export interface CrtxRef { vault: string; file: string; heading: string }

export function parseCrtxUri(uri: string): CrtxRef {
  const m = /^crtx:\/\/([^/]+)\/([^#]*)(?:#(.*))?$/.exec(uri);
  if (!m) throw new Error(`not a crtx uri: ${uri}`);
  return { vault: m[1], file: m[2], heading: m[3] ?? '' };
}

export function buildCrtxUri(r: CrtxRef): string {
  return `crtx://${r.vault}/${r.file}${r.heading ? `#${r.heading}` : ''}`;
}

// - the web app lives on port 8787 of the host the MCP server runs on
function webHost(serverUrl: string): string {
  return `http://${new URL(serverUrl).hostname}:8787`;
}

// - the web reader jumps to the heading by text match
export function crtxReaderUrl(uri: string, serverUrl: string): string {
  const r = parseCrtxUri(uri);
  return `${webHost(serverUrl)}/#${r.vault}/${encodeURIComponent(r.file)}`;
}

// - the web app's file route; it serves nothing outside the vault's assets/ directory, and `file`
//   is the path from the vault root, assets/ included
export function crtxAssetUrl(uri: string, serverUrl: string): string {
  const r = parseCrtxUri(uri);
  return `${webHost(serverUrl)}/api/asset?vault=${encodeURIComponent(r.vault)}&file=${encodeURIComponent(r.file)}`;
}
