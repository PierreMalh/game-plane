'use strict';
// Tables de jeu : un joueur crée une table, les autres la rejoignent. La partie
// démarre quand elle est pleine ; pour un jeu à effectif variable
// (autoStart === false), l'hôte (premier assis) la lance dès qu'il y a
// minPlayers joueurs. Un joueur n'est que sur une table à la fois. Chaque table
// a son canal de chat privé « table:<id> ».
// Spectateurs : un joueur qui n'est assis nulle part peut regarder une table
// (une seule à la fois). Il reçoit la vue publique de la partie (view(état, -1) :
// aucune main ni mot secret) et rejoint le chat de la table ; il ne peut pas jouer.

const crypto = require('crypto');
const { games } = require('./games');

const MAX_TABLES = 30;

// players : Map id → { id, name, conn } ; broadcast(message) : à tous les connectés.
function createTables({ players, chat, broadcast }) {
  const tables = new Map();    // id → table
  const seat = new Map();      // idJoueur → idTable
  const watch = new Map();     // idJoueur → idTable regardée (spectateur)

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
      min: g.minPlayers,
      max: g.maxPlayers,
      manual: g.autoStart === false, // l'hôte lance la partie
      players: t.players.map((id) => ({ id, name: nameOf(id) })),
      spectators: [...t.spectators].map((id) => ({ id, name: nameOf(id) })),
    };
  }

  // Vue complète d'une table pour un joueur assis dedans, ou pour un spectateur
  // (me = -1 : la vue du jeu ne contient alors que l'information publique).
  function viewFor(pid) {
    const t = tables.get(seat.get(pid) ?? watch.get(pid));
    if (!t) return null;
    const idx = seat.has(pid) ? t.players.indexOf(pid) : -1;
    const g = games.get(t.game);
    return {
      ...summary(t),
      me: idx,
      spectator: idx === -1,
      state: t.state ? g.view(t.state, idx) : null,
      rematch: [...t.rematch],
      left: t.players.filter((id) => seat.get(id) !== t.id), // adversaires partis : plus de revanche
      channel: chatId(t),
      first: t.first,
    };
  }

  const list = () => [...tables.values()].map(summary);
  const pushList = () => broadcast({ type: 'tables', tables: list() });
  const pushTable = (t) => {
    for (const pid of t.players) if (seat.get(pid) === t.id) sendTo(pid, { type: 'table', table: viewFor(pid) });
    for (const pid of t.spectators) sendTo(pid, { type: 'table', table: viewFor(pid) });
  };

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
    // Les spectateurs reviennent au salon.
    for (const pid of t.spectators) { watch.delete(pid); sendTo(pid, { type: 'table', table: null }); }
  }

  // Retire un spectateur de la table qu'il regarde (sans rien lui envoyer).
  function stopWatching(pid) {
    const t = tables.get(watch.get(pid));
    watch.delete(pid);
    if (!t) return null;
    t.spectators.delete(pid);
    chat.removeMember(chatId(t), pid);
    return t;
  }

  // Regarder une table (en attente, en cours ou finie) sans y jouer.
  function spectate(pid, tableId) {
    const t = tables.get(tableId);
    if (!t) return { ok: false, error: 'no-table' };
    if (seat.has(pid)) return { ok: false, error: 'already-seated' };
    if (watch.get(pid) === t.id) return { ok: true };
    const prev = stopWatching(pid);
    if (prev) pushTable(prev);
    t.spectators.add(pid);
    watch.set(pid, t.id);
    chat.addMember(chatId(t), pid);
    pushTable(t); // les joueurs voient qui regarde
    pushList();
    return { ok: true };
  }

  function create(pid, gameId) {
    const g = games.get(gameId);
    if (!g) return { ok: false, error: 'unknown-game' };
    if (seat.has(pid)) return { ok: false, error: 'already-seated' };
    if (tables.size >= MAX_TABLES) return { ok: false, error: 'too-many' };
    const prev = stopWatching(pid); // un spectateur qui crée sa table arrête de regarder
    if (prev) pushTable(prev);
    const t = { id: crypto.randomUUID().slice(0, 8), game: gameId, status: 'waiting', players: [pid], spectators: new Set(), state: null, rematch: new Set(), first: 0 };
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
    // Un spectateur peut prendre une place libre (de cette table ou d'une autre).
    const prev = stopWatching(pid);
    if (prev && prev !== t) pushTable(prev);
    t.players.push(pid);
    seat.set(pid, t.id);
    chat.addMember(chatId(t), pid);
    // Jeu à démarrage automatique : on lance dès que la table est pleine.
    if (g.autoStart !== false && t.players.length >= g.maxPlayers) startRound(t);
    pushTable(t);
    pushList();
    return { ok: true };
  }

  const seated = (t) => t.players.filter((id) => seat.get(id) === t.id);

  // Lancement manuel par l'hôte (premier assis) d'un jeu à effectif variable.
  function start(pid) {
    const t = tables.get(seat.get(pid));
    if (!t || t.status !== 'waiting') return { ok: false, error: 'no-table' };
    const g = games.get(t.game);
    if (g.autoStart !== false) return { ok: false, error: 'auto-start' };
    if (t.players[0] !== pid) return { ok: false, error: 'not-host' };
    if (t.players.length < g.minPlayers) return { ok: false, error: 'not-enough' };
    startRound(t);
    pushTable(t);
    pushList();
    return { ok: true };
  }

  // Quitter. Attente : on libère la place. Partie en cours : si le jeu sait gérer
  // un départ (onLeave, ex. faillite au Monopoly) la partie continue, sinon c'est
  // un forfait (l'adversaire gagne). Partie finie : on part simplement. Table
  // vide → fermée. Les joueurs partis restent dans t.players pour garder des
  // index de vue stables.
  function leave(pid) {
    if (!seat.has(pid) && watch.has(pid)) return unwatch(pid);
    const t = tables.get(seat.get(pid));
    if (!t) return { ok: false, error: 'not-seated' };
    const g = games.get(t.game);

    if (t.status === 'waiting') {
      t.players = t.players.filter((id) => id !== pid);
    } else if (t.status === 'playing' && !g.isOver(t.state)) {
      if (g.onLeave) {
        g.onLeave(t.state, t.players.indexOf(pid));
        if (g.isOver(t.state)) t.status = 'over';
      } else {
        const winner = t.players.find((id) => id !== pid && seat.get(id) === t.id);
        t.state.winner = winner === undefined ? 'draw' : t.players.indexOf(winner);
        t.state.forfeit = true;
        t.status = 'over';
      }
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

  // Revanche : démarre quand tous les joueurs encore présents la demandent. Jeu à
  // effectif fixe : impossible si quelqu'un est parti. Effectif variable : les
  // partis sont retirés, il faut rester au moins minPlayers.
  function rematch(pid) {
    const t = tables.get(seat.get(pid));
    if (!t || t.status !== 'over') return { ok: false, error: 'no-rematch' };
    const g = games.get(t.game);
    const present = seated(t);
    const fixed = g.minPlayers === g.maxPlayers;
    if (present.length < g.minPlayers || (fixed && present.length < t.players.length)) {
      return { ok: false, error: 'no-rematch' };
    }
    t.rematch.add(t.players.indexOf(pid));
    if (present.every((id) => t.rematch.has(t.players.indexOf(id)))) {
      t.first = g.nextFirst(t.state, t.first);
      t.players = present;
      startRound(t);
      pushList();
    }
    pushTable(t);
    return { ok: true };
  }

  // Le spectateur arrête de regarder et revient au salon.
  function unwatch(pid) {
    const t = stopWatching(pid);
    if (!t) return { ok: false, error: 'not-watching' };
    sendTo(pid, { type: 'table', table: null });
    pushTable(t);
    pushList();
    return { ok: true };
  }

  // Joueur définitivement parti (déconnecté trop longtemps) : forfait/fermeture.
  function playerGone(pid) {
    if (seat.has(pid)) leave(pid);
    else if (watch.has(pid)) unwatch(pid);
  }

  return { create, join, start, leave, spectate, unwatch, action, rematch, playerGone, list, viewFor };
}

module.exports = { createTables };
