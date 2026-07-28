import type { WidgetModel } from './protocol';

// - escape for HTML text nodes (label content can be arbitrary text)
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// - ipywidgets child refs look like "IPY_MODEL_<comm_id>"
function stripRef(ref: string): string {
  return ref.startsWith('IPY_MODEL_') ? ref.slice('IPY_MODEL_'.length) : ref;
}

function barColour(style: string): string {
  switch (style) {
    case 'success': return '#2ea043';
    case 'info':    return '#1f96bd';
    case 'warning': return '#d29922';
    case 'danger':  return '#e5484d';
    default:        return '#4cc8a0';
  }
}

// - render one widget model (by comm id) to a static HTML snapshot. Supports the subset needed
// - for tqdm.notebook: (Float|Int)Progress, HTML/Label, HBox/VBox. Unknown → placeholder.
export function renderWidget(modelId: string, widgets: Record<string, WidgetModel>, depth = 0): string {
  if (depth > 20) return '';
  const w = widgets[modelId];
  if (!w) return '';
  const name = w.modelName || String((w.state as Record<string, unknown>)._model_name ?? '');
  const s = w.state as Record<string, unknown>;

  if (name === 'FloatProgressModel' || name === 'IntProgressModel' || name === 'ProgressModel') {
    const min = num(s.min, 0), max = num(s.max, 100), val = num(s.value, 0);
    const pct = max > min ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0;
    const colour = barColour(String(s.bar_style ?? ''));
    return `<div class="skena-w-progress"><div class="skena-w-progress-fill" style="width:${(pct * 100).toFixed(1)}%;background:${colour}"></div></div>`;
  }
  if (name === 'HTMLModel' || name === 'LabelModel') {
    // - HTMLModel value is already HTML (tqdm's numbers/timing); LabelModel is plain text
    const raw = String(s.value ?? '');
    return `<span class="skena-w-label">${name === 'LabelModel' ? esc(raw) : raw}</span>`;
  }
  if (name === 'HBoxModel' || name === 'VBoxModel') {
    const dir = name === 'VBoxModel' ? 'column' : 'row';
    const kids = Array.isArray(s.children) ? (s.children as string[]) : [];
    const inner = kids.map(ref => renderWidget(stripRef(ref), widgets, depth + 1)).join('');
    return `<div class="skena-w-box" style="display:flex;flex-direction:${dir};gap:6px;align-items:center">${inner}</div>`;
  }
  return `<span class="skena-w-unsupported">[unsupported widget: ${esc(name)}]</span>`;
}
