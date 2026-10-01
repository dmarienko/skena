/**
 * YouTube links on the canvas. The webview cannot play YouTube (the player refuses to play in a VS
 * Code webview), so a link node to a video shows its thumbnail and opens the video in the browser.
 */

/** Size of a link node that shows a video thumbnail: 16:9 picture under the one-line header. */
export const YOUTUBE_NODE = { w: 500, h: 320 } as const;

/** The video id of a YouTube watch / share / shorts / embed / live URL, or null for anything else. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

/** The thumbnail YouTube serves for every video (480x360, the picture letterboxed to 4:3). */
export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
