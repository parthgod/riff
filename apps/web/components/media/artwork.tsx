'use client';

import type { Artwork as ArtworkSizes } from '@riff/core';
import { Music } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

type Size = 'sm' | 'md' | 'lg';

const PREFERENCE: Record<Size, (keyof ArtworkSizes)[]> = {
  sm: ['sm', 'md', 'lg'],
  md: ['md', 'lg', 'sm'],
  lg: ['lg', 'md', 'sm'],
};

/** The best available image for a display size (~150 / ~480 / ~1000 px). */
export function pickArtwork(artwork: ArtworkSizes, size: Size): string | undefined {
  for (const key of PREFERENCE[size]) if (artwork[key]) return artwork[key];
  return undefined;
}

interface ArtworkProps {
  artwork: ArtworkSizes;
  size: Size;
  className?: string;
  /** Artwork is decorative next to a title, so alt is empty unless given. */
  alt?: string;
}

/** Square cover art with a quiet placeholder when there is none (or it fails to load). */
export function Artwork({ artwork, size, className, alt = '' }: ArtworkProps) {
  const src = pickArtwork(artwork, size);
  return <ArtworkImage key={src ?? 'none'} src={src} className={className} alt={alt} />;
}

function ArtworkImage({ src, className, alt }: { src?: string; className?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const placeholder = cn('grid aspect-square place-items-center bg-raised text-faint', className);
    const icon = <Music className="size-1/3" aria-hidden />;
    return alt ? (
      <div role="img" aria-label={alt} className={placeholder}>
        {icon}
      </div>
    ) : (
      <div className={placeholder}>{icon}</div>
    );
  }
  // A plain <img>: artwork comes from many upstream hosts that next/image would need allowlisted.
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn('aspect-square bg-raised object-cover', className)}
    />
  );
}
