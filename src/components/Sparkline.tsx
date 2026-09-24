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
  maxRpm?: number;
  maxTimeMs?: number;
  width?: number | string;
  height?: number;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  samples,
  launchTimeMs,
  launchRpm,
  maxRpm,
  maxTimeMs,
  width = '100%',
  height = 38,
  className = '',
}) => {
  const gradId = useId();
  const baseWidth = 200;
  const baseHeight = 44;
  const padTop = 4;
  const padBottom = 4;

  const { points, areaPoints, launchDot, maxDot } = useMemo(() => {
    if (!samples || samples.length === 0) {
      return { points: '', areaPoints: '', launchDot: null, maxDot: null };
    }

    const hasValidLaunch =
      launchTimeMs !== undefined &&
      launchRpm !== undefined &&
      launchRpm !== null &&
      launchRpm > 0 &&
      !isNaN(launchRpm);

    const hasValidMax =
      maxRpm !== undefined &&
      maxRpm !== null &&
      maxRpm > 0 &&
      !isNaN(maxRpm);

    // 合併包含 launch 點與 max 點，保證折線必穿過標記點
    let combined = samples.map((s) => ({ ...s }));
    if (hasValidLaunch && !combined.some((s) => s.timeMs === launchTimeMs)) {
      combined.push({ timeMs: launchTimeMs, rpm: launchRpm });
    }
    if (hasValidMax && maxTimeMs !== undefined && !combined.some((s) => s.timeMs === maxTimeMs)) {
      combined.push({ timeMs: maxTimeMs, rpm: maxRpm });
    }
    combined.sort((a, b) => a.timeMs - b.timeMs);

    const xValues = combined.map((s) => s.timeMs);
    const yValues = combined.map((s) => s.rpm);

    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues, xMin + 1);
    const yMin = 0;
    const yMax = Math.max(...yValues, 1);

    const effectiveH = baseHeight - padTop - padBottom;

    const coords = combined.map((sample) => {
      const x = ((sample.timeMs - xMin) / (xMax - xMin)) * baseWidth;
      const y = baseHeight - padBottom - ((sample.rpm - yMin) / (yMax - yMin)) * effectiveH;
      return { x, y, sample };
    });

    const pts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

    // 區域漸層多邊形
    const firstX = coords[0].x.toFixed(1);
    const lastX = coords[coords.length - 1].x.toFixed(1);
    const bottomY = (baseHeight - padBottom).toFixed(1);
    const areaPts = `${firstX},${bottomY} ${pts} ${lastX},${bottomY}`;

    // 發射點 Marker (若 Launch RPM 沒數值則不標點)
    let dot: { cx: number; cy: number } | null = null;
    if (hasValidLaunch) {
      const cx = ((launchTimeMs! - xMin) / (xMax - xMin)) * baseWidth;
      const cy = baseHeight - padBottom - ((launchRpm! - yMin) / (yMax - yMin)) * effectiveH;
      dot = { cx, cy };
    }

    // 最大轉速點 Marker (嚴格選自 combined 頂點，保證在折線上)
    let maxD: { cx: number; cy: number } | null = null;
    const maxItem = combined.reduce((prev, curr) => (curr.rpm > prev.rpm ? curr : prev), combined[0]);
    if (maxItem && maxItem.rpm > 0) {
      const cx = ((maxItem.timeMs - xMin) / (xMax - xMin)) * baseWidth;
      const cy = baseHeight - padBottom - ((maxItem.rpm - yMin) / (yMax - yMin)) * effectiveH;
      maxD = { cx, cy };
    }

    return { points: pts, areaPoints: areaPts, launchDot: dot, maxDot: maxD };
  }, [samples, launchTimeMs, launchRpm, maxRpm, maxTimeMs]);

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

        {/* Max RPM 標記點 (粉紅) */}
        {maxDot && (
          <circle
            cx={maxDot.cx}
            cy={maxDot.cy}
            r="2.5"
            fill="#ec4899"
            stroke="#ffffff"
            strokeWidth="0.8"
          />
        )}

        {/* Launch 標記點 (金黃) */}
        {launchDot && (
          <circle
            cx={launchDot.cx}
            cy={launchDot.cy}
            r="3"
            fill="#fbbf24"
            stroke="#0f172a"
            strokeWidth="1"
          />
        )}
      </svg>
    </div>
  );
};
