/**
 * ScrollableContent — generic scrollable wrapper for node content areas.
 *
 * Scroll guard: intercepts native wheel events on this element and stops
 * propagation to React Flow's zoom handler when the element has actual
 * scrollable overflow and is not yet at its scroll boundary.
 *
 * Result:
 *   - Scroll over node with overflowing content  → scrolls content, no viewport zoom
 *   - Scroll over node with content that fits     → event bubbles → viewport zooms normally
 *   - Scroll at top/bottom boundary              → event bubbles → viewport zooms normally
 */

import React, { useRef, useEffect } from 'react';

interface ScrollableContentProps {
  children:  React.ReactNode;
  style?:    React.CSSProperties;
  className?: string;
}

export function ScrollableContent({ children, style, className }: ScrollableContentProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      const canScrollY = el.scrollHeight > el.clientHeight + 1;
      const canScrollX = el.scrollWidth  > el.clientWidth  + 1;
      // - no overflow at all → let the viewport zoom
      if (!canScrollY && !canScrollX) return;
      // - has scrollable content → consume entirely, never leak to viewport
      // - (letting boundary events bubble causes jarring viewport pan/zoom at scroll edges)
      e.stopPropagation();
    };

    // - passive: true = browser scrolls immediately without waiting for our handler;
    // - stopPropagation is still allowed with passive listeners
    el.addEventListener('wheel', handler, { passive: true });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <div
      ref={ref}
      // - skena-scrollable: marker class for the canvas-level wheel handler
      // - so it knows to skip this element and let ScrollableContent manage scroll
      className={`skena-scrollable${className ? ` ${className}` : ''}`}
      style={{ flex: 1, overflow: 'auto', padding: '6px 8px', minHeight: 0, ...style }}
    >
      {children}
    </div>
  );
}
