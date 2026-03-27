/**
 * Fetches file content from the extension host via message protocol.
 * Caches results in memory (per webview session) to avoid re-fetching.
 * Handles the request/response correlation via requestId.
 * Listens for skena:fileInvalidated events to re-fetch when file changes on disk.
 *
 * Design notes:
 *  - Each effect invocation is fully self-contained: it registers its own
 *    skena:fileResponse listener and removes it in cleanup. This is safe in
 *    React StrictMode (double-invoke) because the `aborted` flag prevents the
 *    first (StrictMode-cancelled) invocation from updating state, and the
 *    handler is always removed on cleanup so no stale listeners accumulate.
 *  - `fetchVersion` is bumped by the file-invalidation effect to re-trigger
 *    the main fetch effect when a file changes on disk.
 */

import { useState, useEffect } from 'react';
import { FileType, MsgFileContent, MsgFileError } from '../../shared/types';

type Status = 'idle' | 'loading' | 'loaded' | 'error';

export interface FileContentState {
  status:      Status;
  content:     string;
  fileType:    FileType;
  resourceUri: string | undefined;
  error:       string | undefined;
}

const IDLE: FileContentState    = { status: 'idle',    content: '', fileType: 'unknown', resourceUri: undefined, error: undefined };
const LOADING: FileContentState = { status: 'loading', content: '', fileType: 'unknown', resourceUri: undefined, error: undefined };

// - module-level cache: uri → resolved content (survives component remounts)
const cache = new Map<string, FileContentState>();

/** - normalize relative URIs so "./foo.md" and "foo.md" share the same cache key */
function normalizeUri(uri: string): string {
  return uri.startsWith('./') ? uri.slice(2) : uri;
}

function vscodePostMessage(msg: unknown): void {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

function generateRequestId(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * Hook to load file content for a canvas node.
 * Auto re-fetches when the underlying file changes on disk.
 * @param uri  - vault:// URI or project-relative path. Undefined = skip.
 */
export function useFileContent(uri: string | undefined): FileContentState {
  const key = uri ? normalizeUri(uri) : undefined;

  const [state, setState] = useState<FileContentState>(() =>
    key ? (cache.get(key) ?? IDLE) : IDLE
  );

  // - bump to force re-fetch after file invalidation
  const [fetchVersion, setFetchVersion] = useState(0);

  // ─── main fetch effect ────────────────────────────────────────────────────
  useEffect(() => {
    if (!key || !uri) return;

    // - cache hit — serve immediately
    const cached = cache.get(key);
    if (cached?.status === 'loaded') {
      setState(cached);
      return;
    }

    // - `aborted` is local to this effect invocation.
    // - When React StrictMode runs cleanup then re-runs the effect, the first
    // - invocation's handler is removed AND aborted so it can't update state.
    let aborted = false;
    const requestId = generateRequestId();

    setState(LOADING);
    vscodePostMessage({ type: 'requestFile', requestId, uri });

    const handler = (e: Event) => {
      if (aborted) return;
      const msg = (e as CustomEvent<MsgFileContent | MsgFileError>).detail;
      if (msg.requestId !== requestId) return;

      // - always remove self: each request is handled exactly once
      window.removeEventListener('skena:fileResponse', handler);

      if (msg.type === 'fileContent') {
        const resolved: FileContentState = {
          status:      'loaded',
          content:     msg.content,
          fileType:    msg.fileType,
          resourceUri: msg.resourceUri,
          error:       undefined,
        };
        cache.set(key, resolved);
        setState(resolved);
      } else {
        setState({
          status:      'error',
          content:     '',
          fileType:    'unknown',
          resourceUri: undefined,
          error:       msg.error,
        });
      }
    };

    window.addEventListener('skena:fileResponse', handler);

    return () => {
      aborted = true;
      window.removeEventListener('skena:fileResponse', handler);
    };
  }, [key, uri, fetchVersion]);

  // ─── file-invalidation effect ─────────────────────────────────────────────
  useEffect(() => {
    if (!uri || !key) return;

    const handler = (e: Event) => {
      const changedUri = (e as CustomEvent<string>).detail;
      if (normalizeUri(changedUri) !== key) return;
      cache.delete(key);
      setFetchVersion(v => v + 1);
    };

    window.addEventListener('skena:fileInvalidated', handler);
    return () => window.removeEventListener('skena:fileInvalidated', handler);
  }, [key, uri]);

  return state;
}

/** - manually invalidate a cached URI (e.g. after external edit) */
export function invalidateFileCache(uri: string): void {
  cache.delete(normalizeUri(uri));
}
