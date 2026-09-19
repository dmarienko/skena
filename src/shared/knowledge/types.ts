export interface KnowledgeQuery { text: string; scope?: string; tags?: string[]; recency?: boolean; top: number }

export interface KnowledgeHit {
  server:    string;
  uri:       string;
  title:     string;
  subtitle?: string;
  date?:     string;
  tags:      string[];
  snippet:   string;
}

export interface KnowledgeText { uri: string; title: string; text: string; fetchedAt: string }

export interface KnowledgeWrite {
  title:  string;
  text:   string;
  tags?:  string[];
  scope?: string;
  // - a folder / parent inside the scope; the crtx vault requires it
  dest?:  string;
  source: { canvas: string; nodeIds: string[]; kind: 'node' | 'output' | 'group' | 'ai' };
}

export interface KnowledgeCapabilities { scopes: boolean; tags: boolean; recency: boolean; facets: boolean; write: boolean }

export interface KnowledgeProvider {
  readonly name: string;
  readonly kind: string;
  readonly capabilities: KnowledgeCapabilities;
  search(q: KnowledgeQuery): Promise<KnowledgeHit[]>;
  // - signal: the caller's cancel (a refresh run being dropped); an aborted fetch rejects with "cancelled"
  fetch(uri: string, signal?: AbortSignal): Promise<KnowledgeText>;
  scopes(): Promise<string[]>;
  facets(scope?: string): Promise<{ tags: [string, number][] }>;
  openUrl(uri: string): string | undefined;
  write(item: KnowledgeWrite): Promise<{ uri: string }>;
  append(uri: string, item: KnowledgeWrite): Promise<void>;
}

export interface KnowledgeServerConfig { name: string; kind: string; url: string; token?: string }

/** - the one thing an adapter needs from a transport */
export interface ToolTransport { callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> }

/** - thrown by adapters when a uri no longer resolves (heading or page gone); refresh keeps the old text */
export class KnowledgeGoneError extends Error {
  // - subclassing Error leaves `.name` as "Error"; set it so callers can tell this error apart by name
  constructor(message?: string) {
    super(message);
    this.name = 'KnowledgeGoneError';
  }
}
