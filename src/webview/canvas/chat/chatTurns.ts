// - pure grouping of the chat timeline into turns; no DOM
import { ChatItem } from '../../../shared/types';

export interface ChatTurn {
  // - `turn-<index of its first item>`; history only grows at the end, so a key never changes
  key:    string;
  // - null for items logged before the first prompt
  prompt: string | null;
  time:   string;
  items:  ChatItem[];
}

export const NODE_ADDED_PREFIX = '📌 *Added to canvas:*';

export function groupTurns(history: ChatItem[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  history.forEach((it, i) => {
    if (it.kind === 'text' && it.role === 'user') {
      turns.push({ key: `turn-${i}`, prompt: it.content, time: it.timestamp, items: [] });
      return;
    }
    if (turns.length === 0) turns.push({ key: `turn-${i}`, prompt: null, time: it.timestamp, items: [] });
    turns[turns.length - 1].items.push(it);
  });
  return turns;
}

export function turnAnswer(turn: ChatTurn): string {
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const it = turn.items[i];
    if (it.kind === 'text' && it.role === 'assistant' && !it.content.startsWith(NODE_ADDED_PREFIX)) return it.content;
  }
  return '';
}

export function turnCost(turn: ChatTurn): { deltaUsd: number; costUsd?: number } | null {
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const it = turn.items[i];
    if (it.kind === 'text' && it.deltaUsd !== undefined) return { deltaUsd: it.deltaUsd, costUsd: it.costUsd };
  }
  return null;
}

export function firstLine(text: string): string {
  return text.trim().split('\n')[0].trim();
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
