import React from 'react';
import { NodeProps } from '@xyflow/react';

/**
 * SectionNode — the section is a data-only container node: it owns nodes via their `sectionId` and
 * carries the `#S` label + title, but renders nothing itself. Its visible band is drawn
 * full-viewport-width by the SectionBands screen-space overlay (a flow node can't span the viewport
 * width, which is what a full-width lane needs).
 */
export function SectionNodeComponent(_props: NodeProps): JSX.Element | null {
  return null;
}
