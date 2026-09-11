import { useSyncExternalStore } from 'react';
import { THEME, isDarkTheme } from './canvas/palette';

// - a colour picked in JS (edgeKindColor) is frozen into the render that picked it, unlike a --sk-*
//   variable the browser re-resolves on its own. This counter moves on every VS Code theme swap so
//   the components that pick one can subscribe and re-render.
let themeTick = 0;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const readTick = () => themeTick;

/** Re-renders the caller whenever VS Code swaps between its light and dark themes. */
export function useThemeTick(): number {
  return useSyncExternalStore(subscribe, readTick, readTick);
}

// - write the neutral tokens as --sk-* variables on <html>; re-run when VS Code swaps the theme class
export function installThemeVars(): () => void {
  const apply = () => {
    const t = isDarkTheme() ? THEME.dark : THEME.light;
    for (const [k, v] of Object.entries(t)) document.documentElement.style.setProperty(`--sk-${k}`, v);
  };
  apply();
  // - the initial apply is not a swap: only a class change past mount bumps the tick
  const mo = new MutationObserver(() => {
    apply();
    themeTick++;
    for (const fn of [...listeners]) fn();
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}
