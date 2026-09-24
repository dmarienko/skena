// - stands in for 'react' in the knowledgeAssets bundle that tests/knowledge-assets.mjs drives
//   hook by hook: every hook goes to the runtime the test puts on globalThis.__hooks
export const useState    = (...a) => globalThis.__hooks.useState(...a);
export const useRef      = (...a) => globalThis.__hooks.useRef(...a);
export const useEffect   = (...a) => globalThis.__hooks.useEffect(...a);
export const useCallback = (...a) => globalThis.__hooks.useCallback(...a);
