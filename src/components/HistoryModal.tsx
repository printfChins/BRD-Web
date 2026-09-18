/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { FileSpreadsheet, Upload, Download, Trash2, ShieldCheck, X } from 'lucide-react';
import { SpinRecord } from '../types';
import { Sparkline } from './Sparkline';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: SpinRecord[];
  activeRecord: SpinRecord | null;
  onSelectRecord: (record: SpinRecord) => void;
  onRenameRecord: (id: string, newName: string) => void;
  onDeleteRecord: (id: string, e: React.MouseEvent) => void;
  onClearAll: () => void;
  onExport: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const formatStopwatchTime = (ms: number | undefined | null): string => {
  if (ms === undefined || ms === null || ms < 0) return '--:--.--';
  const totalHundredths = Math.floor(ms / 10);
  const hundredths = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const xx = String(hundredths).padStart(2, '0');

  return `${mm}:${ss}.${xx}`;
};

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  activeRecord,
  onSelectRecord,
  onRenameRecord,
  onDeleteRecord,
  onClearAll,
  onExport,
  onImport,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-5 animate-fadeIn pointer-events-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-hidden">
        {/* 彈窗標題與頂部操作按鈕 */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base sm:text-lg tracking-wide">戰鬥歷史資料</h3>
                <span className="text-xs bg-cyan-950 text-cyan-400 font-mono px-2 py-0.5 rounded-full font-bold border border-cyan-800/50">
                  {history.length} 筆
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">點選任意紀錄可立即載入至主畫面大圖進行細部曲線追蹤與指標分析。</p>
            </div>
          </div>

          {/* 匯入 / 匯出 / 清空 / 關閉按鈕 */}
          <div className="flex items-center gap-2 self-end sm:self-auto text-xs font-mono">
            <input
              type="file"
              id="import-file-modal"
              accept=".json"
              onChange={onImport}
              className="hidden"
            />
            <button
              type="button"
              id="btn-import"
              onClick={() => document.getElementById('import-file-modal')?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-300 cursor-pointer hover:bg-slate-900 transition-all active:scale-95 font-sans font-semibold"
              title="匯入先前備份的 BRD Telemetry JSON 資料"
            >
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              匯入
            </button>
            <button
              type="button"
              id="btn-export"
              onClick={onExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-300 cursor-pointer hover:bg-slate-900 transition-all active:scale-95 font-sans font-semibold"
              title="將目前所有紀錄匯出為備份 JSON 檔案"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              匯出
            </button>
            {history.length > 0 && (
              <button
                type="button"
                id="btn-clear-all"
                onClick={onClearAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-950 bg-rose-950/30 text-rose-400 hover:bg-rose-950/60 cursor-pointer font-sans font-semibold transition-all active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清空
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1.5 px-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 transition-all cursor-pointer text-xs font-bold ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 紀錄列表內容 */}
        {history.length === 0 ? (
          <div className="border border-dashed border-slate-800 rounded-xl py-16 text-center text-slate-500 text-xs font-mono flex flex-col items-center justify-center gap-2">
            <FileSpreadsheet className="w-8 h-8 text-slate-700 mb-1" />
            <p className="text-slate-300 font-bold">歷史資料中目前尚無紀錄</p>
            <p className="text-slate-500 text-[11px]">連接實體 BLE 裝置進行陀螺發射，完成曲線接收後將自動儲存於此。</p>
          </div>
        ) : (
          <div id="history-list" className="max-h-[58vh] overflow-y-auto space-y-2.5 pr-1.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
            {history.map((record) => {
              const isActive = activeRecord?.id === record.id;
              return (
                <div
                  key={record.id}
                  onClick={() => onSelectRecord(record)}
                  className={`group relative border rounded-xl p-3 sm:p-3.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500/10 border-cyan-400/80 shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                      : 'bg-slate-950/40 border-slate-800/80 hover:border-cyan-500/40 hover:bg-slate-950/80'
                  }`}
                >
                  {/* 左側 / 手機頂部：名稱/日期/CRC32 標籤 + 手機版右上角刪除按鈕 */}
                  <div className="flex items-start justify-between w-full sm:w-auto sm:flex-grow min-w-0">
                    <div className="flex-grow min-w-0 flex flex-col pr-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={record.name}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onRenameRecord(record.id, e.target.value)}
                          className="font-bold text-sm text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-cyan-400 focus:outline-none transition-all w-full max-w-xs py-0.5 truncate"
                          title="點擊修改文字為紀錄命名"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-[10px] text-slate-400 font-mono">
                          {record.timestamp}
                        </span>
                        {record.curveCrc32 !== undefined && (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                            record.crcVerified ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          }`}>
                            <ShieldCheck className="w-2.5 h-2.5" />
                            0x{record.curveCrc32.toString(16).toUpperCase()}
                          </span>
                        )}
                        {record.sessionId && (
                          <span className="text-[9px] font-mono text-slate-500">
                            S#{record.sessionId}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 手機版右上角刪除按鈕 */}
                    <button
                      type="button"
                      id={`btn-delete-mobile-${record.id}`}
                      onClick={(e) => onDeleteRecord(record.id, e)}
                      className="sm:hidden shrink-0 p-1.5 -mr-1 -mt-0.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 active:bg-rose-950/40 transition-all cursor-pointer"
                      title="刪除此筆戰鬥紀錄"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 右側 / 手機底部：指標數值 + 數值右側微型曲線 + 電腦版刪除按鈕 */}
                  <div className="flex items-center gap-2.5 sm:gap-3.5 w-full sm:w-auto justify-between sm:justify-end mt-1 sm:mt-0">
                    {/* 數值區 */}
                    <div className="flex gap-2.5 sm:gap-3.5 text-xs font-mono shrink-0">
                      <div className="flex flex-col items-start sm:items-end">
                        <span className="text-[9px] text-cyan-400 uppercase font-bold tracking-wider">TIME</span>
                        <span className={`font-bold whitespace-nowrap ${record.durationMs !== undefined && record.durationMs > 0 ? 'text-cyan-300' : 'text-slate-500'}`}>
                          {record.durationMs !== undefined && record.durationMs > 0
                            ? formatStopwatchTime(record.durationMs)
                            : '--:--.--'}
                        </span>
                      </div>
                      <div className="flex flex-col items-start sm:items-end">
                        <span className="text-[9px] text-rose-400 uppercase font-bold tracking-wider">MAX</span>
                        <span className="text-rose-400 font-bold whitespace-nowrap">{record.maxRpm.toLocaleString()}</span>
                      </div>
                      {record.launchRpm !== undefined && (
                        <div className="flex flex-col items-start sm:items-end">
                          <span className="text-[9px] text-amber-400 uppercase font-bold tracking-wider">LAUNCH</span>
                          <span className="text-amber-300 font-bold whitespace-nowrap">{record.launchRpm.toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    {/* 數值右側小微型曲線 */}
                    <div className="shrink-0 px-1 py-0.5 rounded-lg bg-slate-950/50 border border-slate-900/80 shadow-inner flex items-center">
                      <Sparkline
                        samples={record.samples}
                        launchTimeMs={record.launchTimeMs}
                        launchRpm={record.launchRpm}
                        width={78}
                        height={26}
                      />
                    </div>

                    {/* 電腦版刪除按鈕 */}
                    <div className="hidden sm:flex items-center shrink-0">
                      <button
                        type="button"
                        id={`btn-delete-${record.id}`}
                        onClick={(e) => onDeleteRecord(record.id, e)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 transition-all cursor-pointer"
                        title="刪除此筆戰鬥紀錄"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 底部關閉按鈕 */}
        <div className="border-t border-slate-800 pt-3 flex justify-between items-center text-xs text-slate-400">
          <span>共 {history.length} 筆歷史紀錄</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95"
          >
            關閉視窗
          </button>
        </div>
      </div>
    </div>
  );
};
