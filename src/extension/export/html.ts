/**
 * String helpers for the exported page: escaping, JSON inside a script element, and the HTML that
 * goes into it from cells, knowledge servers and files made static: nothing in it runs and nothing
 * in it loads from the network. Pure.
 */

import { unified } from 'unified';
import rehypeRaw from 'rehype-raw';
import { toHtml } from 'hast-util-to-html';
import type { Root } from 'hast';
import { sanitizeHtmlAttrs } from '../../webview/canvas/nodes/knowledgeHtml';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** - JSON text that can sit inside <script type="application/json">: no "</script" can end it early. JSON.parse reads \u003c back as "<". */
export function jsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c');
}

const ELEMENTS_WITH_BODY = /<(script|iframe|object|embed|frame|frameset|applet|noscript)\b[\s\S]*?<\/\1\s*>/gi;
// - an opening tag left without its closing one, and the void elements that load or redirect
const LONE_TAGS = /<(?:script|iframe|object|embed|frame|frameset|applet|link|base)\b[^>]*>|<meta\b[^>]*http-equiv[^>]*>/gi;
const SRCSET = /\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const CSS_IMPORT = /@import\s+[^;]*;/gi;
const CSS_REMOTE_URL = /url\(\s*['"]?(?:https?:)?\/\/[^)]*\)/gi;

/**
 * `html` with everything that would run or load in a static page taken out: script, iframe, object,
 * embed and link elements, http-equiv meta, srcset, CSS @import and remote url(), event handler
 * attributes and javascript: urls (sanitizeHtmlAttrs). In the webview this html goes in through
 * innerHTML, where scripts do not run either.
 */
export function stripActiveHtml(html: string): string {
  const out = html
    .replace(ELEMENTS_WITH_BODY, '')
    .replace(LONE_TAGS, '')
    .replace(SRCSET, '')
    .replace(CSS_IMPORT, '')
    .replace(CSS_REMOTE_URL, 'none');
  return sanitizeHtmlAttrs(out);
}

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ALT_ATTR = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** The src of every <img> in `html` that is not a data: url, as written in the attribute, each once. */
export function imageSources(html: string): string[] {
  const out = new Set<string>();
  for (const tag of html.match(IMG_TAG) ?? []) {
    const m = SRC_ATTR.exec(tag);
    const src = m ? m[1] ?? m[2] ?? m[3] ?? '' : '';
    if (src && !/^data:/i.test(src)) out.add(src);
  }
  return [...out];
}

/**
 * Every <img> whose src is a key of `resolved`: a string replaces the src (a data: url), null
 * replaces the image with its alt text and the address it could not be read from. Other images
 * are left as they are.
 */
export function swapImageSources(html: string, resolved: ReadonlyMap<string, string | null>): string {
  return html.replace(IMG_TAG, tag => {
    const m = SRC_ATTR.exec(tag);
    const src = m ? m[1] ?? m[2] ?? m[3] ?? '' : '';
    if (!m || !resolved.has(src)) return tag;
    const got = resolved.get(src);
    if (got) return tag.slice(0, m.index) + `src="${escapeHtml(got)}"` + tag.slice(m.index + m[0].length);
    const alt = ALT_ATTR.exec(tag);
    const text = alt ? decodeAttr(alt[1] ?? alt[2] ?? '') : '';
    const where = decodeAttr(src);
    return `<span class="skena-export-missing" title="${escapeHtml(where)}">[image${text ? `: ${escapeHtml(text)}` : ''} — ${escapeHtml(where)}]</span>`;
  });
}

/** - an attribute value as written, with its character references decoded (for reading a file or a url) */
export function decodeAttr(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const parser = unified().use(rehypeRaw);

/**
 * `fragment` parsed as the browser parses it and written back, so every element it opens is closed
 * inside it. The webview puts each node's html in with innerHTML, which does this per node; one
 * static page has no such boundary, and an unclosed <div> in a cell (capOutputHtml cuts long html
 * at a byte count) would swallow every node after it.
 */
export function balanceHtml(fragment: string): string {
  const tree = parser.runSync({ type: 'root', children: [{ type: 'raw', value: fragment }] } as Root);
  return toHtml(tree as Root);
}
