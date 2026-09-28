// - pure grouping of the chat timeline into turns; no DOM
import { ChatItem } from '../../../shared/types';

export interface ChatTurn {
  // - `turn-<its position among the turns>`: history grows at the end or inside a turn (addToTurn),
  // - so a key never changes
  key:    string;
  // - index in the history of the turn's first item
  start:  number;
  // - null for items logged before the first prompt
  prompt: string | null;
  time:   string;
  items:  ChatItem[];
}

// - the agent's add_note: this prefix, then the note's text
export const NODE_ADDED_PREFIX = '📌 *Added to canvas:*';
// - captures the label, so the console can pull it back out to link it
const NOTE_ADDED_LINE = /^📌 added (\S+) to the canvas$/;

// - the user's ＋ canvas on a turn: one line naming the new node
export function noteAddedLine(label: string): string {
  return `📌 added ${label} to the canvas`;
}

// - the label out of a noteAddedLine, for the console to render as a link; null when content isn't that line
export function noteAddedLabel(content: string): string | null {
  return NOTE_ADDED_LINE.exec(content)?.[1] ?? null;
}

export function groupTurns(history: ChatItem[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  history.forEach((it, i) => {
    if (it.kind === 'text' && it.role === 'user') {
      turns.push({ key: `turn-${turns.length}`, start: i, prompt: it.content, time: it.timestamp, items: [] });
      return;
    }
    if (turns.length === 0) turns.push({ key: 'turn-0', start: i, prompt: null, time: it.timestamp, items: [] });
    turns[turns.length - 1].items.push(it);
  });
  return turns;
}

// - `item` after the last item of the turn `turnKey`; at the end when that turn is the latest or is gone
export function addToTurn(history: ChatItem[], turnKey: string, item: ChatItem): ChatItem[] {
  const turns = groupTurns(history);
  const at    = turns.findIndex(t => t.key === turnKey);
  if (at < 0 || at === turns.length - 1) return [...history, item];
  const end = turns[at + 1].start;
  return [...history.slice(0, end), item, ...history.slice(end)];
}

export function turnAnswer(turn: ChatTurn): string {
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const it = turn.items[i];
    if (it.kind !== 'text' || it.role !== 'assistant') continue;
    if (it.content.startsWith(NODE_ADDED_PREFIX) || NOTE_ADDED_LINE.test(it.content)) continue;
    return it.content;
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
