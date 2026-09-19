/**
 * Strip what executes from html the host rendered out of a knowledge server's markdown: inline
 * event handler attributes and javascript: URLs. A knowledge node injects that html with
 * dangerouslySetInnerHTML and the webview CSP allows inline script, so a note written by anyone
 * who can write to the server would otherwise run in the webview.
 */

// - on… attributes, quoted, single-quoted or bare. A code block that shows one as text loses it
//   too; a mangled sample is a smaller price than a live handler.
const EVENT_ATTR = /\son[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

// - href / src, keeping the name and the quoting so only the value is judged
const URL_ATTR = /(\s(?:href|src|xlink:href)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

const chr = (code: number): string => (code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '');

// - what the browser reads once it has decoded the entities and dropped the control characters a
//   scheme may carry, so "java&#115;cript:" and "java\tscript:" are caught as well
function decodeScheme(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => chr(parseInt(h, 16)))
    .replace(/&#(\d+);?/g,         (_, d: string) => chr(Number(d)))
    .replace(/[\x00-\x20]/g, '')
    .toLowerCase();
}

export function sanitizeHtmlAttrs(html: string): string {
  return html
    .replace(EVENT_ATTR, '')
    .replace(URL_ATTR, (whole, name: string, quoted?: string, single?: string, bare?: string) => {
      const value = quoted ?? single ?? bare ?? '';
      return decodeScheme(value).startsWith('javascript:') ? `${name}"#"` : whole;
    });
}
