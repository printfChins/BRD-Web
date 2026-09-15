/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Bluetooth, Smartphone, Copy, ExternalLink, X } from 'lucide-react';

interface BleHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string, type: 'success' | 'info') => void;
}

export const BleHelpModal: React.FC<BleHelpModalProps> = ({ isOpen, onClose, onToast }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn pointer-events-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Bluetooth className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">iPad / Web Bluetooth 連線指引</h3>
              <p className="text-[10px] text-slate-400 font-mono">CONNECTIVITY & BROWSER GUIDE</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 px-2 rounded-lg bg-slate-950 border border-slate-800 hover:bg-slate-800 transition-all cursor-pointer text-xs font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          {/* iPad / iOS 特殊說明 */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
              <Smartphone className="w-4 h-4" />
              <span>iPad / iPhone (iOS/iPadOS) 用戶：</span>
            </div>
            <p className="text-slate-300 text-[11px]">
              Apple 官方 Safari 與 Chrome (WKWebView) 受到系統限制，預設未開放 Web Bluetooth API。
            </p>
            <div className="bg-cyan-950/30 border border-cyan-500/20 p-3 rounded-lg text-cyan-200 text-[11px] space-y-1 mt-2">
              <div className="font-bold text-cyan-300">建議解決方案 (二選一)：</div>
              <div>
                1. <strong>專用 BLE 瀏覽器 App (最佳推薦)</strong>：請從 App Store 免費下載{' '}
                <strong>Bluefy - Web BLE Browser</strong> 或 <strong>WebBLE</strong>，並在 App 內開啟本網址即可直接搜尋與連線陀螺。
              </div>
              <div>
                2. <strong>電腦版 Chrome / Edge</strong>：使用 Mac / PC 或 Android 裝置之 Google Chrome / Microsoft Edge 瀏覽器開啟。
              </div>
            </div>
          </div>

          {/* 快速動作 */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-400 text-xs uppercase tracking-wider">快速動作：</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(window.location.href);
                    onToast('已複製網址！可貼至 Bluefy / WebBLE 瀏覽器開啟。', 'success');
                  } else {
                    onToast(`網址: ${window.location.href}`, 'info');
                  }
                }}
                className="flex items-center justify-center gap-2 p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-cyan-400 rounded-xl font-bold transition-all cursor-pointer active:scale-95 text-xs"
              >
                <Copy className="w-4 h-4" />
                複製本頁網址
              </button>

              <button
                type="button"
                onClick={() => window.open(window.location.href, '_blank')}
                className="flex items-center justify-center gap-2 p-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl font-black transition-all cursor-pointer active:scale-95 text-xs shadow-md"
              >
                <ExternalLink className="w-4 h-4" />
                在新分頁中開啟
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95"
          >
            關閉說明
          </button>
        </div>
      </div>
    </div>
  );
};
