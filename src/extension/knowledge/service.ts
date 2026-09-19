import type { KnowledgeCapabilities, KnowledgeProvider, KnowledgeServerConfig } from '../../shared/knowledge/types';
import { createProvider, KNOWN_KINDS } from './registry';
import { McpHttpClient } from './mcpHttpClient';

const NO_CAPABILITIES: KnowledgeCapabilities = { scopes: false, tags: false, recency: false, facets: false, write: false };

/**
 * Owns one provider per configured server. Nothing here talks to the network: a provider is built
 * from its config, and the transport connects on its first tool call.
 */
export class KnowledgeService {
  private providers = new Map<string, KnowledgeProvider>();
  private errors = new Map<string, string>();

  /** - re-read on every webview ready, so a token or url edit takes effect on reload */
  configure(servers: KnowledgeServerConfig[]): void {
    this.providers.clear();
    this.errors.clear();
    for (const s of servers) {
      try {
        this.providers.set(s.name, createProvider(s, new McpHttpClient({ url: s.url, token: s.token })));
      } catch (e) {
        // - an unknown kind is listed as unavailable with its reason, not dropped
        this.errors.set(s.name, (e as Error).message);
      }
    }
  }

  list(): { name: string; kind: string; capabilities: KnowledgeCapabilities; error?: string }[] {
    return [
      ...[...this.providers.values()].map(p => ({ name: p.name, kind: p.kind, capabilities: p.capabilities })),
      ...[...this.errors].map(([name, error]) => ({ name, kind: 'unknown', capabilities: NO_CAPABILITIES, error })),
    ];
  }

  provider(name: string): KnowledgeProvider {
    const p = this.providers.get(name);
    if (!p) throw new Error(`no knowledge server "${name}" (known kinds: ${KNOWN_KINDS.join(', ')})`);
    return p;
  }
}
