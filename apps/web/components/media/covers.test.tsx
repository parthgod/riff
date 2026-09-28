import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PlaylistCover } from './covers';

const srcs = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

test('uses the playlist image when it has one', () => {
  const { container } = render(<PlaylistCover playlist={{ coverUrl: 'c', covers: ['a', 'b'] }} />);
  expect(srcs(container)).toEqual(['c']);
});

test('builds a 2×2 mosaic from four or more artworks', () => {
  const { container } = render(
    <PlaylistCover playlist={{ coverUrl: null, covers: ['a', 'b', 'c', 'd'] }} />,
  );
  expect(srcs(container)).toEqual(['a', 'b', 'c', 'd']);
});

test('shows the first artwork when there are fewer than four, or a placeholder when none', () => {
  const few = render(<PlaylistCover playlist={{ coverUrl: null, covers: ['a', 'b'] }} />);
  expect(srcs(few.container)).toEqual(['a']);
  const none = render(<PlaylistCover playlist={{ coverUrl: null, covers: [] }} />);
  expect(srcs(none.container)).toEqual([]);
});
