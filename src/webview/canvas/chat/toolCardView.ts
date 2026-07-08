// - pure mapping from a raw CC tool call to a curated card view; no DOM. Unit-tested.

export interface ToolTodo { text: string; status: string }

export interface ToolCardView {
  title:      string;
  hidden:     boolean;                 // - suppress the card entirely (e.g. Read)
  showResult: boolean;                 // - render resultPreview under the card
  kind:       'generic' | 'todo';
  todos?:     ToolTodo[];
}

function basename(p: unknown): string {
  const s = typeof p === 'string' ? p : '';
  const i = s.replace(/\/+$/, '').lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

export function toolCardView(name: string, input: unknown): ToolCardView {
  const inp = (input ?? {}) as Record<string, unknown>;

  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') {
    return { title: `Edit ${basename(inp.file_path)}`, hidden: false, showResult: true, kind: 'generic' };
  }
  if (name === 'Bash') {
    const cmd = typeof inp.command === 'string' ? inp.command : '';
    const short = cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd;
    return { title: `Bash: ${short}`, hidden: false, showResult: true, kind: 'generic' };
  }
  if (name === 'Read') {
    return { title: `Read ${basename(inp.file_path)}`, hidden: true, showResult: false, kind: 'generic' };
  }
  if (name === 'TodoWrite') {
    const todos = Array.isArray(inp.todos)
      ? (inp.todos as Array<Record<string, unknown>>).map(t => ({ text: String(t.content ?? t.text ?? ''), status: String(t.status ?? '') }))
      : [];
    return { title: 'Todo', hidden: false, showResult: false, kind: 'todo', todos };
  }
  if (name.startsWith('mcp__skena__')) {
    const rest = name.slice('mcp__skena__'.length).replace(/^canvas_/, 'canvas ').replace(/_/g, ' ');
    return { title: rest.startsWith('canvas ') ? rest.replace('canvas ', 'canvas: ') : `canvas: ${rest}`, hidden: false, showResult: true, kind: 'generic' };
  }
  return { title: name, hidden: false, showResult: true, kind: 'generic' };
}
