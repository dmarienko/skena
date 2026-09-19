/**
 * Shared bookkeeping between the two vim relay registers (TextNode, FloatingChat) and the
 * extension-host clipboard. DOM-free and free of any monaco import, so both can use it.
 *
 * Each file keeps its own register object and its own cache; only the record of what was last
 * handed to the host lives here, so a yank in a text node is still recognised as ours when the
 * chat editor reads the clipboard back, and the other way round.
 */

/**
 * - the last text the host clipboard was given, plus the register form it came from.
 * - Recognition is by text alone: an identical copy made in another app is read as ours. The
 * - host clipboard messages carry no identity token, so there is nothing else to match on.
 */
let lastWritten: { text: string; full: string; linewise: boolean } | null = null;

/** - a linewise register ends in a newline; the host must not carry it or a paste elsewhere gains a blank line */
export function stripForHost(text: string, linewise: boolean): string {
  return linewise ? text.replace(/\r?\n$/, '') : text;
}

export function rememberWritten(sent: string, full: string, linewise: boolean): void {
  lastWritten = { text: sent, full, linewise };
}

/**
 * What host clipboard text means for a vim register: our own copy coming back keeps the
 * register form it was written from, anything else follows vim's rule for the system
 * clipboard — text ending in a newline is linewise.
 */
export function classifyHostText(text: string): { text: string; linewise: boolean } {
  if (lastWritten && text === lastWritten.text) {
    return { text: lastWritten.full, linewise: lastWritten.linewise };
  }
  // - foreign text: CRLF becomes LF, or a linewise paste leaves a stray carriage return in the model
  return { text: text.replace(/\r\n/g, '\n'), linewise: /\r?\n$/.test(text) };
}
