/**
 * What a file node's header shows: the frontmatter fields of a markdown file and the file name.
 * NodeHeader draws them on the canvas; the HTML export draws the same row.
 */

export interface Frontmatter {
  title?:  string;
  status?: string;
  type?:   string;
  score?:  string;
}

// - a lightweight regex parse for display only (gray-matter runs in the extension host)
export function extractFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Frontmatter = {};
  for (const line of match[1].split('\n')) {
    const [k, ...rest] = line.split(':');
    const key = k?.trim();
    const val = rest.join(':').trim().replace(/^["']|["']$/g, '');
    if (key === 'title')  fm.title  = val;
    if (key === 'status') fm.status = val;
    if (key === 'type')   fm.type   = val;
    if (key === 'score')  fm.score  = val;
  }
  return fm;
}

export function filenameFromUri(uri: string): string {
  return uri.split('/').pop()?.replace(/\.(md|ipynb|py|yaml|yml)$/, '') ?? uri;
}
