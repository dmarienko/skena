/**
 * NodeHeader — thin top bar shown on all file nodes.
 * Shows: file type icon + title (from frontmatter or filename) + status badge.
 */

import React, { useMemo } from 'react';
import { FileType } from '../../shared/types';
import { FILE_TYPE_COLORS, FILE_TYPE_ICONS, STATUS_COLORS } from '../../shared/constants';
import { StatusBadge } from './StatusBadge';
import { extractFrontmatter, filenameFromUri } from '../../shared/fileHeader';

interface NodeHeaderProps {
  fileType:    FileType;
  uri:         string;
  /** - raw markdown/yaml content for frontmatter extraction */
  content:     string;
  accentColor: string;
  onOpen:      () => void;
}

export function NodeHeader({ fileType, uri, content, accentColor, onOpen }: NodeHeaderProps): JSX.Element {
  const fm = useMemo(() => (fileType === 'markdown' ? extractFrontmatter(content) : {}), [content, fileType]);
  const title = fm.title ?? filenameFromUri(uri);
  const icon = FILE_TYPE_ICONS[fileType] ?? 'file';
  // - type-based tint for background; accent color stays on the border only
  const typeColor = FILE_TYPE_COLORS[fileType] ?? FILE_TYPE_COLORS['unknown'];

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderBottom: `1px solid ${accentColor}40`, background: `${typeColor}22`, flexShrink: 0, minHeight: 34 }}
    >
      {/* - codicon icon */}
      <span className={`codicon codicon-${icon}`} style={{ fontSize: 16, opacity: 0.7, flexShrink: 0 }} />

      <span
        style={{ flex: 1, fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
        onClick={onOpen}
        title={uri}
      >
        {title}
      </span>

      {fm.status && <StatusBadge status={fm.status} />}
      {fm.type   && <span style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{fm.type}</span>}
    </div>
  );
}
