import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lacks these browser APIs; Radix (sliders, menus) and the lyrics panel call them.
// Files that opt into the node environment have no DOM at all.
if (typeof Element !== 'undefined') {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.scrollTo ??= () => {};
}

// findBy*/waitFor default to 1 s, which parallel runs on a busy machine can exceed.
configure({ asyncUtilTimeout: 3_000 });

afterEach(() => cleanup());
