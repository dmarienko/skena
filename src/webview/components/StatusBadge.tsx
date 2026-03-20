import React from 'react';
import { STATUS_COLORS } from '../../shared/constants';

export function StatusBadge({ status }: { status: string }): JSX.Element {
  const color = STATUS_COLORS[status] ?? '#6b7280';
  return (
    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 10, background: `${color}22`, border: `1px solid ${color}66`, color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
      {status}
    </span>
  );
}
