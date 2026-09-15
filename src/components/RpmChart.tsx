/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Gauge, Maximize2, MoveHorizontal } from 'lucide-react';
import { RpmSample } from '../types';

interface RpmChartProps {
  samples: RpmSample[];
  activeLabel?: string;
  launchRpm?: number;
  launchTimeMs?: number;
  launchMarkerValid?: boolean;
  maxRpm?: number;
  maxTimeMs?: number;
}

export const RpmChart: React.FC<RpmChartProps> = ({
  samples,
  activeLabel = '最新轉速數據',
  launchRpm,
  launchTimeMs,
  launchMarkerValid = true,
  maxRpm,
  maxTimeMs,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'fit' | 'scroll'>('fit');

  // 監聽外層容器寬度，確保手機板圖表完全自適應且無被截斷
  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  const isMobile = (containerWidth > 0 ? containerWidth : (typeof window !== 'undefined' ? window.innerWidth : 800)) < 640;

  // SVG 畫布高度：手機端稍微精簡（270px），避免佔據過多直向空間；電腦端（380px）
  const height = isMobile ? 270 : 380;

  // 邊界間距（手機端精簡邊距，保留更多繪圖空間給折線）
  const padding = isMobile
    ? { top: 26, right: 16, bottom: 36, left: 44 }
    : { top: 40, right: 35, bottom: 45, left: 62 };

  // 建立包含 LAUNCH 發射點在內的完整圖表樣本序列，保證發射點與最高點完美錨定在折線路徑上
  const chartSamples = useMemo(() => {
    if (samples.length === 0) return [];
    if (launchTimeMs !== undefined && launchMarkerValid !== false && launchRpm !== undefined) {
      const existing = samples.find((s) => s.timeMs === launchTimeMs);
      if (!existing) {
        const merged = [...samples, { timeMs: launchTimeMs, rpm: launchRpm }];
        merged.sort((a, b) => a.timeMs - b.timeMs);
        return merged;
      }
    }
    return samples;
  }, [samples, launchTimeMs, launchRpm, launchMarkerValid]);

  // 計算數據極值與範圍 (保證完整涵蓋 launch 與 max 點)
  const stats = useMemo(() => {
    if (chartSamples.length === 0) {
      return {
        xMin: 0,
        xMax: 1000,
        yMin: 0,
        yMax: 8000,
        maxSample: null,
      };
    }

    const xValues = chartSamples.map((s) => s.timeMs);
    const yValues = chartSamples.map((s) => s.rpm);

    // 曲線由有數據的第一筆時間點 (timeMs) 開始繪製，不以時間 0 為參考
    // 同時確保 launchTimeMs 與 maxTimeMs 均完整包含在 X 軸視窗內
    const minSampleTime = Math.min(...xValues);
    const hasLaunch = launchTimeMs !== undefined && launchMarkerValid !== false;
    const xMin = hasLaunch ? Math.min(minSampleTime, launchTimeMs) : minSampleTime;
    const maxSampleTime = Math.max(
      ...xValues,
      maxTimeMs !== undefined ? maxTimeMs : minSampleTime,
      hasLaunch ? launchTimeMs : minSampleTime
    );
    const xMax = Math.max(maxSampleTime, xMin + 100);

    const yMin = 0; // Y 軸轉速從 0 開始
    const maxVal = Math.max(
      ...yValues,
      maxRpm !== undefined ? maxRpm : 0,
      hasLaunch && launchRpm !== undefined ? launchRpm : 0
    );
    // Y 軸最大刻度自動四捨五入到最近的千位數，並多留 10% 空間
    const rawYMax = Math.max(maxVal * 1.1, 4000);
    const yMax = Math.ceil(rawYMax / 1000) * 1000;

    // 尋找最大轉速點 (若有給定 maxTimeMs 且可在 chartSamples 找到或精確對應)
    let maxSample: { timeMs: number; rpm: number } | null = null;
    if (maxTimeMs !== undefined && maxRpm !== undefined) {
      maxSample = { timeMs: maxTimeMs, rpm: maxRpm };
    } else {
      let bestSample = chartSamples[0];
      chartSamples.forEach((s) => {
        if (s.rpm > bestSample.rpm) {
          bestSample = s;
        }
      });
      maxSample = bestSample;
    }

    return { xMin, xMax, yMin, yMax, maxSample };
  }, [chartSamples, maxRpm, maxTimeMs, launchTimeMs, launchRpm, launchMarkerValid]);

  // 動態寬度計算：預設 'fit' 模式下，寬度完全吻合外層容器寬度，手機端 100% 完整顯示無切邊
  const width = useMemo(() => {
    if (chartSamples.length === 0) {
      return containerWidth > 0 ? containerWidth : 800;
    }
    if (viewMode === 'fit') {
      return Math.max(containerWidth > 0 ? containerWidth : 320, 280);
    }
    // 滾動模式：依據數據持續時間（秒）展開
    const durationMs = stats.xMax - stats.xMin;
    const durationSec = durationMs / 1000;
    const pixelPerSecond = isMobile ? 100 : 150;
    const calculatedWidth = Math.round(durationSec * pixelPerSecond) + padding.left + padding.right;
    return Math.max(containerWidth > 0 ? containerWidth : 800, calculatedWidth);
  }, [chartSamples, viewMode, containerWidth, stats.xMax, stats.xMin, isMobile, padding.left, padding.right]);

  const chartWidth = Math.max(width - padding.left - padding.right, 50);
  const chartHeight = Math.max(height - padding.top - padding.bottom, 50);

  // 座標轉換 helper (輸入實際數據，輸出畫布 SVG X, Y 座標)
  const getX = (timeMs: number) => {
    const range = stats.xMax - stats.xMin;
    const ratio = range > 0 ? (timeMs - stats.xMin) / range : 0;
    return padding.left + ratio * chartWidth;
  };

  const getY = (rpm: number) => {
    const range = stats.yMax - stats.yMin;
    const ratio = range > 0 ? (rpm - stats.yMin) / range : 0;
    return height - padding.bottom - ratio * chartHeight;
  };

  // 產生折線的 SVG Path
  const linePath = useMemo(() => {
    if (chartSamples.length === 0) return '';
    return chartSamples
      .map((sample, idx) => {
        const x = getX(sample.timeMs);
        const y = getY(sample.rpm);
        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  }, [chartSamples, stats, chartWidth, chartHeight]);

  // 產生漸層填滿區域的 SVG Path
  const areaPath = useMemo(() => {
    if (chartSamples.length === 0) return '';
    const firstX = getX(chartSamples[0].timeMs);
    const lastX = getX(chartSamples[chartSamples.length - 1].timeMs);
    const bottomY = height - padding.bottom;

    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  }, [chartSamples, linePath, stats, chartWidth, chartHeight, height, padding.bottom]);

  // 產生 Y 軸網格線與刻度 (手機端刻度 4 段，電腦端 5 段)
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = isMobile ? 4 : 5;
    const step = (stats.yMax - stats.yMin) / count;
    for (let i = 0; i <= count; i++) {
      ticks.push(stats.yMin + i * step);
    }
    return ticks;
  }, [stats, isMobile]);

  // 產生 X 軸網格線與刻度 (手機端 4 個，電腦端 5 個)
  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = isMobile ? 4 : 5;
    const step = (stats.xMax - stats.xMin) / count;
    for (let i = 0; i <= count; i++) {
      ticks.push(stats.xMin + i * step);
    }
    return ticks;
  }, [stats, isMobile]);

  // Y 軸刻度數值格式化：手機端若超過千進位採用 8k, 6k 簡潔顯示，防止擠壓或超出邊界
  const formatYValue = (val: number) => {
    if (isMobile && val >= 1000) {
      const k = val / 1000;
      return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
    }
    return Math.round(val).toString();
  };

  // 尋找對應 X 座標最近的數據點
  const findClosestSample = (actualSvgX: number) => {
    if (actualSvgX < padding.left || actualSvgX > width - padding.right) {
      setHoverIdx(null);
      return;
    }
    const hoverTimeMs =
      stats.xMin +
      ((actualSvgX - padding.left) / chartWidth) * (stats.xMax - stats.xMin);

    let closestIdx = 0;
    let minDiff = Math.abs(chartSamples[0].timeMs - hoverTimeMs);

    for (let i = 1; i < chartSamples.length; i++) {
      const diff = Math.abs(chartSamples[i].timeMs - hoverTimeMs);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    setHoverIdx(closestIdx);
  };

  // 滑鼠滑過圖表時
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!svgRef.current || chartSamples.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const scaleX = rect.width / width;
    findClosestSample(mouseX / scaleX);
  };

  const handleMouseLeave = () => {
    setHoverIdx(null);
  };

  // 手機觸控支援 (滑動手勢查看點位數值)
  const handleTouch = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!svgRef.current || chartSamples.length === 0 || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = svgRef.current.getBoundingClientRect();
    const touchX = touch.clientX - rect.left;
    const scaleX = rect.width / width;
    findClosestSample(touchX / scaleX);
  };

  const hoveredSample = hoverIdx !== null ? chartSamples[hoverIdx] : null;

  return (
    <div
      ref={containerRef}
      id="rpm-chart-container"
      className="w-full bg-slate-950/60 border border-slate-900 rounded-2xl p-3 sm:p-5 shadow-xl"
    >
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 mb-3 sm:mb-4">
        <h3 id="chart-title" className="text-xs sm:text-sm font-bold tracking-wider text-white flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)] shrink-0"></span>
          <span className="truncate">{activeLabel}</span>
        </h3>
        <div className="flex items-center justify-between sm:justify-end gap-2.5 text-xs font-mono text-slate-400">
          <button
            type="button"
            id="btn-chart-view-mode"
            onClick={() => setViewMode(viewMode === 'fit' ? 'scroll' : 'fit')}
            className="px-2.5 py-1 rounded-lg border text-[11px] font-sans font-semibold flex items-center gap-1.5 transition-all cursor-pointer bg-slate-900 border-slate-800 hover:border-cyan-500/40 text-slate-300 active:scale-95 shadow-sm"
            title={viewMode === 'fit' ? '切換為橫向滾動展開模式' : '切換為全螢幕適應完整顯示'}
          >
            {viewMode === 'fit' ? (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden xs:inline">完整顯示</span>
                <span className="xs:hidden">全幅</span>
              </>
            ) : (
              <>
                <MoveHorizontal className="w-3.5 h-3.5 text-amber-400" />
                <span>展開滾動</span>
              </>
            )}
          </button>
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1 text-[11px]">
              <span className="w-2 h-1.5 rounded-full bg-cyan-500"></span>
              RPM
            </span>
            {chartSamples.length > 0 && (
              <span className="text-[11px]">
                點數: <strong className="text-cyan-400 font-bold">{chartSamples.length}</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={`relative w-full pb-2 ${viewMode === 'fit' ? 'overflow-visible' : 'overflow-x-auto scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent'}`}>
        {chartSamples.length === 0 ? (
          // 空資料狀態
          <div id="chart-empty-state" className="flex flex-col items-center justify-center h-[260px] sm:h-[350px] bg-slate-950/20 rounded-xl border border-dashed border-slate-900 p-6 text-center min-w-[260px]">
            <div className="w-11 h-11 rounded-full bg-slate-900/60 flex items-center justify-center mb-2.5 animate-pulse text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.15)]">
              <Gauge className="w-5 h-5 text-cyan-400" />
            </div>
            <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide">目前無轉速數據紀錄</h4>
            <p className="text-[11px] sm:text-xs text-slate-400 max-w-xs mt-1 leading-relaxed font-sans">
              請連接 BRD_ 裝置，並啟動旋轉以進行轉速量測。
            </p>
          </div>
        ) : (
          // 繪製 SVG 折線圖
          <svg
            id="rpm-svg-chart"
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            style={{
              width: viewMode === 'fit' ? '100%' : `${width}px`,
              minWidth: viewMode === 'fit' ? '100%' : `${width}px`,
              height: `${height}px`,
            }}
            className="select-none overflow-visible shrink-0 block touch-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouch}
            onTouchMove={handleTouch}
            onTouchEnd={() => {
              setTimeout(() => setHoverIdx(null), 2000);
            }}
          >
            <defs>
              {/* 漸層填滿 */}
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
              </linearGradient>
              {/* 網格虛線 */}
              <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
              </pattern>
            </defs>

            {/* 背景網格 */}
            <rect
              x={padding.left}
              y={padding.top}
              width={chartWidth}
              height={chartHeight}
              fill="url(#grid)"
            />

            {/* Y 軸水平網格線與標籤 */}
            {yTicks.map((tick, i) => {
              const y = getY(tick);
              return (
                <g key={`y-${tick}-${i}`} className="opacity-80">
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={width - padding.right}
                    y2={y}
                    stroke="rgba(148, 163, 184, 0.08)"
                    strokeWidth={i === 0 ? 1.5 : 1}
                    strokeDasharray={i === 0 ? undefined : '4 4'}
                  />
                  <text
                    x={padding.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    className="text-[9px] sm:text-[10px] font-mono fill-slate-500 font-medium"
                  >
                    {formatYValue(tick)}
                  </text>
                </g>
              );
            })}

            {/* X 軸垂直網格線與標籤 */}
            {xTicks.map((tick, i) => {
              const x = getX(tick);
              const timeSec = (tick / 1000).toFixed(1);
              return (
                <g key={`x-${tick}-${i}`} className="opacity-80">
                  <line
                    x1={x}
                    y1={padding.top}
                    x2={x}
                    y2={height - padding.bottom}
                    stroke="rgba(148, 163, 184, 0.08)"
                    strokeWidth={i === 0 ? 1.5 : 1}
                    strokeDasharray={i === 0 ? undefined : '4 4'}
                  />
                  <text
                    x={x}
                    y={height - padding.bottom + (isMobile ? 18 : 22)}
                    textAnchor="middle"
                    className="text-[9px] sm:text-[10px] font-mono fill-slate-500 font-medium"
                  >
                    {timeSec}s
                  </text>
                </g>
              );
            })}

            {/* 軸標題 */}
            <text
              x={padding.left - (isMobile ? 32 : 50)}
              y={padding.top - (isMobile ? 8 : 12)}
              className="text-[8px] sm:text-[9px] font-bold tracking-widest fill-slate-600 uppercase font-mono"
            >
              RPM
            </text>
            <text
              x={width - padding.right}
              y={height - padding.bottom + (isMobile ? 28 : 35)}
              textAnchor="end"
              className="text-[8px] sm:text-[9px] font-bold tracking-widest fill-slate-600 uppercase font-mono"
            >
              Time (Sec)
            </text>

            {/* 漸層填滿區域 */}
            <path d={areaPath} fill="url(#areaGradient)" />

            {/* 數據折線 */}
            <path
              d={linePath}
              fill="none"
              stroke="#06b6d4"
              strokeWidth={isMobile ? '2' : '2.5'}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="drop-shadow-[0_0_10px_rgba(6,182,212,0.55)]"
            />

            {/* 標記發射點 (LAUNCH) 與 最高點 (MAX) 標籤（無遮擋與防重疊邏輯） */}
            {(() => {
              // 1. MAX Sample Info
              const hasMax = !!stats.maxSample;
              const maxPointX = hasMax ? getX(stats.maxSample!.timeMs) : 0;
              const maxPointY = hasMax ? getY(stats.maxSample!.rpm) : 0;
              const maxLabelText = hasMax ? `MAX ${stats.maxSample!.rpm.toLocaleString()} RPM` : '';
              const maxBadgeW = hasMax
                ? (isMobile ? Math.max(68, maxLabelText.length * 5.2 + 10) : Math.max(84, maxLabelText.length * 6.5 + 16))
                : 0;
              const maxHalfW = maxBadgeW / 2;
              const maxBadgeX = hasMax ? Math.max(padding.left + maxHalfW, Math.min(width - padding.right - maxHalfW, maxPointX)) : 0;
              let maxBadgeY = hasMax ? Math.max(16, maxPointY - (isMobile ? 18 : 22)) : 0;

              // 2. Launch Info
              const showLaunch = launchTimeMs !== undefined && launchMarkerValid;
              let effectiveLaunchRpm: number | undefined = undefined;
              if (showLaunch) {
                effectiveLaunchRpm = launchRpm !== undefined
                  ? launchRpm
                  : (chartSamples.length > 0 ? (() => {
                      let closest = chartSamples[0];
                      for (const s of chartSamples) {
                        if (Math.abs(s.timeMs - launchTimeMs!) < Math.abs(closest.timeMs - launchTimeMs!)) {
                          closest = s;
                        }
                      }
                      return closest.rpm;
                    })() : undefined);
              }
              const launchPointX = showLaunch ? getX(launchTimeMs!) : 0;
              const launchPointY = showLaunch ? (effectiveLaunchRpm !== undefined ? getY(effectiveLaunchRpm) : getY(0)) : 0;
              const launchLabelText = showLaunch
                ? (effectiveLaunchRpm !== undefined ? `LAUNCH ${effectiveLaunchRpm.toLocaleString()} RPM` : 'LAUNCH')
                : '';
              const launchBadgeW = showLaunch
                ? (isMobile ? Math.max(68, launchLabelText.length * 5.2 + 10) : Math.max(84, launchLabelText.length * 6.5 + 16))
                : 0;
              const launchHalfW = launchBadgeW / 2;
              const launchBadgeX = showLaunch ? Math.max(padding.left + launchHalfW, Math.min(width - padding.right - launchHalfW, launchPointX)) : 0;

              // 計算 Launch 標籤涵蓋範圍內曲線的最高點 (最小 Y)，確保標籤高於曲線
              const launchSpanMinY = (() => {
                if (!showLaunch) return 0;
                let minY = launchPointY;
                for (const s of chartSamples) {
                  const sx = getX(s.timeMs);
                  if (sx >= launchBadgeX - launchHalfW - 8 && sx <= launchBadgeX + launchHalfW + 8) {
                    const sy = getY(s.rpm);
                    if (sy < minY) minY = sy;
                  }
                }
                return minY;
              })();

              let launchBadgeY = showLaunch ? Math.max(16, launchSpanMinY - (isMobile ? 18 : 22)) : 0;

              // 3. 防重疊與防遮擋調整 (Overlap resolution)
              if (hasMax && showLaunch) {
                const xDist = Math.abs(maxBadgeX - launchBadgeX);
                const minXOverlapDist = maxHalfW + launchHalfW + 6;
                if (xDist < minXOverlapDist) {
                  if (Math.abs(maxBadgeY - launchBadgeY) < 22) {
                    if (maxBadgeY >= 38) {
                      launchBadgeY = maxBadgeY - 22;
                    } else {
                      launchBadgeY = 16;
                      maxBadgeY = 38;
                    }
                  }
                }
              }

              return (
                <g>
                  {/* 標記發射點 (Launch Point) */}
                  {showLaunch && (
                    <g>
                      {/* 當 Launch 標籤 elevated 時繪製連線至圓點 */}
                      {launchPointY - launchBadgeY > 14 && (
                        <line
                          x1={launchPointX}
                          y1={launchBadgeY + 6}
                          x2={launchPointX}
                          y2={launchPointY - 4}
                          stroke="#f59e0b"
                          strokeWidth="1.5"
                          strokeDasharray="2 2"
                          opacity="0.8"
                        />
                      )}
                      <line
                        x1={launchPointX}
                        y1={padding.top}
                        x2={launchPointX}
                        y2={height - padding.bottom}
                        stroke="#f59e0b"
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                        className="drop-shadow-[0_0_6px_rgba(245,158,11,0.8)]"
                      />
                      <circle
                        cx={launchPointX}
                        cy={launchPointY}
                        r={isMobile ? '4.5' : '5.5'}
                        fill="#f59e0b"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        className="shadow-[0_0_8px_rgba(245,158,11,0.9)]"
                      />
                      {hoverIdx === null && (
                        <g transform={`translate(${launchBadgeX}, ${launchBadgeY})`}>
                          <rect
                            x={-launchHalfW}
                            y="-11"
                            width={launchBadgeW}
                            height={isMobile ? '16' : '18'}
                            rx="4"
                            fill="rgba(245, 158, 11, 0.95)"
                            className="shadow-lg"
                          />
                          <text
                            textAnchor="middle"
                            y="1"
                            className="text-[8px] sm:text-[9px] font-black fill-slate-950 font-mono"
                          >
                            {launchLabelText}
                          </text>
                        </g>
                      )}
                    </g>
                  )}

                  {/* 標記最大 RPM 點 (MAX Point) */}
                  {hasMax && (
                    <g>
                      {/* 當 MAX 標籤 elevated 時繪製連線至圓點 */}
                      {maxPointY - maxBadgeY > 14 && (
                        <line
                          x1={maxPointX}
                          y1={maxBadgeY + 6}
                          x2={maxPointX}
                          y2={maxPointY - 4}
                          stroke="#ec4899"
                          strokeWidth="1.5"
                          strokeDasharray="2 2"
                          opacity="0.8"
                        />
                      )}
                      <circle
                        cx={maxPointX}
                        cy={maxPointY}
                        r={isMobile ? '4.5' : '5'}
                        fill="#ec4899"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                      {hoverIdx === null && (
                        <g transform={`translate(${maxBadgeX}, ${maxBadgeY})`}>
                          <rect
                            x={-maxHalfW}
                            y="-11"
                            width={maxBadgeW}
                            height={isMobile ? '16' : '18'}
                            rx="4"
                            fill="rgba(236, 72, 153, 0.95)"
                            className="shadow-md"
                          />
                          <text
                            textAnchor="middle"
                            y="1"
                            className="text-[8px] sm:text-[9px] font-black fill-white font-mono"
                          >
                            {maxLabelText}
                          </text>
                        </g>
                      )}
                    </g>
                  )}
                </g>
              );
            })()}

            {/* 懸停十字準心與點亮指示器 */}
            {hoveredSample && (
              <g>
                {/* 垂直虛線 */}
                <line
                  x1={getX(hoveredSample.timeMs)}
                  y1={padding.top}
                  x2={getX(hoveredSample.timeMs)}
                  y2={height - padding.bottom}
                  stroke="rgba(6, 182, 212, 0.45)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
                {/* 水平虛線 */}
                <line
                  x1={padding.left}
                  y1={getY(hoveredSample.rpm)}
                  x2={width - padding.right}
                  y2={getY(hoveredSample.rpm)}
                  stroke="rgba(6, 182, 212, 0.45)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
                {/* 焦點圓點 */}
                <circle
                  cx={getX(hoveredSample.timeMs)}
                  cy={getY(hoveredSample.rpm)}
                  r={isMobile ? '5.5' : '6.5'}
                  fill="#06b6d4"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="shadow-lg"
                />
              </g>
            )}
          </svg>
        )}

        {/* 懸停浮動 Tooltip 元件 */}
        {hoveredSample && (
          <div
            id="chart-hover-tooltip"
            className="absolute bg-[#0d0f14]/95 border border-cyan-500/40 rounded-xl p-2.5 sm:p-3 shadow-[0_0_15px_rgba(6,182,212,0.15)] text-[11px] sm:text-xs font-mono text-slate-100 flex flex-col gap-1 pointer-events-none transition-all duration-75 backdrop-blur-sm"
            style={{
              left: `${Math.min(
                Math.max(getX(hoveredSample.timeMs) - 70, padding.left - 10),
                width - padding.right - 130
              )}px`,
              top: `${Math.max(getY(hoveredSample.rpm) - (isMobile ? 75 : 85), 6)}px`,
              width: isMobile ? '135px' : '155px',
              zIndex: 50,
            }}
          >
            <div className="text-slate-400 border-b border-slate-900 pb-1 mb-0.5 flex justify-between items-center">
              <span>時間</span>
              <span className="text-cyan-400 font-bold">{(hoveredSample.timeMs / 1000).toFixed(2)}s</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">轉速</span>
              <span className="text-cyan-300 font-black text-xs sm:text-sm">{hoveredSample.rpm.toLocaleString()} RPM</span>
            </div>
            {/* 特殊點位標註 */}
            {launchTimeMs !== undefined && Math.abs(hoveredSample.timeMs - launchTimeMs) < 15 && (
              <div className="pt-0.5 mt-0.5 border-t border-slate-900/80 flex items-center justify-between text-[9px] text-amber-400 font-bold">
                <span>🚀 發射點標記</span>
                <span>LAUNCH</span>
              </div>
            )}
            {stats.maxSample && Math.abs(hoveredSample.timeMs - stats.maxSample.timeMs) < 15 && (
              <div className="pt-0.5 mt-0.5 border-t border-slate-900/80 flex items-center justify-between text-[9px] text-pink-400 font-bold">
                <span>⚡ 最高轉速</span>
                <span>MAX</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
