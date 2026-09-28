import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LikeButton } from '@/components/tracks/like-button';
import { noContent, stubApi } from '@/test/api-stub';
import { station, track } from '@/test/fixtures';
import { queryWrapper } from '@/test/query-wrapper';
import { Artwork, pickArtwork } from './artwork';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

describe('Artwork', () => {
  test('picks the nearest available size', () => {
    expect(pickArtwork({ md: 'm', lg: 'l' }, 'sm')).toBe('m');
    expect(pickArtwork({ sm: 's' }, 'lg')).toBe('s');
    expect(pickArtwork({}, 'md')).toBeUndefined();
  });

  test('falls back to a placeholder when the image fails', () => {
    const { container } = render(<Artwork artwork={{ md: 'https://img.test/x.jpg' }} size="md" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('LikeButton', () => {
  test('reflects and toggles the liked state', async () => {
    const liked = ['audius:t1'];
    stubApi({
      'GET /api/me/likes/ids': () => Response.json(liked),
      'DELETE /api/me/likes/audius:t1': () => {
        liked.pop();
        return noContent();
      },
    });
    const { wrapper } = queryWrapper();
    render(<LikeButton track={track(1)} />, { wrapper });
    const button = await screen.findByRole('button', {
      name: 'Remove Track 1 from Liked Songs',
    });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(
      await screen.findByRole('button', { name: 'Save Track 1 to Liked Songs' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('is absent for live stations', () => {
    stubApi({ 'GET /api/me/likes/ids': [] });
    const { wrapper } = queryWrapper();
    render(<LikeButton track={station(1)} />, { wrapper });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
