/**
 * Checks an exported page: no element loads anything over the network, and every node is on it.
 * Script bodies are not read (plotly.min.js holds URLs it never loads unless a map trace asks), and
 * an <a href> is a link, not a load. Pure.
 */

import { escapeHtml } from './html';

export interface OfflineReport {
  /** - "<tag> <attr>=<value>" or "css <url>" for each remote load found */
  remote: string[];
  /** - node ids with no data-node-id attribute on the page */
  missingNodeIds: string[];
}

const SCRIPT_BODY = /(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi;
const LOADING_TAG = /<(script|link|img|iframe|source|video|audio|embed|object|image|track|input|frame)\b([^>]*)>/gi;
const LOADING_ATTR = /(?:^|\s)(src|href|srcset|poster|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const STYLE_BODY = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const STYLE_ATTR = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_REMOTE = /(?:url\(\s*['"]?|@import\s+['"])((?:https?:)?\/\/[^'")\s]*)/gi;
const REMOTE = /^\s*(?:https?:)?\/\//i;

export function checkOffline(html: string, nodeIds: readonly string[]): OfflineReport {
  const page = html.replace(SCRIPT_BODY, '$1$2');
  const remote: string[] = [];
  for (const [, tag, attrs] of page.matchAll(LOADING_TAG)) {
    for (const [, name, dq, sq, bare] of attrs.matchAll(LOADING_ATTR)) {
      const value = dq ?? sq ?? bare ?? '';
      const parts = name.toLowerCase() === 'srcset' ? value.split(',').map(p => p.trim().split(/\s+/)[0]) : [value];
      if (parts.some(p => REMOTE.test(p))) remote.push(`${tag.toLowerCase()} ${name}=${value}`);
    }
  }
  const css: string[] = [];
  for (const [, body] of page.matchAll(STYLE_BODY)) css.push(body);
  for (const [, dq, sq] of page.matchAll(STYLE_ATTR)) css.push(dq ?? sq ?? '');
  for (const text of css) for (const [, url] of text.matchAll(CSS_REMOTE)) remote.push(`css ${url}`);
  const missingNodeIds = nodeIds.filter(id => !html.includes(`data-node-id="${escapeHtml(id)}"`));
  return { remote, missingNodeIds };
}
