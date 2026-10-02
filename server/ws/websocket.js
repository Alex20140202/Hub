import { createHash, randomBytes } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

/** 计算握手响应头。key 不匹配返回 null。 */
export function acceptKey(key) {
  if (typeof key !== 'string' || !key) return null;
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** 编码一个服务端帧（不掩码）。 */
export function encodeFrame(payload, opcode = OP.TEXT) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const length = data.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, data]);
}

export const encodeClose = (code = 1000, reason = '') => {
  const body = Buffer.alloc(2 + Buffer.byteLength(reason));
  body.writeUInt16BE(code, 0);
  body.write(reason, 2);
  return encodeFrame(body, OP.CLOSE);
};

/**
 * 帧解码器：把 socket 数据流切成完整消息。
 * 客户端帧必须掩码，累积到完整帧后回调。
 */
export function createDecoder({ onMessage, onPing, onPong, onClose, onError, maxPayload = 256 * 1024 }) {
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let fragmentOpcode = null;

  return function push(chunk) {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;

    // 单次循环尽量消费完，避免大流量下反复拷贝
    for (;;) {
      if (buffer.length < 2) return;

      const first = buffer[0];
      const second = buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        const big = buffer.readBigUInt64BE(offset);
        if (big > BigInt(maxPayload)) {
          onError?.(new Error('消息过大'));
          return;
        }
        length = Number(big);
        offset += 8;
      }

      if (length > maxPayload) {
        onError?.(new Error('消息过大'));
        return;
      }

      let mask = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + length) return;

      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (mask) {
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      }
      buffer = buffer.subarray(offset + length);

      if (opcode === OP.CLOSE) {
        onClose?.(payload);
        return;
      }
      if (opcode === OP.PING) {
        onPing?.(payload);
        continue;
      }
      if (opcode === OP.PONG) {
        onPong?.(payload);
        continue;
      }

      if (opcode === OP.CONT) {
        fragments.push(payload);
      } else {
        fragments = [payload];
        fragmentOpcode = opcode;
      }

      if (!fin) continue;

      const full = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments);
      fragments = [];
      const op = fragmentOpcode;
      fragmentOpcode = null;
      if (op === OP.TEXT) onMessage?.(full.toString('utf8'), full);
      else if (op === OP.BINARY) onMessage?.(full, full);
    }
  };
}

export const newClientId = () => randomBytes(6).toString('hex');
export { OP };
