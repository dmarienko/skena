// - the content of one stream-json user message: plain text, or image blocks followed by the text
export interface ImageInput { mediaType: string; data: string }

export type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export type UserContent = string | UserContentBlock[];

export function buildUserContent(text: string, images: ImageInput[] = []): UserContent {
  if (images.length === 0) return text;
  return [
    ...images.map((img): UserContentBlock => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text },
  ];
}
