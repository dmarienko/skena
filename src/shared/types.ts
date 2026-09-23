/**
 * Shared types used by both extension host (Node.js) and webview (React).
 * NO Node.js APIs here — this file is bundled into both contexts.
 */

// - type-only, so the sectionLanes ↔ types cycle is erased at build time
import type { SectionLane } from './sectionLanes';
import type { KnowledgeCapabilities, KnowledgeHit, KnowledgeQuery, KnowledgeText } from './knowledge/types';
import type { RefreshOutcome } from './knowledge/refresh';

// ─── JSON Canvas spec types ───────────────────────────────────────────────────

export type CanvasColor = '1' | '2' | '3' | '4' | '5' | '6';

export type EdgeEnd = 'arrow' | 'none';
export type NodeSide = 'top' | 'right' | 'bottom' | 'left';

/** Standard JSON Canvas 1.0 node types */
export type StandardNodeType = 'file' | 'text' | 'group' | 'link';

/** Skena extension node types (Obsidian ignores unknown types gracefully) */
export type SkenaNodeType = 'cell' | 'chat' | 'portal' | 'kernel' | 'code' | 'noderef' | 'knowledge';

export type NodeType = StandardNodeType | SkenaNodeType;

export interface CanvasNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
  /**
   * Short reference label auto-assigned by Skena (e.g. N3, M12, J5).
   * Lets you refer to nodes by label when talking to an AI agent.
   * Persisted in the .canvas file; ignored by Obsidian.
   */
  nodeLabel?: string;
  /** - set to 'ai' when the node was created by an AI agent (MCP tool) */
  createdBy?: 'ai';
  /** - optional user/agent tags for search and organisation */
  tags?: string[];
  /**
   * Unix timestamp (ms) of the last time the user focused or the AI touched this node.
   * Ignored by Obsidian.
   */
  lastTouched?: number;
}

export interface FileNode extends CanvasNodeBase {
  type: 'file';
  /** vault://vaultName/path or relative project path */
  file: string;
}

export interface TextNode extends CanvasNodeBase {
  type: 'text';
  text: string;
}

export interface GroupNode extends CanvasNodeBase {
  type: 'group';
  label?: string;
  background?: string;
  backgroundStyle?: 'cover' | 'ratio' | 'repeat';
}

export interface LinkNode extends CanvasNodeBase {
  type: 'link';
  url: string;
}

/** Standalone output cell — table, chart image, or HTML snippet */
export interface CellNode extends CanvasNodeBase {
  type: 'cell';
  format: 'markdown' | 'image' | 'html' | 'plotly';
  /** - markdown/html: raw string; image: base64 data URI; plotly: figure JSON string */
  content: string;
}

/** AI agent chat terminal */
export interface ChatNode extends CanvasNodeBase {
  type: 'chat';
  title: string;
  agent: 'claude' | 'ollama' | 'openai';
  model?: string;
  /** - path to .chat.json sidecar (relative to .canvas file) */
  historyFile?: string;
}

/** Portal linking to another .canvas file */
export interface PortalNode extends CanvasNodeBase {
  type: 'portal';
  /** - relative path to target .canvas from this .canvas */
  canvas: string;
  label?: string;
}

/** Reference (diamond) to a labelled node in another .canvas file */
export interface NoderefNode extends CanvasNodeBase {
  type:   'noderef';
  /** - workspace-relative path to the target .canvas */
  canvas: string;
  /** - target node's nodeLabel (e.g. N2) */
  label:  string;
  /** - display hint captured at create time */
  title?: string;
}

/** Live Jupyter kernel — circular status widget; drag its ring to bind a code cell */
export interface KernelNode extends CanvasNodeBase {
  type: 'kernel';
  /** - matches a skena.jupyter.kernels[].name (the server it lives on) */
  server: string;
  /** - live Jupyter kernel id once started/bound; absent = not yet connected */
  kernelId?: string;
  /** - e.g. "python3"; shown in the title */
  displayName?: string;
  /** - kernelspec name to (re)launch from (e.g. "xmetals"); a restart uses the SAME environment */
  spec?: string;
  /** - index into KERNEL_PALETTE, assigned at creation */
  colorIndex?: number;
}

/** A kernel that lives in the canvas file, not on the canvas: picked or created from a section's rail. */
export interface KernelRecord {
  id: string;            // - "k-<base36 time>", stable
  server: string;        // - a skena.jupyter.kernels[].name
  spec?: string;         // - kernelspec to (re)launch from; a restart uses the same environment
  displayName?: string;
  kernelId?: string;     // - live Jupyter kernel id once started / attached; absent = not running
  colorIndex: number;    // - into KERNEL_PALETTE, assigned at creation
}

