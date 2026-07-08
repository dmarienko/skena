// - lazily inject plotly.min.js from the extension dist; memoized so it loads at most once.
// - plotly.js-dist-min is a UMD bundle that attaches window.Plotly.

type PlotlyGlobal = {
  newPlot: (el: HTMLElement, data: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
  purge: (el: HTMLElement) => void;
  Plots: { resize: (el: HTMLElement) => void };
};

let _promise: Promise<PlotlyGlobal> | null = null;

export function loadPlotly(): Promise<PlotlyGlobal> {
  if (_promise) return _promise;
  _promise = new Promise<PlotlyGlobal>((resolve, reject) => {
    const w = window as unknown as { Plotly?: PlotlyGlobal };
    if (w.Plotly) { resolve(w.Plotly); return; }
    const uri = document.getElementById('root')?.dataset.plotlyUri;
    if (!uri) { reject(new Error('plotly asset URI not configured on #root')); return; }
    const s = document.createElement('script');
    s.src = uri;
    s.onload = () => {
      if (w.Plotly) resolve(w.Plotly);
      else reject(new Error('plotly.min.js loaded but window.Plotly is undefined'));
    };
    s.onerror = () => reject(new Error('failed to load plotly.min.js'));
    document.head.appendChild(s);
  });
  return _promise;
}
