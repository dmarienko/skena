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

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// ─── Vault / file resolution ──────────────────────────────────────────────────

export type FileType = 'markdown' | 'notebook' | 'python' | 'yaml' | 'image' | 'notion' | 'unknown';

export interface VaultConfig {
  name: string;
  path: string;
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

export interface MsgSearchResults {
  type: 'searchResults';
  requestId: RequestId;
  results: VaultEntry[];
}

/** - host resolved dropped files, webview adds them as nodes */
export interface MsgNodesFromDrop {
  type: 'nodesFromDrop';
  nodes: CanvasNode[];
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
  | MsgAddNodeTrigger;

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
  | MsgAddNodeRequest;

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
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
  type:  'addNodeResult';
  node:  CanvasNode;
  edge?: CanvasEdge;
}

/**
 * Host → Webview: VS Code command "skena.addNode" was triggered.
 * Webview computes viewport centre and sends back an addNodeRequest.
 */
export interface MsgAddNodeTrigger {
  type: 'addNodeTrigger';
}

// ─── Markdown config ─────────────────────────────────────────────────────────

/** - mirrors the subset of VS Code's markdown.preview.* settings we consume */
export interface MarkdownConfig {
  fontFamily?: string;   // - markdown.preview.fontFamily
  fontSize?:   number;   // - markdown.preview.fontSize
  styles:      string[]; // - markdown.styles (external CSS URLs)
}

export interface MsgMarkdownConfig {
  type:   'markdownConfig';
  config: MarkdownConfig;
}

// ─── LOD ─────────────────────────────────────────────────────────────────────

export type ZoomLevel = 'minimal' | 'overview' | 'reading' | 'detail';

export function zoomToLevel(zoom: number): ZoomLevel {
  if (zoom < 0.3)  return 'minimal';
  if (zoom < 0.6)  return 'overview';
  if (zoom < 1.0)  return 'reading';
  return 'detail';
}
