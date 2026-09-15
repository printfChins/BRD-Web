/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  SCANNING = 'SCANNING',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECEIVING = 'RECEIVING',
  ERROR = 'ERROR',
}

export enum AppMode {
  REAL = 'REAL',
  SIMULATOR = 'SIMULATOR',
}

/**
 * 韌體裝置狀態碼 (BRD Reliable BLE Protocol V4 / BRD_BLE_OLED V1.15)
 * 由 0xB1 LIVE 封包持續以 200ms 週期同步
 */
export enum DeviceState {
  WAIT_LOAD = 0,        // 等待裝載
  LOADED_READY = 1,     // 已裝載就緒
  SPINNING_LOADED = 2,  // 裝載中旋轉
  SPINNING_LAUNCHED = 3,// 已發射，持續量測
  RESULT_PENDING = 4,   // 結果待傳或傳送中 (含待 ACK)
}

/**
 * 0xB1 LIVE 狀態 Flag 解析結果 (BRD Reliable BLE Protocol V4)
 */
export interface TelemetryFlags {
  loaded: boolean;            // bit0: loaded (已裝載)
  measurementActive: boolean; // bit1: active / spinning
  launchMarkerValid: boolean; // bit2: launch valid
  resultPending: boolean;     // bit3: result pending
  charging: boolean;          // bit4: charging
  waitAck?: boolean;          // bit5: WAIT_ACK (等待 ACK 視窗中)
  curveWaitAck?: boolean;     // 相容別名
}

/**
 * 0xB1 LIVE 即時傳輸數據 (13 Bytes, Cadence: 200ms)
 * 涵蓋所有狀態之完整 State / Flags / RPM Snapshot
 */
export interface LiveTelemetry {
  state: DeviceState;
  flags: TelemetryFlags;
  currentRpm: number;
  maxRpm: number;
  launchRpm: number;
  elapsedMs: number;
  curveSampleCount: number;
}

/**
 * 0xB2 LAUNCH 發射事件數據
 */
export interface LaunchEvent {
  launchRpm: number;
  maxRpmAtLaunch: number;
  launchTimeMs: number;
  launchSampleIndex: number;
}

/**
 * 0xA1 CURVE_START 曲線摘要數據 (V1.11 Event Curve 20 Bytes)
 */
export interface CurveStartInfo {
  sampleCount: number;
  nominalSampleIntervalMs: number; // V1.11: 0 (Event Curve)
  durationMs: number;
  maxRpm: number;
  launchRpm: number;
  launchTimeMs: number;
  launchSampleIndex: number;
  launchMarkerValid: boolean;
  curveComplete?: boolean;    // V1.11 flags bit1: Curve Complete
  eventCurveFormat?: boolean; // V1.11 flags bit2: Event Curve Format
  allEvents?: boolean;        // 相容別名
  reliableTransfer?: boolean; // 相容別名
  maxTimeMs?: number;         // Byte 16-17 (uint16 LE) MAX RPM 發生的真實相對時間
  sessionId?: number;         // Byte 18-19 (uint16 LE) Session ID
}

/**
 * 0xA3 CURVE_END 數據
 */
export interface CurveEndInfo {
  sessionId?: number;
  totalPacketCount?: number;
  sampleCount?: number;
  curveCrc32?: number;
}

/**
 * 0xA4 TRANSFER_STATUS 狀態碼 (V1.11 官方標準)
 */
export enum TransferStatusCode {
  ACK_ACCEPTED = 0x00,
  RETRY_ACCEPTED = 0x01,
  RESTART_ACCEPTED = 0x02,
  ABORT_ACCEPTED = 0x03,
  SESSION_MISMATCH = 0x80,
  PACKET_INDEX_INVALID = 0x81,
  COMMAND_FORMAT_INVALID = 0x82,
  SAMPLE_COUNT_MISMATCH = 0x83,
  CRC_MISMATCH = 0x84,
  NO_RESULT = 0x85,
  ACK_WINDOW_INVALID = 0x86,
  // 舊版兼容別名
  COMMAND_LENGTH_ERROR = 0x82,
  ACK_SAMPLE_COUNT_MISMATCH = 0x83,
  ACK_CRC_MISMATCH = 0x84,
  BUSY = 0x86,
}

export interface TransferStatusInfo {
  sessionId: number;
  status: TransferStatusCode | number;
  statusName: string;
  detail: number;
  detailDescription?: string;
}

/**
 * 0005 Diagnostic TX State 狀態列舉
 */
export enum DiagnosticTxState {
  IDLE = 0,
  START = 1,
  DATA = 2,
  END = 3,
  WAIT_ACK = 4,
  DONE = 5,
  TIMEOUT = 6,
}

/**
 * 0005 Diagnostic 診斷資訊 (20 Bytes)
 */
export interface DiagnosticInfo {
  protocolVersion: number;       // Offset 0: 1
  txState: DiagnosticTxState;    // Offset 1: 0=IDLE, 1=START, 2=DATA, 3=END, 4=WAIT_ACK, 5=DONE, 6=TIMEOUT
  txStateName: string;
  flags: {
    resultReady: boolean;        // bit0: Result Ready
    curveTruncated: boolean;     // bit1: Curve Truncated
  };
  reliableMode: number;          // Offset 3: 1 (Always Enabled)
  currentResultSession: number;  // Offset 4..5 (uint16 LE)
  sampleCount: number;           // Offset 6..7 (uint16 LE)
  crc32: number;                 // Offset 8..11 (uint32 LE)
  durationMs: number;            // Offset 12..13 (uint16 LE)
  commandErrors: number;         // Offset 14..15 (uint16 LE)
  notifyFailures: number;        // Offset 16..17 (uint16 LE)
  ackTimeouts: number;           // Offset 18..19 (uint16 LE)
  readTime?: string;
}

export interface RpmSample {
  timeMs: number;
  rpm: number;
}

export interface SpinRecord {
  id: string;
  timestamp: string;
  name: string;
  maxRpm: number;
  avgRpm: number;
  durationMs: number;
  samples: RpmSample[];
  totalSamplesExpected?: number;
  maxTimeMs?: number; // MAX RPM 發生的真實相對時間 (ms)
  sessionId?: number;
  curveCrc32?: number;
  crcVerified?: boolean;
  // 發射點相關數據 (依 0xB2 或 0xA1)
  launchRpm?: number;
  launchTimeMs?: number;
  launchSampleIndex?: number;
  launchMarkerValid?: boolean;
}

export interface SimulatorPreset {
  name: string;
  description: string;
  initialRpm: number;
  decayRate: number; // Air resistance decay coefficient
  wobbleIntensity: number; // Vibration/wobble effect
  collisionCount: number; // Number of random collisions
  durationMs: number;
}

/**
 * Section 26: 完整 State Store 定義
 * BRD_BLE_OLED V1.13 / BRD Reliable BLE Protocol V2
 */
export interface BleStateStore {
  connectionState: ConnectionStatus;
  deviceState: DeviceState;
  stateFlags: {
    loaded: boolean;
    active: boolean;
    launchMarkerValid: boolean;
    resultPending: boolean;
    charging: boolean;
    waitAck: boolean;
  };
  stateSeq: number;
  lastStateSeq?: number;
  currentRPM: number;
  maxRPM: number;
  launchRPM: number;
  launchTimeMs: number;
  curveSession: number;
  curveSampleCount: number;
  curvePackets: number;
  curveCRC: number;
  firmwareVersion: string;
}


