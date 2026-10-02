'use strict';
// Serveur game-plane : sert la page (public/) et relaie un salon unique par
// WebSocket. Zéro dépendance, pensé pour tourner sous Termux sans internet.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { acceptUpgrade } = require('./ws');
const { createChat } = require('./chat');
const { createTables } = require('./tables');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_NAME = 20;
const HEARTBEAT_MS = 15000;
const OFFLINE_TTL_MS = 5 * 60 * 1000; // un joueur déconnecté garde sa place 5 min

function createApp({ offlineTtlMs = OFFLINE_TTL_MS, heartbeatMs = HEARTBEAT_MS } = {}) {
  // id → { id, name, conn|null, lastSeen }
  const players = new Map();
  const chat = createChat({ players });
  const tables = createTables({ players, chat, broadcast: (m) => broadcast(m) });

  const publicPlayers = () =>
    [...players.values()].map((p) => ({ id: p.id, name: p.name, online: !!p.conn }));

  function broadcast(message) {
    const text = JSON.stringify(message);
    for (const p of players.values()) if (p.conn) p.conn.send(text);
  }

  const broadcastPlayers = () => broadcast({ type: 'players', players: publicPlayers() });

  function cleanName(raw) {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    return name || 'Joueur';
  }

  function onJoin(conn, state, msg) {
    if (state.player) return;
    // Reconnexion : un id connu reprend sa place (et remplace l'ancienne socket).
    let player = typeof msg.id === 'string' ? players.get(msg.id) : null;
    if (player) {
      if (player.conn && player.conn !== conn) {
        const old = player.conn;
        player.conn = null;
        old.close(4000); // remplacée par une nouvelle connexion
      }
      player.name = cleanName(msg.name || player.name);
    } else {
      player = { id: crypto.randomUUID(), name: cleanName(msg.name), conn: null, lastSeen: 0 };
      players.set(player.id, player);
    }
    player.conn = conn;
    player.lastSeen = Date.now();
    state.player = player;
    conn.send(JSON.stringify({ type: 'welcome', id: player.id, players: publicPlayers(), chat: chat.snapshot(player.id), tables: tables.list(), table: tables.viewFor(player.id) }));
    broadcastPlayers();
  }

  // Les échecs d'action (coup refusé, table pleine…) sont signalés au seul émetteur.
  function reply(conn, res) {
    if (!res.ok) conn.send(JSON.stringify({ type: 'game-error', error: res.error }));
  }

  function onMessage(conn, state, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'join') return onJoin(conn, state, msg);
    if (!state.player) return; // tout le reste exige d'avoir rejoint

    if (msg.type === 'chat') {
      const res = chat.send(state.player.id, msg.channel, msg.text);
      if (!res.ok && res.reason === 'rate') conn.send(JSON.stringify({ type: 'chat-error', reason: 'rate' }));
    } else if (msg.type === 'typing') {
      chat.typing(state.player.id, msg.channel);
    } else if (msg.type === 'table-create') {
      reply(conn, tables.create(state.player.id, msg.game));
    } else if (msg.type === 'table-join') {
      reply(conn, tables.join(state.player.id, msg.table));
    } else if (msg.type === 'table-leave') {
      tables.leave(state.player.id);
    } else if (msg.type === 'table-rematch') {
      tables.rematch(state.player.id);
    } else if (msg.type === 'game-action') {
      reply(conn, tables.action(state.player.id, msg.action));
    }
  }

  function onClose(conn, state) {
    const player = state.player;
    // Si la socket a été remplacée par une reconnexion, on ne touche à rien.
    if (!player || player.conn !== conn) return;
    player.conn = null;
    player.lastSeen = Date.now();
    broadcastPlayers();
  }

  function attach(conn) {
    const state = { player: null };
    conn.on('message', (raw) => onMessage(conn, state, raw));
    conn.on('close', () => onClose(conn, state));
  }

  // Ping régulier : coupe les sockets muettes (téléphone verrouillé, wifi perdu).
  const heartbeat = setInterval(() => {
    for (const p of players.values()) {
      if (!p.conn) continue;
      if (!p.conn.isAlive) { p.conn.terminate(); continue; }
      p.conn.isAlive = false;
      p.conn.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  // Oubli des joueurs partis depuis trop longtemps.
  const sweeper = setInterval(() => {
    const now = Date.now();
    let removed = false;
    for (const [id, p] of players) {
      if (!p.conn && now - p.lastSeen > offlineTtlMs) { tables.playerGone(id); chat.forget(id); players.delete(id); removed = true; }
    }
    if (removed) broadcastPlayers();
  }, Math.min(offlineTtlMs, 30000));
  sweeper.unref();

  return { attach, players, chat, tables, stop() { clearInterval(heartbeat); clearInterval(sweeper); } };
}

// Chemin d'une requête, ou null si l'URL est malformée (ne doit jamais faire planter le serveur).
function pathnameOf(req) {
  try { return new URL(req.url, 'http://x').pathname; } catch { return null; }
}

function serveStatic(req, res) {
  const url = { pathname: pathnameOf(req) };
  if (url.pathname === null) { res.writeHead(400).end('Bad request'); return; }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { rel = null; }
  if (rel === null) { res.writeHead(400).end('Bad request'); return; }
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  // Empêche de sortir de public/ (ex. /../server/server.js).
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function start({ port = 8080, host = '0.0.0.0', ...opts } = {}) {
  const app = createApp(opts);
  const server = http.createServer(serveStatic);
  server.on('upgrade', (req, socket) => {
    if (pathnameOf(req) !== '/ws') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    const conn = acceptUpgrade(req, socket);
    if (conn) app.attach(conn);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        server,
        app,
        port: server.address().port,
        close() {
          app.stop();
          for (const p of app.players.values()) if (p.conn) p.conn.terminate();
          return new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
        },
      });
    });
  });
}

// Adresses IPv4 locales à communiquer aux joueurs (hors loopback).
function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

module.exports = { start, createApp, localAddresses };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  start({ port }).then(() => {
    console.log(`game-plane prêt sur le port ${port}`);
    const ips = localAddresses();
    if (ips.length === 0) console.log('Aucune adresse réseau détectée : activez le hotspot Wi-Fi.');
    for (const ip of ips) console.log(`  → http://${ip}:${port}`);
  }).catch((err) => {
    console.error(`Impossible de démarrer : ${err.message}`);
    process.exit(1);
  });
}
