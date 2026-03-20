import React from 'react';

export function ScrollableContent({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '6px 8px', minHeight: 0 }}>
      {children}
    </div>
  );
}
