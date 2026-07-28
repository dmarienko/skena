export interface ExecuteIds {
  msgId:   string;
  session: string;
  date:    string;
}

export interface ExecuteRequest {
  header:        { msg_id: string; session: string; username: string; msg_type: 'execute_request'; version: '5.3'; date: string };
  parent_header: Record<string, never>;
  metadata:      Record<string, never>;
  content:       { code: string; silent: boolean; store_history: boolean; user_expressions: Record<string, never>; allow_stdin: boolean; stop_on_error: boolean };
  channel:       'shell';
}

export type ReplyKind = 'stream' | 'result' | 'display' | 'error' | 'status' | 'comm' | 'other';

export interface ParsedReply {
  parentMsgId:    string | null;
  kind:           ReplyKind;
  text?:          string;
  data?:          Record<string, unknown>;
  executionState?: string;
  error?:         string;
  comm?:          { id: string; sub: 'open' | 'msg' | 'close'; modelName?: string; state?: Record<string, unknown> };
}

export interface CollectedOutput {
  streamText: string;
  rich:       { mime: string; data: string }[];
  status:     'ok' | 'error' | 'running';
  error?:     string;
  done:       boolean;
}

export function buildExecuteRequest(code: string, ids: ExecuteIds): ExecuteRequest {
  return {
    header: {
      msg_id:   ids.msgId,
      session:  ids.session,
      username: 'skena',
      msg_type: 'execute_request',
      version:  '5.3',
      date:     ids.date,
    },
    parent_header: {},
    metadata:      {},
    content: {
      code,
      silent:           false,
      store_history:    true,
      user_expressions: {},
      allow_stdin:      false,
      stop_on_error:    true,
    },
    channel: 'shell',
  };
}

export interface CompleteResult {
  matches:     string[];
  cursorStart: number;
  cursorEnd:   number;
}

// - Jupyter v5.3 complete_request on the shell channel (tab-completion at a cursor)
export function buildCompleteRequest(code: string, cursorPos: number, ids: ExecuteIds) {
  return {
    header: {
      msg_id:   ids.msgId,
      session:  ids.session,
      username: 'skena',
      msg_type: 'complete_request',
      version:  '5.3',
      date:     ids.date,
    },
    parent_header: {},
    metadata:      {},
    content:       { code, cursor_pos: cursorPos },
    channel:       'shell',
  };
}

// - returns the completion result from a complete_reply for `ourMsgId`, else null
export function parseCompleteReply(raw: unknown, ourMsgId: string): CompleteResult | null {
  const m = raw as Record<string, any>;
  if (m?.parent_header?.msg_id !== ourMsgId) return null;
  if (m?.header?.msg_type !== 'complete_reply') return null;
  const c = (m.content ?? {}) as Record<string, any>;
  return {
    matches:     Array.isArray(c.matches) ? c.matches as string[] : [],
    cursorStart: typeof c.cursor_start === 'number' ? c.cursor_start : 0,
    cursorEnd:   typeof c.cursor_end === 'number' ? c.cursor_end : 0,
  };
}

export interface InspectResult {
  found: boolean;
  text:  string;   // - the text/plain inspection (signature + docstring), ANSI kept
}

// - Jupyter v5.3 inspect_request (Shift+Tab introspection at a cursor)
export function buildInspectRequest(code: string, cursorPos: number, ids: ExecuteIds, detailLevel = 0) {
  return {
    header: {
      msg_id:   ids.msgId,
      session:  ids.session,
      username: 'skena',
      msg_type: 'inspect_request',
      version:  '5.3',
      date:     ids.date,
    },
    parent_header: {},
    metadata:      {},
    content:       { code, cursor_pos: cursorPos, detail_level: detailLevel },
    channel:       'shell',
  };
}

export function parseInspectReply(raw: unknown, ourMsgId: string): InspectResult | null {
  const m = raw as Record<string, any>;
  if (m?.parent_header?.msg_id !== ourMsgId) return null;
  if (m?.header?.msg_type !== 'inspect_reply') return null;
  const c = (m.content ?? {}) as Record<string, any>;
  const text = (c.data && typeof c.data['text/plain'] === 'string') ? c.data['text/plain'] as string : '';
  return { found: !!c.found, text };
}