/** Editable code cell — runs on its kernel (edge-bound node, else the section's), output goes to a linked cell node */
export interface CodeNode extends CanvasNodeBase {
  type: 'code';
  code: string;
  /** - default 'python' */
  language?: string;
  /** - id of the linked output CellNode, once the first run created it */
  outputNodeId?: string;
  /** - ms timestamp of last execution start */
  lastRun?: number;
  lastStatus?: 'ok' | 'error' | 'running';
}

/** A result from a knowledge server, with a cached copy of its text so the node reads offline */
export interface KnowledgeNode extends CanvasNodeBase {
  type: 'knowledge';
  /** - the skena.knowledge.servers entry this came from */
  server: string;
  /** - opaque to the webview; only the server's adapter understands it */
  uri: string;
  title: string;
  text: string;
  /** - ISO timestamp of the last successful fetch; drives the staleness check on open */
  fetchedAt: string;
  /** - set when a refresh brought back different text */
  changed?: boolean;
  /** - last refresh failure, kept so the node can show it without losing the cached text */
  error?: string;
}

export type CanvasNode =
  | FileNode
  | TextNode
  | GroupNode
  | LinkNode
  | CellNode
  | ChatNode
  | PortalNode
  | NoderefNode
  | KernelNode
  | CodeNode
  | KnowledgeNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: NodeSide;
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: NodeSide;
  toEnd?: EdgeEnd;
  color?: CanvasColor;
  label?: string;
}

export interface CanvasViewport {
  x:    number;
  y:    number;
  zoom: number;
}

export interface CanvasData {
  nodes:     CanvasNode[];
  edges:     CanvasEdge[];
  /** - last known viewport; persisted so the canvas reopens at the same position */
  viewport?: CanvasViewport;
  /** - canvas-scoped skena metadata (portable in the .canvas file) */
  metadata?: {
    /** - AI model for this canvas's chat; overrides the global skena.ai.model */
    aiModel?: string;
    /** - virtual section lanes, sorted by y; geometry is derived, see sectionLanes.ts */
    sections?: SectionLane[];
    /** - kernels without a node; a section's kernelId may name one of these */
    kernels?: KernelRecord[];
  };
}

// ─── Vault / file resolution ──────────────────────────────────────────────────

export type FileType = 'markdown' | 'notebook' | 'python' | 'yaml' | 'image' | 'html' | 'notion' | 'unknown';

export interface VaultConfig {
  name: string;
  path: string;
  /** - subdirectories to scan; omit (or set ['.']) to scan the entire vault root recursively */
  directories?: string[];
}

/**
 * Parsed vault URI.
 * vault://v1/alpha/storm.md  → { vault: 'v1', path: 'alpha/storm.md' }
 * vault://notion/abc123      → { vault: 'notion', path: 'abc123' }
 */
export interface VaultUri {
  vault: string;
  path: string;
}

// ─── Vault index ──────────────────────────────────────────────────────────────

export type EntryType =
  | 'momentum' | 'mean-revert' | 'stat-arb' | 'portfolio'
  | 'microstructure' | 'seasonality' | 'dips-buying' | 'defi' | 'infrastructure'
  | 'indicator' | 'method' | 'concept' | 'model' | 'pattern' | 'reference' | 'dataset';

export type EntryStatus = 'idea' | 'research' | 'backtest' | 'paper' | 'live' | 'paused' | 'dead';
export type EntryScore = 'bad' | 'not-sure' | 'interesting' | 'promising' | 'perfect';

export interface VaultEntry {
  /** - unique id from frontmatter */
  id: string;
  title: string;
  type?: EntryType;
  status?: EntryStatus;
  score?: EntryScore;
  tags: string[];
  /** - vault URI: vault://v1/alpha/storm.md */
  uri: string;
  /** - absolute filesystem path (extension host only, not sent to webview) */
  fsPath?: string;
}

// ─── Message protocol (Extension Host ↔ Webview) ─────────────────────────────

/** Every request carries a requestId for correlation (multiple nodes load in parallel) */
type RequestId = string;

// - Host → Webview messages

export interface MsgCanvasLoaded {
  type: 'canvasLoaded';
  canvas: CanvasData;
  /** - absolute fs path of the .canvas file (for relative path resolution) */
  canvasPath: string;
}

