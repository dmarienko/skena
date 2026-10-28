/**
 * The marks of a code cell: every line `# %% <text>` (the cell marker of VS Code's Python Interactive
 * window and of Jupytext), with its text. A marker without text is not a mark. No vscode import.
 */
export interface CodeMark {
  /** - 1-based line of the marker */
  line: number;
  text: string;
}

const MARKER = /^\s*#\s*%%(.*)$/;

export function codeMarks(code: string): CodeMark[] {
  const out: CodeMark[] = [];
  code.split('\n').forEach((raw, i) => {
    const m = MARKER.exec(raw.replace(/\r$/, ''));
    const text = m?.[1].trim();
    if (text) out.push({ line: i + 1, text });
  });
  return out;
}
