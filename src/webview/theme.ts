import { THEME, isDarkTheme } from './canvas/palette';

// - write the neutral tokens as --sk-* variables on <html>; re-run when VS Code swaps the theme class
export function installThemeVars(): () => void {
  const apply = () => {
    const t = isDarkTheme() ? THEME.dark : THEME.light;
    for (const [k, v] of Object.entries(t)) document.documentElement.style.setProperty(`--sk-${k}`, v);
  };
  apply();
  const mo = new MutationObserver(apply);
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}