export interface MsgFileContent {
  type: 'fileContent';
  requestId: RequestId;
  uri: string;
  fileType: FileType;
  /** - raw string content (md, py, yaml) or base64 (images) */
  content: string;
  /**
   * - for images and embedded assets: vscode-resource:// URI safe for webview <img src>
   * - undefined for text content
   */
  resourceUri?: string;
  /** - true when file exceeded MAX_FILE_FULL_BYTES; content is the first MAX_FILE_PREVIEW_BYTES */
  truncated?:  boolean;
  /** - original file size in bytes (present when truncated=true) */
  totalSize?:  number;
  /**
   * Pre-rendered HTML for markdown files — produced by the extension host's
   * unified pipeline so the webview UI thread never has to parse markdown.
   * When present, the webview uses dangerouslySetInnerHTML instead of ReactMarkdown.
   */
  html?: string;
}

export interface MsgFileError {
  type: 'fileError';
  requestId: RequestId;
  uri: string;
  error: 'NOT_FOUND' | 'TOO_LARGE' | 'ACCESS_DENIED' | 'NOTION_OFFLINE' | string;
}

export interface MsgVaultIndex {
  type: 'vaultIndex';
  entries: VaultEntry[];
}

export interface MsgFileChanged {
  type: 'fileChanged';
  uri: string;
}

export interface MsgCanvasChanged {
  type: 'canvasChanged';
}

export interface MsgChatChunk {
  type: 'chatChunk';
  nodeId: string;
  delta: string;
  done: boolean;
}

export interface MsgAgentNodeCreated {
  type: 'agentNodeCreated';
  chatNodeId: string;
  newNode: CanvasNode;
  newEdge: CanvasEdge;
}

// ─── Floating AI companion messages ──────────────────────────────────────────

/** Host → Webview: streamed text chunk from the floating chat */
export interface MsgFloatingChatDelta {
  type: 'floatingChatDelta';
  delta: string;
}

/** Host → Webview: floating chat stream complete */
export interface MsgFloatingChatDone {
  type: 'floatingChatDone';
  /** - session-cumulative cost after this turn (harness provider only) */
  costUsd?:  number;
  /** - this turn's cost (harness provider only) */
  deltaUsd?: number;
}

/** - host → webview: this canvas panel became the active editor (navigated to) */
export interface MsgPanelActivated { type: 'panelActivated'; }

/** - host → webview: current AI model + provider (for the chat title) */
export interface MsgChatModelInfo { type: 'chatModelInfo'; model: string; provider: string; sessionName?: string; }

/** - host → webview: focus (select + pan to) a node by id */
export interface MsgFocusNode { type: 'focusNode'; id: string; }
/** - webview → host: user clicked the chat title to change this canvas's model */
export interface MsgPickModel { type: 'pickModel'; }
export interface MsgRunCell   { type: 'runCell'; cellNodeId: string; code: string; }
// - run every code cell of a section top to bottom on its resolved kernel; the first error stops it
export interface MsgRunSection { type: 'runSection'; sectionId: string; }
export interface MsgAddKernel {
  type: 'addKernel';
  position?: { x: number; y: number };
  // - forSection → the host answers with a KernelRecord bound to that section instead of a node
  forSection?: string;
}
export interface MsgKernelAction {
  type: 'kernelAction';
  action: 'restart' | 'shutdown' | 'interrupt' | 'start';
  kernelNodeId: string;   // - a KernelRecord id or a kernel node id
}
// - interrupt (SIGINT) the kernel running THIS code cell; confirm asks the host for a modal first
export interface MsgInterruptCell { type: 'interruptCell'; cellNodeId: string; confirm?: boolean; }
// - webview asks the host to confirm a destructive delete (e.g. an active kernel node)
export interface MsgConfirmDelete { type: 'confirmDelete'; nodeIds: string[]; reason: string; }
// - webview → host: remove a KernelRecord (no canvas node to delete)
export interface MsgRemoveKernel { type: 'removeKernel'; kernelRef: string; }   // - a KernelRecord id or a kernel node id; kernelId means the live Jupyter id elsewhere
// - webview asks the host for kernel tab-completion at a cursor (Ctrl+Space in a code cell)
export interface MsgComplete { type: 'complete'; reqId: string; cellNodeId: string; code: string; cursorPos: number; }
// - webview asks the host for kernel introspection at a cursor (hover / signature help)
export interface MsgInspect { type: 'inspect'; reqId: string; cellNodeId: string; code: string; cursorPos: number; }

/** - host → webview: session compaction is running (true) or finished (false) */
export interface MsgFloatingChatCompacting { type: 'floatingChatCompacting'; active: boolean; }

