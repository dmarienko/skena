import type { KnowledgeProvider, KnowledgeServerConfig, ToolTransport } from '../../shared/knowledge/types';
import { createCrtxProvider } from './adapters/crtx';

const KINDS: Record<string, (c: KnowledgeServerConfig, t: ToolTransport) => KnowledgeProvider> = {
  crtx: createCrtxProvider,
};

export const KNOWN_KINDS = Object.keys(KINDS);

export function createProvider(config: KnowledgeServerConfig, transport: ToolTransport): KnowledgeProvider {
  const make = KINDS[config.kind];
  if (!make) throw new Error(`unknown knowledge server kind "${config.kind}" (known: ${KNOWN_KINDS.join(', ')})`);
  return make(config, transport);
}
