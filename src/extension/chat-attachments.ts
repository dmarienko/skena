// - one text block per chat attachment; nodes and files follow the focused node's rule in context-builder
import { CanvasData } from '../shared/types';
import { AttachmentBlock, ChatAttachment } from '../shared/chatAttachments';
import { capText, nodeContent, nodeTitle, readFileText, SystemPromptOptions } from './context-builder';

const MAX_NODE_CHARS = 3000;
const MAX_FILE_CHARS = 12000;

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
        : capText(await readFileText(a.path), MAX_FILE_CHARS);
      return { heading: `file ${a.path}`, body };
    }
    return {
      heading: `image ${a.name}`,
      body:    imagesSent ? '(sent with this message as an image)' : '(not sent: this provider takes text only)',
    };
  }));
}
