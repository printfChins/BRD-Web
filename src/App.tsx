/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  ConnectionStatus,
  AppMode,
  RpmSample,
  SpinRecord,
  DeviceState,
  LiveTelemetry,
  LaunchEvent,
  CurveStartInfo,
  TransferStatusCode,
  DiagnosticInfo,
  DiagnosticTxState,
} from './types';
import {
  parseBlePacket,
  calculateCurveCrc32,
  SERVICE_UUID,
  DATA_CHAR_UUID,
  CONTROL_CHAR_UUID,
  FIRMWARE_CHAR_UUID,
  DIAGNOSTIC_CHAR_UUID,
  parseDiagnosticPacket,
  buildC1Ack,
  buildC2Retry,
  buildC3Restart,
  buildC4Abort,
} from './utils/bleParser';
import { RpmChart } from './components/RpmChart';
import { HistoryModal } from './components/HistoryModal';
import { LogsModal } from './components/LogsModal';
import { BleHelpModal } from './components/BleHelpModal';
import {
  Bluetooth,
  HelpCircle,
  FileSpreadsheet,
  Terminal,
  AlertTriangle,
  Smartphone,
  CheckCircle,
  Info,
  Trash2,
  Square,
  Clock,
} from 'lucide-react';

interface LogEntry {
  id: string;
  time: string;
  message: string;
}

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // 藍牙硬體連線狀態與 Characteristic 參照
  const [connectedDeviceName, setConnectedDeviceName] = useState<string>('');
  const bleDeviceRef = useRef<any>(null);
  const bleCharacteristicRef = useRef<any>(null);
  const bleControlCharacteristicRef = useRef<any>(null);
  const bleFirmwareCharacteristicRef = useRef<any>(null);
  const bleDiagnosticCharacteristicRef = useRef<any>(null);

  // V1.15 / Protocol V4 狀態機核心參照 (由 B1 LIVE 持續以 200ms 同步)
  const [deviceState, setDeviceState] = useState<DeviceState>(DeviceState.WAIT_LOAD);
  const [stateFlags, setStateFlags] = useState<{
    loaded: boolean;
    active: boolean;
    launchMarkerValid: boolean;
    resultPending: boolean;
    charging: boolean;
    waitAck: boolean;
  }>({
    loaded: false,
    active: false,
    launchMarkerValid: false,
    resultPending: false,
    charging: false,
    waitAck: false,
  });

  // V1.15 韌體版本 (0004) 與 診斷狀態 (0005)
  const [firmwareVersion, setFirmwareVersion] = useState<string>('');
  const [diagnosticInfo, setDiagnosticInfo] = useState<DiagnosticInfo | null>(null);

  // Duplicate C1 ACK 逾時重試計時器 (2000ms 未收 A4 自動重送)
  const c1TimeoutRef = useRef<any>(null);
  const lastC1PayloadRef = useRef<{ sessionId: number; sampleCount: number; crc: number } | null>(null);

  // Reliable Curve Transfer 傳輸狀態管理
  const packetMapRef = useRef<Map<number, RpmSample[]>>(new Map());
  const currentSessionIdRef = useRef<number>(1);
  const totalExpectedPacketsRef = useRef<number>(0);

  // 即時與發射狀態
  const [liveTelemetry, setLiveTelemetry] = useState<LiveTelemetry | null>(null);
  const [lastLaunchEvent, setLastLaunchEvent] = useState<LaunchEvent | null>(null);
  const [activeCurveInfo, setActiveCurveInfo] = useState<CurveStartInfo | null>(null);
  const [isLaunchedMode, setIsLaunchedMode] = useState<boolean>(false);

  const lastLaunchEventRef = useRef<LaunchEvent | null>(null);
  const activeCurveInfoRef = useRef<CurveStartInfo | null>(null);

  // 數據緩衝與目前觀測紀錄
  const [activeRecord, setActiveRecord] = useState<SpinRecord | null>(null);
  const hasCompletedCurveRef = useRef<boolean>(false);
  const lastDeviceStateRef = useRef<DeviceState>(DeviceState.WAIT_LOAD);
  const lastLoadedRef = useRef<boolean>(false);
  const tempSamplesRef = useRef<RpmSample[]>([]);
  const [expectedSamplesCount, setExpectedSamplesCount] = useState<number>(0);
  const [receivedSamplesCount, setReceivedSamplesCount] = useState<number>(0);
  const expectedSamplesCountRef = useRef<number>(0);
  const sampleIntervalMsRef = useRef<number>(0);
  const expectedDurationMsRef = useRef<number>(0);

  // 協議驗證狀態與計數器
  const [sampleIntervalMs, setSampleIntervalMs] = useState<number>(0);
  const [expectedDurationMs, setExpectedDurationMs] = useState<number>(0);
  const [curveError, setCurveError] = useState<string | null>(null);

  // 戰鬥歷史紀錄
  const [history, setHistory] = useState<SpinRecord[]>([]);

  // 發射計時器狀態 (裝載後變為 LOW 未裝載時觸發計時，直到下次裝載才歸零或按下暫停鍵)
  const [spinDurationMs, setSpinDurationMs] = useState<number>(0);
  const [isSpinTiming, setIsSpinTiming] = useState<boolean>(false);
  const spinStartTimeRef = useRef<number | null>(null);
  const isSpinTimingRef = useRef<boolean>(false);
  const spinTimerIntervalRef = useRef<any>(null);
  const manualSpinDurationRef = useRef<number | null>(null);

  const startSpinTimer = (initialElapsedMs: number = 0) => {
    isSpinTimingRef.current = true;
    setIsSpinTiming(true);
    spinStartTimeRef.current = Date.now() - initialElapsedMs;
    setSpinDurationMs(initialElapsedMs);
    manualSpinDurationRef.current = null;

    if (spinTimerIntervalRef.current) {
      clearInterval(spinTimerIntervalRef.current);
    }
    spinTimerIntervalRef.current = setInterval(() => {
      if (spinStartTimeRef.current && isSpinTimingRef.current) {
        setSpinDurationMs(Date.now() - spinStartTimeRef.current);
      }
    }, 50);
  };

  const stopSpinTimer = (finalMs?: number) => {
    isSpinTimingRef.current = false;
    setIsSpinTiming(false);
    if (spinTimerIntervalRef.current) {
      clearInterval(spinTimerIntervalRef.current);
      spinTimerIntervalRef.current = null;
    }
    if (finalMs !== undefined && finalMs > 0) {
      setSpinDurationMs(finalMs);
    } else if (spinStartTimeRef.current) {
      setSpinDurationMs(Date.now() - spinStartTimeRef.current);
    }
  };

  const resetSpinTimer = () => {
    isSpinTimingRef.current = false;
    setIsSpinTiming(false);
    spinStartTimeRef.current = null;
    manualSpinDurationRef.current = null;
    if (spinTimerIntervalRef.current) {
      clearInterval(spinTimerIntervalRef.current);
      spinTimerIntervalRef.current = null;
    }
    setSpinDurationMs(0);
  };

  // 按下停止鍵：停止計時並將旋轉時間儲存於曲線紀錄中（無法再繼續）
  const handleStopSpinTimer = () => {
    if (!isSpinTiming && spinDurationMs <= 0) return;

    let finalMs = spinDurationMs;
    if (spinStartTimeRef.current && isSpinTimingRef.current) {
      finalMs = Date.now() - spinStartTimeRef.current;
    }
    stopSpinTimer(finalMs);
    manualSpinDurationRef.current = finalMs;

    // 若當前已有曲線紀錄 (activeRecord)，立即更新其旋轉時間並持久化至歷史紀錄 (localStorage)
    if (activeRecord) {
      const updatedRecord: SpinRecord = {
        ...activeRecord,
        durationMs: finalMs,
      };
      setActiveRecord(updatedRecord);
      setHistory((prevHistory) => {
        const updated = prevHistory.map((rec) =>
          rec.id === activeRecord.id ? { ...rec, durationMs: finalMs } : rec
        );
        saveHistoryToStorage(updated);
        return updated;
      });
      addLog(`[SYSTEM] 手動停止計時：${formatSpinDuration(finalMs)}，已成功寫入當前戰鬥曲線紀錄。`);
    } else {
      addLog(`[SYSTEM] 手動停止計時：${formatSpinDuration(finalMs)}，將在接收到曲線後自動儲存。`);
    }
  };

  // 碼表計時格式化 (00:00.00，無資料時為 --:--.--)
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

  const formatSpinDuration = (ms: number): string => {
    if (ms <= 0) return '--:--.--';
    return formatStopwatchTime(ms);
  };

  // 系統事件/封包傳輸日誌
  const [systemLogs, setSystemLogs] = useState<LogEntry[]>([
    {
      id: 'init',
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      message: '[SYSTEM] BRD Reliable BLE Protocol V4 Engine initialized. Ready.',
    },
  ]);

  const addLog = (message: string) => {
    const newLog: LogEntry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      message,
    };
    setSystemLogs((prev) => [newLog, ...prev].slice(0, 50));
  };

  // 瀏覽器 Bluetooth API 相容性檢查
  const [isBluetoothSupported, setIsBluetoothSupported] = useState<boolean>(true);
  const [isIOSDevice, setIsIOSDevice] = useState<boolean>(false);
  const [showBleHelpModal, setShowBleHelpModal] = useState<boolean>(false);

  // Modals & Toast 訊息狀態
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [showLogsModal, setShowLogsModal] = useState<boolean>(false);

  // 自動清除 Toast 訊息
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 載入 localStorage 歷史紀錄與裝置環境偵測
  useEffect(() => {
    const hasBluetooth = typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;
    const isIOS = typeof navigator !== 'undefined' && (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );

    setIsBluetoothSupported(hasBluetooth);
    setIsIOSDevice(isIOS);

    try {
      const saved = localStorage.getItem('brd_history_records');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const uniqueParsed: SpinRecord[] = [];
          const seenIds = new Set<string>();
          parsed.forEach((rec) => {
            let recordId = rec.id || `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
            if (seenIds.has(recordId)) {
              recordId = `${recordId}-${Math.floor(Math.random() * 1000000)}`;
            }
            seenIds.add(recordId);
            uniqueParsed.push({
              ...rec,
              id: recordId,
            });
          });
          setHistory(uniqueParsed);
          if (uniqueParsed.length > 0) {
            setActiveRecord(uniqueParsed[0]);
          }
        }
      }
    } catch (e) {
      console.error('無法自 localStorage 讀取歷史紀錄', e);
    }
    return () => {
      if (spinTimerIntervalRef.current) {
        clearInterval(spinTimerIntervalRef.current);
      }
    };
  }, []);

  const saveHistoryToStorage = (newHistory: SpinRecord[]) => {
    setHistory(newHistory);
    try {
      localStorage.setItem('brd_history_records', JSON.stringify(newHistory));
    } catch (e) {
      console.error('儲存歷史紀錄至 localStorage 失敗', e);
    }
  };

  // ----------------------------------------------------
  // BLE 實體通訊邏輯 (BRD Reliable BLE Protocol V2 / V1.13)
  // ----------------------------------------------------

  /**
   * 發送 Control Characteristic 指令 (0xC1 ACK / 0xC2 RETRY / 0xC3 RESTART / 0xC4 ABORT)
   */
  const sendControlCommand = async (cmdBytes: Uint8Array, cmdName: string) => {
    if (bleControlCharacteristicRef.current) {
      try {
        addLog(`[TX -> ${cmdName}] Writing ${cmdBytes.byteLength} bytes to Control Characteristic...`);
        if (bleControlCharacteristicRef.current.writeValueWithResponse) {
          await bleControlCharacteristicRef.current.writeValueWithResponse(cmdBytes);
        } else {
          await bleControlCharacteristicRef.current.writeValue(cmdBytes);
        }
        addLog(`[TX -> ${cmdName}] Command sent successfully.`);
      } catch (err: any) {
        console.error(`[TX -> ${cmdName}] Failed:`, err);
        addLog(`[ERROR] Failed to send ${cmdName}: ${err.message || 'Write error'}`);
      }
    } else {
      addLog(`[TX -> ${cmdName}] Warning: Control Characteristic (7f510003) not available.`);
    }
  };

  /**
   * 0xC1 ACK 發送含 Duplicate C1 自動重傳機制 (Section 12 & 17)
   * 若發送 C1 後 2000ms 內未收到 A4 STATUS，自動重新發送相同 C1 一次
   */
  const sendC1AckWithRetry = (sessionId: number, sampleCount: number, calculatedCrc: number) => {
    if (c1TimeoutRef.current) {
      clearTimeout(c1TimeoutRef.current);
      c1TimeoutRef.current = null;
    }
    lastC1PayloadRef.current = { sessionId, sampleCount, crc: calculatedCrc };
    const c1Cmd = buildC1Ack(sessionId, sampleCount, calculatedCrc);
    sendControlCommand(c1Cmd, `0xC1 ACK (Session #${sessionId})`);

    c1TimeoutRef.current = setTimeout(() => {
      if (lastC1PayloadRef.current && lastC1PayloadRef.current.sessionId === sessionId) {
        addLog(`[TIMEOUT] 2000ms 內未收到 A4 回覆，依規範重送 Duplicate 0xC1 ACK (Session #${sessionId})...`);
        const dupCmd = buildC1Ack(sessionId, sampleCount, calculatedCrc);
        sendControlCommand(dupCmd, `Duplicate 0xC1 ACK (Session #${sessionId})`);
      }
      c1TimeoutRef.current = null;
    }, 2000);
  };

  /**
   * 讀取 0005 Diagnostic 診斷特徵值
   */
  const readDiagnosticFromDevice = async () => {
    if (!bleDiagnosticCharacteristicRef.current) {
      addLog('[DIAGNOSTIC] 診斷特徵值 (0x0005) 尚未就緒或不可用');
      return;
    }
    try {
      addLog('[DIAGNOSTIC] 正在向裝置讀取 0x0005 診斷特徵值...');
      const diagVal = await bleDiagnosticCharacteristicRef.current.readValue();
      const diag = parseDiagnosticPacket(diagVal);
      setDiagnosticInfo(diag);
      addLog(`[DIAGNOSTIC] 讀取成功：狀態=${diag.txStateName}, Session=#${diag.currentResultSession}, 點數=${diag.sampleCount}, CRC=0x${diag.crc32.toString(16).toUpperCase()}, 指令錯誤=${diag.commandErrors}, Notify失敗=${diag.notifyFailures}, ACK逾時=${diag.ackTimeouts}`);
      setToast({
        message: `已更新診斷：狀態=${diag.txStateName}，Session #${diag.currentResultSession}`,
        type: 'info',
      });
    } catch (e: any) {
      console.error('讀取診斷特徵值失敗:', e);
      addLog(`[DIAGNOSTIC ERROR] 讀取失敗: ${e.message || '未知錯誤'}`);
    }
  };

  /**
   * 請求 0xC3 完整重傳
   */
  const handleRequestRetransmit = (sessionId: number = 0xFFFF) => {
    if (!bleControlCharacteristicRef.current) {
      addLog('[COMMAND ERROR] 控制特徵值 (0x0003) 不可用');
      return;
    }
    const c3 = buildC3Restart(sessionId);
    sendControlCommand(c3, `0xC3 RESTART (Session 0x${sessionId.toString(16).toUpperCase()})`);
    setToast({
      message: `已發送 0xC3 請求重傳${sessionId === 0xFFFF ? '最新曲線' : ` Session #${sessionId}`}`,
      type: 'info',
    });
  };

  /**
   * 請求 0xC4 中斷傳輸並清除 RAM
   */
  const handleAbortTransfer = (sessionId?: number) => {
    if (!bleControlCharacteristicRef.current) {
      addLog('[COMMAND ERROR] 控制特徵值 (0x0003) 不可用');
      return;
    }
    const sess = sessionId ?? activeRecord?.sessionId ?? currentSessionIdRef.current ?? 1;
    const c4 = buildC4Abort(sess);
    sendControlCommand(c4, `0xC4 ABORT (Session #${sess})`);
    setToast({ message: `已發送 0xC4 中斷傳輸 (Session #${sess})`, type: 'info' });
  };

  /**
   * 請求 0xC2 重送 A3 END 封包 (Count = 0)
   */
  const handleRequestA3Resend = () => {
    if (!bleControlCharacteristicRef.current) {
      addLog('[COMMAND ERROR] 控制特徵值 (0x0003) 不可用');
      return;
    }
    const sess = activeCurveInfoRef.current?.sessionId ?? currentSessionIdRef.current ?? 1;
    const c2 = buildC2Retry(sess, []);
    sendControlCommand(c2, `0xC2 Request A3 Resend (Session #${sess})`);
    setToast({ message: `已向裝置請求重發 A3 結束通知 (Count=0)`, type: 'info' });
  };

  /**
   * 連線至 BLE 裝置 (依循 BRD Reliable BLE Protocol V4 / BRD_BLE_OLED V1.15)
   * 1. Connect
   * 2. Discover Service 0001
   * 3. Subscribe 0002 Notification (B1 / B2 / A1 / A2 / A3 / A4)
   * 4. Acquire 0003 Control Characteristic (C1 / C2 / C3 / C4)
   * 5. Read 0004 Firmware Version (V1.15) & 0005 Diagnostic (Version 4)
   * 6. 接收 0002 B1 LIVE (每 200ms 持續同步 State / Flags / RPM)
   */
  const connectRealDevice = async () => {
    if (!isBluetoothSupported) {
      if (isIOSDevice) {
        setErrorMessage('iPad / iOS 系統預設 Safari 與 Chrome 尚未開放 Web Bluetooth。請使用支援 BLE 之專用 App (如 Bluefy)。');
      } else {
        setErrorMessage('您的瀏覽器不支援 Web Bluetooth API，請更換為 Chrome、Edge 或 Opera 瀏覽器。');
      }
      setShowBleHelpModal(true);
      addLog('[WARNING] Web Bluetooth API is not available in this browser/platform.');
      return;
    }

    try {
      setErrorMessage('');
      setCurveError(null);
      tempSamplesRef.current = [];
      packetMapRef.current.clear();
      expectedSamplesCountRef.current = 0;
      totalExpectedPacketsRef.current = 0;
      sampleIntervalMsRef.current = 0;
      expectedDurationMsRef.current = 0;
      activeCurveInfoRef.current = null;
      setExpectedSamplesCount(0);
      setReceivedSamplesCount(0);

      setStatus(ConnectionStatus.SCANNING);

      const requestOptions = {
        filters: [
          { services: [SERVICE_UUID] },
          { namePrefix: 'BRD_' },
          { namePrefix: 'BRD' },
          { namePrefix: 'Bey' },
          { namePrefix: 'RPM' },
        ],
        optionalServices: [SERVICE_UUID],
      };

      addLog('[SYSTEM] Scanning for BRD compatible Bluetooth devices (BRD_XXXX)...');
      const device = await (navigator as any).bluetooth.requestDevice(requestOptions);

      setStatus(ConnectionStatus.CONNECTING);
      setConnectedDeviceName(device.name || 'BRD_Device');
      bleDeviceRef.current = device;
      addLog(`[SYSTEM] Device found: ${device.name || 'BRD_Device'}. Connecting GATT...`);

      device.addEventListener('gattserverdisconnected', handleBleDisconnect);

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('無法連接至裝置的 GATT 伺服器');
      }

      addLog('[SYSTEM] GATT Server connected. Requesting Primary Service (0x0001)...');
      const service = await server.getPrimaryService(SERVICE_UUID);

      // Step 3: Subscribe 0002 Notification (接收 B1, B2, A1, A2, A3, A4)
      const dataCharacteristic = await service.getCharacteristic(DATA_CHAR_UUID);
      bleCharacteristicRef.current = dataCharacteristic;
      dataCharacteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const val: DataView = event.target.value;
        processBinaryPacket(val);
      });
      await dataCharacteristic.startNotifications();
      addLog('[SYSTEM] Subscribed 0002 Data Notification (Packets: B1, B2, A1, A2, A3, A4).');

      // Step 4: Acquire Control Characteristic (0x0003) - Write
      try {
        const controlCharacteristic = await service.getCharacteristic(CONTROL_CHAR_UUID);
        bleControlCharacteristicRef.current = controlCharacteristic;
        addLog('[SYSTEM] Control Characteristic (0x0003) acquired (Commands: C1, C2, C3, C4).');
      } catch (e) {
        console.warn('Control Characteristic not available:', e);
        bleControlCharacteristicRef.current = null;
      }

      // 連線建立完成，立即更新狀態為 CONNECTED
      setStatus(ConnectionStatus.CONNECTED);
      addLog('[SYSTEM] BRD Reliable BLE Protocol V4 connected. Standing by for B1 telemetry.');

      // 背景非阻塞讀取 0004 韌體版本與 0005 診斷特徵值
      setTimeout(async () => {
        try {
          if (service && bleDeviceRef.current?.gatt?.connected) {
            const firmwareCharacteristic = await service.getCharacteristic(FIRMWARE_CHAR_UUID);
            bleFirmwareCharacteristicRef.current = firmwareCharacteristic;
            const fwVal = await firmwareCharacteristic.readValue();
            const fwText = new TextDecoder('utf-8').decode(fwVal).trim();
            if (fwText) {
              setFirmwareVersion(fwText);
              addLog(`[SYSTEM] Firmware Revision (0x0004): ${fwText}`);
            }
          }
        } catch (e) {
          // 非致命錯誤，靜默略過
        }

        try {
          if (service && bleDeviceRef.current?.gatt?.connected) {
            const diagnosticCharacteristic = await service.getCharacteristic(DIAGNOSTIC_CHAR_UUID);
            bleDiagnosticCharacteristicRef.current = diagnosticCharacteristic;
            const diagVal = await diagnosticCharacteristic.readValue();
            const diag = parseDiagnosticPacket(diagVal);
            setDiagnosticInfo(diag);
            addLog(`[SYSTEM] Diagnostic (0x0005): TX State = ${diag.txStateName}`);
          }
        } catch (e) {
          // 非致命錯誤，靜默略過
        }
      }, 150);
    } catch (err: any) {
      const isCancelled = err.name === 'NotFoundError' || 
                          err.code === 8 ||
                          err.message?.includes('cancelled') || 
                          err.message?.includes('canceled') || 
                          err.message?.includes('chooser') ||
                          err.message?.includes('cancel');

      if (isCancelled) {
        setStatus(ConnectionStatus.DISCONNECTED);
        setErrorMessage('');
        addLog('[SYSTEM] Device scan cancelled by user.');
      } else {
        console.error('藍牙連線錯誤：', err);
        setStatus(ConnectionStatus.ERROR);
        setErrorMessage(err.message || '連線過程發生未知錯誤');
        addLog(`[ERROR] Connection failed: ${err.message || 'Unknown error'}`);
      }
      
      if (c1TimeoutRef.current) {
        clearTimeout(c1TimeoutRef.current);
        c1TimeoutRef.current = null;
      }
      bleDeviceRef.current = null;
      bleCharacteristicRef.current = null;
      bleControlCharacteristicRef.current = null;
      bleFirmwareCharacteristicRef.current = null;
      bleDiagnosticCharacteristicRef.current = null;
    }
  };

  /**
   * 斷開 BLE 裝置連線
   */
  const disconnectRealDevice = async () => {
    if (bleDeviceRef.current && bleDeviceRef.current.gatt?.connected) {
      bleDeviceRef.current.gatt.disconnect();
    } else {
      handleBleDisconnect();
    }
  };

  /**
   * 處理 BLE 斷線事件 (Section 17 & 28 TEST 10)
   * 清除連線狀態，重設 DeviceState 為 WAIT_LOAD，不殘留舊 READY 假設
   */
  const handleBleDisconnect = () => {
    console.warn('BLE 裝置已斷開連線！');
    if (c1TimeoutRef.current) {
      clearTimeout(c1TimeoutRef.current);
      c1TimeoutRef.current = null;
    }
    setStatus(ConnectionStatus.DISCONNECTED);
    setConnectedDeviceName('');
    setFirmwareVersion('');
    setDeviceState(DeviceState.WAIT_LOAD);
    setStateFlags({
      loaded: false,
      active: false,
      launchMarkerValid: false,
      resultPending: false,
      charging: false,
      waitAck: false,
    });

    bleCharacteristicRef.current = null;
    bleControlCharacteristicRef.current = null;
    bleFirmwareCharacteristicRef.current = null;
    bleDiagnosticCharacteristicRef.current = null;
    bleDeviceRef.current = null;

    hasCompletedCurveRef.current = false;
    lastDeviceStateRef.current = DeviceState.WAIT_LOAD;
    lastLoadedRef.current = false;
    resetSpinTimer();

    tempSamplesRef.current = [];
    packetMapRef.current.clear();
    expectedSamplesCountRef.current = 0;
    totalExpectedPacketsRef.current = 0;
    sampleIntervalMsRef.current = 0;
    expectedDurationMsRef.current = 0;
    activeCurveInfoRef.current = null;
    setExpectedSamplesCount(0);
    setReceivedSamplesCount(0);
    addLog('[SYSTEM] BLE connection terminated. State reset to WAIT_LOAD.');
  };

  /**
   * 核心二進位封包處理引擎 (0xB1, 0xB2, 0xA1, 0xA2, 0xA3, 0xA4)
   */
  const processBinaryPacket = (dataView: DataView) => {
    const result = parseBlePacket(dataView);

    if (result.error) {
      console.error(`[PROTOCOL ERROR] ${result.error}`);
      addLog(`[ERROR] ${result.error}`);
    }

    switch (result.type) {
      // 0xB1: LIVE 即時遙測數據 (V1.15 每 200ms 持續發送，涵蓋所有狀態之 State / Flags / RPM)
      case 'LIVE': {
        if (!result.liveData) break;
        const live = result.liveData;
        setLiveTelemetry(live);
        setDeviceState(live.state);
        setStateFlags({
          loaded: live.flags.loaded,
          active: live.flags.measurementActive,
          launchMarkerValid: live.flags.launchMarkerValid,
          resultPending: live.flags.resultPending,
          charging: live.flags.charging,
          waitAck: !!live.flags.curveWaitAck || !!live.flags.waitAck,
        });

        const prevState = lastDeviceStateRef.current;
        const prevLoaded = lastLoadedRef.current;
        const newState = live.state;
        const isLoadedNow = live.flags.loaded || newState === DeviceState.LOADED_READY || newState === DeviceState.SPINNING_LOADED;

        lastDeviceStateRef.current = newState;
        lastLoadedRef.current = isLoadedNow;

        // 偵測是否為「再次裝載」的邊緣觸發
        const isReloadEdge = !prevLoaded && isLoadedNow;
        // 偵測是否為「發射成功」：裝載後變為 LOW (未裝載)
        const isLaunchEdge = prevLoaded && !isLoadedNow;

        // 判斷是否有收到轉速變化 (即時轉速 > 0 或 極速 > 0)
        const hasRpmActivity = (live.currentRpm > 0) || (live.maxRpm > 0);

        // 依據 V1.15 狀態切換 UI 呈現模式：曲線收到後且再次裝載才歸零介面
        if (isLoadedNow) {
          setIsLaunchedMode(false);
          resetSpinTimer();

          // 曲線收到後且再次裝載（或先前有舊曲線/發射紀錄殘留），才進行介面與曲線歸零
          if (isReloadEdge || hasCompletedCurveRef.current) {
            hasCompletedCurveRef.current = false;
            setActiveRecord(null);
            setActiveCurveInfo(null);
            activeCurveInfoRef.current = null;
            setLastLaunchEvent(null);
            lastLaunchEventRef.current = null;
            tempSamplesRef.current = [];
            packetMapRef.current.clear();
            setExpectedSamplesCount(0);
            setReceivedSamplesCount(0);
            expectedSamplesCountRef.current = 0;
            totalExpectedPacketsRef.current = 0;
            sampleIntervalMsRef.current = 0;
            expectedDurationMsRef.current = 0;
            setSampleIntervalMs(0);
            setExpectedDurationMs(0);
            setCurveError(null);
            addLog('[SYSTEM] 檢測到再次裝載陀螺 (LOADED_READY)，介面與計時已歸零，等待下次發射。');
          }
        } else {
          // 未裝載狀態 (LOW)
          if (isLaunchEdge || newState === DeviceState.SPINNING_LAUNCHED) {
            setIsLaunchedMode(true);
            // 只有在收到轉速變化 (RPM > 0) 時才啟動旋轉計時器；若無轉速變化則不啟用
            if (hasRpmActivity && !isSpinTimingRef.current && manualSpinDurationRef.current === null) {
              startSpinTimer(live.elapsedMs || 0);
              addLog(`[SYSTEM] 陀螺發射且偵測到轉速 (${live.currentRpm} RPM, Peak: ${live.maxRpm} RPM)，開始旋轉計時。`);
            }
          }

          if (newState === DeviceState.SPINNING_LAUNCHED) {
            setIsLaunchedMode(true);
            if (hasRpmActivity && !isSpinTimingRef.current && manualSpinDurationRef.current === null) {
              startSpinTimer(live.elapsedMs || 0);
            }
          } else if (newState === DeviceState.RESULT_PENDING) {
            setIsLaunchedMode(true);
          } else if (newState === DeviceState.WAIT_LOAD) {
            // WAIT_LOAD (未裝載/量測結束後回到待命)：嚴格保留接收到的曲線與統計供檢視，不提早歸零
            setIsLaunchedMode(false);
          }
        }

        const stateLabels: Record<number, string> = {
          0: 'WAIT_LOAD',
          1: 'LOADED_READY',
          2: 'SPINNING_LOADED',
          3: 'SPINNING_LAUNCHED',
          4: 'RESULT_PENDING',
        };
        addLog(`[0xB1 LIVE] ${stateLabels[live.state] || live.state}: RPM=${live.currentRpm}, Peak=${live.maxRpm}, Elapsed=${live.elapsedMs}ms`);
        break;
      }

      // 0xB2: LAUNCH 發射事件通知
      case 'LAUNCH': {
        if (!result.launchEvent) break;
        const launch = result.launchEvent;
        setLastLaunchEvent(launch);
        lastLaunchEventRef.current = launch;
        setIsLaunchedMode(true);
        const hasLaunchRpm = (launch.launchRpm > 0) || (launch.maxRpmAtLaunch > 0);
        // 若有收到轉速數值才啟用計時
        if (hasLaunchRpm && !isSpinTimingRef.current && manualSpinDurationRef.current === null) {
          startSpinTimer(launch.launchTimeMs || 0);
        }
        addLog(`[0xB2] LAUNCH: RPM=${launch.launchRpm}, PeakAtLaunch=${launch.maxRpmAtLaunch}, Time=${launch.launchTimeMs}ms`);
        break;
      }

      // 0xA1: CURVE_START 曲線開始
      case 'START': {
        setIsLaunchedMode(true);
        tempSamplesRef.current = [];
        packetMapRef.current.clear();

        const info = result.curveStartInfo;
        if (info) {
          setActiveCurveInfo(info);
          activeCurveInfoRef.current = info;
          currentSessionIdRef.current = info.sessionId;
        } else {
          currentSessionIdRef.current = 1;
        }

        const totalCount = result.totalCount || 0;
        const intervalMs = result.sampleIntervalMs || 0;
        const durMs = result.durationMs || 0;
        const expectedPkts = Math.ceil(totalCount / 4);
        totalExpectedPacketsRef.current = expectedPkts;

        addLog(`[0xA1] CURVE_START (Session #${currentSessionIdRef.current}): Count=${totalCount} pts (~${expectedPkts} pkts), MaxRPM=${info?.maxRpm || 0}`);

        if (totalCount === 0) {
          const err = 'CURVE_START 封包無效：樣本數不能為 0';
          setCurveError(err);
          break;
        }

        setCurveError(null);
        setExpectedSamplesCount(totalCount);
        expectedSamplesCountRef.current = totalCount;
        setReceivedSamplesCount(0);
        setSampleIntervalMs(intervalMs);
        setExpectedDurationMs(durMs);
        setStatus(ConnectionStatus.RECEIVING);
        break;
      }

      // 0xA2: CURVE_DATA 曲線資料
      case 'DATA': {
        if (expectedSamplesCountRef.current === 0) {
          break;
        }

        if (!result.samples || result.samples.length === 0) {
          break;
        }

        const incomingCount = result.samples.length;
        const pktIdx = result.packetIndex !== undefined ? result.packetIndex : packetMapRef.current.size;

        packetMapRef.current.set(pktIdx, result.samples);

        let totalReceivedPts = 0;
        packetMapRef.current.forEach((samples) => {
          totalReceivedPts += samples.length;
        });

        setReceivedSamplesCount(totalReceivedPts);
        const totalExpectedPkts = totalExpectedPacketsRef.current || Math.ceil(expectedSamplesCountRef.current / 4);
        addLog(`[0xA2] CURVE_DATA Pkt #${pktIdx}: +${incomingCount} pts (Total: ${totalReceivedPts}/${expectedSamplesCountRef.current} pts, ${packetMapRef.current.size}/${totalExpectedPkts} pkts)`);
        break;
      }

      // 0xA3: CURVE_END 曲線結束與校驗 (Section 12, 17, 28)
      case 'END': {
        if (expectedSamplesCountRef.current === 0 && packetMapRef.current.size === 0) {
          break;
        }

        const endInfo = result.curveEndInfo;
        const sessionId = endInfo?.sessionId ?? currentSessionIdRef.current;
        const expectedSampleCount = endInfo?.sampleCount ?? expectedSamplesCountRef.current;
        const totalPackets = endInfo?.totalPacketCount ?? (totalExpectedPacketsRef.current || Math.ceil(expectedSampleCount / 4));

        // 1. 檢查封包完整性 (0 .. totalPackets - 1)
        const missingPacketIndexes: number[] = [];
        for (let p = 0; p < totalPackets; p++) {
          if (!packetMapRef.current.has(p)) {
            missingPacketIndexes.push(p);
          }
        }

        // 缺包 -> 發送 0xC2 選擇性重傳
        if (missingPacketIndexes.length > 0 && bleControlCharacteristicRef.current) {
          const retryBatch = missingPacketIndexes.slice(0, 8);
          const warnMsg = `[0xA3] 檢測到缺失 ${missingPacketIndexes.length} 個封包 (索引: [${missingPacketIndexes.join(', ')}])，向裝置發送 0xC2 RETRY...`;
          console.warn(warnMsg);
          addLog(warnMsg);

          const c2Cmd = buildC2Retry(sessionId, retryBatch);
          sendControlCommand(c2Cmd, `0xC2 RETRY (Session ${sessionId}, ${retryBatch.length} pkts)`);
          return;
        }

        // 拼裝所有樣本
        const finalSamples: RpmSample[] = [];
        for (let p = 0; p < totalPackets; p++) {
          const pktSamples = packetMapRef.current.get(p);
          if (pktSamples) {
            finalSamples.push(...pktSamples);
          }
        }

        if (finalSamples.length === 0) {
          const err = '收到 CURVE_END 封包，但未收到任何樣本數據！';
          setCurveError(err);
          packetMapRef.current.clear();
          expectedSamplesCountRef.current = 0;
          setExpectedSamplesCount(0);
          setReceivedSamplesCount(0);
          setStatus(ConnectionStatus.CONNECTED);
          break;
        }

        finalSamples.sort((a, b) => a.timeMs - b.timeMs);

        // 2. 計算並校驗 CRC32
        const calculatedCrc = calculateCurveCrc32(finalSamples);
        let crcVerified = true;

        if (endInfo && endInfo.curveCrc32 !== undefined) {
          if (calculatedCrc !== endInfo.curveCrc32) {
            crcVerified = false;
            const crcErrMsg = `CRC32 驗證不符：本機 0x${calculatedCrc.toString(16).toUpperCase()} != 裝置宣告 0x${endInfo.curveCrc32.toString(16).toUpperCase()}`;
            console.error(`[PROTOCOL] ${crcErrMsg}`);
            addLog(`[ERROR] ${crcErrMsg}`);

            if (bleControlCharacteristicRef.current) {
              addLog(`[PROTOCOL] CRC32 錯誤，發送 0xC3 RESTART_FULL_TRANSFER (Session ${sessionId})...`);
              const c3Cmd = buildC3Restart(sessionId);
              sendControlCommand(c3Cmd, `0xC3 RESTART (Session ${sessionId})`);
              setCurveError(`CRC32 校驗失敗，已自動發送 C3 要求重新傳送整組曲線。`);
            } else {
              setCurveError(crcErrMsg);
            }
          } else {
            // 3. 封包數、樣本數、CRC32 三重驗證皆通過 -> 發送 0xC1 ACK
            addLog(`[CRC32] 驗證成功 (0x${calculatedCrc.toString(16).toUpperCase()})！發送 0xC1 ACK...`);
            sendC1AckWithRetry(sessionId, finalSamples.length, calculatedCrc);
          }
        }

        setStatus(ConnectionStatus.CONNECTED);

        const actualCount = finalSamples.length;
        const launchInfo = activeCurveInfoRef.current || lastLaunchEventRef.current;

        if (
          launchInfo?.launchTimeMs !== undefined &&
          launchInfo?.launchRpm !== undefined &&
          (activeCurveInfoRef.current ? activeCurveInfoRef.current.launchMarkerValid : true)
        ) {
          if (!finalSamples.some((s) => s.timeMs === launchInfo.launchTimeMs)) {
            finalSamples.push({
              timeMs: launchInfo.launchTimeMs,
              rpm: launchInfo.launchRpm,
            });
            finalSamples.sort((a, b) => a.timeMs - b.timeMs);
          }
        }

        const rpms = finalSamples.map((s) => s.rpm);
        const startMaxRpm = activeCurveInfoRef.current?.maxRpm || 0;
        const maxRpm = Math.max(...rpms, startMaxRpm);
        const sumRpm = rpms.reduce((acc, val) => acc + val, 0);
        const avgRpm = rpms.length > 0 ? Math.round(sumRpm / rpms.length) : 0;

        // 若使用者沒有按下暫停鍵，則不儲存旋轉時間 (為 undefined，顯示 --)；按下暫停才儲存
        const recordedDuration = (manualSpinDurationRef.current !== null && manualSpinDurationRef.current > 0)
          ? manualSpinDurationRef.current
          : undefined;

        const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        const recordName = `戰鬥紀錄 #${uniqueId.slice(-4)}`;
        const newRecord: SpinRecord = {
          id: uniqueId,
          timestamp: new Date().toLocaleString('zh-TW', { hour12: false }),
          name: recordName,
          maxRpm,
          avgRpm,
          durationMs: recordedDuration,
          samples: finalSamples,
          totalSamplesExpected: expectedSampleCount,
          maxTimeMs: activeCurveInfoRef.current?.maxTimeMs,
          launchRpm: launchInfo?.launchRpm,
          launchTimeMs: launchInfo?.launchTimeMs,
          launchSampleIndex: launchInfo?.launchSampleIndex,
          launchMarkerValid: activeCurveInfoRef.current ? activeCurveInfoRef.current.launchMarkerValid : true,
          sessionId,
          curveCrc32: calculatedCrc,
          crcVerified,
        };

        setActiveRecord(newRecord);
        hasCompletedCurveRef.current = true;
        if (crcVerified) {
          setCurveError(null);
        }

        addLog(`[SYSTEM] Telemetry processed. Peak: ${maxRpm} RPM, Points: ${actualCount}/${expectedSampleCount}, CRC32: 0x${calculatedCrc.toString(16).toUpperCase()}${crcVerified ? ' (Verified)' : ' (Mismatch)'}.`);

        setHistory((prevHistory) => {
          const updated = [newRecord, ...prevHistory];
          localStorage.setItem('brd_history_records', JSON.stringify(updated));
          return updated;
        });

        tempSamplesRef.current = [];
        packetMapRef.current.clear();
        expectedSamplesCountRef.current = 0;
        totalExpectedPacketsRef.current = 0;
        sampleIntervalMsRef.current = 0;
        expectedDurationMsRef.current = 0;
        activeCurveInfoRef.current = null;
        setExpectedSamplesCount(0);
        setReceivedSamplesCount(0);
        break;
      }

      // 0xA4: TRANSFER_STATUS
      case 'STATUS': {
        if (!result.transferStatus) break;
        const st = result.transferStatus;

        if (c1TimeoutRef.current) {
          clearTimeout(c1TimeoutRef.current);
          c1TimeoutRef.current = null;
        }

        const detailDesc = st.detailDescription ? ` (${st.detailDescription})` : '';
        addLog(`[0xA4] TRANSFER_STATUS: ${st.statusName} (0x${st.status.toString(16).toUpperCase()}), Session #${st.sessionId}, Detail=${st.detail}${detailDesc}`);

        if (st.status === TransferStatusCode.ACK_ACCEPTED) {
          // 靜默完成，不彈出 Toast 提示避免遮擋畫面，相關資訊已記錄於系統日誌中
        } else if (st.status === TransferStatusCode.RETRY_ACCEPTED) {
          addLog(`[0xA4] 裝置已接受選擇性重傳請求，將重發 ${st.detail} 個 A2 封包...`);
        } else if (st.status === TransferStatusCode.RESTART_ACCEPTED) {
          packetMapRef.current.clear();
          addLog(`[0xA4] 裝置已接受整組重傳 (${st.detail} 包)，等待發送 A1...`);
        } else if (st.status === TransferStatusCode.ABORT_ACCEPTED) {
          packetMapRef.current.clear();
          setStatus(ConnectionStatus.CONNECTED);
          addLog(`[0xA4] 裝置已確認放棄傳輸 (ABORT)。`);
          setToast({ message: '已放棄當前曲線傳輸。', type: 'info' });
        } else if (st.status === TransferStatusCode.SESSION_MISMATCH) {
          addLog(`[0xA4] 裝置回應 Session 不符：裝置目前為 #${st.detail}。`);
          setToast({ message: `Session 不符，裝置目前為 #${st.detail}`, type: 'warning' });
        } else if (st.status === TransferStatusCode.CRC_MISMATCH) {
          addLog(`[0xA4] 曲線 CRC32 校驗不符！`);
          setToast({ message: '曲線 CRC32 校驗不符，建議重新請求重傳', type: 'error' });
        }
        break;
      }
    }
  };

  // ----------------------------------------------------
  // 歷史資料操作
  // ----------------------------------------------------

  const handleRenameRecord = (id: string, newName: string) => {
    const updated = history.map((rec) => {
      if (rec.id === id) {
        return { ...rec, name: newName };
      }
      return rec;
    });
    if (activeRecord && activeRecord.id === id) {
      setActiveRecord({ ...activeRecord, name: newName });
    }
    saveHistoryToStorage(updated);
  };

  const handleDeleteRecord = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = history.filter((rec) => rec.id !== id);
    if (activeRecord && activeRecord.id === id) {
      setActiveRecord(filtered.length > 0 ? filtered[0] : null);
    }
    saveHistoryToStorage(filtered);
  };

  const handleExportHistory = () => {
    if (history.length === 0) {
      setToast({ message: '目前沒有任何紀錄可供匯出。', type: 'error' });
      return;
    }
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(history, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `BRD_Telemetry_Export_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setToast({ message: '歷史紀錄匯出成功！', type: 'success' });
    } catch (err) {
      setToast({ message: '匯出失敗，請重試。', type: 'error' });
    }
  };

  const handleImportHistory = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json) && json.every((item) => item.samples)) {
          const sanitizedJson = json.map((item) => {
            const originalId = item.id || `import-${Date.now()}`;
            return {
              ...item,
              id: `${originalId}-${Math.floor(Math.random() * 1000000)}`,
            };
          });

          const merged = [...sanitizedJson, ...history].filter(
            (v, i, a) => a.findIndex((t) => t.id === v.id) === i
          );
          saveHistoryToStorage(merged);
          if (merged.length > 0) {
            setActiveRecord(merged[0]);
          }
          setToast({ message: `匯入成功！共載入 ${json.length} 筆戰鬥紀錄。`, type: 'success' });
        } else {
          setToast({ message: '匯入格式不符！請確保匯入的是帶有轉速樣本的 JSON 陣列。', type: 'error' });
        }
      } catch (err) {
        setToast({ message: '解析檔案失敗，請選取正確的 BRD 歷史匯出 JSON 檔。', type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 韌體版本格式化
  const formatFirmwareVersion = (fw: string) => {
    if (!fw) return 'FW V1.15';
    const clean = fw.trim();
    if (clean.toUpperCase().startsWith('FW')) return clean;
    if (clean.toUpperCase().startsWith('V')) return `FW ${clean}`;
    return `FW V${clean}`;
  };

  // 獲取狀態標籤顯示
  const getStatusDisplay = () => {
    switch (status) {
      case ConnectionStatus.SCANNING:
        return {
          text: '正在搜尋裝置...',
          subText: '',
          dotClass: 'bg-blue-400 animate-ping',
        };
      case ConnectionStatus.CONNECTING:
        return {
          text: `連線中: ${connectedDeviceName}`,
          subText: '',
          dotClass: 'bg-amber-400',
        };
      case ConnectionStatus.RECEIVING:
        return {
          text: `正在接收資料: ${receivedSamplesCount} / ${expectedSamplesCount} 點`,
          subText: formatFirmwareVersion(firmwareVersion),
          dotClass: 'bg-pink-400 animate-bounce',
        };
      case ConnectionStatus.CONNECTED:
        return {
          text: `已連線: ${connectedDeviceName}`,
          subText: formatFirmwareVersion(firmwareVersion),
          dotClass: 'bg-emerald-400 animate-pulse',
        };
      case ConnectionStatus.ERROR:
        return {
          text: '藍牙連線異常',
          subText: '',
          dotClass: 'bg-rose-500',
        };
      case ConnectionStatus.DISCONNECTED:
      default:
        return {
          text: !isBluetoothSupported
            ? (isIOSDevice ? 'iPad / iOS 提示 (需專用 BLE 瀏覽器)' : '未開啟原生 Web BLE')
            : '尚未連線',
          subText: '請點擊按鈕搜尋',
          dotClass: !isBluetoothSupported ? 'bg-amber-400 animate-pulse' : 'bg-slate-500',
        };
    }
  };

  const statusInfo = getStatusDisplay();

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-200 flex flex-col antialiased font-sans selection:bg-cyan-500/30 selection:text-white">
      {/* 頂部標題與狀態導航列 */}
      <header id="brd-app-header" className="border-b border-slate-900 bg-[#07090e]/90 backdrop-blur-md sticky top-0 z-50 shadow-[0_1px_15px_rgba(0,0,0,0.5)]">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4 flex flex-col md:flex-row justify-between items-center gap-3 md:gap-4">
          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.45)] transform hover:scale-105 transition-all shrink-0">
                <svg className="w-6 h-6 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-black tracking-wider text-white uppercase">
                  BRD DETECTOR
                </h1>
                <p className="text-[9px] sm:text-[10px] text-slate-400 font-mono tracking-widest uppercase">
                  BEYBLADE RPM TELEMETRY V2
                </p>
              </div>
            </div>

            {/* Mobile buttons */}
            <div className="flex items-center gap-1.5 md:hidden">
              <button
                type="button"
                onClick={() => setShowBleHelpModal(true)}
                className="p-2 rounded-xl bg-slate-900 text-amber-400 border border-slate-800 hover:border-amber-500/40 cursor-pointer"
                title="iPad / 藍牙說明"
              >
                <HelpCircle className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {/* 狀態列指示標籤與藍牙連線按鈕 */}
          <div className="flex items-center gap-3 sm:gap-4 w-full md:w-auto justify-between md:justify-end">
            <div className="flex items-center bg-slate-950 border border-slate-800/80 px-3.5 py-1.5 sm:py-2 rounded-xl gap-2.5 shadow-inner min-w-0">
              <div className="relative flex h-2.5 w-2.5 shrink-0">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${statusInfo.dotClass.includes('animate-pulse') ? 'bg-cyan-400 animate-ping' : statusInfo.dotClass}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${statusInfo.dotClass.split(' ')[0]}`}></span>
              </div>
              <div className="flex flex-col min-w-0 justify-center">
                <span className="text-xs font-bold text-white tracking-wide truncate">{statusInfo.text}</span>
                {statusInfo.subText ? (
                  <span className="text-[9px] text-slate-400 font-mono leading-none mt-0.5 uppercase tracking-wider block truncate">
                    {statusInfo.subText}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* 歷史資料按鈕 */}
              <button
                type="button"
                id="btn-open-history-header"
                onClick={() => setShowHistoryModal(true)}
                className="hidden md:flex px-3 py-2 sm:py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 hover:border-cyan-500/40 text-xs font-bold items-center gap-1.5 transition-all cursor-pointer shrink-0 active:scale-95 shadow-sm"
                title="開啟戰鬥歷史資料"
              >
                <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
                <span>歷史資料</span>
                <span className="text-[10px] bg-cyan-950 text-cyan-400 font-mono px-1.5 py-0.5 rounded-full font-bold border border-cyan-800/50">
                  {history.length}
                </span>
              </button>

              {/* 連線/斷開按鈕 */}
              {status === ConnectionStatus.DISCONNECTED || status === ConnectionStatus.ERROR ? (
                <button
                  type="button"
                  id="btn-ble-connect"
                  onClick={connectRealDevice}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs sm:text-sm px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer whitespace-nowrap"
                >
                  <Bluetooth className="w-4 h-4" />
                  <span>搜尋藍牙裝置</span>
                </button>
              ) : (
                <button
                  type="button"
                  id="btn-ble-disconnect"
                  onClick={disconnectRealDevice}
                  className="bg-slate-900 hover:bg-slate-800 text-rose-400 font-bold text-xs sm:text-sm px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all border border-slate-800 hover:border-slate-700 cursor-pointer active:scale-95 whitespace-nowrap"
                >
                  <Bluetooth className="w-4 h-4 text-rose-400" />
                  <span>中斷藍牙</span>
                </button>
              )}

              {/* 藍芽通訊日誌按鈕 */}
              <button
                type="button"
                id="btn-open-logs-header"
                onClick={() => setShowLogsModal(true)}
                className="hidden md:flex p-2 sm:p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-400 border border-slate-800 hover:border-cyan-500/40 items-center justify-center transition-all cursor-pointer shrink-0 active:scale-95 shadow-sm"
                title="藍芽通訊日誌"
                aria-label="藍芽通訊日誌"
              >
                <Terminal className="w-4.5 h-4.5 text-cyan-400" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 主要內容區 */}
      <main id="brd-main-layout" className="flex-grow max-w-7xl w-full mx-auto p-3 sm:p-4 lg:p-6 pb-24 lg:pb-8 grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 animate-fadeIn">
        {/* 錯誤警告訊息橫條 */}
        {errorMessage && (
          <div className="lg:col-span-12 bg-rose-950/50 border border-rose-800/80 rounded-2xl p-3.5 px-4 flex items-center justify-between gap-3 text-xs text-rose-200 shadow-lg backdrop-blur-sm animate-fadeIn max-lg:order-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle className="w-4.5 h-4.5 text-rose-400 shrink-0" />
              <span className="font-mono">{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage('')}
              className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded-lg bg-rose-900/30 hover:bg-rose-900/60 transition-all cursor-pointer shrink-0"
            >
              關閉
            </button>
          </div>
        )}

        {/* iPad / iOS 相容性提醒橫條 */}
        {(!isBluetoothSupported || isIOSDevice) && (status === ConnectionStatus.DISCONNECTED || status === ConnectionStatus.ERROR) && (
          <div className="lg:col-span-12 bg-amber-950/30 border border-amber-500/30 rounded-2xl p-3.5 px-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-200 shadow-md max-lg:order-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Smartphone className="w-4.5 h-4.5 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <span className="font-bold text-amber-300">
                  {isIOSDevice ? 'iPad / iOS 藍牙支援提示：' : '網頁藍牙相容提示：'}
                </span>
                <span className="text-slate-300 ml-1">
                  {isIOSDevice
                    ? 'iPad Safari 預設未開放原生 Web BLE。請點擊【iPad/藍牙說明】下載 Bluefy 專用 App。'
                    : '請使用 Google Chrome、Microsoft Edge 或相容之 Web BLE 瀏覽器。'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 font-mono text-[11px]">
              <button
                type="button"
                onClick={() => setShowBleHelpModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-800 rounded-xl transition-all cursor-pointer active:scale-95 font-bold"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                設定說明
              </button>
            </div>
          </div>
        )}

        {/* 左側：主要圖表區 (8/12 寬度) */}
        <section id="chart-and-history-section" className="lg:col-span-8 flex flex-col gap-6 max-lg:contents">
          {curveError && (
            <div id="curve-error-container" className="bg-rose-950/40 border border-rose-900/50 rounded-2xl p-4 flex flex-col gap-3 shadow-xl animate-fadeIn max-lg:order-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                  <AlertTriangle className="w-4.5 h-4.5 text-rose-500 animate-pulse" />
                  <span>戰鬥陀螺數據解析或驗證失敗！</span>
                </div>
                <button
                  type="button"
                  id="btn-clear-curve-error"
                  onClick={() => setCurveError(null)}
                  className="px-2.5 py-1 rounded bg-rose-900/30 hover:bg-rose-900/50 text-rose-300 font-semibold text-xs cursor-pointer transition-all active:scale-95"
                >
                  清除錯誤
                </button>
              </div>
              <div className="text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-900/80 font-mono text-xs leading-relaxed">
                <div>
                  <span className="text-rose-400 font-bold">錯誤描述：</span>
                  <span className="text-slate-200">{curveError}</span>
                </div>
                <div className="mt-3.5 pt-2.5 border-t border-slate-900 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] text-slate-400">
                  <div>預期樣本總數：<span className="text-white font-bold">{expectedSamplesCount} 筆</span></div>
                  <div>實際接收總數：<span className="text-white font-bold">{receivedSamplesCount} 筆</span></div>
                  <div>取樣間隔：<span className="text-white font-bold">{sampleIntervalMs === 0 ? '0 ms (全點傳輸)' : `${sampleIntervalMs} ms`}</span></div>
                  <div>總時間：<span className="text-white font-bold">{expectedDurationMs} ms</span></div>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col max-lg:order-4 gap-3">
            <RpmChart
              samples={activeRecord ? activeRecord.samples : []}
              activeLabel={
                activeRecord
                  ? `${activeRecord.name} (${activeRecord.timestamp})`
                  : (deviceState === DeviceState.LOADED_READY
                      ? '裝載就緒，等待發射...'
                      : deviceState === DeviceState.SPINNING_LOADED
                      ? '裝載中預轉，等待發射...'
                      : deviceState === DeviceState.WAIT_LOAD
                      ? '等待裝載戰鬥陀螺...'
                      : '目前尚未載入任何轉速紀錄')
              }
              maxRpm={activeRecord?.maxRpm}
              maxTimeMs={activeRecord?.maxTimeMs}
              launchRpm={activeRecord?.launchRpm}
              launchTimeMs={activeRecord?.launchTimeMs}
              launchMarkerValid={activeRecord?.launchMarkerValid}
            />
          </div>
        </section>

        {/* 右側：核心控制台與即時轉速表 (4/12 寬度) */}
        <section id="control-panel-section" className="lg:col-span-4 flex flex-col gap-6 max-lg:contents">
          <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-5 flex flex-col items-center text-center relative overflow-hidden shadow-xl max-lg:order-3">
            <div className="flex items-center justify-between w-full mb-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest text-left">
                極速顯示器
              </h2>
              {/* 狀態 Badge (0x81 State) */}
              <div className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono font-bold flex items-center gap-1.5 ${
                deviceState === DeviceState.WAIT_LOAD ? 'bg-slate-900 text-slate-400 border-slate-800' :
                (deviceState === DeviceState.LOADED_READY || deviceState === DeviceState.SPINNING_LOADED) ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 animate-pulse' :
                deviceState === DeviceState.SPINNING_LAUNCHED ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse' :
                'bg-purple-500/20 text-purple-400 border-purple-500/40'
              }`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping"></span>
                {deviceState === DeviceState.WAIT_LOAD && '等待裝載'}
                {(deviceState === DeviceState.LOADED_READY || deviceState === DeviceState.SPINNING_LOADED) && '裝載就緒'}
                {deviceState === DeviceState.SPINNING_LAUNCHED && '發射中'}
                {deviceState === DeviceState.RESULT_PENDING && '待傳送'}
              </div>
            </div>

            {/* 圓形儀表板繪製 */}
            {(() => {
              const isLoaded = deviceState === DeviceState.LOADED_READY || deviceState === DeviceState.SPINNING_LOADED;
              const maxVal = Math.max(
                liveTelemetry?.maxRpm || 0,
                lastLaunchEvent?.maxRpmAtLaunch || 0,
                activeCurveInfo?.maxRpm || 0,
                activeRecord?.maxRpm || 0
              );

              let displayRpm = 0;
              let labelText = 'LIVE RPM';

              if (isLoaded) {
                // 裝載狀態：已歸零，顯示即時轉速 (0 或 裝載中旋轉)
                labelText = 'LIVE RPM';
                displayRpm = liveTelemetry ? liveTelemetry.currentRpm : 0;
              } else if (isLaunchedMode || maxVal > 0 || activeRecord) {
                // 已發射、待傳送、或量測結束回到 WAIT_LOAD 期間：持續鎖定顯示前次 MAX RPM 直到下次裝載
                labelText = 'MAX RPM';
                displayRpm = maxVal;
              } else {
                labelText = 'LIVE RPM';
                displayRpm = liveTelemetry ? liveTelemetry.currentRpm : 0;
              }

              const maxScale = 12000;
              const percentage = Math.min(displayRpm / maxScale, 1);
              const strokeDashoffset = 439.8 * (1 - percentage);

              return (
                <div className="relative flex items-center justify-center w-48 h-48 mb-4">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="96"
                      cy="96"
                      r="70"
                      fill="transparent"
                      stroke="rgba(15, 23, 42, 0.9)"
                      strokeWidth="10"
                    />
                    <circle
                      cx="96"
                      cy="96"
                      r="70"
                      fill="transparent"
                      stroke="url(#gaugeGradient)"
                      strokeWidth="10"
                      strokeDasharray="439.8"
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      className="transition-all duration-300 ease-out"
                    />
                    <defs>
                      <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="100%" stopColor="#ec4899" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider font-mono">
                      {labelText}
                    </span>
                    <span id="gauge-rpm-text" className="text-4xl font-black text-white font-mono leading-none tracking-tighter">
                      {displayRpm.toLocaleString()}
                    </span>
                    <span className="text-[9px] text-cyan-400 font-bold mt-1.5 tracking-widest font-mono">
                      轉/分 (RPM)
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* 進度條 */}
            {(() => {
              const isLoaded = deviceState === DeviceState.LOADED_READY || deviceState === DeviceState.SPINNING_LOADED;
              const maxVal = Math.max(
                liveTelemetry?.maxRpm || 0,
                lastLaunchEvent?.maxRpmAtLaunch || 0,
                activeCurveInfo?.maxRpm || 0,
                activeRecord?.maxRpm || 0
              );

              const displayRpm = isLoaded
                ? (liveTelemetry ? liveTelemetry.currentRpm : 0)
                : (isLaunchedMode || maxVal > 0 || activeRecord ? maxVal : (liveTelemetry ? liveTelemetry.currentRpm : 0));

              return (
                <div className="w-full mt-1 mb-4 h-1.5 bg-[#0d0f14] rounded-full overflow-hidden border border-slate-900">
                  <div 
                    className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)] transition-all duration-300 ease-out"
                    style={{ width: `${Math.min((displayRpm / 12000) * 100, 100)}%` }}
                  ></div>
                </div>
              );
            })()}

            {/* 數值數據欄 */}
            <div className="grid grid-cols-2 gap-3 w-full border-t border-slate-900/80 pt-4 text-xs">
              <div className="bg-[#0d0f14]/80 p-3 rounded-xl border border-slate-900 flex flex-col items-start">
                <span className="text-slate-500 text-[9px] uppercase font-bold tracking-wider font-mono">Max RPM</span>
                <span className="text-sm font-black text-pink-400 font-mono mt-0.5">
                  {(() => {
                    const isLoaded = deviceState === DeviceState.LOADED_READY || deviceState === DeviceState.SPINNING_LOADED;
                    if (isLoaded) return '--';
                    const maxVal = Math.max(
                      liveTelemetry?.maxRpm || 0,
                      lastLaunchEvent?.maxRpmAtLaunch || 0,
                      activeCurveInfo?.maxRpm || 0,
                      activeRecord?.maxRpm || 0
                    );
                    return maxVal > 0 ? maxVal.toLocaleString() : '--';
                  })()}
                </span>
              </div>
              <div className="bg-[#0d0f14]/80 p-3 rounded-xl border border-slate-900 flex flex-col items-start">
                <span className="text-slate-500 text-[9px] uppercase font-bold tracking-wider font-mono">Launch RPM</span>
                <span className="text-sm font-black text-amber-400 font-mono mt-0.5">
                  {(() => {
                    const isLoaded = deviceState === DeviceState.LOADED_READY || deviceState === DeviceState.SPINNING_LOADED;
                    if (isLoaded) return '--';
                    const launchVal = lastLaunchEvent?.launchRpm || activeRecord?.launchRpm;
                    return launchVal && launchVal > 0 ? launchVal.toLocaleString() : '--';
                  })()}
                </span>
              </div>
            </div>

            {/* 發射計時：位於兩個小方框下方，寬度與兩框合計相同 */}
            <div className="bg-[#0d0f14]/80 p-3.5 rounded-xl border border-slate-900 w-full mt-3 flex flex-col justify-between relative overflow-hidden group">
              <div className="flex items-center justify-between w-full mb-1">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider font-mono">
                    發射計時
                  </span>
                  {isSpinTiming && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between w-full mt-0.5">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-2xl font-black font-mono tracking-tight ${
                    isSpinTiming
                      ? 'text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                      : spinDurationMs > 0 || (activeRecord?.durationMs && activeRecord.durationMs > 0)
                      ? 'text-amber-400'
                      : 'text-slate-500'
                  }`}>
                    {(() => {
                      const isLoaded = stateFlags.loaded || deviceState === DeviceState.LOADED_READY || deviceState === DeviceState.SPINNING_LOADED;
                      if (isLoaded) {
                        return '00:00.00';
                      }
                      if (spinDurationMs > 0) {
                        return formatStopwatchTime(spinDurationMs);
                      }
                      if (activeRecord?.durationMs && activeRecord.durationMs > 0) {
                        return formatStopwatchTime(activeRecord.durationMs);
                      }
                      return '--:--.--';
                    })()}
                  </span>
                </div>

                {/* 右下角：計時中時顯示【停止】按鈕；非計時中時顯示狀態文字 */}
                <div className="flex items-center">
                  {isSpinTiming ? (
                    <button
                      type="button"
                      id="btn-box-stop-spin-timer"
                      onClick={handleStopSpinTimer}
                      title="按下停止鍵：停止計時並將旋轉時間儲存至曲線紀錄中"
                      className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/60 text-xs font-bold font-mono flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-md shadow-amber-950/40"
                    >
                      <Square className="w-2.5 h-2.5 fill-current text-amber-400" />
                      <span>停止</span>
                    </button>
                  ) : (() => {
                    const isLoaded = stateFlags.loaded || deviceState === DeviceState.LOADED_READY || deviceState === DeviceState.SPINNING_LOADED;
                    if (isLoaded) return <span className="text-[10px] font-mono text-emerald-400 font-bold">就緒</span>;
                    if (spinDurationMs > 0 || (activeRecord?.durationMs && activeRecord.durationMs > 0)) {
                      return <span className="text-[10px] font-mono text-amber-400 font-bold">已儲存時間</span>;
                    }
                    return <span className="text-[10px] font-mono text-slate-500">等待裝載</span>;
                  })()}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 頁尾 */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-[10px] text-slate-500 mt-8 font-mono tracking-wider">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-3">
          <span>© 2026 BRD TELEMETRY SYSTEM. ALL RIGHTS RESERVED.</span>
          <div className="flex gap-5">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
              RELIABLE PROTOCOL V4
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              CHARACTERISTIC 0002 NOTIFY
            </span>
          </div>
        </div>
      </footer>

      {/* 手機版專屬底部橫條 */}
      <aside
        id="brd-mobile-bottom-bar"
        aria-label="手機專屬底部操作列"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-slate-900 bg-[#07090e]/95 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.6)] px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      >
        <div className="max-w-md mx-auto grid grid-cols-2 gap-2">
          <button
            type="button"
            id="btn-mobile-bottom-history"
            onClick={() => setShowHistoryModal(true)}
            className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40 text-xs font-bold shadow-md active:scale-95 cursor-pointer transition-all"
          >
            <FileSpreadsheet className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>歷史</span>
            <span className="text-[10px] bg-cyan-950 text-cyan-300 font-mono px-1 py-0.2 rounded-full font-bold border border-cyan-800/60">
              {history.length}
            </span>
          </button>

          <button
            type="button"
            id="btn-mobile-bottom-logs"
            onClick={() => setShowLogsModal(true)}
            className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-slate-800 text-xs font-bold shadow-md active:scale-95 cursor-pointer transition-all"
          >
            <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>日誌</span>
          </button>
        </div>
      </aside>

      {/* 戰鬥歷史資料 Modal */}
      <HistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        history={history}
        activeRecord={activeRecord}
        onSelectRecord={(rec) => {
          setActiveRecord(rec);
          setIsLaunchedMode(true);
          setSpinDurationMs(rec.durationMs || (rec.samples.length > 0 ? rec.samples[rec.samples.length - 1].timeMs : 0));
          setIsSpinTiming(false);
          setShowHistoryModal(false);
          setToast({ message: `已載入【${rec.name}】至主畫面觀測`, type: 'info' });
        }}
        onRenameRecord={handleRenameRecord}
        onDeleteRecord={handleDeleteRecord}
        onClearAll={() => setShowClearConfirm(true)}
        onExport={handleExportHistory}
        onImport={handleImportHistory}
      />

      {/* 藍芽通訊日誌與診斷 Modal */}
      <LogsModal
        isOpen={showLogsModal}
        onClose={() => setShowLogsModal(false)}
        systemLogs={systemLogs}
        firmwareVersion={firmwareVersion}
        hasControlChar={!!bleControlCharacteristicRef.current}
        hasDiagnosticChar={!!bleDiagnosticCharacteristicRef.current}
        diagnosticInfo={diagnosticInfo}
        status={status}
        receivedSamplesCount={receivedSamplesCount}
        expectedSamplesCount={expectedSamplesCount}
        currentSessionId={currentSessionIdRef.current}
        onCopyLogs={() => {
          const text = systemLogs.map((l) => `[${l.time}] ${l.message}`).join('\n');
          navigator.clipboard.writeText(text);
          setToast({ message: '已複製通訊日誌到剪貼簿', type: 'info' });
        }}
        onClearLogs={() => {
          setSystemLogs([
            {
              id: `clear-${Date.now()}`,
              time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
              message: '日誌已手動清空',
            },
          ]);
          setToast({ message: '通訊日誌已清空', type: 'info' });
        }}
        onReadDiagnostic={readDiagnosticFromDevice}
        onRequestRetransmit={handleRequestRetransmit}
        onRequestA3Resend={handleRequestA3Resend}
        onAbortTransfer={handleAbortTransfer}
      />

      {/* 清除所有歷史紀錄之自訂彈窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-fadeIn pointer-events-auto">
          <div className="bg-slate-900 border border-slate-800/80 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-start gap-3.5 text-rose-400">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">確定要清空歷史紀錄嗎？</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  這項操作將會永久刪除本機瀏覽器中所儲存的所有戰鬥轉速數據與歷史紀錄（共 {history.length} 筆），且無法復原。
                </p>
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-3.5 mt-2 border-t border-slate-800/55 pt-4">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-4.5 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-950 border border-slate-800 rounded-xl cursor-pointer hover:bg-slate-900 transition-all active:scale-95"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveRecord(null);
                  saveHistoryToStorage([]);
                  setShowClearConfirm(false);
                  setToast({ message: '已成功清除所有歷史紀錄！', type: 'success' });
                }}
                className="px-4.5 py-2 text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-xl cursor-pointer transition-all active:scale-95 shadow-lg shadow-rose-500/20"
              >
                確認清空
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iPad / Web Bluetooth 相容性與設定導引 Modal */}
      <BleHelpModal
        isOpen={showBleHelpModal}
        onClose={() => setShowBleHelpModal(false)}
        onToast={(msg, type) => setToast({ message: msg, type })}
      />
    </div>
  );
}
