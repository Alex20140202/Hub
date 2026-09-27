import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 256 * 1024;
// 分片消息最多允许的帧数，防止恶意客户端不发 FIN 无限累积内存
const MAX_FRAGMENTS = 64;
const MAX_BUFFER = 1024 * 1024;

const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

/**
 * 极简 WebSocket 连接：完成 HTTP 握手 + 帧编解码 + 心跳。
 * 事件：message(text), binary, close({code, reason, remote}), pong, error
 */
export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.open = true;
    this.isAlive = true;
    this.data = { user: null, room: 'lobby', nickname: '游客' };
    this.id = crypto.randomBytes(6).toString('hex');
    this.closeInfo = null;

    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOp = null;
    this._writable = true;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('drain', () => {
      this._writable = true;
    });
    socket.on('close', () => this._teardown());
    socket.on('end', () => this._teardown());
    socket.on('error', (err) => {
      this.emit('error', err);
      this._teardown();
    });
  }

  get remoteAddress() {
    const fwd = String(this.req?.headers?.['x-forwarded-for'] || '');
    if (fwd) return fwd.split(',')[0].trim();
    return this.socket.remoteAddress || 'unknown';
  }

  _teardown() {
    if (!this.open) return;
    this.open = false;
    this.emit('close', { code: this.closeInfo?.code ?? 1006, reason: this.closeInfo?.reason ?? '', remote: true });
    this.removeAllListeners();
  }

  _onData(chunk) {
    this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const frame = this._readFrame();
      if (!frame) break;
      this._handleFrame(frame);
      if (!this.open) break;
    }
  }

  _readFrame() {
    const buf = this._buffer;
    // 单连接未消费缓冲上限，避免读速远高于处理速时无限增长
    if (buf.length > MAX_BUFFER) {
      this.close(1009, 'buffer overflow');
      return null;
    }
    if (buf.length < 2) return null;
    const b0 = buf[0];
    const b1 = buf[1];
    const rsv = b0 & 0x70;
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f;
    let offset = 2;

    // 未协商扩展，RSV 位必须为 0
    if (rsv !== 0) {
      this.close(1002, 'rsv bits set');
      return null;
    }
    // RFC 6455：客户端发往服务端的帧必须掩码
    if (!masked) {
      this.close(1002, 'unmasked frame');
      return null;
    }
    // 控制帧必须 FIN 且长度 <= 125
    if (opcode >= 0x8 && (!fin || length > 125)) {
      this.close(1002, 'bad control frame');
      return null;
    }
    // 保留操作码
    if ([0x3, 0x4, 0x5, 0x6, 0x7, 0xb, 0xc, 0xd, 0xe, 0xf].includes(opcode)) {
      this.close(1002, 'reserved opcode');
      return null;
    }

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_PAYLOAD)) {
        this.close(1009, 'payload too large');
        return null;
      }
      length = Number(big);
      offset += 8;
    }
    if (length > MAX_PAYLOAD) {
      this.close(1009, 'payload too large');
      return null;
    }

    if (buf.length < offset + 4) return null;
    const mask = buf.subarray(offset, offset + 4);
    offset += 4;
    if (buf.length < offset + length) return null;

    let payload = buf.subarray(offset, offset + length);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this._buffer = buf.subarray(offset + length);
    return { fin, opcode, payload };
  }

  _handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case OP.PING:
        this._send(OP.PONG, payload);
        break;
      case OP.PONG:
        this.isAlive = true;
        this.emit('pong');
        break;
      case OP.CLOSE: {
        // 对端可能不带状态码（空 payload）。此时按「无状态码」处理，
        // 回一个 1000 正常关闭：1005/1006 是保留码，绝不能写进线上的 close 帧，
        // 否则浏览器会报 "broken close frame containing a reserved status code"。
        let code = 1000;
        let reason = '';
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        }
        // 1005/1006/1015 与未分配区间都不能出现在 close 帧里
        if (code === 1005 || code === 1006 || code === 1015 || (code >= 1016 && code <= 2999)) code = 1000;
        this.close(code, reason, true);
        break;
      }
      case OP.TEXT:
      case OP.BINARY:
        if (fin) {
          this._deliver(opcode, payload);
        } else {
          this._fragmentOp = opcode;
          this._fragments = [payload];
        }
        break;
      case OP.CONT:
        // 没有起始分片就收到 CONT：丢弃状态并要求重连
        if (this._fragmentOp === null) {
          this.close(1002, 'unexpected continuation');
          return;
        }
        this._fragments.push(payload);
        // 分片数量与累计长度都受限，避免无限累积
        if (this._fragments.length > MAX_FRAGMENTS || this._fragmentSize() > MAX_PAYLOAD) {
          this._fragments = [];
          this._fragmentOp = null;
          this.close(1009, 'too many fragments');
          return;
        }
        if (fin) {
          const full = Buffer.concat(this._fragments);
          const op = this._fragmentOp;
          this._fragments = [];
          this._fragmentOp = null;
          this._deliver(op, full);
        }
        break;
      default:
        this.close(1002, 'unknown opcode');
    }
  }

  _fragmentSize() {
    return this._fragments.reduce((n, b) => n + b.length, 0);
  }

  _deliver(opcode, payload) {
    if (opcode === OP.TEXT) {
      const text = payload.toString('utf8');
      this.isAlive = true;
      this.emit('message', text);
    } else {
      this.emit('binary', payload);
    }
  }

  _send(opcode, data) {
    if (!this.open || this.socket.destroyed) return false;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      const ok = this.socket.write(Buffer.concat([header, payload]));
      // 背压：写缓冲超过阈值时标记，由上层决定丢消息还是断连
      this._writable = this.socket.writableLength < 1024 * 1024;
      return ok;
    } catch {
      this._teardown();
      return false;
    }
  }

  /** 对端写缓冲是否还在健康范围内 */
  get writable() {
    return this._writable && !this.socket.destroyed && this.socket.writableLength < 4 * 1024 * 1024;
  }

  send(text) {
    return this._send(OP.TEXT, text);
  }

  sendJSON(obj) {
    return this.send(JSON.stringify(obj));
  }

  ping() {
    return this._send(OP.PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = '', remote = false) {
    if (!this.open) return;
    // RFC 6455 §7.4.1：1004/1005/1006/1015 与 1016-2999 是保留码，
    // 写进 close 帧会让浏览器直接判定为协议错误。
    const reserved =
      !Number.isInteger(code) || code < 1000 || code > 4999 || (code >= 1004 && code <= 1006) || (code >= 1015 && code <= 2999);
    if (reserved) code = 1000;
    this.closeInfo = { code, reason };
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this._send(OP.CLOSE, body);
    this.open = false;
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
    // 主动关闭也要触发 close 事件，保证上层能清理连接集合
    this.emit('close', { code, reason, remote });
    this.removeAllListeners();
  }
}

