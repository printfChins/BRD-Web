/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  RpmSample,
  DeviceState,
  LiveTelemetry,
  LaunchEvent,
  CurveStartInfo,
  CurveEndInfo,
  TransferStatusInfo,
  TransferStatusCode,
  DiagnosticInfo,
  DiagnosticTxState,
} from '../types';

export const SERVICE_UUID = '7f510001-1b15-4d5f-9f4d-9b3c7a1d9a10';
export const DATA_CHAR_UUID = '7f510002-1b15-4d5f-9f4d-9b3c7a1d9a10';
export const CONTROL_CHAR_UUID = '7f510003-1b15-4d5f-9f4d-9b3c7a1d9a10';
export const FIRMWARE_CHAR_UUID = '7f510004-1b15-4d5f-9f4d-9b3c7a1d9a10';
export const DIAGNOSTIC_CHAR_UUID = '7f510005-1b15-4d5f-9f4d-9b3c7a1d9a10';

export interface ParseResult {
  type: 'LIVE' | 'LAUNCH' | 'START' | 'DATA' | 'END' | 'STATUS' | 'UNKNOWN';
  liveData?: LiveTelemetry;
  launchEvent?: LaunchEvent;
  curveStartInfo?: CurveStartInfo;
  curveEndInfo?: CurveEndInfo;
  transferStatus?: TransferStatusInfo;
  totalCount?: number;          // CURVE_START 封包解析出的總數量 (sample_count)
  sampleIntervalMs?: number;    // CURVE_START 封包解析出的取樣間隔 (sample_interval_ms = 0)
  durationMs?: number;          // CURVE_START 封包解析出的預期總時間 (duration_ms)
  packetIndex?: number;         // CURVE_DATA 封包序號
  samples?: RpmSample[];        // CURVE_DATA 封包解析出的多筆轉速樣本
  sampleCountInPacket?: number; // CURVE_DATA 封包中的樣本數
  error?: string;               // 封包解析階段的錯誤
}

/**
 * 計算曲線點的 IEEE CRC-32 (CRC-32/ISO-HDLC)
 * 依 sample 全域順序，每點依序輸入 4 Bytes (Little-endian):
 * 1. time_ms low byte
 * 2. time_ms high byte
 * 3. rpm low byte
 * 4. rpm high byte
 */
