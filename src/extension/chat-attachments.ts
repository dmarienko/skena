// - one text block per chat attachment; nodes and files follow the focused node's rule in context-builder
import * as fs from 'fs/promises';
import * as path from 'path';
import { CanvasData } from '../shared/types';
import { AttachmentBlock, ChatAttachment, looksBinary } from '../shared/chatAttachments';
import { nodeContent, nodeTitle, SystemPromptOptions } from './context-builder';

const MAX_NODE_CHARS = 3000;
const MAX_FILE_CHARS = 12000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function fileText(p: string): Promise<string> {
  try {
    const st = await fs.stat(p);
    if (st.size > MAX_FILE_BYTES) return `[file over 2 MB, not inlined: ${path.basename(p)}]`;
    const raw = await fs.readFile(p, 'utf-8');
    if (looksBinary(raw)) return `[binary file, not inlined: ${path.basename(p)}]`;
    return raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) + '\n…[truncated]' : raw;
  } catch {
    return '[file not found]';
  }
}

export async function attachmentBlocks(
  attachments: ChatAttachment[],
  canvas:      CanvasData,
  canvasDir:   string,
  opts:        SystemPromptOptions,
  imagesSent:  boolean,
): Promise<AttachmentBlock[]> {
  return Promise.all(attachments.map(async (a): Promise<AttachmentBlock> => {
    if (a.kind === 'node') {
      const n = canvas.nodes.find(x => x.id === a.id);
      if (!n) return { heading: `[${a.label}]`, body: '(this node is no longer on the canvas)' };
      return {
        heading: `[${n.nodeLabel ?? a.label}] (${n.type}) ${nodeTitle(n)}`,
        body:    await nodeContent(n, canvasDir, MAX_NODE_CHARS, opts),
      };
    }
    if (a.kind === 'file') {
      const body = opts.fileNodeMode === 'path'
        ? `[file on disk — read it yourself if needed: ${a.path}]`
        : await fileText(a.path);
      return { heading: `file ${a.path}`, body };
    }
    return {
      heading: `image ${a.name}`,
      body:    imagesSent ? '(sent with this message as an image)' : '(not sent: this provider takes text only)',
    };
  }));
}
