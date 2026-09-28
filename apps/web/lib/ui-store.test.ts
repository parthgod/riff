import { beforeEach, expect, test } from 'vitest';
import { ui, uiStore } from './ui-store';

beforeEach(() => ui.showPanel(null));

test('togglePanel opens a tab, switches tabs, and closes the showing tab', () => {
  ui.togglePanel('queue');
  expect(uiStore.getState().panel).toBe('queue');
  ui.togglePanel('lyrics');
  expect(uiStore.getState().panel).toBe('lyrics');
  ui.togglePanel('lyrics');
  expect(uiStore.getState().panel).toBeNull();
});