export function parseReply(raw: unknown): ParsedReply {
  const m = raw as Record<string, any>;
  const parentMsgId = m?.parent_header?.msg_id ?? null;
  const type = m?.header?.msg_type as string | undefined;
  const content = (m?.content ?? {}) as Record<string, any>;
  switch (type) {
    case 'stream':
      return { parentMsgId, kind: 'stream', text: String(content.text ?? '') };
    case 'execute_result':
      return { parentMsgId, kind: 'result', data: content.data ?? {} };
    case 'display_data':
      return { parentMsgId, kind: 'display', data: content.data ?? {} };
    case 'error': {
      // - the traceback array is the RICH, ANSI-coloured formatting; prefer it
      const tb = Array.isArray(content.traceback) ? (content.traceback as string[]).join('\n') : '';
      return { parentMsgId, kind: 'error', error: tb || `${content.ename}: ${content.evalue}` };
    }
    case 'status':
      return { parentMsgId, kind: 'status', executionState: content.execution_state };
    case 'comm_open': {
      const d = (content.data ?? {}) as Record<string, any>;
      const state = (d.state ?? {}) as Record<string, unknown>;
      return { parentMsgId, kind: 'comm', comm: { id: content.comm_id, sub: 'open', modelName: state._model_name as string | undefined, state } };
    }
    case 'comm_msg': {
      const d = (content.data ?? {}) as Record<string, any>;
      const state = (d.method === 'update' && d.state) ? d.state as Record<string, unknown> : {};
      return { parentMsgId, kind: 'comm', comm: { id: content.comm_id, sub: 'msg', state } };
    }
    case 'comm_close':
      return { parentMsgId, kind: 'comm', comm: { id: content.comm_id, sub: 'close' } };
    default:
      return { parentMsgId, kind: 'other' };
  }
}

// - preference order when picking a single rich mime from a data bundle.
// - plotly first: it also emits a text/html fallback whose <script> can't run in the
// - sandboxed webview, so route the figure JSON to the plotly renderer instead.
const RICH_MIMES = ['application/vnd.plotly.v1+json', 'image/png', 'image/jpeg', 'text/html', 'application/json', 'text/plain'];

function pickRich(data: Record<string, unknown>): { mime: string; data: string } | null {
  for (const mime of RICH_MIMES) {
    if (data[mime] != null) {
      const v = data[mime];
      return { mime, data: typeof v === 'string' ? v : JSON.stringify(v) };
    }
  }
  return null;
}

// - overwrite `line` starting at `col` with `s`, padding with spaces if col is past the end
function overwriteAt(line: string, col: number, s: string): string {
  const padded = col > line.length ? line + ' '.repeat(col - line.length) : line;
  return padded.slice(0, col) + s + padded.slice(col + s.length);
}

// - collapse terminal control in stream text to what a terminal would display: \r rewinds to
// - column 0 (overwrite), \n commits a line, ESC[nA / ESC[nB move the cursor up/down. tqdm's
// - console bar redraws with \r each update; without this every frame is appended.
// - SGR colour escapes (ESC[…m) are left in place for the later ansiToHtml pass and, being
// - zero-width, are treated as occupying columns — fine for the default monochrome bar; a
// - `colour=`d bar can misalign slightly (known limitation).
export function renderStream(text: string): string {
  const lines: string[] = [''];
  let row = 0;
  let col = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\x1b' && text[i + 1] === '[') {
      let j = i + 2;
      let num = '';
      while (j < text.length && text[j] >= '0' && text[j] <= '9') { num += text[j]; j++; }
      const cmd = text[j];
      const n = parseInt(num || '1', 10);
      if (cmd === 'A') { row = Math.max(0, row - n); col = 0; i = j; continue; }
      if (cmd === 'B') { row += n; while (lines.length <= row) lines.push(''); col = 0; i = j; continue; }
      // - any other CSI (colour, etc.): copy verbatim, advance the cursor by its length
      const seq = text.slice(i, j + 1);
      lines[row] = overwriteAt(lines[row], col, seq); col += seq.length; i = j; continue;
    }
    if (ch === '\r') { col = 0; continue; }
    if (ch === '\n') { row++; col = 0; while (lines.length <= row) lines.push(''); continue; }
    lines[row] = overwriteAt(lines[row], col, ch); col++;
  }
  return lines.join('\n');
}

export function collectOutputs(replies: unknown[], ourMsgId: string): CollectedOutput {
  let streamText = '';
  const rich: { mime: string; data: string }[] = [];
  let status: 'ok' | 'error' | 'running' = 'running';
  let error: string | undefined;
  let done = false;

  for (const raw of replies) {
    const p = parseReply(raw);
    if (p.parentMsgId !== ourMsgId) continue;
    if (p.kind === 'stream' && p.text) streamText += p.text;
    else if ((p.kind === 'result' || p.kind === 'display') && p.data) {
      const r = pickRich(p.data);
      if (r) rich.push(r);
    } else if (p.kind === 'error') {
      status = 'error';
      error = p.error;
    } else if (p.kind === 'status' && p.executionState === 'idle') {
      done = true;
      if (status !== 'error') status = 'ok';
    }
  }
  return { streamText, rich, status, error, done };
}
