/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId, useMemo } from 'react';
import { RpmSample } from '../types';

interface SparklineProps {
  samples: RpmSample[];
  launchTimeMs?: number;
  launchRpm?: number;
  width?: number | string;
  height?: number;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  samples,
  launchTimeMs,
  launchRpm,
  width = '100%',
  height = 38,
  className = '',
}) => {
  const gradId = useId();
  const baseWidth = 200;
  const baseHeight = 44;
  const padTop = 4;
  const padBottom = 4;

  const { points, areaPoints, maxDot } = useMemo(() => {
    if (!samples || samples.length === 0) {
      return { points: '', areaPoints: '', maxDot: null };
    }

    const xValues = samples.map((s) => s.timeMs);
    const yValues = samples.map((s) => s.rpm);

    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues, xMin + 1);
    const yMin = 0;
    const yMax = Math.max(...yValues, 1);

    const effectiveH = baseHeight - padTop - padBottom;

    const coords = samples.map((sample) => {
      const x = ((sample.timeMs - xMin) / (xMax - xMin)) * baseWidth;
      const y = baseHeight - padBottom - ((sample.rpm - yMin) / (yMax - yMin)) * effectiveH;
      return { x, y, sample };
    });

    const pts = coords.map((c) => `${c.x},${c.y}`).join(' ');

    // 區域漸層多邊形
    const firstX = coords[0].x;
    const lastX = coords[coords.length - 1].x;
    const bottomY = baseHeight - padBottom;
    const areaPts = `${firstX},${bottomY} ${pts} ${lastX},${bottomY}`;

    // 最大轉速點 Marker：直接取自實際坐標點陣列中的最大頂點，保證 100% 落在折線上
    let maxD: { cx: number; cy: number } | null = null;
    if (coords.length > 0) {
      const maxCoord = coords.reduce((prev, curr) => (curr.sample.rpm > prev.sample.rpm ? curr : prev), coords[0]);
      if (maxCoord && maxCoord.sample.rpm > 0) {
        maxD = { cx: maxCoord.x, cy: maxCoord.y };
      }
    }

    return { points: pts, areaPoints: areaPts, maxDot: maxD };
  }, [samples]);

  if (!samples || samples.length === 0) {
    return (
      <div
        style={{ height }}
        className="w-full border border-dashed border-slate-800/80 rounded-lg bg-slate-950/40 flex items-center justify-center text-[10px] text-slate-600 font-mono"
      >
        無曲線數據
      </div>
    );
  }

  return (
    <div className={`relative flex items-center ${className}`} style={{ width: typeof width === 'number' ? `${width}px` : width, height: `${height}px` }}>
      <svg
        viewBox={`0 0 ${baseWidth} ${baseHeight}`}
        preserveAspectRatio="none"
        className="w-full h-full overflow-visible select-none pointer-events-none"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* 底部微弱輔助基準線 */}
        <line
          x1="0"
          y1={baseHeight - padBottom}
          x2={baseWidth}
          y2={baseHeight - padBottom}
          stroke="rgba(30, 41, 59, 0.6)"
          strokeWidth="1"
          strokeDasharray="2,2"
        />

        {/* 曲線下方半透明漸層填色 */}
        <polygon fill={`url(#${gradId})`} points={areaPoints} />

        {/* 曲線路徑 */}
        <polyline
          fill="none"
          stroke="#22d3ee"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />

        {/* Max RPM 標記點 (粉紅) - 精準落在曲線上 */}
        {maxDot && (
          <circle
            cx={maxDot.cx}
            cy={maxDot.cy}
            r="2.5"
            fill="#f43f5e"
            stroke="#ffffff"
            strokeWidth="0.8"
          />
        )}
      </svg>
    </div>
  );
};
