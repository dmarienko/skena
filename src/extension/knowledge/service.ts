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

// - the failures that mean the server itself did not answer, so the rest of its targets would fail
//   the same way: a timeout or an HTTP status from McpHttpClient, undici's bare "fetch failed", and
//   this file's own "no knowledge server". Anything else (a uri that does not parse, an unknown
//   tool name) belongs to the one node that asked for it.
const TRANSPORT = /timed out after|^HTTP \d|fetch failed|^no knowledge server /;

/**
 * Owns one provider per configured server. Nothing here talks to the network: a provider is built
 * from its config, and the transport connects on its first tool call.
 */
export class KnowledgeService {
  private providers = new Map<string, KnowledgeProvider>();
  private errors = new Map<string, string>();
  private configured: string[] = [];
  /** - the open run per canvas, so a second canvas does not cancel the first one's fetches */
  private refreshing = new Map<string, { cancel(): void }>();

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
   * webview, at most MAX_IN_FLIGHT per server; a server that did not answer drops the rest of its
   * targets. One run per key (the canvas path): a new call cancels the previous run of that key
   * only. The last emit of a run carries finished = true, whether it ran out or was cancelled.
   */
  startRefresh(
    key: string,
    targets: RefreshTarget[],
    emit: (batch: RefreshOutcome[], finished: boolean) => void,
  ): { cancel(): void } {
    this.refreshing.get(key)?.cancel();
    const q = newQueue(targets);
    let cancelled = false;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (this.refreshing.get(key) === handle) this.refreshing.delete(key);
      emit(drain(q), true);
    };

    const fetchOne = async (t: RefreshTarget) => {
      try {
        const got = await this.provider(t.server).fetch(t.uri);
        if (cancelled) return;
        settle(q, t, outcomeOf(t, { text: got.text, title: got.title, fetchedAt: got.fetchedAt }));
      } catch (e) {
        if (cancelled) return;
        // - a uri that no longer resolves is this node's problem, and so is a malformed one; only a
        //   server that did not answer stops the rest of its targets
        if (e instanceof KnowledgeGoneError) settle(q, t, outcomeOf(t, { gone: e.message }));
        else {
          const msg = (e as Error).message;
          settle(q, t, outcomeOf(t, { error: msg }), TRANSPORT.test(msg));
        }
      }
      if (!cancelled) fillSlots();
    };

    const fillSlots = () => {
      for (let t = takeNext(q); t; t = takeNext(q)) void fetchOne(t);
    };

    const handle = {
      cancel: () => {
        cancelled = true;
        stop();
      },
    };
    this.refreshing.set(key, handle);

    timer = setInterval(() => {
      if (q.ready.length > 0) emit(drain(q), false);
      if (done(q)) stop();
    }, BATCH_MS);
    fillSlots();
    return handle;
  }
}
