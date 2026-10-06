import { isDarkTheme } from './canvas/palette';

/**
 * Every --vscode-* variable VS Code set on this webview, and whether its theme is dark: the HTML
 * export colours its page with them (export/exportCommand.ts asks through exportThemeRequest).
 */
export function exportThemeVars(): { vars: Record<string, string>; dark: boolean } {
  const vars: Record<string, string> = {};
  const take = (d: CSSStyleDeclaration) => {
    for (let i = 0; i < d.length; i++) {
      const name = d[i];
      if (name.startsWith('--vscode-')) vars[name] = d.getPropertyValue(name).trim();
    }
  };
  // - VS Code writes them as inline style on <html>; the computed style is the fallback
  take(document.documentElement.style);
  if (Object.keys(vars).length === 0) take(getComputedStyle(document.documentElement));
  return { vars, dark: isDarkTheme() };
}
