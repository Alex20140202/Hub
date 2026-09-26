import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 256 * 1024;

const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

/**
 * 极简 WebSocket 连接：完成 HTTP 握手 + 帧编解码 + 心跳。
 * 事件：message(text), close, pong, error
 */
export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.open = true;
    this.isAlive = true;
    this.data = { user: null, room: 'lobby', nickname: '游客' };

    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOp = null;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._teardown());
    socket.on('error', (err) => {
      this.emit('error', err);
      this._teardown();
    });
    socket.on('timeout', () => this.close(1001, 'timeout'));
  }

  _teardown() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
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
    if (buf.length < 2) return null;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f;
    let offset = 2;

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

    let mask = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + length) return null;

    let payload = buf.subarray(offset, offset + length);
    if (mask) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
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
      case OP.CLOSE:
        this.close(1000, '');
        break;
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
        this._fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this._fragments);
          this._fragments = [];
          this._deliver(this._fragmentOp, full);
          this._fragmentOp = null;
        }
        break;
      default:
        this.close(1002, 'unknown opcode');
    }
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
      this.socket.write(Buffer.concat([header, payload]));
      return true;
    } catch {
      this._teardown();
      return false;
    }
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

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this._send(OP.CLOSE, payload);
    this.open = false;
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
    // 主动关闭也要触发 close 事件，保证上层能清理连接集合
    this.emit('close');
    this.removeAllListeners();
  }
}

/** 挂到已有 http.Server 的 upgrade 事件上 */
export function attachWebSocket(server, { path = '/ws', onConnection, verifyClient, onReady } = {}) {
  const clients = new Set();
  const log = (msg) => server.emit('ws:log', msg);
  onReady?.(clients);

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== path) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (upgrade !== 'websocket' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (verifyClient) {
      const ok = verifyClient(req, url);
      if (!ok) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
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
    clients.add(conn);
    conn.on('close', () => clients.delete(conn));
    if (head?.length) conn._onData(head);
    onConnection?.(conn, clients);
    log(`客户端接入，当前连接数 ${clients.size}`);
  });

  // 心跳
  const interval = setInterval(() => {
    for (const c of clients) {
      if (!c.isAlive) {
        c.close(1001, 'no pong');
        clients.delete(c);
        continue;
      }
      c.isAlive = false;
      c.ping();
    }
  }, 30_000);
  interval.unref?.();

  server.on('close', () => {
    clearInterval(interval);
    for (const c of clients) c.close(1001, 'server shutdown');
  });

  return clients;
}
