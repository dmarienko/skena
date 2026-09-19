/**
 * Remove what can execute from html the host rendered out of a knowledge server's markdown:
 * inline event handler attributes, srcdoc, and javascript: or data:text/html urls. A knowledge
 * node injects that html with dangerouslySetInnerHTML and the webview CSP allows inline script,
 * so a note written by anyone who can write to the server would otherwise run in the webview.
 *
 * Only the inside of a tag is rewritten. Text between tags is copied out untouched, so a
 * paragraph that happens to contain "onclick=" keeps its words and a code block that shows a
 * handler as escaped text keeps its sample.
 */

// - attributes whose value the browser follows or loads
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'data']);

// - of those, the ones that load the value as a document: a data: url in them becomes live html
const DOC_ATTRS = new Set(['src', 'data']);

const chr = (code: number): string => (code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '');

const NAMED = /&(amp|colon|tab|newline|lpar|rpar);/gi;
const NAMED_CHAR: Record<string, string> = { amp: '&', colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')' };

// - what the browser reads once it has decoded the entities and dropped the control characters a
//   scheme may carry, so "java&#115;cript:" and "java\tscript:" are caught as well
function decodeScheme(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => chr(parseInt(h, 16)))
    .replace(/&#(\d+);?/g,         (_, d: string) => chr(Number(d)))
    .replace(NAMED,                (_, n: string) => NAMED_CHAR[n.toLowerCase()])
    .replace(/[\x00-\x20]/g, '')
    .toLowerCase();
}

function isDangerousUrl(name: string, value: string): boolean {
  const v = decodeScheme(value);
  return v.startsWith('javascript:') || (DOC_ATTRS.has(name) && v.startsWith('data:text/html'));
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

// - the ">" that ends the tag opened at `from`; a ">" inside a quoted attribute value is part of
//   the value, and a quote only opens a value when it follows the "="
function tagEnd(html: string, from: number): number {
  let quote = '';
  let afterEquals = false;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '>') return i;
    if (c === '=') { afterEquals = true; continue; }
    if (afterEquals && (c === '"' || c === "'")) { quote = c; afterEquals = false; continue; }
    if (isSpace(c)) continue;
    afterEquals = false;
  }
  return -1;
}

interface Attr {
  // - start covers the whitespace before the name, so removing the attribute removes it whole
  start: number;
  end: number;
  name: string;
  value: string;
  // - the value with its quotes, or -1 for an attribute written without one
  valueStart: number;
  valueEnd: number;
}

// - the attributes of one tag; `from` is just past the tag name, `end` the index of the closing ">"
function readAttrs(html: string, from: number, end: number): Attr[] {
  const attrs: Attr[] = [];
  let i = from;
  while (i < end) {
    const wsStart = i;
    while (i < end && isSpace(html[i])) i++;
    if (i >= end) break;
    // - the slash of a self-closing tag, or a stray character where a name should be
    if (html[i] === '/' || html[i] === '=') { i++; continue; }
    const nameStart = i;
    while (i < end && !isSpace(html[i]) && html[i] !== '=' && html[i] !== '/') i++;
    const name = html.slice(nameStart, i).toLowerCase();
    let j = i;
    while (j < end && isSpace(html[j])) j++;
    let valueStart = -1;
    let valueEnd = -1;
    let value = '';
    let attrEnd = i;
    if (html[j] === '=') {
      j++;
      while (j < end && isSpace(html[j])) j++;
      const q = html[j];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, j + 1);
        const stop = close < 0 || close > end ? end : close;
        value = html.slice(j + 1, stop);
        valueStart = j;
        valueEnd = Math.min(stop + 1, end);
      } else {
        let k = j;
        while (k < end && !isSpace(html[k])) k++;
        value = html.slice(j, k);
        valueStart = j;
        valueEnd = k;
      }
      attrEnd = valueEnd;
    }
    attrs.push({ start: wsStart, end: attrEnd, name, value, valueStart, valueEnd });
    i = attrEnd;
  }
  return attrs;
}

// - the tag from "<" at `lt` to ">" at `end`, with the handlers and bad urls taken out; everything
//   else is copied character for character
function cleanTag(html: string, lt: number, end: number): string {
  let nameEnd = lt + 1;
  while (nameEnd < end && !isSpace(html[nameEnd]) && html[nameEnd] !== '/') nameEnd++;
  const edits: { start: number; end: number; text: string }[] = [];
  for (const a of readAttrs(html, nameEnd, end)) {
    if (/^on[a-z-]+$/.test(a.name) || a.name === 'srcdoc') { edits.push({ start: a.start, end: a.end, text: '' }); continue; }
    if (URL_ATTRS.has(a.name) && a.valueStart >= 0 && isDangerousUrl(a.name, a.value)) {
      edits.push({ start: a.valueStart, end: a.valueEnd, text: '"#"' });
    }
  }
  if (!edits.length) return html.slice(lt, end + 1);
  let out = '';
  let at = lt;
  for (const e of edits) { out += html.slice(at, e.start) + e.text; at = e.end; }
  return out + html.slice(at, end + 1);
}

export function sanitizeHtmlAttrs(html: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt < 0) return out + html.slice(i);
    // - a tag name has to follow the "<"; a closing tag carries no attributes, so both are text here
    if (!/[a-zA-Z]/.test(html[lt + 1] ?? '')) { out += html.slice(i, lt + 1); i = lt + 1; continue; }
    const end = tagEnd(html, lt + 1);
    // - no closing ">": the rest of the input is not a tag
    if (end < 0) return out + html.slice(i);
    out += html.slice(i, lt) + cleanTag(html, lt, end);
    i = end + 1;
  }
}
