/**
 * ScrollableContent — generic scrollable wrapper for node content areas.
 *
 * Scroll guard: intercepts native wheel events on this element and stops
 * propagation to React Flow's zoom handler when the element has actual
 * scrollable overflow and is not yet at its scroll boundary.
 *
 * Scroll persistence strategy (survives canvas close/reopen):
 *
 *  1. Module-level Map — updated synchronously on every USER scroll event so it
 *     is always current before a display:none transition resets scrollTop to 0.
 *
 *  2. localStorage — persisted so positions survive webview recreation (VS Code
 *     destroys and recreates the webview when panels are hidden/closed).
 *     Written immediately on scroll via a proper trailing-edge debounce.
 *
 *  3. visibilitychange / pagehide / beforeunload flush — when the webview is
 *     about to be hidden/destroyed the debounce timer may not have fired yet;
 *     these events flush immediately so the close-then-reopen case is always
 *     saved.
 *
 *  4. Restore via useLayoutEffect([hidden, scrollKey, contentLoaded]):
 *     - mount: restores if content is already loaded
 *     - contentLoaded false→true: restores once the real DOM height is known
 *     - hidden true→false: restores after Chromium resets scrollTop on display:none
 *     - retried in a rAF because content-visibility:auto may underestimate
 *       scrollHeight on first render; the retry fires once more elements have
 *       settled to their real heights
 *
 *  KEY BUG FIXED: programmatic `el.scrollTop = value` fires a native `scroll`
 *  event. When content isn't loaded yet the assignment is clamped to 0, the
 *  scroll event handler saves 0, and the real saved position is lost. We
 *  suppress onScroll during programmatic restores via `restoringRef`.
 */

import React, { forwardRef, useRef, useEffect, useLayoutEffect, MutableRefObject, useCallback } from 'react';

interface ScrollableContentProps {
  children:   React.ReactNode;
  style?:     React.CSSProperties;
  className?: string;
  /**
   * Unique key used to persist the scroll position across remounts and
   * hide/show cycles. Pass the React Flow node `id` from the parent.
   * Omit for anonymous scrollable areas where persistence isn't needed.
   */
  scrollKey?: string;
  /**
   * When true, applies display:none to keep the fiber tree mounted while
   * hiding the content (e.g. at low zoom LOD levels). Scroll position is
   * automatically saved and restored around hide/show transitions.
   */
  hidden?: boolean;
  /**
   * Set to true once the actual content has rendered (e.g. file finished loading).
   * The scroll-restore effect re-runs when this transitions false → true so that
   * the restore happens once the div has its real scrollHeight (not 0).
   */
  contentLoaded?: boolean;
}

// - module-level scroll cache — survives component remounts within a session
const scrollPositions = new Map<string, number>();

// ─── localStorage persistence ─────────────────────────────────────────────────

const LS_KEY = 'skena:scrollPositions';

// - seed Map from localStorage on module init so positions are available
// - before any component mounts (covers webview-recreate scenario)
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, number>;
    Object.entries(parsed).forEach(([k, v]) => scrollPositions.set(k, v));
  }
} catch { /* ignore: localStorage unavailable in some webview configs */ }

// - synchronous flush — write current Map to localStorage immediately
function flushToLocalStorage(): void {
  try {
    const obj: Record<string, number> = {};
    scrollPositions.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

// - trailing-edge debounce: resets on every call, fires 300ms after LAST scroll
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
function persistScrollPositions(): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    flushToLocalStorage();
  }, 300);
}

// - emergency flush: fires when the webview is about to be hidden/destroyed
// - covers the case where the user closes the canvas < 300ms after scrolling
// - (debounce timer hasn't fired yet, localStorage still has the old value)
function onPageHide(): void {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  flushToLocalStorage();
}
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') onPageHide();
});
window.addEventListener('pagehide',     onPageHide);
window.addEventListener('beforeunload', onPageHide);

// ─── component ────────────────────────────────────────────────────────────────

export const ScrollableContent = forwardRef<HTMLDivElement, ScrollableContentProps>(
function ScrollableContent({
  children, style, className, scrollKey, hidden, contentLoaded,
}: ScrollableContentProps, forwardedRef): JSX.Element {
  const localRef     = useRef<HTMLDivElement>(null);
  // - true while we are programmatically setting scrollTop during a restore.
  // - Suppresses the onScroll handler so the clamped-to-0 value from an
  // - unloaded-content restore does NOT overwrite the real saved position.
  const restoringRef = useRef(false);
  // - callback ref: feeds both localRef (internal) and any forwarded ref from parent
  const ref = localRef;  // - keep alias so inner code is unchanged
  const setRef = useCallback((el: HTMLDivElement | null) => {
    (localRef as MutableRefObject<HTMLDivElement | null>).current = el;
    if (!forwardedRef) return;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else (forwardedRef as MutableRefObject<HTMLDivElement | null>).current = el;
  }, [forwardedRef]);

  // ─── scroll persistence ─────────────────────────────────────────────────

  useLayoutEffect(() => {
    if (hidden || !scrollKey || !ref.current) return;
    const saved = scrollPositions.get(scrollKey);
    if (!saved) return;

    const el = ref.current;

    // - guard: suppress onScroll during this programmatic set
    restoringRef.current = true;
    el.scrollTop = saved;

    // - content-visibility:auto underestimates scrollHeight on cold load
    // - (off-screen elements use their intrinsic-size estimate, not real height).
    // - After one rAF more elements have settled to real heights, so retry once.
    requestAnimationFrame(() => {
      if (!el) { restoringRef.current = false; return; }
      if (el.scrollTop >= saved * 0.95) {
        // - restore succeeded — lift the suppress guard
        restoringRef.current = false;
        return;
      }
      // - still clamped: retry once more
      el.scrollTop = saved;
      requestAnimationFrame(() => { restoringRef.current = false; });
    });
  }, [hidden, scrollKey, contentLoaded]);

  // - save position on every USER scroll — immediate Map update + trailing debounce
  // - cleanup also saves so unmount captures the final position
  useEffect(() => {
    if (!scrollKey || !ref.current) return;
    const el = ref.current;

    const onScroll = () => {
      // - skip scroll events fired by our own programmatic scrollTop assignments
      if (restoringRef.current) return;
      scrollPositions.set(scrollKey, el.scrollTop);
      persistScrollPositions();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      // - save on unmount only if we are not mid-restore (avoids saving 0)
      if (!restoringRef.current) {
        scrollPositions.set(scrollKey, el.scrollTop);
        persistScrollPositions();
      }
    };
  }, [scrollKey]);

  // ─── wheel guard (prevents viewport zoom while scrolling content) ────────

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      const canScrollY = el.scrollHeight > el.clientHeight + 1;
      const canScrollX = el.scrollWidth  > el.clientWidth  + 1;
      if (!canScrollY && !canScrollX) return;
      e.stopPropagation();
    };

    el.addEventListener('wheel', handler, { passive: true });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <div
      ref={setRef}
      className={`skena-scrollable${className ? ` ${className}` : ''}`}
      style={{
        flex: 1, overflow: 'auto', padding: '6px 8px', minHeight: 0,
        ...(hidden ? { display: 'none' } : undefined),
        ...style,
      }}
    >
      {children}
    </div>
  );
});  // - end forwardRef
