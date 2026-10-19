/**
 * What a clicked markdown link asks the host to open. A rendered href is URL-encoded (a space in
 * `[x](<a b.canvas#N1>)` arrives as `a%20b.canvas#N1`) while the host resolves file paths, so a path or a
 * vault:// uri is decoded. A web or mail address is sent as written. No vscode import.
 */

// - a scheme of two or more characters: `C:` on Windows is a drive, not a scheme
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;

export function hrefToOpenTarget(href: string): string {
  if (SCHEME.test(href) && !href.startsWith('vault://')) return href;
  try {
    return decodeURIComponent(href);
  } catch {
    return href;   // - a lone % that is not an escape: the name as written
  }
}
