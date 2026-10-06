/**
 * Helpers for the exported page: escaping, JSON inside a script element, and the html of each node
 * made static on its parsed tree: nothing in it runs, nothing in it loads from the network, its
 * images are put in as data urls, and every element it opens is closed inside it. Text is never
 * changed. Pure.
 */

import { unified } from 'unified';
import rehypeRaw from 'rehype-raw';
import { toHtml } from 'hast-util-to-html';
import { find, html as htmlSchema, svg as svgSchema } from 'property-information';
import type { Element, ElementContent, Properties, Root, RootContent } from 'hast';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** - JSON text that can sit inside <script type="application/json">: no "</script" can end it early. JSON.parse reads < back as "<". */
export function jsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c');
}

const parser = unified().use(rehypeRaw);

/** - `fragment` parsed as the browser parses html set through innerHTML */
export function parseFragment(fragment: string): Root {
  return parser.runSync({ type: 'root', children: [{ type: 'raw', value: fragment }] } as Root) as Root;
}

// - elements that run, embed another document, or change where the page loads from
const DROPPED = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'link', 'base', 'portal']);
// - attributes whose value the browser follows or loads (knowledgeHtml.ts URL_ATTRS and the loading ones)
const URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'action', 'formaction', 'data', 'poster', 'background']);
// - attributes that load their url when the page opens, on any element
const LOAD_ATTRS = new Set(['src', 'srcset', 'poster', 'data', 'background']);
// - the style attribute and the svg presentation attributes that take a css url()
export const CSS_ATTRS = new Set(['style', 'fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'cursor']);

/** - a url the browser fetches over the network, read as its url parser reads it (tabs and newlines dropped, \ as /) */
export function isRemoteUrl(url: string): boolean {
  const u = url.replace(/[\t\n\r]/g, '').replace(/\\/g, '/').trim();
  return /^(?:(?:https?|ftp):|\/\/)/i.test(u);
}

// - a url that runs when followed or loaded, read as the browser reads its scheme (control characters and spaces dropped)
function runsUrl(name: string, url: string): boolean {
  const v = url.replace(/[\x00-\x20]/g, '').toLowerCase();
  return v.startsWith('javascript:') || v.startsWith('vbscript:') || ((name === 'src' || name === 'data') && v.startsWith('data:text/html'));
}

/** - the attribute `name` of `tag` loads its url when the page opens: src, srcset, poster…, a link's href, an svg reference */
export function loadsUrl(tag: string, name: string, svg: boolean): boolean {
  if (LOAD_ATTRS.has(name)) return true;
  if (name === 'href' || name === 'xlink:href') return tag === 'link' || (svg && tag !== 'a');
  return false;
}

/** - the attribute name of hast property `prop` (onClick → onclick, xLinkHref → xlink:href), lower case */
export function attributeName(prop: string, svg: boolean): string {
  return find(svg ? svgSchema : htmlSchema, prop).attribute.toLowerCase();
}

export function propertyText(value: Properties[string]): string {
  return Array.isArray(value) ? value.join(' ') : String(value);
}

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_URL = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi;
const CSS_IMPORT = /@import\b[^;]*;?/gi;
const CSS_IMPORT_STRING = /@import\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_STRING = /"([^"]*)"|'([^']*)'/g;
const IMAGE_SET = /(?:-webkit-)?image-set\(/gi;
// - css that cannot name a url: no url(, @import, image-set( and no escape that could spell one
const CSS_PLAIN = /^(?:(?!url\(|@import|image-set\()[^\\])*$/i;

const chr = (code: number): string => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�');

// - css escapes read as the css tokenizer reads them (u\72l is url)
function cssUnescape(css: string): string {
  return css.replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, (_, h: string) => chr(parseInt(h, 16))).replace(/\\([^\n0-9a-f])/gi, '$1');
}

// - [start, end) of the argument list of each image-set( in `css`
function imageSetBodies(css: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of css.matchAll(IMAGE_SET)) {
    const open = (m.index ?? 0) + m[0].length;
    let depth = 1;
    let quote = '';
    let i = open;
    for (; i < css.length && depth > 0; i++) {
      const c = css[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    out.push([open, depth === 0 ? i - 1 : i]);
  }
  return out;
}

/** - the remote addresses `css` loads: url(), @import "…" and the strings of image-set(), comments and escapes read as css reads them */
export function cssRemoteUrls(css: string): string[] {
  if (CSS_PLAIN.test(css)) return [];
  const s = cssUnescape(css.replace(CSS_COMMENT, ''));
  const urls: string[] = [];
  for (const m of s.matchAll(CSS_URL)) urls.push(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of s.matchAll(CSS_IMPORT_STRING)) urls.push(m[1] ?? m[2] ?? '');
  for (const [a, b] of imageSetBodies(s)) for (const m of s.slice(a, b).matchAll(CSS_STRING)) urls.push(m[1] ?? m[2] ?? '');
  return urls.filter(isRemoteUrl);
}

// - `css` with every @import taken out and every remote url() or image-set() address made `none`;
//   empty when an escape or a comment still hides a remote address
function cleanCss(css: string): string {
  if (CSS_PLAIN.test(css)) return css;
  let out = css
    .replace(CSS_IMPORT, '')
    .replace(CSS_URL, (m, dq?: string, sq?: string, bare?: string) => (isRemoteUrl(dq ?? sq ?? bare ?? '') ? 'none' : m));
  for (const [a, b] of imageSetBodies(out).reverse()) {
    const body = out.slice(a, b).replace(CSS_STRING, (m, dq?: string, sq?: string) => (isRemoteUrl(dq ?? sq ?? '') ? 'none' : m));
    out = out.slice(0, a) + body + out.slice(b);
  }
  return cssRemoteUrls(out).length ? '' : out;
}

type Resolved = ReadonlyMap<string, string | null>;
type Child = RootContent | ElementContent;

// - an image the swap has no data url for: its alt text and the address it could not be read from
function missingImage(src: string, alt: string): Element {
  return {
    type: 'element', tagName: 'span', properties: { className: ['skena-export-missing'], title: src },
    children: [{ type: 'text', value: `[image${alt ? `: ${alt}` : ''} — ${src}]` }],
  };
}

function cleanProps(el: Element, tag: string, svg: boolean): void {
  for (const [prop, value] of Object.entries(el.properties)) {
    if (value === null || value === undefined || value === false) continue;
    const name = attributeName(prop, svg);
    const v = propertyText(value);
    // - srcset goes whole, as before: the src the export puts in is the image's one source
    if (name.startsWith('on') || name === 'srcdoc' || name === 'srcset'
      || (URL_ATTRS.has(name) && runsUrl(name, v))
      || (loadsUrl(tag, name, svg) && isRemoteUrl(v))) {
      delete el.properties[prop];
      continue;
    }
    if (CSS_ATTRS.has(name)) {
      const css = cleanCss(v);
      if (css === v) continue;
      if (css) el.properties[prop] = css; else delete el.properties[prop];
    }
  }
}

function isDropped(el: Element, tag: string, svg: boolean): boolean {
  if (DROPPED.has(tag)) return true;
  if (tag === 'meta' && el.properties.httpEquiv != null) return true;
  // - an svg animation can set an href or a src to anything
  return svg && (tag === 'set' || tag.startsWith('animate')) && /href|src/i.test(String(el.properties.attributeName ?? ''));
}

function cleanElement(el: Element, svg: boolean, resolved: Resolved | null): Element | null {
  const tag = el.tagName.toLowerCase();
  const inSvg = svg || tag === 'svg';
  if (isDropped(el, tag, inSvg)) return null;
  if (tag === 'img' && resolved) {
    const src = el.properties.src;
    if (typeof src === 'string' && resolved.has(src)) {
      const got = resolved.get(src);
      if (!got) return missingImage(src, typeof el.properties.alt === 'string' ? el.properties.alt : '');
      el.properties.src = got;
    }
  }
  cleanProps(el, tag, inSvg);
  if (tag === 'style') for (const c of el.children) if (c.type === 'text') c.value = cleanCss(c.value);
  cleanChildren(el, inSvg && tag !== 'foreignobject', resolved);
  if (el.content) cleanChildren(el.content, false, resolved);
  return el;
}

function cleanChildren(parent: Root | Element, svg: boolean, resolved: Resolved | null): void {
  const out: Child[] = [];
  for (const child of parent.children) {
    if (child.type !== 'element') { out.push(child); continue; }
    const kept = cleanElement(child, svg, resolved);
    if (kept) out.push(kept);
  }
  parent.children = out as typeof parent.children;
}

// - the src of every <img> that is not a data url, each once, in document order (template content too)
function imageSources(tree: Root): string[] {
  const out = new Set<string>();
  const visit = (nodes: readonly Child[], svg: boolean) => {
    for (const n of nodes) {
      if (n.type !== 'element') continue;
      const tag = n.tagName.toLowerCase();
      const inSvg = svg || tag === 'svg';
      if (isDropped(n, tag, inSvg)) continue;
      const src = n.properties.src;
      if (tag === 'img' && typeof src === 'string' && src.trim() && !/^\s*data:/i.test(src)) out.add(src);
      visit(n.children, inSvg && tag !== 'foreignobject');
      if (n.content) visit(n.content.children, false);
    }
  };
  visit(tree.children, false);
  return [...out];
}

/**
 * `html` as it goes on the page: parsed as the browser parses it; each <img> source that is not a
 * data url handed to `resolve` once, which gives its data url, or null for its alt text and address
 * in its place; scripts, event handlers, javascript: urls, embedded documents and every remote load
 * (attributes and css) taken out; written back with every element closed. Text is never changed.
 */
export async function staticHtml(html: string, resolve?: (sources: string[]) => Promise<Resolved>): Promise<string> {
  const tree = parseFragment(html);
  const sources = resolve ? imageSources(tree) : [];
  const resolved = resolve && sources.length ? await resolve(sources) : null;
  cleanChildren(tree, false, resolved);
  return toHtml(tree);
}
