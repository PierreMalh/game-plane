'use strict';
// Mini implémentation WebSocket (RFC 6455) sans dépendance : poignée de main
// HTTP Upgrade + trames texte, ping/pong, fermeture. Suffisant pour un jeu
// local ; pas de compression ni de sous-protocoles.

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024; // au-delà, on coupe la connexion

const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

// Construit une trame serveur → client (jamais masquée).
function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

class WebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.closed = false;
    this.isAlive = true;

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
  }

  send(text) {
    if (this.closed) return;
    this.socket.write(encodeFrame(OP.TEXT, Buffer.from(text, 'utf8')));
  }

  ping() {
    if (this.closed) return;
    this.socket.write(encodeFrame(OP.PING, Buffer.alloc(0)));
  }

  close(code = 1000) {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this.socket.write(encodeFrame(OP.CLOSE, payload));
    this.socket.end();
    this._finish();
  }

  terminate() {
    this.socket.destroy();
    this._finish();
  }

  _finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // Plusieurs trames peuvent arriver d'un coup : on les consomme toutes.
    while (!this.closed && this._readFrame()) { /* boucle */ }
  }

  // Lit une trame complète au début du tampon ; renvoie false s'il en manque.
  _readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return false;

    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < 4) return false;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return false;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(MAX_PAYLOAD)) return this._fail(1009);
      len = Number(big);
      offset = 10;
    }

    // Le protocole impose que les clients masquent leurs trames.
    if (!masked) return this._fail(1002);
    if (len > MAX_PAYLOAD) return this._fail(1009);
    if (buf.length < offset + 4 + len) return false;

    const mask = buf.subarray(offset, offset + 4);
    const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + len));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buffer = buf.subarray(offset + 4 + len);

    this._handleFrame(fin, opcode, payload);
    return true;
  }

  _fail(code) {
    this.close(code);
    return false;
  }

  _handleFrame(fin, opcode, payload) {
    switch (opcode) {
      case OP.PING:
        this.socket.write(encodeFrame(OP.PONG, payload));
        return;
      case OP.PONG:
        this.isAlive = true;
        return;
      case OP.CLOSE:
        this.close(1000);
        return;
      case OP.TEXT:
      case OP.BINARY:
        this.fragmentOpcode = opcode;
        this.fragments = [payload];
        break;
      case OP.CONT:
        if (this.fragmentOpcode === null) return this._fail(1002);
        this.fragments.push(payload);
        break;
      default:
        return this._fail(1002);
    }

    if (!fin) return;
    const message = Buffer.concat(this.fragments);
    const wasText = this.fragmentOpcode === OP.TEXT;
    this.fragments = [];
    this.fragmentOpcode = null;
    if (wasText) this.emit('message', message.toString('utf8'));
  }
}

// Gère un événement 'upgrade' du serveur HTTP ; renvoie la connexion ou null.
function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const isWs = (req.headers.upgrade || '').toLowerCase() === 'websocket';
  if (!key || !isWs) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  return new WebSocketConnection(socket);
}

module.exports = { acceptUpgrade, WebSocketConnection };
