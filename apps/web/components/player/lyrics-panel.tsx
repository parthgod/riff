'use client';

import { findActiveLineIndex, type LyricLine } from '@riff/core';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { player, usePlayer } from '@/lib/player/instance';
import { useLyrics } from '@/lib/queries/catalog';

/** After the listener scrolls the lyrics themselves, auto-scroll waits this long. */
export const MANUAL_SCROLL_PAUSE_MS = 3_000;

function Message({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-8 text-center text-muted text-sm">{children}</p>;
}

/** Lyrics for the current track: synced lines follow playback and seek on click. */
export function LyricsPanel({ className }: { className?: string }) {
  const track = usePlayer((s) => s.queue.current?.track ?? null);
  const lyrics = useLyrics(track && !track.isLive ? track.id : null);

  let body: React.ReactNode;
  if (!track) body = <Message>Play something to see its lyrics.</Message>;
  else if (track.isLive) body = <Message>Lyrics aren’t available for live radio.</Message>;
  else if (lyrics.isPending)
    body = (
      <div role="status" aria-label="Loading lyrics" className="flex flex-col gap-4 py-4">
        {[70, 55, 80, 45, 65].map((width) => (
          <div
            key={width}
            className="h-6 animate-pulse rounded-full bg-raised"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    );
  else if (lyrics.isError)
    body = (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-muted text-sm">Couldn’t load lyrics.</p>
        <Button size="sm" onClick={() => lyrics.refetch()}>
          Retry
        </Button>
      </div>
    );
  else if (!lyrics.data) body = <Message>No lyrics for this track.</Message>;
  else if (lyrics.data.instrumental) body = <Message>This track is instrumental.</Message>;
  else if (lyrics.data.synced?.length) body = <SyncedLyrics lines={lyrics.data.synced} />;
  else
    body = (
      <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
        <p className="whitespace-pre-line py-4 text-lg leading-relaxed">{lyrics.data.plain}</p>
      </div>
    );

  return <div className={cn('flex min-h-0 flex-col', className)}>{body}</div>;
}

function SyncedLyrics({ lines }: { lines: LyricLine[] }) {
  const position = usePlayer((s) => s.position);
  const active = findActiveLineIndex(lines, position * 1000);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const manualScrollAt = useRef(0);

  useEffect(() => {
    if (active < 0 || Date.now() - manualScrollAt.current < MANUAL_SCROLL_PAUSE_MS) return;
    const box = scroller.current;
    const line = list.current?.children[active] as HTMLElement | undefined;
    if (!box || !line) return;
    // Scroll only the lyrics box (scrollIntoView would also move the page or sheet around it).
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, [active]);

  const markManual = () => {
    manualScrollAt.current = Date.now();
  };

  return (
    <div
      ref={scroller}
      onWheel={markManual}
      onTouchMove={markManual}
      className="relative h-full min-h-0 overflow-y-auto overscroll-contain"
    >
      <ol ref={list} aria-label="Lyrics" className="flex flex-col gap-1 py-4">
        {lines.map((line, index) => (
          <li key={`${line.timeMs}-${index}`}>
            <button
              type="button"
              aria-current={index === active ? 'true' : undefined}
              onClick={() => player.actions.seek(line.timeMs / 1000)}
              className={cn(
                'w-full rounded-lg px-1 py-1 text-left font-semibold text-xl leading-snug transition-colors hover:text-fg md:text-2xl',
                index === active ? 'text-fg' : index < active ? 'text-faint' : 'text-muted',
              )}
            >
              {line.text || '♪'}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
