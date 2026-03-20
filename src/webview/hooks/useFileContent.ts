/**
 * Fetches file content from the extension host via message protocol.
 * Caches results in memory (per webview session) to avoid re-fetching.
 * Handles the request/response correlation via requestId.
 * Listens for skena:fileInvalidated events to re-fetch when file changes on disk.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { FileType, MsgFileContent, MsgFileError } from '../../shared/types';

type Status = 'idle' | 'loading' | 'loaded' | 'error';

export interface FileContentState {
  status:      Status;
  content:     string;
  fileType:    FileType;
  resourceUri: string | undefined;
  error:       string | undefined;
}

const IDLE: FileContentState = { status: 'idle', content: '', fileType: 'unknown', resourceUri: undefined, error: undefined };
const LOADING: FileContentState = { status: 'loading', content: '', fileType: 'unknown', resourceUri: undefined, error: undefined };

// - module-level cache: uri → resolved content
const cache = new Map<string, FileContentState>();

/** - normalize relative URIs so "./foo.md" and "foo.md" are the same cache key */
function normalizeUri(uri: string): string {
  return uri.startsWith('./') ? uri.slice(2) : uri;
}

function vscodePostMessage(msg: unknown) {
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

  const requestIdRef = useRef<string | null>(null);

  // - extracted so we can call it both on mount and on invalidation
  const fetchContent = useCallback(() => {
    if (!uri || !key) return;
    const requestId = generateRequestId();
    requestIdRef.current = requestId;
    setState(LOADING);
    vscodePostMessage({ type: 'requestFile', requestId, uri });

    const handler = (e: Event) => {
      const msg = (e as CustomEvent<MsgFileContent | MsgFileError>).detail;
      if (msg.requestId !== requestId) return;

      if (msg.type === 'fileContent') {
        const resolved: FileContentState = {
          status:      'loaded',
          content:     msg.content,
          fileType:    msg.fileType,
          resourceUri: msg.resourceUri,
          error:       undefined,
        };
        cache.set(key, resolved);
        if (requestIdRef.current === requestId) setState(resolved);
      } else {
        const errState: FileContentState = {
          status:      'error',
          content:     '',
          fileType:    'unknown',
          resourceUri: undefined,
          error:       msg.error,
        };
        if (requestIdRef.current === requestId) setState(errState);
      }
      window.removeEventListener('skena:fileResponse', handler);
    };

    window.addEventListener('skena:fileResponse', handler);
  }, [uri, key]);

  // - initial load (or when uri changes)
  useEffect(() => {
    if (!key) return;

    // - cache hit — use immediately, but still listen for invalidation below
    const cached = cache.get(key);
    if (cached?.status === 'loaded') {
      setState(cached);
    } else {
      fetchContent();
    }

    return () => { requestIdRef.current = null; };
  }, [key, fetchContent]);

  // - re-fetch when file changes on disk
  useEffect(() => {
    if (!uri) return;

    const handler = (e: Event) => {
      const changedUri = (e as CustomEvent<string>).detail;
      const changedKey = normalizeUri(changedUri);
      if (changedKey !== key) return;
      cache.delete(key);
      fetchContent();
    };

    window.addEventListener('skena:fileInvalidated', handler);
    return () => window.removeEventListener('skena:fileInvalidated', handler);
  }, [key, fetchContent]);

  return state;
}

/** - manually invalidate a cached URI (e.g. after external edit) */
export function invalidateFileCache(uri: string): void {
  cache.delete(normalizeUri(uri));
}
