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

export type ReplyKind = 'stream' | 'result' | 'display' | 'error' | 'status' | 'other';

export interface ParsedReply {
  parentMsgId:    string | null;
  kind:           ReplyKind;
  text?:          string;
  data?:          Record<string, unknown>;
  executionState?: string;
  error?:         string;
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
    case 'error':
      return { parentMsgId, kind: 'error', error: `${content.ename}: ${content.evalue}` };
    case 'status':
      return { parentMsgId, kind: 'status', executionState: content.execution_state };
    default:
      return { parentMsgId, kind: 'other' };
  }
}

// - preference order when picking a single rich mime from a data bundle
const RICH_MIMES = ['image/png', 'image/jpeg', 'text/html', 'application/json', 'text/plain'];

function pickRich(data: Record<string, unknown>): { mime: string; data: string } | null {
  for (const mime of RICH_MIMES) {
    if (data[mime] != null) {
      const v = data[mime];
      return { mime, data: typeof v === 'string' ? v : JSON.stringify(v) };
    }
  }
  return null;
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
