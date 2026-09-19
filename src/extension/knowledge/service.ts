import type { KnowledgeCapabilities, KnowledgeProvider, KnowledgeServerConfig } from '../../shared/knowledge/types';
import { KnowledgeGoneError } from '../../shared/knowledge/types';
import type { RefreshOutcome, RefreshTarget } from '../../shared/knowledge/refresh';
import { done, drain, newQueue, outcomeOf, settle, takeNext } from '../../shared/knowledge/refresh';
import { createProvider } from './registry';
import { McpHttpClient } from './mcpHttpClient';

const NO_CAPABILITIES: KnowledgeCapabilities = { scopes: false, tags: false, recency: false, facets: false, write: false };

// - how often finished fetches go to the webview as one message: often enough to watch the nodes
//   fill in, rarely enough that a canvas with hundreds of them repaints a few at a time
const BATCH_MS = 250;

/**
 * Owns one provider per configured server. Nothing here talks to the network: a provider is built
 * from its config, and the transport connects on its first tool call.
 */
export class KnowledgeService {
  private providers = new Map<string, KnowledgeProvider>();
  private errors = new Map<string, string>();
  private configured: string[] = [];
  /** - the run started by the last startRefresh, so the next one can cancel it */
  private refreshing: { cancel(): void } | null = null;

  /** - re-read on every webview ready, so a token or url edit takes effect on reload */
  configure(servers: KnowledgeServerConfig[]): void {
    this.providers.clear();
    this.errors.clear();
    this.configured = servers.map(s => s.name);
    for (const s of servers) {
      try {
        this.providers.set(s.name, createProvider(s, new McpHttpClient({ url: s.url, token: s.token })));
      } catch (e) {
        // - an unknown kind is listed as unavailable with its reason, not dropped
        this.errors.set(s.name, (e as Error).message);
      }
    }
  }

  /** - config order, so the dialog's selector reads as the settings file does */
  list(): { name: string; kind: string; capabilities: KnowledgeCapabilities; error?: string }[] {
    return this.configured.map(name => {
      const p = this.providers.get(name);
      return p
        ? { name: p.name, kind: p.kind, capabilities: p.capabilities }
        : { name, kind: 'unknown', capabilities: NO_CAPABILITIES, error: this.errors.get(name) ?? 'not configured' };
    });
  }

  provider(name: string): KnowledgeProvider {
    const p = this.providers.get(name);
    if (!p) throw new Error(`no knowledge server "${name}" (configured: ${this.configured.join(', ') || 'none'})`);
    return p;
  }

  /**
   * Fetch each target again and report the outcomes in batches. The calls run here, off the
   * webview, at most MAX_IN_FLIGHT per server; a server that fails once drops the rest of its
   * targets. One run at a time: a new call cancels the previous one.
   */
  startRefresh(targets: RefreshTarget[], emit: (batch: RefreshOutcome[]) => void): { cancel(): void } {
    this.refreshing?.cancel();
    const q = newQueue(targets);
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      if (q.ready.length > 0) emit(drain(q));
      if (this.refreshing === handle) this.refreshing = null;
    };

    const fetchOne = async (t: RefreshTarget) => {
      try {
        const got = await this.provider(t.server).fetch(t.uri);
        if (cancelled) return;
        settle(q, t, outcomeOf(t, { text: got.text, title: got.title, fetchedAt: got.fetchedAt }));
      } catch (e) {
        if (cancelled) return;
        // - a uri that no longer resolves is this node's problem; anything else (no such server,
        //   timeout, HTTP error) is the server's, so the run for that server stops
        if (e instanceof KnowledgeGoneError) settle(q, t, outcomeOf(t, { gone: e.message }));
        else settle(q, t, outcomeOf(t, { error: (e as Error).message }), true);
      }
      if (!cancelled) fillSlots();
    };

    const fillSlots = () => {
      for (let t = takeNext(q); t; t = takeNext(q)) void fetchOne(t);
    };

    const handle = {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        stop();
      },
    };
    this.refreshing = handle;

    timer = setInterval(() => {
      if (q.ready.length > 0) emit(drain(q));
      if (done(q)) stop();
    }, BATCH_MS);
    fillSlots();
    return handle;
  }
}
