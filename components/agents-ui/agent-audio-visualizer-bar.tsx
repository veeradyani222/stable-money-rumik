'use client';

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

export type AgentVisualizerSpeaker = 'user' | 'agent' | 'neutral';

interface AgentAudioVisualizerBarProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  barCount?: number;
  /** @deprecated prefer `speaker` */
  state?: string;
  speaker?: AgentVisualizerSpeaker;
  audioTrack?: unknown;
  analyser?: AnalyserNode | null;
}

const heightMap = {
  sm: 20,
  md: 40,
  lg: 60,
} as const;

function getNormalizedAmplitude(dataArray: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < dataArray.length; index += 1) {
    const centered = (dataArray[index] - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, dataArray.length)) * 3.2);
}

const SPEAKER_COLORS: Record<AgentVisualizerSpeaker, string> = {
  user: '#f8fafc',
  agent: '#e8c97c',
  neutral: '#f8fafc',
};

export function AgentAudioVisualizerBar({
  size = 'md',
  color,
  barCount = 5,
  state,
  speaker = 'neutral',
  audioTrack: _audioTrack,
  analyser,
}: AgentAudioVisualizerBarProps) {
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: barCount }, () => 0.18));
  const height = heightMap[size];
  const resolvedSpeaker: AgentVisualizerSpeaker =
    speaker ?? (state === 'speaking' ? 'agent' : 'neutral');
  const resolvedColor = color || SPEAKER_COLORS[resolvedSpeaker];

  useEffect(() => {
    setLevels(Array.from({ length: barCount }, () => 0.18));
  }, [barCount]);

  useEffect(() => {
    const dataArray = analyser ? new Uint8Array(analyser.fftSize) : null;
    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;

      if (analyser && dataArray) {
        analyser.getByteTimeDomainData(dataArray);
        const normalizedAmplitude = getNormalizedAmplitude(dataArray);
        const boostedAmplitude = Math.pow(normalizedAmplitude, 0.55);
        setLevels(
          Array.from({ length: barCount }, (_, index) => {
            const wave = (Math.sin(frame * 0.9 + index * 0.72) + 1) / 2;
            const spread = 0.7 + wave * 0.55;
            return Math.min(1, 0.22 + boostedAmplitude * 0.78 * spread);
          }),
        );
        return;
      }

      setLevels(
        Array.from({ length: barCount }, (_, index) => {
          const wave = (Math.sin(frame * 0.6 + index * 0.8) + 1) / 2;
          if (resolvedSpeaker === 'agent') return 0.22 + wave * 0.65;
          if (resolvedSpeaker === 'user') return 0.2 + wave * 0.42;
          return 0.14;
        }),
      );
    }, 90);

    return () => window.clearInterval(timer);
  }, [analyser, barCount, resolvedSpeaker]);

  return (
    <div
      className="agent-audio-visualizer-bar"
      style={{ '--agent-bar-color': resolvedColor, height: `${height}px` } as CSSProperties}
      aria-hidden="true"
    >
      {levels.map((level, index) => (
        <span
          key={index}
          className="agent-audio-visualizer-bar__bar"
          style={{ height: `${Math.max(18, Math.round(level * height))}px` }}
        />
      ))}
    </div>
  );
}