/** - webview → host: render arbitrary markdown text to HTML (Typst/KaTeX-aware) */
export interface MsgRenderMarkdown { type: 'renderMarkdown'; requestId: string; text: string; }
/** - host → webview: rendered HTML for a renderMarkdown request */
export interface MsgRenderMarkdownResult { type: 'renderMarkdownResult'; requestId: string; html: string; }

export interface MsgFloatingChatToolEvent { type: 'floatingChatToolEvent'; event: ChatToolEvent; }
export interface MsgFloatingChatUsage     { type: 'floatingChatUsage'; usage: ChatTokenUsage; }

/** Host → Webview: API error during floating chat */
export interface MsgFloatingChatError {
  type: 'floatingChatError';
  message: string;
}

/** Host → Webview: session reset confirmed and performed — clear the visible history */
export interface MsgFloatingChatResetDone {
  type: 'floatingChatResetDone';
}

/** Host → Webview: restore chat state from workspaceState on canvas open */
export interface MsgFloatingChatHistoryRestored {
  type: 'floatingChatHistoryRestored';
  history:   ChatItem[];
  collapsed?: boolean;
  pos?:       { x: number; y: number };
  size?:      { w: number; h: number };
  inputW?:    number;
}

/** Webview → Host: persist floating chat panel UI state (pos/size/collapsed) */
export interface MsgFloatingChatSaveUIState {
  type:      'floatingChatSaveUIState';
  collapsed: boolean;
  pos:       { x: number; y: number };
  size:      { w: number; h: number };
  inputW?:   number;
}

/** Host → Webview: AI added a node to the canvas during tool use */
export interface MsgFloatingChatNodeAdded {
  type: 'floatingChatNodeAdded';
  node: CanvasNode;
  edge?: CanvasEdge;
}


export interface MsgSearchResults {
  type: 'searchResults';
  requestId: RequestId;
  results: VaultEntry[];
}

/** - host resolved dropped files, webview adds them as nodes */
export interface MsgNodesFromDrop {
  type: 'nodesFromDrop';
  nodes: CanvasNode[];
  /** - echoed from dropFiles: draw an arrow edge from this node to each new node */
  connectTo?: string;
}

/** - host → webview: system clipboard text in response to requestClipboardRead */
export interface MsgClipboardContent {
  type: 'clipboardContent';
  text: string;
}

// - host → webview: answers to the knowledge messages below; every request carries a requestId the
// - dialog matches, and a failed call comes back as the same message type with `error` set.
export interface MsgKnowledgeServersResult {
  type: 'knowledgeServersResult';
  servers: { name: string; kind: string; capabilities: KnowledgeCapabilities; error?: string }[];
  refreshAfterHours: number;
  /** - the host could not read the settings at all; the list is empty for that reason */
  error?: string;
}
export interface MsgKnowledgeSearchResult { type: 'knowledgeSearchResult'; requestId: number; hits?: KnowledgeHit[]; error?: string }
export interface MsgKnowledgeFetchResult  { type: 'knowledgeFetchResult';  requestId: number; text?: KnowledgeText; error?: string }
export interface MsgKnowledgeScopesResult { type: 'knowledgeScopesResult'; requestId: number; scopes?: string[]; error?: string }
export interface MsgKnowledgeFacetsResult { type: 'knowledgeFacetsResult'; requestId: number; tags?: [string, number][]; error?: string }
/** - host → webview: one image a knowledge node asked for, as a data url it can put in an <img> */
export interface MsgKnowledgeAssetResult { type: 'knowledgeAssetResult'; server: string; uri: string; dataUrl?: string; error?: string }
export interface MsgKnowledgeRefreshed {
  type: 'knowledgeRefreshed';
  nodes: RefreshOutcome[];
  /** - the last message of a run, whether it ran out or was cancelled; the batch may be empty */
  done?: boolean;
}

export type HostToWebview =
  | MsgCanvasLoaded
  | MsgNodesFromDrop
  | MsgFileContent
  | MsgFileError
  | MsgVaultIndex
  | MsgFileChanged
  | MsgCanvasChanged
  | MsgChatChunk
  | MsgAgentNodeCreated
  | MsgSearchResults
  | MsgMarkdownConfig
  | MsgAddNodeResult
  | MsgAddNodeTrigger
  | MsgAddTextNodeTrigger
  | MsgSubCanvasCreated
  | MsgClipboardContent
  | MsgFloatingChatDelta
  | MsgFloatingChatToolEvent
  | MsgFloatingChatUsage
  | MsgPanelActivated
  | MsgChatModelInfo
  | MsgFocusNode
  | MsgFloatingChatCompacting
  | MsgRenderMarkdownResult
  | MsgFloatingChatDone
  | MsgFloatingChatError
  | MsgFloatingChatResetDone
  | MsgFloatingChatNodeAdded
  | MsgFloatingChatHistoryRestored
  | MsgMarksRestored
  | MsgVerifyPathResult
  | MsgKernelStatus
  | MsgKernelAdded
  | MsgKernelRemoved
  | MsgRunStatus
  | MsgRunOutput
  | MsgAddKernelTrigger
  | MsgNewSectionTrigger
  | MsgDoDelete
  | MsgCompleteResult
  | MsgInspectResult
  | MsgKnowledgeServersResult
  | MsgKnowledgeSearchResult
  | MsgKnowledgeFetchResult
  | MsgKnowledgeScopesResult
  | MsgKnowledgeFacetsResult
  | MsgKnowledgeAssetResult
  | MsgKnowledgeRefreshed;

