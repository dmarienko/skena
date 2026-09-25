// - temporary drag diagnostics
/**
 * Temporary diagnostic: the webview can't reach VS Code dev tools easily, so this
 * posts every drag/drop event reaching `window` back to the host, which appends it
 * to the "Skena" Output channel. Remove this file + its one import in index.tsx +
 * the 'diagLog' case in editor-provider.ts once the Explorer-drop bug is diagnosed.
 */

function postDiag(text: string): void {
  const api = (window as unknown as Record<string, { postMessage: (m: unknown) => void } | undefined>)['vscodeApi'];
  api?.postMessage({ type: 'diagLog', text });
}

function describeEvent(e: DragEvent): string {
  const target = e.target as HTMLElement | null;
  const tag    = target?.tagName ?? '(none)';
  const cls    = String(target?.className ?? '').slice(0, 60);
  const dt     = e.dataTransfer;
  const types  = dt ? Array.from(dt.types).join(',') : '';
  return `type=${e.type} shiftKey=${e.shiftKey} target=${tag}.${cls} types=[${types}] `
    + `dropEffect=${dt?.dropEffect ?? ''} effectAllowed=${dt?.effectAllowed ?? ''}`;
}

const DRAGOVER_THROTTLE_MS = 500;
let lastDragoverLogAt = 0;
// - set by the capture-phase dragover handler when it decides to log; the bubble-phase
// - handler (after the canvas's own onDragOver ran) consumes it to report defaultPrevented
// - paired with that same sample, instead of logging on every single bubble tick.
let dragoverLoggedThisPass = false;

function onDragEnterOrLeave(e: DragEvent): void {
  postDiag(describeEvent(e));
}

function onDrop(e: DragEvent): void {
  const dt = e.dataTransfer;
  const codeUriList = (dt?.getData('application/vnd.code.uri-list') ?? '').slice(0, 200);
  const uriList     = (dt?.getData('text/uri-list') ?? '').slice(0, 200);
  postDiag(`${describeEvent(e)} codeUriList="${codeUriList}" uriList="${uriList}"`);
}

function onDragOverCapture(e: DragEvent): void {
  const now = Date.now();
  if (now - lastDragoverLogAt < DRAGOVER_THROTTLE_MS) return;
  lastDragoverLogAt = now;
  dragoverLoggedThisPass = true;
  postDiag(describeEvent(e));
}

function onDragOverBubble(e: DragEvent): void {
  if (!dragoverLoggedThisPass) return;
  dragoverLoggedThisPass = false;
  postDiag(`type=dragover(after-bubble) defaultPrevented=${e.defaultPrevented}`);
}

/** - install capture-phase drag/drop listeners on window; call once from the webview entry */
export function installDragDiagnostics(): void {
  window.addEventListener('dragenter', onDragEnterOrLeave, true);
  window.addEventListener('dragleave', onDragEnterOrLeave, true);
  window.addEventListener('drop',      onDrop,             true);
  window.addEventListener('dragover',  onDragOverCapture,  true);
  window.addEventListener('dragover',  onDragOverBubble,   false);
}
