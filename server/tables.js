'use strict';
// Tables de jeu : un joueur crée une table, les autres la rejoignent ; la
// partie démarre quand elle est pleine. Un joueur n'est que sur une table à la
// fois. Chaque table a son canal de chat privé « table:<id> ».

const crypto = require('crypto');
const { games } = require('./games');

const MAX_TABLES = 30;

// players : Map id → { id, name, conn } ; broadcast(message) : à tous les connectés.
function createTables({ players, chat, broadcast }) {
  const tables = new Map();    // id → table
  const seat = new Map();      // idJoueur → idTable

  const nameOf = (id) => players.get(id)?.name ?? '?';
  const chatId = (t) => `table:${t.id}`;

  function sendTo(pid, message) {
    const conn = players.get(pid)?.conn;
    if (conn) conn.send(JSON.stringify(message));
  }

  function summary(t) {
    const g = games.get(t.game);
    return {
      id: t.id,
      game: t.game,
      gameName: g.name,
      status: t.status,
      max: g.maxPlayers,
      players: t.players.map((id) => ({ id, name: nameOf(id) })),
    };
  }

  // Vue complète d'une table pour un joueur assis dedans.
  function viewFor(pid) {
    const t = tables.get(seat.get(pid));
    if (!t) return null;
    const idx = t.players.indexOf(pid);
    const g = games.get(t.game);
    return {
      ...summary(t),
      me: idx,
      state: t.state ? g.view(t.state, idx) : null,
      rematch: [...t.rematch],
      left: t.players.filter((id) => seat.get(id) !== t.id), // adversaires partis : plus de revanche
      channel: chatId(t),
      first: t.first,
    };
  }

  const list = () => [...tables.values()].map(summary);
  const pushList = () => broadcast({ type: 'tables', tables: list() });
  const pushTable = (t) => { for (const pid of t.players) if (seat.get(pid) === t.id) sendTo(pid, { type: 'table', table: viewFor(pid) }); };

  function startRound(t) {
    const g = games.get(t.game);
    t.state = g.init(t.players, { first: t.first });
    t.status = 'playing';
    t.rematch.clear();
  }

  function destroy(t) {
    chat.removeChannel(chatId(t));
    tables.delete(t.id);
    for (const pid of t.players) if (seat.get(pid) === t.id) seat.delete(pid);
  }

  function create(pid, gameId) {
    const g = games.get(gameId);
    if (!g) return { ok: false, error: 'unknown-game' };
    if (seat.has(pid)) return { ok: false, error: 'already-seated' };
    if (tables.size >= MAX_TABLES) return { ok: false, error: 'too-many' };
    const t = { id: crypto.randomUUID().slice(0, 8), game: gameId, status: 'waiting', players: [pid], state: null, rematch: new Set(), first: 0 };
    tables.set(t.id, t);
    seat.set(pid, t.id);
    chat.createChannel(chatId(t), g.name, [pid]);
    pushTable(t);
    pushList();
    return { ok: true };
  }

  function join(pid, tableId) {
    const t = tables.get(tableId);
    if (!t) return { ok: false, error: 'no-table' };
    if (seat.has(pid)) return { ok: false, error: 'already-seated' };
    const g = games.get(t.game);
    if (t.status !== 'waiting' || t.players.length >= g.maxPlayers) return { ok: false, error: 'full' };
    t.players.push(pid);
    seat.set(pid, t.id);
    chat.addMember(chatId(t), pid);
    if (t.players.length >= g.maxPlayers) startRound(t);
    pushTable(t);
    pushList();
    return { ok: true };
  }

  const seated = (t) => t.players.filter((id) => seat.get(id) === t.id);

  // Quitter. Attente : on libère la place. Partie en cours : forfait (l'adversaire
  // gagne). Partie finie : on part simplement. Table vide → fermée.
  // Les joueurs partis restent dans t.players pour garder des index de vue stables.
  function leave(pid) {
    const t = tables.get(seat.get(pid));
    if (!t) return { ok: false, error: 'not-seated' };
    const g = games.get(t.game);

    if (t.status === 'waiting') {
      t.players = t.players.filter((id) => id !== pid);
    } else if (t.status === 'playing' && !g.isOver(t.state)) {
      const winner = t.players.find((id) => id !== pid && seat.get(id) === t.id);
      t.state.winner = winner === undefined ? 'draw' : t.players.indexOf(winner);
      t.state.forfeit = true;
      t.status = 'over';
    }
    seat.delete(pid);
    sendTo(pid, { type: 'table', table: null });

    if (seated(t).length === 0) destroy(t);
    else pushTable(t);
    pushList();
    return { ok: true };
  }

  function action(pid, act) {
    const t = tables.get(seat.get(pid));
    if (!t || t.status !== 'playing') return { ok: false, error: 'no-game' };
    const g = games.get(t.game);
    const res = g.action(t.state, t.players.indexOf(pid), act);
    if (!res.ok) return res;
    if (g.isOver(t.state)) t.status = 'over';
    pushTable(t);
    if (t.status === 'over') pushList();
    return res;
  }

  // Revanche : démarre quand tous les joueurs (encore présents) la demandent.
  function rematch(pid) {
    const t = tables.get(seat.get(pid));
    if (!t || t.status !== 'over' || seated(t).length < t.players.length) return { ok: false, error: 'no-rematch' };
    t.rematch.add(t.players.indexOf(pid));
    if (t.rematch.size >= t.players.length) {
      t.first = games.get(t.game).nextFirst(t.state, t.first);
      startRound(t);
      pushList();
    }
    pushTable(t);
    return { ok: true };
  }

  // Joueur définitivement parti (déconnecté trop longtemps) : forfait/fermeture.
  function playerGone(pid) {
    if (seat.has(pid)) leave(pid);
  }

  return { create, join, leave, action, rematch, playerGone, list, viewFor };
}

module.exports = { createTables };
