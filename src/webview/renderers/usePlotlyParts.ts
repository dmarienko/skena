/**
 * Draws an interactive chart into every plotly placeholder (plotlyParts.ts) of the html shown under `ref`,
 * and again when that html changes. React sets the html once per string, so the charts it holds stay
 * until the next output replaces it.
 */
import { useEffect, type RefObject } from 'react';
import { loadPlotly } from './plotlyLoader';
import { PLOTLY_PART_CLASS, plotlyPartFigure } from '../../shared/plotlyParts';

// - the height of a figure whose layout gives none: plotly's own default
const FIGURE_H = 450;

type Plotly = Awaited<ReturnType<typeof loadPlotly>>;
interface Figure { data: unknown[]; layout?: { height?: unknown } & Record<string, unknown> }

function figureOf(el: HTMLElement): Figure | null {
  try {
    const fig = JSON.parse(plotlyPartFigure(el.dataset.figure) ?? '') as Figure;
    return fig && Array.isArray(fig.data) ? fig : null;
  } catch { return null; }
}

export function usePlotlyParts(ref: RefObject<HTMLElement>, html: string): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || !html.includes(PLOTLY_PART_CLASS)) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(`.${PLOTLY_PART_CLASS}`));
    let cancelled = false;
    let plotly: Plotly | null = null;
    // - keep each chart sized to the (resizable) cell
    const ro = new ResizeObserver(entries => { for (const e of entries) plotly?.Plots.resize(e.target as HTMLElement); });
    loadPlotly()
      .then(P => {
        if (cancelled) return;
        plotly = P;
        for (const el of els) {
          const fig = figureOf(el);
          if (!fig) { el.textContent = 'Plotly: invalid figure JSON'; continue; }
          const h = typeof fig.layout?.height === 'number' ? fig.layout.height : FIGURE_H;
          Object.assign(el.style, { width: '100%', height: `${h}px`, margin: '6px 0' });
          void P.newPlot(el, fig.data, fig.layout ?? {}, { responsive: true, displaylogo: false });
          ro.observe(el);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        for (const el of els) el.textContent = `Plotly: ${e instanceof Error ? e.message : String(e)}`;
      });
    return () => {
      cancelled = true;
      ro.disconnect();
      if (plotly) for (const el of els) plotly.purge(el);
    };
  }, [ref, html]);
}
