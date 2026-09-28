import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { type ShortcutHandlers, shortcutFor, useShortcuts } from './shortcuts';

function keydown(key: string, init: KeyboardEventInit = {}, target?: HTMLElement) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  (target ?? document.body).dispatchEvent(event);
  return event;
}

function captured(key: string, init: KeyboardEventInit = {}, target?: HTMLElement) {
  let result: ReturnType<typeof shortcutFor> = null;
  const listener = (event: KeyboardEvent) => {
    result = shortcutFor(event);
  };
  window.addEventListener('keydown', listener);
  keydown(key, init, target);
  window.removeEventListener('keydown', listener);
  return result;
}

describe('shortcutFor', () => {
  test.each([
    [' ', {}, 'togglePlay'],
    ['ArrowLeft', {}, 'seekBack'],
    ['ArrowRight', {}, 'seekForward'],
    ['ArrowLeft', { shiftKey: true }, 'prev'],
    ['ArrowRight', { shiftKey: true }, 'next'],
    ['m', {}, 'toggleMute'],
    ['M', { shiftKey: true }, 'toggleMute'],
    ['l', {}, 'like'],
    ['/', {}, 'focusSearch'],
  ])('%j %j is %s', (key, init, action) => {
    expect(captured(key, init)).toBe(action);
  });

  test.each([
    ['k', {}],
    ['ArrowRight', { ctrlKey: true }],
    ['l', { metaKey: true }],
    ['m', { altKey: true }],
    [' ', { repeat: true }],
  ])('ignores %j %j', (key, init) => {
    expect(captured(key, init)).toBeNull();
  });

  test.each([
    ['input', '<input type="text" />'],
    ['search input', '<input type="search" />'],
    ['textarea', '<textarea></textarea>'],
    ['editable element', '<div contenteditable="true"></div>'],
  ])('ignores keys typed into a %s', (_, html) => {
    document.body.innerHTML = html;
    const field = document.body.firstElementChild as HTMLElement;
    expect(captured('m', {}, field)).toBeNull();
    expect(captured(' ', {}, field)).toBeNull();
  });

  test('Space on a focused button presses the button instead', () => {
    document.body.innerHTML = '<button>Like</button>';
    const button = document.body.firstElementChild as HTMLElement;
    expect(captured(' ', {}, button)).toBeNull();
    expect(captured('ArrowRight', {}, button)).toBe('seekForward');
  });

  test('keys a widget already handled are left alone', () => {
    document.body.innerHTML = '<span role="slider" tabindex="0"></span>';
    const slider = document.body.firstElementChild as HTMLElement;
    slider.addEventListener('keydown', (event) => event.preventDefault());
    expect(captured('ArrowRight', {}, slider)).toBeNull();
  });
});

describe('useShortcuts', () => {
  function Harness({ handlers }: { handlers: ShortcutHandlers }) {
    useShortcuts(handlers);
    return null;
  }

  test('runs the handler and prevents the browser default (e.g. Space scrolling)', () => {
    const handlers = {
      togglePlay: vi.fn(),
      seekBack: vi.fn(),
      seekForward: vi.fn(),
      prev: vi.fn(),
      next: vi.fn(),
      toggleMute: vi.fn(),
      like: vi.fn(),
      focusSearch: vi.fn(),
    };
    const { unmount } = render(<Harness handlers={handlers} />);
    const event = keydown(' ');
    expect(handlers.togglePlay).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    fireEvent.keyDown(window, { key: 'l' });
    expect(handlers.like).toHaveBeenCalledOnce();
    unmount();
    keydown(' ');
    expect(handlers.togglePlay).toHaveBeenCalledOnce();
  });
});
