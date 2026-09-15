/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Terminal, Copy, Trash2, Activity, RefreshCw, RotateCcw, X } from 'lucide-react';
import { ConnectionStatus, DiagnosticInfo, DiagnosticTxState } from '../types';

interface LogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemLogs: { id: string; time: string; message: string }[];
  firmwareVersion: string;
  hasControlChar: boolean;
  hasDiagnosticChar: boolean;
  diagnosticInfo: DiagnosticInfo | null;
  status: ConnectionStatus;
  receivedSamplesCount: number;
  expectedSamplesCount: number;
  currentSessionId: number;
  onCopyLogs: () => void;
  onClearLogs: () => void;
  onReadDiagnostic: () => void;
  onRequestRetransmit: (sessionId: number) => void;
  onRequestA3Resend: () => void;
  onAbortTransfer: () => void;
}

export const LogsModal: React.FC<LogsModalProps> = ({
  isOpen,
  onClose,
  systemLogs,
  firmwareVersion,
  hasControlChar,
  hasDiagnosticChar,
  diagnosticInfo,
  status,
  receivedSamplesCount,
  expectedSamplesCount,
  currentSessionId,
  onCopyLogs,
  onClearLogs,
  onReadDiagnostic,
  onRequestRetransmit,
  onRequestA3Resend,
  onAbortTransfer,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-5 animate-fadeIn pointer-events-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-hidden">
        {/* 彈窗標題與頂部操作按鈕 */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Terminal className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-white text-base sm:text-lg tracking-wide">藍芽通訊日誌與診斷控制台</h3>
                {firmwareVersion && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold bg-cyan-950 text-cyan-400 border-cyan-800/60">
                    韌體 {firmwareVersion}
                  </span>
                )}
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${
                  hasControlChar
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {hasControlChar ? '0x0003 雙向控制' : '唯讀 Notify'}
                </span>
                {hasDiagnosticChar && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold bg-purple-500/15 text-purple-300 border-purple-500/30">
                    0x0005 診斷支援
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                即時 BRD Reliable BLE Protocol V4 封包日誌、B1 即時狀態同步、0005 診斷特徵值與可靠傳輸狀態機。
              </p>
            </div>
          </div>

          {/* 複製 / 清空 / 關閉按鈕 */}
          <div className="flex items-center gap-2 self-end sm:self-auto text-xs font-mono">
            <button
              type="button"
              id="btn-copy-logs"
              onClick={onCopyLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-300 cursor-pointer hover:bg-slate-900 transition-all active:scale-95 font-sans font-semibold"
              title="複製日誌內容至剪貼簿"
            >
              <Copy className="w-3.5 h-3.5 text-cyan-400" />
              複製
            </button>
            <button
              type="button"
              id="btn-clear-logs"
              onClick={onClearLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-800 hover:border-rose-900/50 bg-slate-950 text-slate-400 hover:text-rose-400 cursor-pointer hover:bg-slate-900 transition-all active:scale-95 font-sans font-semibold"
              title="清空目前日誌記錄"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1.5 px-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 transition-all cursor-pointer text-xs font-bold ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 0005 診斷即時監控面板 */}
        <div className="bg-[#05070a] border border-slate-800 rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold text-slate-300 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              底層傳輸與診斷狀態 (Characteristic 0x0005)
            </span>
            {diagnosticInfo?.readTime && (
              <span className="font-mono text-[10px] text-slate-500">更新時間: {diagnosticInfo.readTime}</span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px]">TX 狀態機</span>
              <span className={`font-bold text-xs truncate block ${
                diagnosticInfo?.txState === DiagnosticTxState.DONE ? 'text-emerald-400' :
                diagnosticInfo?.txState === DiagnosticTxState.TIMEOUT ? 'text-rose-400' :
                diagnosticInfo?.txState === DiagnosticTxState.WAIT_ACK ? 'text-amber-400 animate-pulse' :
                'text-cyan-300'
              }`}>
                {diagnosticInfo ? diagnosticInfo.txStateName : (status === ConnectionStatus.CONNECTED ? '尚未讀取' : '未連線')}
              </span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px]">儲存 SESSION</span>
              <span className="text-cyan-300 font-bold text-xs">
                {diagnosticInfo ? `#${diagnosticInfo.currentResultSession}` : `#${currentSessionId || 1}`}
              </span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px]">樣本點數 / CRC32</span>
              <span className="text-white font-bold text-xs truncate block">
                {diagnosticInfo ? `${diagnosticInfo.sampleCount}點 (0x${diagnosticInfo.crc32.toString(16).toUpperCase()})` : `${receivedSamplesCount}/${expectedSamplesCount}點`}
              </span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px]">異常累計統計</span>
              <span className="text-slate-300 text-xs">
                誤:{diagnosticInfo?.commandErrors ?? 0} 敗:{diagnosticInfo?.notifyFailures ?? 0} 逾:{diagnosticInfo?.ackTimeouts ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* 協議控制手動操作 (0005 讀取 / 0xC3 重傳 / 0xC2 重送A3 / 0xC4 放棄) */}
        {(status === ConnectionStatus.CONNECTED || status === ConnectionStatus.RECEIVING) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              id="btn-modal-read-diagnostic"
              onClick={onReadDiagnostic}
              className="px-2.5 py-2 bg-slate-950 hover:bg-slate-850 hover:border-purple-500/40 text-purple-300 border border-slate-800 rounded-xl font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95"
              title="向陀螺讀取 Characteristic 0x0005 最新診斷封包"
            >
              <Activity className="w-3.5 h-3.5 text-purple-400" />
              讀取診斷 (0005)
            </button>

            <button
              type="button"
              id="btn-modal-proto-restart"
              onClick={() => onRequestRetransmit(currentSessionId || 0xFFFF)}
              className="px-2.5 py-2 bg-slate-950 hover:bg-slate-850 hover:border-cyan-500/40 text-cyan-300 border border-slate-800 rounded-xl font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95"
              title="向陀螺發送 0xC3 RESTART 指令要求重傳最新曲線"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
              重傳曲線 (0xC3)
            </button>

            <button
              type="button"
              id="btn-modal-proto-resend-a3"
              onClick={onRequestA3Resend}
              className="px-2.5 py-2 bg-slate-950 hover:bg-slate-850 hover:border-amber-500/40 text-amber-300 border border-slate-800 rounded-xl font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95"
              title="發送 0xC2 (Count=0) 要求陀螺重發 A3 結束包"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              重發A3 (0xC2)
            </button>

            <button
              type="button"
              id="btn-modal-proto-abort"
              onClick={onAbortTransfer}
              className="px-2.5 py-2 bg-slate-950 hover:bg-rose-950/30 hover:border-rose-500/40 text-rose-400 border border-slate-800 rounded-xl font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95"
              title="向陀螺發送 0xC4 ABORT 指令中斷傳輸並清除 RAM"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              中斷傳輸 (0xC4)
            </button>
          </div>
        )}

        {/* 終端封包日誌內容 */}
        <div className="bg-[#05070a] border border-slate-800 rounded-xl p-3 max-h-[50vh] overflow-y-auto space-y-1 font-mono text-[11px] text-slate-300 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
          {systemLogs.length === 0 ? (
            <div className="text-slate-600 text-center py-8">尚無通訊日誌</div>
          ) : (
            systemLogs.map((log) => (
              <div key={log.id} className="leading-relaxed flex items-start gap-2 border-b border-slate-900/50 pb-1">
                <span className="text-slate-600 shrink-0 select-none">[{log.time}]</span>
                <span className={
                  log.message.includes('ERROR') || log.message.includes('失敗') || log.message.includes('斷開')
                    ? 'text-rose-400 font-bold'
                    : log.message.includes('0xC1') || log.message.includes('ACK') || log.message.includes('成功')
                    ? 'text-emerald-400 font-bold'
                    : log.message.includes('0xB1') || log.message.includes('0xB2') || log.message.includes('LIVE') || log.message.includes('LAUNCH')
                    ? 'text-purple-400 font-bold'
                    : log.message.includes('0xC3') || log.message.includes('RESTART')
                    ? 'text-cyan-400 font-bold'
                    : log.message.includes('0xC4') || log.message.includes('ABORT')
                    ? 'text-rose-400'
                    : log.message.includes('0xC2')
                    ? 'text-amber-400'
                    : 'text-slate-300'
                }>
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>

        {/* 底部資訊與關閉按鈕 */}
        <div className="border-t border-slate-800 pt-3 flex justify-between items-center text-xs text-slate-400">
          <span>共 {systemLogs.length} 筆日誌紀錄</span>
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