// - host → webview: the "Skena: Add Kernel" command asks the webview to relay an
// - addKernel message back to the host (where the QuickPick runs).
export interface MsgAddKernelTrigger { type: 'addKernelTrigger'; }
export interface MsgNewSectionTrigger { type: 'newSectionTrigger'; }
// - host → webview: result of a confirmDelete modal (proceed only when confirmed)
export interface MsgDoDelete { type: 'doDelete'; confirmed: boolean; }
// - host → webview: kernel tab-completion matches for a pending complete request
export interface MsgCompleteResult { type: 'completeResult'; reqId: string; matches: string[]; cursorStart: number; cursorEnd: number; }
// - host → webview: kernel introspection text for a pending inspect request
export interface MsgInspectResult { type: 'inspectResult'; reqId: string; found: boolean; text: string; }

export interface KernelStatusEntry {
  server:    string;
  kernelId:  string;
  state:     'idle' | 'busy' | 'dead' | 'error';
  connections?: number;
}
export interface MsgKernelStatus { type: 'kernelStatus'; kernels: KernelStatusEntry[]; }
// - host → webview: a KernelRecord was created (picked or launched) for a section
export interface MsgKernelAdded { type: 'kernelAdded'; sectionId: string; kernel: KernelRecord; }
// - host → webview: a KernelRecord (or kernel node) was removed
export interface MsgKernelRemoved {
  type: 'kernelRemoved';
  kernelRef: string;      // - a KernelRecord id or a kernel node id; kernelId means the live Jupyter id elsewhere
  unranCells: string[];   // - cells whose run flag the host cleared; the webview mirrors it so its next save keeps them cleared
}
// - host → webview: apply a cell run's output WITHOUT a full canvas reload (which would
// - re-sync every node → focus jump + position shift). The host already persisted to disk
// - with self-save suppression; the webview mirrors this into its own state.
export interface MsgRunOutput {
  type:         'runOutput';
  codeNodeId:   string;
  lastStatus:   'ok' | 'error' | 'running';   // - 'running' = a mid-run live delta (UI-only, not persisted)
  kernelNodeId: string;   // - a KernelRecord id or a kernel node id
  kernelId?:    string;
  outputNode?:  CellNode;    // - present when the run produced output (upsert by id)
  edge?:        CanvasEdge;  // - present only when the output node was newly created
  source?:      'host' | 'mcp';   // - TEMP diagnosis: which agent-run path emitted this (single-writer host vs MCP fallback)
}
export interface MsgRunStatus {
  type:         'runStatus';
  cellNodeId:   string;
  kernelNodeId: string | null;   // - a KernelRecord id or a kernel node id
  state:        'running' | 'ok' | 'error';
  error?:       string;
}

// - agent-run persist relay: when a canvas panel is open, the out-of-process MCP delegates the
// - .canvas WRITE to the host (single-writer) over the 127.0.0.1 relay's /persist endpoint, so the
// - MCP's external writes no longer race the webview's debounced save (which reset outputNodeId and
// - duplicated output nodes). The MCP still runs the kernel, streams live deltas, and returns text.
export interface AgentRunPersist {
  phase:         'start' | 'done';
  cellNodeId:    string;
  kernelNodeId:  string;
  kernelId:      string;
  outputNodeId?: string;                                                                          // - 'done': the id the host returned on 'start'
  status?:       'ok' | 'error';                                                                  // - 'done' only
  output?:       { format: 'markdown' | 'image' | 'html' | 'plotly'; content: string } | null;   // - 'done' only
}
export interface AgentRunPersistResult {
  handled:       boolean;        // - false when no panel is open for this canvas → MCP falls back to writeCanvas
  outputNodeId?: string;         // - authoritative output-node id (returned on 'start')
}

// - Webview → Host messages

