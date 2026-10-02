'use strict';
// Cadre commun des jeux : liste des jeux, tables ouvertes, vue de partie.
// Chaque jeu s'enregistre avec GPGames.register({ id, name, blurb, status, render }) :
//   status(table)         → texte d'état (« À toi de jouer »…)
//   render(el, ctx)       → dessine la partie dans `el` ; ctx = { table, send(action), myTurn }
// Le cadre (en-tête, revanche, quitter, chat de table) est le même pour tous.

window.GPGames = (() => {
  const $ = (id) => document.getElementById(id);
  const registry = new Map();
  const ERRORS = {
    'not-your-turn': 'Ce n’est pas ton tour.',
    'column-full': 'Cette colonne est pleine.',
    full: 'Cette table est déjà complète.',
    'no-table': 'Cette table n’existe plus.',
    'already-seated': 'Tu es déjà à une table.',
    'too-many': 'Trop de tables ouvertes.',
    'illegal-move': 'Coup impossible.',
    'promotion-required': 'Choisis la pièce de promotion.',
    over: 'La partie est terminée.',
    'already-offered': 'Nulle déjà proposée.',
    'no-offer': 'Aucune nulle à répondre.',
    'not-enough': 'Pas assez de joueurs pour démarrer.',
    'not-host': 'Seul l’hôte peut lancer la partie.',
  };

  let send = () => false;
  let tables = [];
  let table = null;
  let lastStatus = null;
  let lastMyTurn = false;
  let toastTimer = null;

  function register(def) { registry.set(def.id, def); renderLobby(); }

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
  }

  function renderLobby() {
    const list = $('game-list');
    list.replaceChildren();
    for (const def of registry.values()) {
      const card = document.createElement('div');
      card.className = 'game-card';
      const info = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = def.name;
      const blurb = document.createElement('div');
      blurb.className = 'hint';
      blurb.textContent = def.blurb ?? '';
      info.append(title, blurb);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Créer';
      btn.addEventListener('click', () => send({ type: 'table-create', game: def.id }));
      card.append(info, btn);
      list.append(card);
    }

    const open = tables.filter((t) => t.status === 'waiting');
    $('open-tables').hidden = open.length === 0;
    const ul = $('tables');
    ul.replaceChildren();
    for (const t of open) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = `${t.gameName} — ${t.players.map((p) => p.name).join(', ')} (${t.players.length}/${t.max})`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Rejoindre';
      btn.addEventListener('click', () => send({ type: 'table-join', table: t.id }));
      li.append(span, btn);
      ul.append(li);
    }
  }

  // Salle d'attente : joueurs assis et, pour un jeu à démarrage manuel, bouton de lancement (hôte).
  function renderWaiting(body) {
    const ul = document.createElement('ul');
    ul.className = 'waiting';
    table.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.textContent = p.name + (i === 0 ? ' (hôte)' : '') + (i === table.me ? ' — toi' : '');
      ul.append(li);
    });
    const count = document.createElement('p');
    count.className = 'hint';
    count.style.textAlign = 'center';
    count.textContent = `${table.players.length} / ${table.max} joueurs`;
    body.append(ul, count);
    if (table.manual && table.me === 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Démarrer (${table.players.length} joueurs)`;
      btn.disabled = table.players.length < table.min;
      btn.style.display = 'block';
      btn.style.margin = '12px auto 0';
      btn.addEventListener('click', () => send({ type: 'table-start' }));
      body.append(btn);
    }
  }

  function renderGame() {
    const inGame = !!table;
    $('lobby').hidden = inGame;
    $('game-view').hidden = !inGame;
    if (!inGame) { lastStatus = null; lastMyTurn = false; return; }

    const def = registry.get(table.game);
    const ctx = {
      table,
      myTurn: table.status === 'playing' && !!def?.isMyTurn?.(table),
      send: (action) => send({ type: 'game-action', action }),
    };
    $('gv-title').textContent = def ? def.name : table.gameName;

    let status;
    if (table.status === 'waiting') {
      status = table.manual
        ? (table.me === 0 ? 'Lance la partie quand tout le monde est là.' : `${table.players[0].name} lancera la partie…`)
        : 'En attente d’un adversaire…';
    } else {
      status = def ? def.status(table) : '';
    }
    $('gv-status').textContent = status;

    const body = $('gv-body');
    body.replaceChildren();
    if (table.status === 'waiting') renderWaiting(body);
    else if (def && table.state) def.render(body, ctx);

    // Revanche : quand la manche est finie. Jeu à effectif fixe : personne ne doit être
    // parti ; effectif variable : il doit rester au moins `min` joueurs.
    const rematch = $('gv-rematch');
    const over = table.status === 'over';
    const present = table.players.length - table.left.length;
    const fixed = table.min === table.max;
    rematch.hidden = !over || (fixed && table.left.length > 0) || present < table.min;
    rematch.disabled = table.rematch.includes(table.me);
    rematch.textContent = rematch.disabled
      ? (table.max > 2 ? 'En attente des autres…' : 'En attente de l’adversaire…')
      : 'Rejouer';

    $('gv-leave').textContent = table.status === 'playing' ? 'Abandonner' : 'Quitter';

    // À chaque début de partie, on replie le chat pour laisser la place au plateau.
    if (table.status !== lastStatus && (table.status === 'playing' || lastStatus === null)) GPChat.close();
    // Vibration seulement quand le tour passe à nous (pas à chaque mise à jour de la partie).
    const myTurn = ctx.myTurn && table.status === 'playing';
    if (myTurn && !lastMyTurn && navigator.vibrate) navigator.vibrate(40);
    lastMyTurn = myTurn;
    lastStatus = table.status;
  }

  function setTable(t) { table = t; renderGame(); }
  function setTables(list) { tables = list; renderLobby(); }

  function onMessage(msg) {
    switch (msg.type) {
      case 'tables': setTables(msg.tables); return true;
      case 'table': setTable(msg.table); return true;
      case 'game-error': {
        const def = table && registry.get(table.game);
        toast(def?.errors?.[msg.error] ?? ERRORS[msg.error] ?? 'Action impossible.');
        return true;
      }
      default: return false;
    }
  }

  function init(opts) {
    send = opts.send;
    $('gv-leave').addEventListener('click', () => {
      const def = table && registry.get(table.game);
      const warning = def?.leaveWarning ?? 'Abandonner la partie ? Ton adversaire gagnera.';
      if (table?.status === 'playing' && !confirm(warning)) return;
      send({ type: 'table-leave' });
    });
    $('gv-rematch').addEventListener('click', () => send({ type: 'table-rematch' }));
    $('gv-chat').addEventListener('click', () => { if (table) GPChat.openChannel(table.channel); });
    renderLobby();
  }

  return { register, init, setTable, setTables, onMessage };
})();
