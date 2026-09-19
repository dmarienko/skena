export interface CrtxRef { vault: string; file: string; heading: string }

export function parseCrtxUri(uri: string): CrtxRef {
  const m = /^crtx:\/\/([^/]+)\/([^#]*)(?:#(.*))?$/.exec(uri);
  if (!m) throw new Error(`not a crtx uri: ${uri}`);
  return { vault: m[1], file: m[2], heading: m[3] ?? '' };
}

export function buildCrtxUri(r: CrtxRef): string {
  return `crtx://${r.vault}/${r.file}${r.heading ? `#${r.heading}` : ''}`;
}

// - the web reader lives on port 8787 of the same host; it jumps to the heading by text match
export function crtxReaderUrl(uri: string, serverUrl: string): string {
  const r = parseCrtxUri(uri);
  const host = new URL(serverUrl).hostname;
  return `http://${host}:8787/#${r.vault}/${encodeURIComponent(r.file)}`;
}