export interface MsgRequestFile {
  type: 'requestFile';
  requestId: RequestId;
  uri: string;
}

export interface MsgSaveCanvas {
  type: 'saveCanvas';
  canvas: CanvasData;
}

export interface MsgOpenFile {
  type: 'openFile';
  /** - resolved fs path or vault URI */
  uri: string;
  /** - true → maximize the editor group after opening (Ctrl+Enter "modal" mode) */
  modal?: boolean;
}

export interface MsgCopyNodeReference { type: 'copyNodeReference'; label: string; }

export interface MsgSearchVault {
  type: 'searchVault';
  requestId: RequestId;
  query: string;
}

export interface MsgChatMessage {
  type: 'chatMessage';
  nodeId: string;
  message: string;
  /** - summary of canvas nodes sent as agent context */
  canvasContext: CanvasContext;
}

export interface MsgRefreshVault {
  type: 'refreshVault';
}

/** - webview sends this once React has mounted and message listener is active */
export interface MsgWebviewReady {
  type: 'webviewReady';
}

/**
 * Files dropped from VS Code Explorer onto the canvas.
 * uris: raw VS Code URIs from dataTransfer (vscode-remote://, file://, etc.)
 * position: drop point already converted to React Flow canvas coordinates
 */
export interface MsgDropFiles {
  type: 'dropFiles';
  uris: string[];
  position: { x: number; y: number };
  /** - when set, webview draws an arrow edge from this node to each dropped node */
  connectTo?: string;
}

/** - webview → host: does this pasted filesystem path exist? */
export interface MsgVerifyPath {
  type:      'verifyPath';
  requestId: string;
  path:      string;   // - raw pasted text: file:// URI, absolute, or ~/ path
}

/** - host → webview: verifyPath answer */
export interface MsgVerifyPathResult {
  type:         'verifyPathResult';
  requestId:    string;
  exists:       boolean;
  /** - vault:// URI or canvas-dir-relative path suitable for a FileNode.file, set when exists */
  resolvedPath?: string;
}

/** - webview → host: show a VS Code warning toast */
export interface MsgShowWarning {
  type: 'showWarning';
  text: string;
}

/** - webview → host: show a VS Code information toast (a notice, not a problem) */
export interface MsgNotify {
  type: 'notify';
  text: string;
}

/** - webview → host: request system clipboard text (navigator.clipboard is sandboxed) */
export interface MsgRequestClipboardRead {
  type: 'requestClipboardRead';
}

/** - webview → host: write text to system clipboard via vscode.env.clipboard */
export interface MsgWriteClipboard {
  type: 'writeClipboard';
  text: string;
}

/** - webview → host: run a VS Code focus-navigation command (chat editor swallows some keys) */
export interface MsgNavigateFocus {
  type: 'navigateFocus';
  dir:  'left' | 'right' | 'up' | 'down';
}

/** - webview → host: resolve a canvas-relative / vault:// URI and copy absolute fsPath to clipboard */
export interface MsgCopyAbsolutePath {
  type: 'copyAbsolutePath';
  uri: string;
}

/** - Webview → Host: user sends a message in the floating chat overlay */
/** - what the user is actually looking at: zoom, on-screen nodes, scroll position */
export interface ViewportSnapshot {
  zoom: number;
  /** - labels of nodes currently within the viewport */
  visibleNodes: string[];
  /** - 0..100 scroll position within the focused node, if it is scrollable */
  focusedScrollPct?: number;
  /** - the actual on-screen text of the focused node (DOM blocks in view), capped */
  focusedVisibleText?: string;
}

export interface MsgFloatingChatSend {
  type: 'floatingChatSend';
  message: string;
  /** - id of the currently keyboard-focused canvas node (for context building) */
  activeNodeId: string | null;
  /** - full conversation history (session-only; no sidecar persistence) */
  history: ChatItem[];
  /** - what the user currently sees on screen (viewport awareness) */
  viewport?: ViewportSnapshot;
}

/** - Webview → Host: abort the current streaming request */
export interface MsgFloatingChatAbort {
  type: 'floatingChatAbort';
}

/** - Webview → Host: clear session + history, kill the live CC process (fresh start) */
export interface MsgFloatingChatReset {
  type: 'floatingChatReset';
}

/** - Webview → Host: compact the live CC session (/compact) */
export interface MsgFloatingChatCompact {
  type: 'floatingChatCompact';
}

/**
 * - Webview → Host: persist the full conversation history.
 * - Sent after an assistant turn completes (and after AI node-adds) so the
 * - latest reply survives canvas close/reopen — floatingChatSend only ever
 * - carries history up to the user message.
 */
