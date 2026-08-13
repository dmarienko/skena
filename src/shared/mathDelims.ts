/**
Normalize LaTeX-style math delimiters to the `$` / `$$` form that remark-math understands, so KaTeX
renders math written as `\(…\)` (inline) and `\[…\]` (display) — common in exported papers. Fenced
```code``` blocks and `inline code` are masked first so literal brackets there are never mangled.
*/

const NUL = String.fromCharCode(0);   // - sentinel; cannot occur in markdown prose

export function normalizeMathDelimiters(md: string): string {
  if (!md.includes('\\(') && !md.includes('\\[')) return md;

  // - mask code spans so the delimiter rewrite can't touch literal brackets inside code
  const codeSpans: string[] = [];
  const mask = (m: string): string => `${NUL}${codeSpans.push(m) - 1}${NUL}`;
  const masked = md
    .replace(/```[\s\S]*?```/g, mask)   // - fenced code blocks
    .replace(/`[^`\n]*`/g, mask);       // - inline code

  const converted = masked
    // - display: put $$ on its OWN line. remark-math treats `$$…` at line start as BLOCK math whose
    //   rest-of-line is discarded meta and which only closes on a line that is just `$$`; a
    //   multi-line \[…\] (content on the same line as the fence) would otherwise never close and
    //   swallow the rest of the document.
    .replace(/\\\[/g, () => '\n$$\n')   // - display open  \[
    .replace(/\\\]/g, () => '\n$$\n')   // - display close \]
    .replace(/\\\(/g, () => '$')        // - inline open   \(  → $
    .replace(/\\\)/g, () => '$');       // - inline close  \)  → $

  return converted.replace(new RegExp(`${NUL}(\\d+)${NUL}`, 'g'), (_, i) => codeSpans[Number(i)]);
}