export function calculateCurveCrc32(samples: RpmSample[]): number {
  let crc = 0xFFFFFFFF;
  for (const s of samples) {
    const bytes = [
      s.timeMs & 0xFF,
      (s.timeMs >>> 8) & 0xFF,
      s.rpm & 0xFF,
      (s.rpm >>> 8) & 0xFF,
    ];
    for (const b of bytes) {
      crc = (crc ^ b) >>> 0;
      for (let i = 0; i < 8; i++) {
        crc = ((crc & 1) !== 0)
          ? ((crc >>> 1) ^ 0xEDB88320) >>> 0
          : (crc >>> 1) >>> 0;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 解析從 BLE 裝置接收到的二進位封包。
 * 遵循 Little-endian 格式讀取：value = data[offset] | (data[offset + 1] << 8)。
 * 
 * BLE_RPM_V1.9 RELIABLE CURVE Packet Types:
 * - 0xB1: LIVE (13 bytes)
 * - 0xB2: LAUNCH (9 bytes)
 * - 0xA1: CURVE_START_V2 (20 bytes V1.9 / 18 bytes / 16 bytes)
 * - 0xA2: CURVE_DATA_V2 (4 + N * 4 bytes, N = 1~4)
 * - 0xA3: CURVE_END_V2 (11 bytes V1.9 / 1 byte)
 * - 0xA4: TRANSFER_STATUS (6 bytes)
 * 
 * @param data 接收到的原始資料，支援 DataView (實體 BLE) 或 Uint8Array
 * @returns 解析結果物件
 */
export function parseBlePacket(data: DataView | Uint8Array): ParseResult {
  let view: DataView;
  if (data instanceof Uint8Array) {
    view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  } else {
    view = data;
  }

  // 封包長度檢查
  if (view.byteLength < 1) {
    return { type: 'UNKNOWN', error: '封包長度為 0' };
  }

  const packetType = view.getUint8(0);

  switch (packetType) {
    // ----------------------------------------------------
    // 0xB1: LIVE 即時數據封包 (13 Bytes)
    // ----------------------------------------------------
    case 0xB1: {
      if (view.byteLength !== 13) {
        return {
          type: 'LIVE',
          error: `0xB1 LIVE 封包長度錯誤，預期 13 位元組，實際為 ${view.byteLength} 位元組`,
        };
      }

      const rawState = view.getUint8(1);
      const state: DeviceState = rawState <= 4 ? rawState : DeviceState.WAIT_LOAD;
      const flagsRaw = view.getUint8(2);

      const flags = {
        loaded: (flagsRaw & 0x01) !== 0,
        measurementActive: (flagsRaw & 0x02) !== 0,
        launchMarkerValid: (flagsRaw & 0x04) !== 0,
        resultPending: (flagsRaw & 0x08) !== 0,
        charging: (flagsRaw & 0x10) !== 0,
        curveWaitAck: (flagsRaw & 0x20) !== 0,
      };

      const currentRpm = view.getUint16(3, true);
      const maxRpm = view.getUint16(5, true);
      const launchRpm = view.getUint16(7, true);
      const elapsedMs = view.getUint16(9, true);
      const curveSampleCount = view.getUint16(11, true);

      const liveData: LiveTelemetry = {
        state,
        flags,
        currentRpm,
        maxRpm,
        launchRpm,
        elapsedMs,
        curveSampleCount,
      };

      return {
        type: 'LIVE',
        liveData,
      };
    }

    // ----------------------------------------------------
    // 0xB2: LAUNCH 發射事件封包 (9 Bytes)
    // ----------------------------------------------------
    case 0xB2: {
      if (view.byteLength !== 9) {
        return {
          type: 'LAUNCH',
          error: `0xB2 LAUNCH 封包長度錯誤，預期 9 位元組，實際為 ${view.byteLength} 位元組`,
        };
      }

      const launchRpm = view.getUint16(1, true);
      const maxRpmAtLaunch = view.getUint16(3, true);
      const launchTimeMs = view.getUint16(5, true);
      const launchSampleIndex = view.getUint16(7, true);

      const launchEvent: LaunchEvent = {
        launchRpm,
        maxRpmAtLaunch,
        launchTimeMs,
        launchSampleIndex,
      };

      return {
        type: 'LAUNCH',
        launchEvent,
      };
    }

    // ----------------------------------------------------
    // 0xA1: CURVE_START 曲線摘要 (V1.9 20 Bytes / V1.7 18 Bytes / 16 Bytes)
    // ----------------------------------------------------
    case 0xA1: {
      if (view.byteLength !== 20 && view.byteLength !== 18 && view.byteLength !== 16) {
        return {
          type: 'START',
          error: `0xA1 CURVE_START 封包長度錯誤，預期 20 位元組 (相容 18/16 位元組)，實際為 ${view.byteLength} 位元組`,
        };
      }

      const sampleCount = view.getUint16(1, true);
      const nominalSampleIntervalMs = view.getUint16(3, true);
      const durationMs = view.getUint16(5, true);
      const maxRpm = view.getUint16(7, true);
      const launchRpm = view.getUint16(9, true);
      const launchTimeMs = view.getUint16(11, true);
      const launchSampleIndex = view.getUint16(13, true);
      const flagsRaw = view.getUint8(15);
      const launchMarkerValid = (flagsRaw & 0x01) !== 0;
      const curveComplete = (flagsRaw & 0x02) !== 0; // V1.11 Flags bit1: Curve Complete
      const eventCurveFormat = (flagsRaw & 0x04) !== 0; // V1.11 Flags bit2: Event Curve Format

      let maxTimeMs: number | undefined = undefined;
      if (view.byteLength >= 18) {
        maxTimeMs = view.getUint16(16, true);
      }

      let sessionId: number | undefined = undefined;
      if (view.byteLength >= 20) {
        sessionId = view.getUint16(18, true);
      }

      const curveStartInfo: CurveStartInfo = {
        sampleCount,
        nominalSampleIntervalMs,
        durationMs,
        maxRpm,
        launchRpm,
        launchTimeMs,
        launchSampleIndex,
        launchMarkerValid,
        curveComplete,
        eventCurveFormat,
        allEvents: curveComplete,
        reliableTransfer: eventCurveFormat,
        maxTimeMs,
        sessionId,
      };

      return {
        type: 'START',
        curveStartInfo,
        totalCount: sampleCount,
        sampleIntervalMs: nominalSampleIntervalMs,
        durationMs,
      };
    }

    // ----------------------------------------------------
    // 0xA2: CURVE_DATA 曲線資料封包 (V1.9: 4 + N * 4 Bytes, N = 1~4)
    // ----------------------------------------------------
    case 0xA2: {
      if (view.byteLength < 2) {
        return {
          type: 'DATA',
          error: '0xA2 CURVE_DATA 封包長度不足',
        };
      }

      const sampleCount = view.getUint8(1);
      
      if (sampleCount < 1 || sampleCount > 4) {
        return {
          type: 'DATA',
          error: `0xA2 CURVE_DATA 封包內的樣本數 (${sampleCount}) 必須在 1 到 4 之間`,
        };
      }

      // 檢查是否為 V1.9 格式 (4 + sampleCount * 4) 或 V1.7 格式 (2 + sampleCount * 4)
      const isV19 = view.byteLength === 4 + sampleCount * 4;
      const isV17 = view.byteLength === 2 + sampleCount * 4;

      if (!isV19 && !isV17) {
        return {
          type: 'DATA',
          error: `0xA2 CURVE_DATA 封包長度錯誤，實際為 ${view.byteLength} 位元組`,
        };
      }

      let packetIndex = 0;
      let offset = 2;

      if (isV19) {
        packetIndex = view.getUint16(2, true);
        offset = 4;
      }

      const samples: RpmSample[] = [];

      for (let i = 0; i < sampleCount; i++) {
        const sampleOffset = offset + i * 4;
        const timeMs = view.getUint16(sampleOffset, true);
        const rpm = view.getUint16(sampleOffset + 2, true);
        samples.push({ timeMs, rpm });
      }

      return {
        type: 'DATA',
        packetIndex,
        sampleCountInPacket: sampleCount,
        samples,
      };
    }

    // ----------------------------------------------------
    // 0xA3: CURVE_END 曲線結束封包 (V1.9: 11 Bytes, V1.7: 1 Byte)
    // ----------------------------------------------------
    case 0xA3: {
      if (view.byteLength !== 11 && view.byteLength !== 1) {
        return {
          type: 'END',
          error: `0xA3 CURVE_END 封包長度錯誤，預期 11 位元組 (相容舊版 1 位元組)，實際為 ${view.byteLength} 位元組`,
        };
      }

      let curveEndInfo: CurveEndInfo | undefined = undefined;
      if (view.byteLength >= 11) {
        const sessionId = view.getUint16(1, true);
        const totalPacketCount = view.getUint16(3, true);
        const sampleCount = view.getUint16(5, true);
        const curveCrc32 = view.getUint32(7, true);
        curveEndInfo = {
          sessionId,
          totalPacketCount,
          sampleCount,
          curveCrc32,
        };
      }

      return {
        type: 'END',
        curveEndInfo,
      };
    }

    // ----------------------------------------------------
    // 0xA4: TRANSFER_STATUS 狀態通知 (6 Bytes) - BRD V1.11
    // ----------------------------------------------------
    case 0xA4: {
      if (view.byteLength !== 6) {
        return {
          type: 'STATUS',
          error: `0xA4 TRANSFER_STATUS 封包長度錯誤，預期 6 位元組，實際為 ${view.byteLength} 位元組`,
        };
      }

      const sessionId = view.getUint16(1, true);
      const status = view.getUint8(3);
      const detail = view.getUint16(4, true);

      const statusMap: Record<number, string> = {
        0x00: 'ACK_ACCEPTED',
        0x01: 'RETRY_ACCEPTED',
        0x02: 'RESTART_ACCEPTED',
        0x03: 'ABORT_ACCEPTED',
        0x80: 'SESSION_MISMATCH',
        0x81: 'PACKET_INDEX_INVALID',
        0x82: 'COMMAND_FORMAT_INVALID',
        0x83: 'SAMPLE_COUNT_MISMATCH',
        0x84: 'CRC_MISMATCH',
        0x85: 'NO_RESULT',
        0x86: 'ACK_WINDOW_INVALID',
      };

      const detailDescriptions: Record<number, (d: number) => string> = {
        0x00: () => 'ACK 已被接受並確認，曲線結果接收完畢',
        0x01: (d) => `接受選擇性重傳，即將重送 ${d} 個 A2 封包`,
        0x02: (d) => `接受完整重傳，總封包數 ${d}`,
        0x03: () => '已接受中斷 (Abort)，已清除 RAM 暫存曲線',
        0x80: (d) => `Session 不符 (裝置目前 Session 為 #${d})`,
        0x81: (d) => `無效封包索引 (封包號: ${d})`,
        0x82: (d) => `命令格式長度錯誤 (收到的 Command 長度: ${d} 位元組)`,
        0x83: (d) => `樣本數量不符 (裝置正確 Sample 數: ${d} 筆)`,
        0x84: () => 'CRC32 校驗不符，請使用 C3 重新請求完整重傳',
        0x85: () => '目前無可讀取的量測結果',
        0x86: () => 'ACK 時間窗口無效或已逾時 (> 5秒)',
      };

      const statusName = statusMap[status] || `UNKNOWN_0x${status.toString(16).toUpperCase()}`;
      const detailDescription = detailDescriptions[status]
        ? detailDescriptions[status](detail)
        : `Detail=${detail}`;

      const transferStatus: TransferStatusInfo = {
        sessionId,
        status,
        statusName,
        detail,
        detailDescription,
      };

      return {
        type: 'STATUS',
        transferStatus,
      };
    }

    default:
      return {
        type: 'UNKNOWN',
        error: `未知的二進位封包類型: 0x${packetType.toString(16).toUpperCase()}`,
      };
  }
}

/**
 * 0005 Diagnostic API 特徵值解析 (20 Bytes)
 * 適用 BRD Reliable BLE Protocol V4 (BRD_BLE_OLED V1.15)
 */
export function parseDiagnosticPacket(data: DataView | Uint8Array): DiagnosticInfo {
  let view: DataView;
  if (data instanceof Uint8Array) {
    view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  } else {
    view = data;
  }

  if (view.byteLength < 20) {
    throw new Error(`0005 Diagnostic 封包長度錯誤，預期 20 位元組，實際為 ${view.byteLength} 位元組`);
  }

  const protocolVersion = view.getUint8(0);
  const txState = view.getUint8(1) as DiagnosticTxState;
  const flagsRaw = view.getUint8(2);
  const reliableMode = view.getUint8(3);
  const currentResultSession = view.getUint16(4, true);
  const sampleCount = view.getUint16(6, true);
  const crc32 = view.getUint32(8, true);
  const durationMs = view.getUint16(12, true);
  const commandErrors = view.getUint16(14, true);
  const notifyFailures = view.getUint16(16, true);
  const ackTimeouts = view.getUint16(18, true);

  const txStateLabels: Record<number, string> = {
    0: 'IDLE (空閒)',
    1: 'START (開始)',
    2: 'DATA (傳送數據)',
    3: 'END (傳送結束)',
    4: 'WAIT_ACK (等待ACK)',
    5: 'DONE (完成)',
    6: 'TIMEOUT (逾時)',
  };

  return {
    protocolVersion,
    txState,
    txStateName: txStateLabels[txState] || `UNKNOWN(${txState})`,
    flags: {
      resultReady: (flagsRaw & 0x01) !== 0,
      curveTruncated: (flagsRaw & 0x02) !== 0,
    },
    reliableMode,
    currentResultSession,
    sampleCount,
    crc32,
    durationMs,
    commandErrors,
    notifyFailures,
    ackTimeouts,
    readTime: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
  };
}

// ----------------------------------------------------
// APP -> 裝置指令建構 Helper (Control Characteristic Write with response)
// ----------------------------------------------------

/**
 * 0xC1 ACK (9 Bytes)
 */
export function buildC1Ack(
  sessionId: number,
  receivedSampleCount: number,
  calculatedCurveCrc32: number
): Uint8Array {
  const buf = new Uint8Array(9);
  buf[0] = 0xC1;
  const view = new DataView(buf.buffer);
  view.setUint16(1, sessionId, true);
  view.setUint16(3, receivedSampleCount, true);
  view.setUint32(5, calculatedCurveCrc32, true);
  return buf;
}

/**
 * 0xC2 Selective Retransmission (4 + 2 * Count Bytes)
 * Count: 0 ~ 8
 * 特別說明：Count = 0 表示只重新要求送 A3 END，不重新送 A2。
 */
export function buildC2Retry(
  sessionId: number,
  missingIndexes: number[] = []
): Uint8Array {
  const count = Math.min(missingIndexes.length, 8);
  const buf = new Uint8Array(4 + count * 2);
  buf[0] = 0xC2;
  const view = new DataView(buf.buffer);
  view.setUint16(1, sessionId, true);
  view.setUint8(3, count);
  for (let i = 0; i < count; i++) {
    view.setUint16(4 + i * 2, missingIndexes[i], true);
  }
  return buf;
}

/**
 * 0xC3 RESTART_FULL_TRANSFER (3 Bytes)
 */
export function buildC3Restart(sessionId: number = 0xFFFF): Uint8Array {
  const buf = new Uint8Array(3);
  buf[0] = 0xC3;
  const view = new DataView(buf.buffer);
  view.setUint16(1, sessionId, true);
  return buf;
}

/**
 * 0xC4 ABORT_RESULT (3 Bytes)
 */
export function buildC4Abort(sessionId: number): Uint8Array {
  const buf = new Uint8Array(3);
  buf[0] = 0xC4;
  const view = new DataView(buf.buffer);
  view.setUint16(1, sessionId, true);
  return buf;
}

// ----------------------------------------------------
// 模擬封包產生工具 Helper
// ----------------------------------------------------

export function buildLivePacket(
  state: DeviceState,
  loaded: boolean,
  currentRpm: number,
  maxRpm: number,
  launchRpm: number = 0,
  elapsedMs: number = 0,
  curveWaitAck: boolean = false
): Uint8Array {
  const buf = new Uint8Array(13);
  buf[0] = 0xB1; // LIVE header
  buf[1] = state;
  buf[2] = (loaded ? 0x01 : 0x00) | 0x02 | (curveWaitAck ? 0x20 : 0x00);
  const view = new DataView(buf.buffer);
  view.setUint16(3, currentRpm, true);
  view.setUint16(5, maxRpm, true);
  view.setUint16(7, launchRpm, true);
  view.setUint16(9, elapsedMs, true);
  view.setUint16(11, 0, true);
  return buf;
}

export function buildLaunchPacket(
  launchRpm: number,
  maxRpmAtLaunch: number,
  launchTimeMs: number,
  launchSampleIndex: number = 0xFFFF
): Uint8Array {
  const buf = new Uint8Array(9);
  buf[0] = 0xB2; // LAUNCH header
  const view = new DataView(buf.buffer);
  view.setUint16(1, launchRpm, true);
  view.setUint16(3, maxRpmAtLaunch, true);
  view.setUint16(5, launchTimeMs, true);
  view.setUint16(7, launchSampleIndex, true);
  return buf;
}

export function buildStartPacket(
  sampleCount: number,
  intervalMs: number = 0,
  durationMs: number = 1000,
  maxRpm: number = 8000,
  launchRpm: number = 7500,
  launchTimeMs: number = 100,
  launchSampleIndex: number = 2,
  maxTimeMs: number = 80,
  sessionId: number = 1
): Uint8Array {
  const buf = new Uint8Array(20);
  buf[0] = 0xA1; // START header
  const view = new DataView(buf.buffer);
  view.setUint16(1, sampleCount, true);
  view.setUint16(3, intervalMs, true); // V1.9: 固定為 0
  view.setUint16(5, durationMs, true);
  view.setUint16(7, maxRpm, true);
  view.setUint16(9, launchRpm, true);
  view.setUint16(11, launchTimeMs, true);
  view.setUint16(13, launchSampleIndex, true);
  buf[15] = 0x07; // flags: Bit 0 launch_valid (1), Bit 1 all_events (1), Bit 2 reliable_transfer (1)
  view.setUint16(16, maxTimeMs, true);
  view.setUint16(18, sessionId, true);
  return buf;
}

export function buildDataPacket(
  packetIndex: number,
  samples: RpmSample[]
): Uint8Array {
  const byteLength = 4 + samples.length * 4;
  const buf = new Uint8Array(byteLength);
  buf[0] = 0xA2; // DATA header
  buf[1] = samples.length;
  const view = new DataView(buf.buffer);
  view.setUint16(2, packetIndex, true);

  samples.forEach((sample, idx) => {
    const offset = 4 + idx * 4;
    view.setUint16(offset, sample.timeMs, true);
    view.setUint16(offset + 2, sample.rpm, true);
  });

  return buf;
}

export function buildEndPacket(
  sessionId: number = 1,
  totalPacketCount: number = 1,
  sampleCount: number = 1,
  curveCrc32: number = 0
): Uint8Array {
  const buf = new Uint8Array(11);
  buf[0] = 0xA3; // END header
  const view = new DataView(buf.buffer);
  view.setUint16(1, sessionId, true);
  view.setUint16(3, totalPacketCount, true);
  view.setUint16(5, sampleCount, true);
  view.setUint32(7, curveCrc32, true);
  return buf;
}

export function buildTransferStatusPacket(
  sessionId: number,
  status: TransferStatusCode,
  detail: number = 0
): Uint8Array {
  const buf = new Uint8Array(6);
  buf[0] = 0xA4;
  const view = new DataView(buf.buffer);
  view.setUint16(1, sessionId, true);
  view.setUint8(3, status);
  view.setUint16(4, detail, true);
  return buf;
}

/**
 * 0x81 STATE 封包產生工具 (5 Bytes, Characteristic 0006)
 */
export function buildStatePacket(
  state: DeviceState,
  flags: {
    loaded?: boolean;
    active?: boolean;
    launchMarkerValid?: boolean;
    resultPending?: boolean;
    charging?: boolean;
    waitAck?: boolean;
  } = {},
  stateSequence: number = 0
): Uint8Array {
  const buf = new Uint8Array(5);
  buf[0] = 0x81; // STATE header
  buf[1] = state & 0xFF;

  let flagsRaw = 0;
  if (flags.loaded) flagsRaw |= 0x01;
  if (flags.active) flagsRaw |= 0x02;
  if (flags.launchMarkerValid) flagsRaw |= 0x04;
  if (flags.resultPending) flagsRaw |= 0x08;
  if (flags.charging) flagsRaw |= 0x10;
  if (flags.waitAck) flagsRaw |= 0x20;
  buf[2] = flagsRaw;

  const view = new DataView(buf.buffer);
  view.setUint16(3, stateSequence & 0xFFFF, true);
  return buf;
}

