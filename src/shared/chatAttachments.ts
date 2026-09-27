// - what the user attached to a chat message, and the text the agent reads for it; no DOM, no fs
export type ChatAttachment =
  | { kind: 'node';  id: string; label: string }
  | { kind: 'file';  path: string; name: string }
  | { kind: 'image'; id: string; name: string; mediaType: string; data: string };

export interface AttachmentBlock { heading: string; body: string }

export const MAX_ATTACHMENT_CHARS = 30000;
// - base64 length; Bedrock and Google Cloud reject a larger image
export const MAX_IMAGE_BASE64     = 5 * 1024 * 1024;
export const IMAGE_MEDIA_TYPES    = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function attachmentKey(a: ChatAttachment): string {
  switch (a.kind) {
    case 'node':  return `node:${a.id}`;
    case 'file':  return `file:${a.path}`;
    case 'image': return `image:${a.id}`;
  }
}

export function chipLabel(a: ChatAttachment): string {
  return a.kind === 'node' ? a.label : a.name;
}

export function mergeAttachments(list: ChatAttachment[], add: ChatAttachment[]): ChatAttachment[] {
  const seen = new Set(list.map(attachmentKey));
  const out  = [...list];
  for (const a of add) {
    const k = attachmentKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

export function removeAttachment(list: ChatAttachment[], key: string): ChatAttachment[] {
  return list.filter(a => attachmentKey(a) !== key);
}

export function parseImageDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m || !IMAGE_MEDIA_TYPES.includes(m[1])) return null;
  return { mediaType: m[1], data: m[2] };
}

// - a NUL character in text decoded as UTF-8 means the file is not text
export function looksBinary(text: string): boolean {
  return text.includes('\u0000');
}

// - the whole text, headings and notes included, stays within `cap`: first as many headings as fit,
// - each with a left-out note and one line counting the rest; then, in order, every body that still fits
export function formatAttachments(blocks: AttachmentBlock[], cap: number = MAX_ATTACHMENT_CHARS): string {
  const n = blocks.length;
  if (n === 0) return '';
  const head  = `ATTACHED BY THE USER (${n}):\n`;
  const whole = blocks.map(b => `### ${b.heading}\n${b.body}`);
  const short = blocks.map(b => `### ${b.heading}\n[left out: attachments are capped at ${cap} characters]`);
  const rest  = (k: number) => `[${k} more attachments left out: attachments are capped at ${cap} characters]`;
  // - a part's size includes the blank line that joins it to the part before; `used` is the exact length
  const size  = (part: string) => part.length + 2;
  let listed = n;
  let used   = head.length - 2 + short.reduce((t, part) => t + size(part), 0);
  while (listed > 0 && used + (listed < n ? size(rest(n - listed)) : 0) > cap) {
    listed--;
    used -= size(short[listed]);
  }
  if (listed < n) used += size(rest(n - listed));
  const parts = short.slice(0, listed);
  for (let i = 0; i < listed; i++) {
    const grow = whole[i].length - short[i].length;
    if (used + grow <= cap) { parts[i] = whole[i]; used += grow; }
  }
  if (listed < n) parts.push(rest(n - listed));
  return head + parts.join('\n\n');
}