export interface MsgFloatingChatPersistHistory {
  type: 'floatingChatPersistHistory';
  history: ChatItem[];
}

// ─── Canvas marks (vim-style bookmarks) ───────────────────────────────────────

/** - one stored bookmark: focused node + viewport state at mark time */
export interface CanvasMark {
  /** - id of the focused node; null in position-only marks saved before every mark carried a node */
  nodeId: string | null;
  viewport: { x: number; y: number; zoom: number };
}

/** - Webview → Host: persist current marks map to workspaceState */
export interface MsgSaveMarks {
  type: 'saveMarks';
  marks: Record<string, CanvasMark>;
}

/** - Host → Webview: restore marks map on canvas open */
export interface MsgMarksRestored {
  type: 'marksRestored';
  marks: Record<string, CanvasMark>;
}

// - webview → host: the dialog and the knowledge nodes never see a tool name or a URL scheme; the
// - host's KnowledgeService picks the adapter by `server`.
export interface MsgKnowledgeServers { type: 'knowledgeServers' }
export interface MsgKnowledgeSearch  { type: 'knowledgeSearch'; requestId: number; server: string; query: KnowledgeQuery }
export interface MsgKnowledgeFetch   { type: 'knowledgeFetch';  requestId: number; server: string; uri: string }
export interface MsgKnowledgeScopes  { type: 'knowledgeScopes'; requestId: number; server: string }
export interface MsgKnowledgeFacets  { type: 'knowledgeFacets'; requestId: number; server: string; scope?: string }
export interface MsgKnowledgeRefresh { type: 'knowledgeRefresh'; nodes: { id: string; server: string; uri: string; text: string }[] }
/** - webview → host: an image the rendered text refers to by the server's own uri */
export interface MsgKnowledgeAsset   { type: 'knowledgeAsset';  server: string; uri: string }
export interface MsgKnowledgeOpen    { type: 'knowledgeOpen'; server: string; uri: string }

export type WebviewToHost =
  | MsgRequestFile
  | MsgSaveCanvas
  | MsgOpenFile
  | MsgCopyNodeReference
  | MsgSearchVault
  | MsgChatMessage
  | MsgRefreshVault
  | MsgWebviewReady
  | MsgDropFiles
  | MsgAddNodeRequest
  | MsgMoveToSubCanvas
  | MsgRequestClipboardRead
  | MsgWriteClipboard
  | MsgNavigateFocus
  | MsgCopyAbsolutePath
  | MsgFloatingChatSend
  | MsgFloatingChatSaveUIState
  | MsgFloatingChatAbort
  | MsgFloatingChatPersistHistory
  | MsgFloatingChatReset
  | MsgFloatingChatCompact
  | MsgSaveMarks
  | MsgVerifyPath
  | MsgRenderMarkdown
  | MsgShowWarning
  | MsgNotify
  | MsgPickModel
  | MsgRunCell
  | MsgRunSection
  | MsgInterruptCell
  | MsgAddKernel
  | MsgKernelAction
  | MsgRemoveKernel
  | MsgConfirmDelete
  | MsgComplete
  | MsgInspect
  | MsgKnowledgeServers
  | MsgKnowledgeSearch
  | MsgKnowledgeFetch
  | MsgKnowledgeScopes
  | MsgKnowledgeFacets
  | MsgKnowledgeRefresh
  | MsgKnowledgeAsset
  | MsgKnowledgeOpen;

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /** - session-cumulative cost after this reply (harness provider only) */
  costUsd?:  number;
  /** - this reply's cost (harness provider only) */
  deltaUsd?: number;
}

export interface ChatHistory {
  nodeId: string;
  messages: ChatMessage[];
}

/** - interleaved chat timeline item: assistant/user text, a tool call, or a thinking block */
export type ChatItem =
  | { kind: 'text'; role: 'user' | 'assistant'; content: string; timestamp: string; costUsd?: number; deltaUsd?: number }
  | { kind: 'tool'; id: string; name: string; input: unknown; status: 'running' | 'ok' | 'error'; resultPreview?: string; timestamp: string }
  | { kind: 'thinking'; content: string; timestamp: string };

/** - display-only tool/thinking event streamed from Claude Code (harness) */
export type ChatToolEvent =
  | { kind: 'use'; id: string; name: string; input: unknown }
  | { kind: 'result'; id: string; ok: boolean; preview: string }
  | { kind: 'thinking'; content: string };

/** - live token usage for the running turn (harness) */
export interface ChatTokenUsage {
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number;
}

/**
 * Condensed canvas summary sent to agent as context.
 * Keeps token count reasonable — titles + types only, not full content.
 */
