// - pure delimiter matcher for embedded Typst math; no unified/DOM deps. Unit-tested.
// - inline `%body%`, block `%%body%%`. Strict boundary rules to avoid prose collisions
// - with literal percent signs (mirrors remark-math's `$` rules):
// -   opening delimiter immediately followed by a non-space,
// -   closing delimiter immediately preceded by a non-space,
// -   inline spans do not cross a newline, empty body is not math.

export interface TypstSpan { start: number; end: number; body: string; block: boolean }

export function findTypstSpans(text: string): TypstSpan[] {
  const out: TypstSpan[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '%') { i++; continue; }
    const block = text[i + 1] === '%';
    const open = block ? 2 : 1;
    const after = text[i + open];
    // - opening must be followed by a non-space, non-% char
    if (after === undefined || after === ' ' || after === '\t' || after === '%' || (!block && after === '\n')) { i += open; continue; }
    // - scan for the matching close
    const closeDelim = block ? '%%' : '%';
    let j = i + open;
    let found = -1;
    while (j < text.length) {
      if (!block && text[j] === '\n') break;             // - inline never crosses newline
      if (text.startsWith(closeDelim, j) && (block || text[j - 1] !== '%')) {
        const before = text[j - 1];
        if (before !== ' ' && before !== '\t' && before !== '\n' && before !== '%') { found = j; break; }
      }
      j++;
    }
    if (found < 0) { i += open; continue; }
    const body = text.slice(i + open, found);
    if (body.trim()) out.push({ start: i, end: found + open, body, block });
    i = found + open;
  }
  return out;
}
