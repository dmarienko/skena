/**
 * Checks an exported page: no element loads anything over the network, and every node is on it.
 * The page is parsed as the browser parses it (parse5, read as hast) and read element by element:
 * loading attributes, svg references, meta refresh, base, and css in style attributes, svg
 * presentation attributes and style elements. Script bodies are not read (plotly.min.js holds URLs
 * it never loads unless a map trace asks), and an <a href> is a link, not a load. Pure.
 */

import { parse } from 'parse5';
import { fromParse5 } from 'hast-util-from-parse5';
import type { ElementContent, Root, RootContent } from 'hast';
import { CSS_ATTRS, attributeName, cssRemoteUrls, isRemoteUrl, loadsUrl, propertyText } from './html';

export interface OfflineReport {
  /** - "<tag> <attr>=<value>" or "css <url>" for each remote load found */
  remote: string[];
  /** - node ids with no data-node-id attribute on the page */
  missingNodeIds: string[];
}

// - the urls of a srcset as its parser reads them: a url runs to the first space, and a comma
//   inside it (a data url) does not end the candidate
function srcsetUrls(srcset: string): string[] {
  const urls: string[] = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i])) i++;
    let j = i;
    while (j < srcset.length && !/\s/.test(srcset[j])) j++;
    const url = srcset.slice(i, j);
    if (url) urls.push(url.replace(/,+$/, ''));
    if (!url.endsWith(',')) while (j < srcset.length && srcset[j] !== ',') j++;
    i = j + 1;
  }
  return urls;
}

export function checkOffline(html: string, nodeIds: readonly string[]): OfflineReport {
  const remote: string[] = [];
  const onPage = new Set<string>();
  const visit = (nodes: readonly (RootContent | ElementContent)[], svg: boolean) => {
    for (const n of nodes) {
      if (n.type !== 'element') continue;
      const tag = n.tagName.toLowerCase();
      const inSvg = svg || tag === 'svg';
      for (const [prop, value] of Object.entries(n.properties)) {
        if (value === null || value === undefined || value === false) continue;
        const name = attributeName(prop, inSvg);
        const v = propertyText(value);
        if (name === 'data-node-id') onPage.add(v);
        const urls = name === 'srcset' ? srcsetUrls(v) : loadsUrl(tag, name, inSvg) || (tag === 'base' && name === 'href') ? [v] : [];
        if (urls.some(isRemoteUrl)) remote.push(`${tag} ${name}=${v}`);
        if (CSS_ATTRS.has(name)) for (const url of cssRemoteUrls(v)) remote.push(`css ${url}`);
      }
      if (tag === 'meta' && /^\s*refresh\s*$/i.test(propertyText(n.properties.httpEquiv ?? ''))) {
        const content = propertyText(n.properties.content ?? '');
        const url = /url\s*=\s*['"]?([^'"]*)/i.exec(content)?.[1] ?? '';
        if (isRemoteUrl(url)) remote.push(`meta content=${content}`);
      }
      if (tag === 'style') for (const c of n.children) if (c.type === 'text') for (const url of cssRemoteUrls(c.value)) remote.push(`css ${url}`);
      if (tag !== 'script') visit(n.children, inSvg && tag !== 'foreignobject');
      if (n.content) visit(n.content.children, false);
    }
  };
  // - no source positions: hast-util-from-html computes them, and that takes 40 s on a 14 MB page
  visit((fromParse5(parse(html)) as Root).children, false);
  return { remote, missingNodeIds: nodeIds.filter(id => !onPage.has(id)) };
}
