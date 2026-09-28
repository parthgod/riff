import { useEffect, useRef } from 'react';

export type ShortcutAction =
  | 'togglePlay'
  | 'seekBack'
  | 'seekForward'
  | 'prev'
  | 'next'
  | 'toggleMute'
  | 'like'
  | 'focusSearch';

export type ShortcutHandlers = Record<ShortcutAction, () => void>;

/** Seconds moved by ← and →. */
export const SEEK_STEP_SEC = 5;

/** Text fields and native controls (checkboxes, radios, ranges, selects) keep their own keys. */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Elements that Space activates by itself (links are not among them). */
const ACTIVATES_ON_SPACE =
  'button, summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="slider"]';

/** The player shortcut for a keydown, or null when the key belongs to something else. */
export function shortcutFor(event: KeyboardEvent): ShortcutAction | null {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (ownsKeys(event.target)) return null;
  switch (event.key) {
    case ' ': {
      if (event.repeat) return null;
      const target = event.target;
      if (target instanceof Element && target.closest(ACTIVATES_ON_SPACE)) return null;
      return 'togglePlay';
    }
    case 'ArrowLeft':
      return event.shiftKey ? 'prev' : 'seekBack';
    case 'ArrowRight':
      return event.shiftKey ? 'next' : 'seekForward';
    case 'm':
    case 'M':
      return 'toggleMute';
    case 'l':
    case 'L':
      return 'like';
    case '/':
      return 'focusSearch';
    default:
      return null;
  }
}

/** Binds the player shortcuts to the window for as long as the calling component is mounted. */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      latest.current[action]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
