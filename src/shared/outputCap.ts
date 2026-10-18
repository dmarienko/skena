/**
Guardrails so a huge cell output (e.g. a 1M-row dataframe rendered to HTML) can't flood the webview
DOM or bloat the .canvas file. Applied host-side in renderOutput (caps NEW runs + what is persisted)
AND webview-side in CellNode (protects EXISTING oversized cells already on disk, so they don't freeze
the canvas on load without a re-run).
*/

export const MAX_OUTPUT_HTML_BYTES = 400_000;   // - ~400 KB of HTML
export const MAX_OUTPUT_HTML_ROWS  = 200;       // - table rows to keep (pandas' own view shows ~60)
export const MAX_OUTPUT_TEXT_CHARS = 200_000;   // - ~200 K chars of text/plain or stream

// - an inline image's base64 payload: one attribute, no DOM nodes. It does not count toward the byte
//   limit, and a cut never lands inside one: it is swapped for a short stand-in before the cut and back after
const DATA_IMAGE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]*/gi;
const STAND_IN = /\u0000skena-img-(\d+)\u0000/g;

// - keep a large HTML table renderable: cut to the first N rows, close the table, append a note.
// - falls back to a byte cut for huge non-table HTML. Small HTML is returned untouched.
export function capOutputHtml(html: string): string {
  if (html.includes('\u0000')) return capBareHtml(html);   // - stand-ins could not be told from the text
  const images: string[] = [];
  const bare = html.replace(DATA_IMAGE, m => `\u0000skena-img-${images.push(m) - 1}\u0000`);
  const capped = capBareHtml(bare);
  if (capped === bare) return html;
  return capped.replace(STAND_IN, (_, i: string) => images[Number(i)]);
}

function capBareHtml(html: string): string {
  const rows = (html.match(/<\/tr>/gi) ?? []).length;
  if (rows <= MAX_OUTPUT_HTML_ROWS && html.length <= MAX_OUTPUT_HTML_BYTES) return html;

  if (rows > MAX_OUTPUT_HTML_ROWS) {
    const re = /<\/tr>/gi;
    let m: RegExpExecArray | null;
    let seen = 0;
    let cut  = -1;
    while ((m = re.exec(html)) !== null) {
      if (++seen >= MAX_OUTPUT_HTML_ROWS) { cut = m.index + m[0].length; break; }
    }
    if (cut > 0) {
      return html.slice(0, cut)
        + '</tbody></table>'
        + `<div class="skena-out-truncated">⚠ output truncated — showing first ${MAX_OUTPUT_HTML_ROWS} of ${rows} rows</div>`;
    }
  }
  let kept = html.slice(0, MAX_OUTPUT_HTML_BYTES);
  // - an odd count of stand-in marks: the cut is inside one, which goes
  if ((kept.match(/\u0000/g) ?? []).length % 2 === 1) kept = kept.slice(0, kept.lastIndexOf('\u0000'));
  return kept
    + `<div class="skena-out-truncated">⚠ output truncated — ${Math.round(html.length / 1024)} KB exceeded the ${Math.round(MAX_OUTPUT_HTML_BYTES / 1024)} KB render limit</div>`;
}

// - cap huge text/plain or stream output by characters, with a trailing note.
export function capOutputText(text: string): string {
  if (text.length <= MAX_OUTPUT_TEXT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_TEXT_CHARS)
    + `\n… [truncated ${Math.round((text.length - MAX_OUTPUT_TEXT_CHARS) / 1024)} KB]`;
}
