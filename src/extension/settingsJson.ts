/**
 * Pure JSON-with-comments parsing for settings files.
 *
 * No vscode import — testable standalone. Uses jsonc-parser so a string value
 * containing "//" (a URL, for instance) is never mistaken for a comment.
 */

import { parse, ParseError, printParseErrorCode } from 'jsonc-parser';

/** Parse VS Code's relaxed JSON (comments, trailing commas). Throws on error. */
export function parseSettingsJson(raw: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const result = parse(raw, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `settings JSON parse error: ${printParseErrorCode(first.error)} at offset ${first.offset}`,
    );
  }
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('settings JSON must parse to an object');
  }

  return result as Record<string, unknown>;
}
