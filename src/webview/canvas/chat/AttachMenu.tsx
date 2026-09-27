import { useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { MAX_IMAGE_BASE64, parseImageDataUrl } from '../../../shared/chatAttachments';

export interface PastedImage { id: string; name: string; mediaType: string; data: string }

interface Props {
  pickedCount: number;
  // - only the harness sends images; the other adapters take text only
  allowImage:  boolean;
  imageCount:  number;
  onPickNodes: () => void;
  onPickFile:  () => void;
  onImage:     (img: PastedImage) => void;
  onWarn:      (text: string) => void;
}

export function AttachMenu({ pickedCount, allowImage, imageCount, onPickNodes, onPickFile, onImage, onWarn }: Props): JSX.Element {
  const pasteTargetRef = useRef<HTMLTextAreaElement>(null);
  const pastedRef      = useRef(false);
  const [waiting, setWaiting] = useState(false);

  // - vscode.env.clipboard is text only; an image arrives only in a DOM paste event. Focus a hidden
  // - textarea and try a scripted paste; if the webview refuses it, the user's Ctrl+V lands there instead.
  const askClipboard = () => {
    const target = pasteTargetRef.current;
    if (!target) return;
    pastedRef.current = false;
    target.focus();
    try { document.execCommand('paste'); } catch { /* - refused; the timer below asks for Ctrl+V */ }
    setTimeout(() => { if (!pastedRef.current) setWaiting(true); }, 150);
  };

  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    pastedRef.current = true;
    e.preventDefault();
    e.stopPropagation();
    const item = Array.from(e.clipboardData.items).find(it => it.kind === 'file' && it.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) { onWarn('Skena: the clipboard holds no image.'); return; }
    const reader = new FileReader();
    reader.onerror = () => onWarn('Skena: could not read the clipboard image.');
    reader.onload = () => {
      const img = parseImageDataUrl(String(reader.result));
      if (!img) { onWarn(`Skena: ${file.type} is not supported; use PNG, JPEG, GIF or WebP.`); return; }
      if (img.data.length > MAX_IMAGE_BASE64) { onWarn('Skena: the clipboard image is over 5 MB.'); return; }
      onImage({ id: `img-${Date.now().toString(36)}`, name: `image ${imageCount + 1}`, ...img });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="cc-menu" role="menu">
      <button className="cc-menu-item" disabled={pickedCount === 0} onClick={onPickNodes}>
        ◇ Nodes picked with Space <span className="k">{pickedCount} picked</span>
      </button>
      <button className="cc-menu-item" onClick={onPickFile}>▤ File from the workspace…</button>
      {allowImage && <button className="cc-menu-item" onClick={askClipboard}>▣ Image from the clipboard</button>}
      {waiting && <div className="cc-menu-hint">Press Ctrl+V to attach the image · Esc to cancel</div>}
      <textarea ref={pasteTargetRef} className="cc-paste-target" aria-hidden="true" tabIndex={-1} onPaste={onPaste} />
    </div>
  );
}