export interface CanvasContext {
  nodes: Array<{
    id: string;
    type: NodeType;
    title: string;
    uri?: string;
  }>;
  edges: Array<{
    fromId: string;
    toId: string;
    label?: string;
  }>;
}

// ─── Add-node flow ───────────────────────────────────────────────────────────

/**
 * Webview → Host: user triggered "add node" (Ctrl+N or Shift+hjkl).
 * position is in flow-canvas coordinates.
 * fromNodeId/fromSide/toSide are set for the Shift+hjkl case so the host
 * can create a connecting edge automatically.
 */
export interface MsgAddNodeRequest {
  type:        'addNodeRequest';
  position:    { x: number; y: number };
  width?:      number;   // - preferred size for the created text/file node (directional-add size)
  height?:     number;
  fromNodeId?: string;
  fromSide?:   NodeSide;
  toSide?:     NodeSide;
}

/** Host → Webview: QuickPick resolved — add this node (and optional edge) to canvas. */
export interface MsgAddNodeResult {
  type:      'addNodeResult';
  node:      CanvasNode;
  edge?:     CanvasEdge;
  /**
   * Id of the node this one was created FROM (`o`, Alt+X, a directional add, a paste beside the
   * focused node). The new node joins that node's section — which grows to hold it — instead of the
   * section its y happens to fall in. Absent for a creation with no source: a context-menu add at a
   * click point, a connection dropped on empty canvas.
   */
  anchorId?: string;
  /**
   * When true the webview should immediately open the node in its native
   * editor (Monaco for text nodes). Used for newly-created empty text notes.
   */
  autoEdit?: boolean;
}

/**
 * Host → Webview: VS Code command "skena.addNode" was triggered.
 * Webview computes viewport centre and sends back an addNodeRequest.
 */
export interface MsgAddNodeTrigger {
  type: 'addNodeTrigger';
}

/**
 * Host → Webview: VS Code command skena.addTextNode{Down,Up} was triggered.
 * VS Code intercepts Ctrl+Shift+J / Ctrl+Shift+K before the webview sees them,
 * so we route them through a command with a `when` context guard.
 * direction: uppercase HJKL matching the keyboard handler convention.
 */
export interface MsgAddTextNodeTrigger {
  type:      'addTextNodeTrigger';
  direction: 'H' | 'J' | 'K' | 'L';
}

// ─── Sub-canvas extraction ────────────────────────────────────────────────────

/**
 * Webview → Host: extract selected nodes into a new .canvas file.
 * position: where to place the resulting portal node in the source canvas.
 */
export interface MsgMoveToSubCanvas {
  type:     'moveToSubCanvas';
  nodes:    CanvasNode[];
  edges:    CanvasEdge[];
  position: { x: number; y: number };
}

/**
 * Host → Webview: sub-canvas file created; replace moved nodes with a portal.
 * movedNodeIds: IDs to remove from current canvas (all edges touching them are also removed).
 */
export interface MsgSubCanvasCreated {
  type:         'subCanvasCreated';
  portalNode:   PortalNode;
  movedNodeIds: string[];
}

// ─── Markdown config ─────────────────────────────────────────────────────────

/** - mirrors the subset of VS Code's markdown.preview.* settings we consume */
export interface MarkdownConfig {
  fontFamily?:          string;   // - markdown.preview.fontFamily
  fontSize?:            number;   // - markdown.preview.fontSize
  styles:               string[]; // - markdown.styles (external CSS URLs)
  /** - when false (default) notebook code cells show outputs only, source is hidden */
  notebookShowSource?:  boolean;  // - skena.notebook.showSourceCells
  /** - rendered-markdown theme: 'vscode' adapts to the editor, 'factors' = dark teal terminal */
  theme?:               'vscode' | 'factors';  // - skena.markdownTheme
  /** - max line length (chars) for readable columns in md nodes; 0/undefined = unlimited */
  maxWidth?:            number;                 // - skena.markdownMaxWidth
}

export interface MsgMarkdownConfig {
  type:   'markdownConfig';
  config: MarkdownConfig;
}

// ─── LOD ─────────────────────────────────────────────────────────────────────

export type ZoomLevel = 'minimal' | 'overview' | 'reading' | 'detail';

export function zoomToLevel(zoom: number): ZoomLevel {
  if (zoom < 0.3)  return 'minimal';
  if (zoom < 0.8)  return 'overview';  // - raised from 0.6: hide content during typical nav zoom (0.6–0.8)
  if (zoom < 1.5)  return 'reading';
  return 'detail';
}
