// - pure clipboard classifier for paste-to-node; no DOM, no vscode — unit-testable standalone.
// - priority per spec: image > html > uri-list > text (yy-internal / url / path / plain).

export interface ClipboardInput {
  hasImage:   boolean;
  html:       string;          // - text/html flavor, '' if absent
  uriList:    string;          // - raw text/uri-list, '' if absent
  text:       string;          // - text/plain flavor, '' if absent
  yySnapshot: string | null;   // - OS clipboard text captured at last yy, null if never
}

export type PasteAction =
  | { kind: 'cell-image' }
  | { kind: 'cell-html'; html: string }
  | { kind: 'files'; uris: string[] }
  | { kind: 'internal' }
  | { kind: 'link'; url: string }
  | { kind: 'verify-path'; raw: string }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

const isSingleLine = (s: string) => !/\r|\n/.test(s);
const isUrl  = (s: string) => /^https?:\/\/\S+$/.test(s);
// - permissive: spaces allowed — host-side existence check filters false positives
const isPath = (s: string) => /^(file:\/\/|\/|~\/)/.test(s);

export function classifyClipboard(input: ClipboardInput): PasteAction {
  const trimmed = input.text.trim();

  if (input.hasImage) return { kind: 'cell-image' };

  // - browser-URL guard: copied links often carry anchor markup in text/html;
  // - the single-line URL plain flavor is the truer intent
  if (input.html.trim()) {
    if (isSingleLine(trimmed) && isUrl(trimmed)) return { kind: 'link', url: trimmed };
    return { kind: 'cell-html', html: input.html };
  }

  if (input.uriList.trim()) {
    const uris = input.uriList.split(/\r?\n/).map(u => u.trim()).filter(u => u && !u.startsWith('#'));
    if (uris.length > 0) return { kind: 'files', uris };
  }

  if (trimmed) {
    if (input.yySnapshot !== null && input.text === input.yySnapshot) return { kind: 'internal' };
    if (isSingleLine(trimmed)) {
      if (isUrl(trimmed))  return { kind: 'link', url: trimmed };
      if (isPath(trimmed)) return { kind: 'verify-path', raw: trimmed };
    }
    return { kind: 'text', text: input.text };
  }

  return { kind: 'none' };
}
