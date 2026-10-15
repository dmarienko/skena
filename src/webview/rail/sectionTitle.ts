/**
 * A section's title as the rail and the canvas print it: `S8: Hedging · quantkit`. Pure: no React.
 */

import { fmtDateTime } from '../../shared/dateTime';
import type { RailKernel } from './SectionRail';

/** - the kernel's own name: a record's display name is its label, a kernel node's is its name (its label is K1) */
export function kernelDisplayName(k: Pick<RailKernel, 'kind' | 'label' | 'name'> | null): string | null {
  return k ? (k.kind === 'record' ? k.label : k.name) : null;
}

/**
 * `title` is the section's title, an untitled section's being its creation date; `head` is
 * `S#: title`; `kernel` is the bound kernel's name, drawn in the colour of its state; `text` is
 * head and kernel as one line.
 */
export function sectionTitleParts(lane: { label: string; title?: string; createdAt: number }, kernelName: string | null): { title: string; head: string; kernel: string | null; text: string } {
  const title = lane.title?.trim() || fmtDateTime(lane.createdAt);
  const head = `${lane.label}: ${title}`;
  return { title, head, kernel: kernelName, text: kernelName ? `${head} · ${kernelName}` : head };
}
