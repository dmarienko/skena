/**
 * The url check react-markdown applies to every href and src skena's markdown renders. Its own
 * defaultUrlTransform keeps only http(s), ircs, mailto, xmpp and relative urls; anything else comes back
 * "". Two relaxations:
 * - an img src: a data:image/… url, or any other scheme:// that is not javascript:, vbscript: or
 *   data:text/html, so a knowledge server's own scheme (crtx://…) reaches knowledgeAssets.ts;
 * - a link href to vault://<vault>/<path>, which the host resolves (file-resolver.ts).
 * Every other href stays on the default, so a link to a dangerous scheme is still blocked.
 */
import { defaultUrlTransform } from 'react-markdown';
import type { UrlTransform } from 'react-markdown';

const IMG_SRC_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const BLOCKED_IMG_SCHEME = new Set(['data', 'javascript', 'vbscript', 'http', 'https']);

export const markdownUrlTransform: UrlTransform = (url, key, node) => {
  if (key === 'src' && node.tagName === 'img') {
    if (/^data:image\//i.test(url)) return url;
    const scheme = IMG_SRC_SCHEME.exec(url)?.[1]?.toLowerCase();
    if (scheme && !BLOCKED_IMG_SCHEME.has(scheme)) return url;
  }
  if (key === 'href' && url.startsWith('vault://')) return url;
  return defaultUrlTransform(url);
};
