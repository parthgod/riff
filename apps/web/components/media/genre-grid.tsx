import { GENRES } from '@riff/core';
import Link from 'next/link';

/** Six quiet tints so the grid has rhythm without competing with the ember accent. */
const TINTS = [
  'oklch(0.32 0.07 30)',
  'oklch(0.32 0.06 150)',
  'oklch(0.32 0.07 250)',
  'oklch(0.32 0.07 320)',
  'oklch(0.33 0.07 80)',
  'oklch(0.32 0.06 200)',
];

export const genreHref = (genre: string) => `/genre/${encodeURIComponent(genre)}`;

export function GenreGrid() {
  return (
    <ul className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:px-8 lg:grid-cols-4 xl:grid-cols-5">
      {GENRES.map((genre, index) => (
        <li key={genre}>
          <Link
            href={genreHref(genre)}
            style={{ backgroundColor: TINTS[index % TINTS.length] }}
            className="flex aspect-[5/3] items-end rounded-xl p-4 font-semibold text-lg leading-tight tracking-tight transition-[filter] hover:brightness-125"
          >
            {genre}
          </Link>
        </li>
      ))}
    </ul>
  );
}
