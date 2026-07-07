/**
 * Shared types used by both extension host (Node.js) and webview (React).
 * NO Node.js APIs here — this file is bundled into both contexts.
 */

// ─── JSON Canvas spec types ───────────────────────────────────────────────────

export type CanvasColor = '1' | '2' | '3' | '4' | '5' | '6';

export type EdgeEnd = 'arrow' | 'none';
export type NodeSide = 'top' | 'right' | 'bottom' | 'left';

/** Standard JSON Canvas 1.0 node types */
export type StandardNodeType = 'file' | 'text' | 'group' | 'link';

/** Skena extension node types (Obsidian ignores unknown types gracefully) */
export type SkenaNodeType = 'cell' | 'chat' | 'portal';

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
   * Used by the activity heatmap to render recency glow.
   * Ignored by Obsidian.
   */
  lastTouched?: number;
  /**
   * Monotonically increasing integer assigned once at node creation.
   * Higher = created later. Used by the activity heatmap for recency ranking.
   * Ignored by Obsidian.
   */
  creationIndex?: number;
  /**
   * Monotonically increasing integer, stamped (re-stamped) every time the node's
   * content is edited. Shares the same counter pool as creationIndex so the two
   * values are directly comparable. The heatmap uses max(creationIndex, editIndex)
   * so a recently edited node glows as brightly as a recently created one.
   * Ignored by Obsidian.
   */
  editIndex?: number;
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
  format: 'markdown' | 'image' | 'html';
  /** - markdown/html: raw string content; image: base64 data URI */
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

export type CanvasNode =
  | FileNode
  | TextNode
  | GroupNode
  | LinkNode
  | CellNode
  | ChatNode
  | PortalNode;

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
  /**
   * Monotonically increasing counter; incremented every time a node is created.
   * Persisted so the sequence survives canvas reopen.
   */
  creationCounter?: number;
}

// ─── Activity heatmap types ────────────────────────────────────────────────────

/**
 * Per-node glow data computed by useActivityHeatmap.
 * color is an RGB triplet string e.g. "56,189,248" — use as rgba(${color},${alpha}).
 */
export type HeatmapNode = {
  color:       string;
  intensity:   number;
  clusterId:   number | null;
  glowFilter:  string;   // - CSS filter string, ready to apply
  borderColor: string;   // - CSS rgba() border color
  opacity:     number;   // - 1.0 normally, 0.45 for isolated nodes
};

/**
 * Per-edge glow data computed by useActivityHeatmap.
 * sourceIntensity / targetIntensity drive the gradient direction:
 * the low-intensity end is transparent, the high-intensity end is bright + wide.
 */
export type EdgeGlow = {
  color:           string;
  intensity:       number;   // - max(sourceIntensity, targetIntensity)
  sourceIntensity: number;   // - intensity at the edge's source handle
  targetIntensity: number;   // - intensity at the edge's target handle
  stroke:          string;   // - rgba() for the core line
  glowFilter:      string;   // - CSS drop-shadow (fallback / node-component use)
  glowBlur:        number;   // - SVG feGaussianBlur stdDeviation (px, zoom-scaled)
  glowWidth:       number;   // - wide bloom stroke-width (px, zoom-scaled)
};

// ─── Vault / file resolution ──────────────────────────────────────────────────

export type FileType = 'markdown' | 'notebook' | 'python' | 'yaml' | 'image' | 'notion' | 'unknown';

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
  history:   ChatMessage[];
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
  | MsgFloatingChatDone
  | MsgFloatingChatError
  | MsgFloatingChatResetDone
  | MsgFloatingChatNodeAdded
  | MsgFloatingChatHistoryRestored
  | MsgMarksRestored
  | MsgVerifyPathResult;

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

/** - webview → host: request system clipboard text (navigator.clipboard is sandboxed) */
export interface MsgRequestClipboardRead {
  type: 'requestClipboardRead';
}

/** - webview → host: write text to system clipboard via vscode.env.clipboard */
export interface MsgWriteClipboard {
  type: 'writeClipboard';
  text: string;
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
  history: ChatMessage[];
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
  history: ChatMessage[];
}

// ─── Canvas marks (vim-style bookmarks) ───────────────────────────────────────

/** - one stored bookmark: focused node + viewport state at mark time */
export interface CanvasMark {
  /** - id of the focused node; null for the `` ` `` (previous-position) register */
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

export type WebviewToHost =
  | MsgRequestFile
  | MsgSaveCanvas
  | MsgOpenFile
  | MsgSearchVault
  | MsgChatMessage
  | MsgRefreshVault
  | MsgWebviewReady
  | MsgDropFiles
  | MsgAddNodeRequest
  | MsgMoveToSubCanvas
  | MsgRequestClipboardRead
  | MsgWriteClipboard
  | MsgCopyAbsolutePath
  | MsgFloatingChatSend
  | MsgFloatingChatSaveUIState
  | MsgFloatingChatAbort
  | MsgFloatingChatPersistHistory
  | MsgFloatingChatReset
  | MsgFloatingChatCompact
  | MsgSaveMarks
  | MsgVerifyPath
  | MsgShowWarning;

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