/** 挂到已有 http.Server 的 upgrade 事件上 */
export function attachWebSocket(server, { path = '/ws', onConnection, verifyClient, onReady, heartbeatMs = 25_000, maxTotal = 500, maxPerIp = 6 } = {}) {
  const clients = new Set();
  const log = (msg) => server.emit('ws:log', msg);
  onReady?.(clients);

  const ipCount = new Map();
  const countPerIp = (ip) => ipCount.get(ip) || 0;
  const bumpIp = (ip, delta) => {
    const next = countPerIp(ip) + delta;
    if (next <= 0) ipCount.delete(ip);
    else ipCount.set(ip, next);
  };
  const releaseIp = (conn) => {
    if (conn._ipCounted) {
      bumpIp(conn._ipAddress, -1);
      conn._ipCounted = false;
    }
  };

  const reject = (socket, status, message) => {
    const body = `${message}\n`;
    socket.write(
      `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    // 与 HTTP 层相同的空闲超时，防止半开连接堆积
    socket.setTimeout(120_000, () => socket.destroy());

    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return reject(socket, '400 Bad Request', 'Bad Request');
    }
    if (url.pathname !== path) return reject(socket, '404 Not Found', 'Not Found');
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (upgrade !== 'websocket' || !key) return reject(socket, '400 Bad Request', 'Bad Request');
    // 握手响应必须与客户端请求的版本一致
    if (String(req.headers['sec-websocket-version'] || '') !== '13') {
      return reject(socket, '426 Upgrade Required', 'Upgrade Required');
    }

    if (maxTotal > 0 && clients.size >= maxTotal) {
      return reject(socket, '503 Service Unavailable', 'Server Full');
    }
    const ip = String(
      String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || socket.remoteAddress || 'unknown',
    );
    if (maxPerIp > 0 && countPerIp(ip) >= maxPerIp) {
      return reject(socket, '429 Too Many Requests', 'Too Many Connections');
    }

    if (verifyClient) {
      const ok = verifyClient(req, url);
      if (!ok) return reject(socket, '401 Unauthorized', 'Unauthorized');
    }

    const accept = crypto
      .createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    socket.setNoDelay(true);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const conn = new WsConnection(socket, req);
    conn.query = url.searchParams;
    conn._ipAddress = ip;
    conn._ipCounted = true;
    bumpIp(ip, 1);
    clients.add(conn);
    const drop = () => {
      clients.delete(conn);
      releaseIp(conn);
    };
    conn.on('close', drop);
    if (head?.length) conn._onData(head);
    onConnection?.(conn, clients);
    log(`客户端接入，当前连接数 ${clients.size}`);
  });

  // 心跳：先 ping，超时未回 pong 的连接直接断开
  const interval = setInterval(() => {
    for (const c of clients) {
      if (!c.open) {
        clients.delete(c);
        releaseIp(c);
        continue;
      }
      if (!c.isAlive) {
        c.close(1001, 'no pong');
        clients.delete(c);
        releaseIp(c);
        continue;
      }
      c.isAlive = false;
      c.ping();
    }
  }, heartbeatMs);
  interval.unref?.();

  server.on('close', () => {
    clearInterval(interval);
    for (const c of clients) c.close(1001, 'server shutdown');
    clients.clear();
    ipCount.clear();
  });

  return clients;
}
