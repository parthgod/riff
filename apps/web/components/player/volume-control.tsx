'use client';

import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { player, usePlayer } from '@/lib/player/instance';

export function VolumeControl() {
  const { volume, muted } = usePlayer(useShallow((s) => ({ volume: s.volume, muted: s.muted })));
  const level = muted ? 0 : volume;
  const percent = Math.round(level * 100);
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={() => player.actions.toggleMute()}
      >
        {level === 0 ? <VolumeX /> : level < 0.5 ? <Volume1 /> : <Volume2 />}
      </Button>
      <Slider
        className="w-24"
        label="Volume"
        valueText={`${percent}%`}
        value={[percent]}
        max={100}
        step={1}
        onValueChange={([next]) => player.actions.setVolume((next ?? 0) / 100)}
      />
    </div>
  );
}
