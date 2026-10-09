/**
 * Path helpers shared by the file resolver and the vault watcher. No vscode import, so tests can
 * load it in plain node.
 */

// - paths the vault watcher never reports: any entry whose name starts with a dot, and anything inside
// - a node_modules, __pycache__ or dist folder
export const WATCH_IGNORED = /(^|[/\\])\..|(^|[/\\])(node_modules|__pycache__|dist)([/\\]|$)/;
