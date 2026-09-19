import type { KnowledgeCapabilities, KnowledgeProvider, KnowledgeServerConfig } from '../../shared/knowledge/types';
import { createProvider } from './registry';
import { McpHttpClient } from './mcpHttpClient';

const NO_CAPABILITIES: KnowledgeCapabilities = { scopes: false, tags: false, recency: false, facets: false, write: false };

/**
 * Owns one provider per configured server. Nothing here talks to the network: a provider is built
 * from its config, and the transport connects on its first tool call.
 */
export class KnowledgeService {
  private providers = new Map<string, KnowledgeProvider>();
  private errors = new Map<string, string>();
  private configured: string[] = [];

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
}
