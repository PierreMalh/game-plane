'use strict';
// Chat à canaux : « general » (tous), messages privés « dm:<idAutreJoueur> » et
// canaux de salon créés par les jeux (membres explicites, ex. chat des loups).
// Le filtrage est fait côté serveur : un message n'est envoyé qu'aux membres
// du canal, jamais « caché » seulement dans l'interface.

const MAX_TEXT = 500;
const HISTORY_LIMIT = 200;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 8; // messages par fenêtre et par joueur
const TYPING_MIN_GAP_MS = 1000;

function createChat({ players, now = Date.now }) {
  // id interne → { id, kind: 'general'|'dm'|'room', label, members: Set|null, history: [] }
  const channels = new Map();
  channels.set('general', { id: 'general', kind: 'general', label: 'Général', members: null, history: [] });

  const dmKey = (a, b) => 'dm:' + [a, b].sort().join('|');
  const isMember = (ch, pid) => ch.members === null || ch.members.has(pid);

  // Identifiant du canal tel que le voit un joueur : pour un privé, c'est
  // toujours « dm: » suivi de l'id de l'interlocuteur.
  function viewId(ch, pid) {
    if (ch.kind !== 'dm') return ch.id;
    return 'dm:' + [...ch.members].find((m) => m !== pid);
  }

  function labelFor(ch, pid) {
    if (ch.kind !== 'dm') return ch.label;
    const other = [...ch.members].find((m) => m !== pid);
    return players.get(other)?.name ?? '?';
  }

  // Retrouve le canal visé par un joueur ; `create` autorise la création d'un
  // privé à la volée (envoi de message), pas le simple « X écrit… ».
  function resolve(pid, channelId, create) {
    if (typeof channelId !== 'string') return null;
    if (channelId.startsWith('dm:')) {
      const other = channelId.slice(3);
      if (other === pid || !players.has(other) || !players.has(pid)) return null;
      const id = dmKey(pid, other);
      let ch = channels.get(id);
      if (!ch && create) {
        ch = { id, kind: 'dm', label: '', members: new Set([pid, other]), history: [] };
        channels.set(id, ch);
      }
      return ch ?? null;
    }
    const ch = channels.get(channelId);
    return ch && isMember(ch, pid) ? ch : null;
  }

  // Envoie `build(viewerId)` à chaque membre connecté du canal (sauf `exceptId`).
  function deliver(ch, build, exceptId) {
    const targets = ch.members === null ? [...players.keys()] : ch.members;
    for (const pid of targets) {
      if (pid === exceptId) continue;
      const conn = players.get(pid)?.conn;
      if (conn) conn.send(JSON.stringify(build(pid)));
    }
  }

  function rateLimited(player) {
    const t = now();
    player.chatTimes = (player.chatTimes ?? []).filter((x) => t - x < RATE_WINDOW_MS);
    if (player.chatTimes.length >= RATE_MAX) return true;
    player.chatTimes.push(t);
    return false;
  }

  function send(pid, channelId = 'general', text) {
    const player = players.get(pid);
    if (!player) return { ok: false, reason: 'player' };
    const clean = String(text ?? '').trim().slice(0, MAX_TEXT);
    if (!clean) return { ok: false, reason: 'empty' };
    if (rateLimited(player)) return { ok: false, reason: 'rate' };
    const ch = resolve(pid, channelId, true);
    if (!ch) return { ok: false, reason: 'channel' };

    const msg = { from: player.name, id: pid, text: clean, ts: now() };
    ch.history.push(msg);
    if (ch.history.length > HISTORY_LIMIT) ch.history.shift();
    deliver(ch, (viewer) => ({ type: 'chat', channel: viewId(ch, viewer), ...msg }));
    return { ok: true };
  }

  // « X écrit… » : éphémère, jamais stocké.
  function typing(pid, channelId = 'general') {
    const player = players.get(pid);
    if (!player) return;
    const t = now();
    if (t - (player.typingAt ?? 0) < TYPING_MIN_GAP_MS) return;
    player.typingAt = t;
    const ch = resolve(pid, channelId, false);
    if (!ch) return;
    deliver(ch, (viewer) => ({ type: 'typing', channel: viewId(ch, viewer), from: player.name, id: pid }), pid);
  }

  // Canaux et historiques visibles par un joueur (envoyé à la connexion).
  function snapshot(pid) {
    const list = [];
    const history = {};
    for (const ch of channels.values()) {
      if (!isMember(ch, pid)) continue;
      const id = viewId(ch, pid);
      list.push({ id, label: labelFor(ch, pid), kind: ch.kind });
      history[id] = ch.history;
    }
    return { channels: list, history };
  }

  // API pour les jeux : canal à membres explicites (ex. « loups »).
  function createChannel(id, label, memberIds) {
    if (typeof id !== 'string' || !id || id.startsWith('dm:') || channels.has(id)) return false;
    const ch = { id, kind: 'room', label, members: new Set(memberIds), history: [] };
    channels.set(id, ch);
    deliver(ch, () => ({ type: 'channel', channel: { id, label, kind: 'room' } }));
    return true;
  }

  function removeChannel(id) {
    const ch = channels.get(id);
    if (!ch || ch.kind !== 'room') return;
    deliver(ch, () => ({ type: 'channel-removed', id }));
    channels.delete(id);
  }

  // Joueur définitivement parti : ses privés disparaissent, il quitte les salons.
  function forget(pid) {
    for (const [id, ch] of channels) {
      if (ch.kind === 'dm' && ch.members.has(pid)) channels.delete(id);
      else if (ch.kind === 'room') ch.members.delete(pid);
    }
  }

  return { send, typing, snapshot, createChannel, removeChannel, forget };
}

module.exports = { createChat, MAX_TEXT, HISTORY_LIMIT, RATE_MAX };
