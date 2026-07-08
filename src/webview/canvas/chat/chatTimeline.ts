// - pure folds over the chat timeline (ChatItem[]); no DOM/React. Unit-tested.
import { ChatItem, ChatToolEvent } from '../../../shared/types';

// - append the pending assistant text (if any) as a text item; optionally stamp cost
export function flushPendingText(
  items: ChatItem[],
  pending: string,
  ts: string,
  cost?: { costUsd?: number; deltaUsd?: number },
): ChatItem[] {
  if (!pending) return items;
  return [...items, { kind: 'text', role: 'assistant', content: pending, timestamp: ts, costUsd: cost?.costUsd, deltaUsd: cost?.deltaUsd }];
}

// - fold one display tool event into (items, pending). `use`/`thinking` flush pending
// - text first (preserving interleave order); `result` updates the matching card by id.
export function applyToolEvent(
  items: ChatItem[],
  pending: string,
  e: ChatToolEvent,
  ts: string,
): { items: ChatItem[]; pending: string } {
  if (e.kind === 'result') {
    const next = items.map(it =>
      it.kind === 'tool' && it.id === e.id
        ? { ...it, status: e.ok ? 'ok' as const : 'error' as const, resultPreview: e.preview }
        : it,
    );
    return { items: next, pending };
  }
  const flushed = flushPendingText(items, pending, ts);
  const item: ChatItem = e.kind === 'use'
    ? { kind: 'tool', id: e.id, name: e.name, input: e.input, status: 'running', timestamp: ts }
    : { kind: 'thinking', content: e.content, timestamp: ts };
  return { items: [...flushed, item], pending: '' };
}

// - upgrade persisted history: legacy ChatMessage (no `kind`) → text ChatItem
export function migrateHistory(raw: unknown[]): ChatItem[] {
  return (raw ?? []).map(r => {
    const o = r as Record<string, unknown>;
    if (o && typeof o === 'object' && 'kind' in o) {
      const it = o as unknown as ChatItem;
      // - a card persisted mid-turn (crash before completeDelta) restores as error, not spinning
      if (it.kind === 'tool' && it.status === 'running') return { ...it, status: 'error' };
      return it;
    }
    return { kind: 'text', role: (o?.role as 'user' | 'assistant') ?? 'assistant', content: String(o?.content ?? ''), timestamp: String(o?.timestamp ?? ''), costUsd: o?.costUsd as number | undefined, deltaUsd: o?.deltaUsd as number | undefined };
  });
}
