/**
 * The section runs in progress in one extension host, by canvas path and section id. One run per
 * section at a time. A stop marks the run so the cells still queued are never started, and names the
 * cell running at that moment for the caller to interrupt.
 */

type CellStatus = 'ok' | 'error';
export type SectionRunResult = 'done' | 'stopped' | 'error' | 'busy';

interface Run { stopped: boolean; cellId: string | null }

export class SectionRuns {
  // - section ids are sec-<timestamp>; two canvases can hold the same id
  private runs = new Map<string, Run>();

  private static key(canvasPath: string, sectionId: string): string { return `${canvasPath}::${sectionId}`; }

  /**
   * Run `cellIds` one after the other with `runCell`; the first error ends the run. `onState` hears
   * true once the run starts and false once it ends, however it ends. 'busy' when the section is
   * already running: nothing is started and `onState` is not called.
   */
  async run(canvasPath: string, sectionId: string, cellIds: string[], runCell: (id: string) => Promise<CellStatus>, onState?: (running: boolean) => void): Promise<SectionRunResult> {
    const key = SectionRuns.key(canvasPath, sectionId);
    if (this.runs.has(key)) return 'busy';
    const run: Run = { stopped: false, cellId: null };
    this.runs.set(key, run);
    onState?.(true);
    try {
      for (const id of cellIds) {
        if (run.stopped) return 'stopped';
        run.cellId = id;
        const st = await runCell(id);
        // - an interrupted cell can still end 'ok' (code that catches KeyboardInterrupt)
        if (run.stopped) return 'stopped';
        if (st === 'error') return 'error';
      }
      return 'done';
    } finally {
      this.runs.delete(key);
      onState?.(false);
    }
  }

  /** Mark the section's run stopped. The cell running now, for the caller to interrupt; null when the section is not running. */
  stop(canvasPath: string, sectionId: string): { cellId: string | null } | null {
    const run = this.runs.get(SectionRuns.key(canvasPath, sectionId));
    if (!run) return null;
    run.stopped = true;
    return { cellId: run.cellId };
  }

  /** The ids of the sections of this canvas that are running. */
  runningIn(canvasPath: string): string[] {
    const prefix = `${canvasPath}::`;
    return [...this.runs.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
  }
}
