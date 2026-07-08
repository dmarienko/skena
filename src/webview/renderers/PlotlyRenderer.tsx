// - renders a plotly figure (JSON string) into a cell; lazy-loads plotly.js on first mount.
// - `nowheel nodrag` isolate chart interaction from canvas pan/drag (same as Monaco nodes).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadPlotly } from './plotlyLoader';

export function PlotlyRenderer({ json }: { json: string }): JSX.Element {
  const elRef = useRef<HTMLDivElement>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // - parse once; require a data array to count as a figure
  const fig = useMemo(() => {
    try {
      const o = JSON.parse(json);
      if (!o || typeof o !== 'object' || !Array.isArray(o.data)) return null;
      return o as { data: unknown[]; layout?: unknown };
    } catch { return null; }
  }, [json]);

  useEffect(() => {
    if (!fig) { setError('invalid figure JSON'); setLoading(false); return; }
    // - fig is valid → clear any stale error and re-enter the loading state before (re)plotting,
    //   otherwise a transient invalid json would leave `error` set forever
    setError(null);
    setLoading(true);
    let cancelled = false;
    let plotly: { purge: (el: HTMLElement) => void } | null = null;
    const el = elRef.current;
    loadPlotly()
      .then(P => {
        if (cancelled || !el) return;
        plotly = P;
        P.newPlot(el, fig.data, fig.layout ?? {}, { responsive: true, displaylogo: false });
        setLoading(false);
      })
      .catch((e: unknown) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => {
      cancelled = true;
      if (plotly && el) plotly.purge(el);
    };
  }, [fig]);

  // - keep the chart sized to the (resizable) node
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = window as unknown as { Plotly?: { Plots: { resize: (e: HTMLElement) => void } } };
      if (w.Plotly) w.Plotly.Plots.resize(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // - error/loading are overlays, never an early return: the plot div must stay mounted so elRef
  //   remains valid and the effect can re-plot once a later valid json arrives
  return (
    <div className="skena-plotly nowheel nodrag" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {error && (
        <div className="skena-error" style={{ position: 'absolute', inset: 0, padding: 8, fontSize: 11, background: 'var(--vscode-editor-background)' }}>
          Plotly: {error}
        </div>
      )}
      {loading && !error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 11 }}>
          loading plotly…
        </div>
      )}
      <div ref={elRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
