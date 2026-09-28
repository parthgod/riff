import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { station, track, tracks } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { SeekBar } from './seek-bar';
import { Transport } from './transport';
import { VolumeControl } from './volume-control';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));

const ctx = { type: 'playlist' as const, id: 'p1', name: 'Mix' };

beforeEach(() => {
  player.actions.reset();
  player.store.setState({ volume: 1, muted: false });
});

afterEach(() => vi.restoreAllMocks());

describe('Transport', () => {
  test('is disabled until something is loaded', () => {
    render(<Transport />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('play/pause follows the player status', async () => {
    act(() => player.actions.playContext(tracks(2), 0, ctx));
    act(() => player.store.setState({ status: 'playing' }));
    render(<Transport />);
    const toggle = vi.spyOn(player.actions, 'togglePlay');
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(toggle).toHaveBeenCalledOnce();
  });

  test('previous is disabled for live stations', () => {
    act(() => player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' }));
    render(<Transport />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('shuffle and repeat show their state', async () => {
    render(<Transport />);
    const shuffle = screen.getByRole('button', { name: 'Shuffle' });
    await userEvent.click(shuffle);
    expect(shuffle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Repeat all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Repeat one' }));
    expect(screen.getByRole('button', { name: 'Turn repeat off' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('SeekBar', () => {
  test('shows elapsed and total time and seeks with the keyboard', () => {
    act(() => player.actions.playContext([track(1)], 0, ctx));
    act(() => player.store.setState({ position: 65, duration: 200 }));
    render(<SeekBar />);
    const thumb = screen.getByRole('slider', { name: 'Seek' });
    expect(thumb).toHaveAttribute('aria-valuetext', '1:05 of 3:20');
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(player.store.getState().position).toBe(66);
  });

  test('shows LIVE instead of a bar for stations', () => {
    act(() => player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' }));
    render(<SeekBar />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});

describe('VolumeControl', () => {
  test('mutes, unmutes and adjusts', async () => {
    render(<VolumeControl />);
    await userEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(player.store.getState().muted).toBe(true);
    const thumb = screen.getByRole('slider', { name: 'Volume' });
    expect(thumb).toHaveAttribute('aria-valuetext', '0%');
    await userEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Volume' }), { key: 'ArrowLeft' });
    expect(player.store.getState().volume).toBeCloseTo(0.99);
  });
});
