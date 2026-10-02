'use strict';
// Composant de chat réutilisable : volet repliable avec onglets (général,
// privés, salons de jeu), compteur de non-lus, messages rapides et
// indicateur « X écrit… ». Les jeux n'ont rien à faire : le volet est global.
//
// API : GPChat.init({ send }) puis setIdentity / setPlayers / snapshot /
// onMessage(msg) / openDm(playerId) / open() / close().

window.GPChat = (() => {
  const QUICK = ['👍', '😂', '😮', 'Oui', 'Non', 'À toi !', 'Prêt ✋'];
  const TYPING_SEND_GAP_MS = 2000;
  const TYPING_SHOW_MS = 3000;

  const $ = (id) => document.getElementById(id);
  const channels = new Map(); // id → { id, label, kind, msgs, unread, seen }
  const names = new Map();    // idJoueur → pseudo
  const typers = new Map();   // canal → Map(idJoueur → { name, timer })
  let send = () => false;
  let myId = null;
  let active = 'general';
  let isOpen = false;
  let firstSnapshot = true;
  let lastTypingSent = 0;

  const lastTs = (ch) => (ch.msgs.length ? ch.msgs[ch.msgs.length - 1].ts : 0);

  function label(ch) {
    if (ch.kind === 'dm') return names.get(ch.id.slice(3)) ?? ch.label;
    return ch.label;
  }

  function ensureChannel(id, lbl, kind) {
    let ch = channels.get(id);
    if (!ch) {
      ch = { id, label: lbl ?? '?', kind: kind ?? (id.startsWith('dm:') ? 'dm' : 'room'), msgs: [], unread: 0, seen: 0 };
      channels.set(id, ch);
    }
    return ch;
  }

  function markSeen(ch) {
    ch.unread = 0;
    ch.seen = lastTs(ch);
  }

  function render() {
    renderTabs();
    renderLog();
    renderTyping();
    renderBadge();
  }

  function renderTabs() {
    const tabs = $('chat-tabs');
    tabs.replaceChildren();
    for (const ch of channels.values()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (ch.id === active ? ' on' : '');
      b.textContent = (ch.kind === 'dm' ? '🔒 ' : '') + label(ch);
      if (ch.unread > 0 && ch.id !== active) {
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = ch.unread;
        b.append(n);
      }
      b.addEventListener('click', () => switchTo(ch.id));
      tabs.append(b);
    }
  }

  function renderLog() {
    const log = $('chat-log');
    const ch = channels.get(active);
    log.replaceChildren();
    if (!ch) return;
    for (const m of ch.msgs) log.append(lineFor(m));
    log.scrollTop = log.scrollHeight;
  }

  function lineFor(m) {
    const p = document.createElement('p');
    if (m.id === myId) p.className = 'me';
    const b = document.createElement('b');
    b.textContent = m.id === myId ? 'Moi' : m.from;
    p.append(b, document.createTextNode(' ' + m.text));
    return p;
  }

  function renderTyping() {
    const who = [...(typers.get(active)?.values() ?? [])].map((t) => t.name);
    $('chat-typing').textContent =
      who.length === 0 ? '' : who.length === 1 ? `${who[0]} écrit…` : `${who.join(', ')} écrivent…`;
  }

  function renderBadge() {
    let total = 0;
    for (const ch of channels.values()) if (!(isOpen && ch.id === active)) total += ch.unread;
    const badge = $('chat-badge');
    badge.hidden = total === 0;
    badge.textContent = total > 99 ? '99+' : total;
  }

  function switchTo(id) {
    if (!channels.has(id)) return;
    active = id;
    markSeen(channels.get(id));
    render();
  }

  function open() {
    isOpen = true;
    $('chat-panel').hidden = false;
    $('chat-toggle').hidden = true;
    const ch = channels.get(active);
    if (ch) markSeen(ch);
    render();
  }

  function close() {
    isOpen = false;
    $('chat-panel').hidden = true;
    $('chat-toggle').hidden = false;
    renderBadge();
  }

  function setTyper(channel, id, name) {
    let m = typers.get(channel);
    if (!m) typers.set(channel, (m = new Map()));
    clearTimeout(m.get(id)?.timer);
    m.set(id, { name, timer: setTimeout(() => clearTyper(channel, id), TYPING_SHOW_MS) });
  }

  function clearTyper(channel, id) {
    const m = typers.get(channel);
    if (!m) return;
    clearTimeout(m.get(id)?.timer);
    m.delete(id);
    if (channel === active) renderTyping();
  }

  function addChat(msg) {
    const ch = ensureChannel(msg.channel);
    ch.msgs.push({ from: msg.from, id: msg.id, text: msg.text, ts: msg.ts });
    clearTyper(msg.channel, msg.id);
    if (isOpen && msg.channel === active) {
      markSeen(ch);
    } else if (msg.id !== myId) {
      ch.unread++;
      if (navigator.vibrate) navigator.vibrate(30); // ignoré sur iOS
    }
    render();
  }

  // Remplace l'état à chaque (re)connexion : le serveur renvoie les historiques.
  function snapshot(data) {
    if (!data) return;
    const known = new Set();
    for (const c of data.channels) {
      known.add(c.id);
      const ch = ensureChannel(c.id, c.label, c.kind);
      ch.label = c.label;
      ch.msgs = data.history[c.id] ?? [];
      // Premier chargement : rien n'est « non lu ». Ensuite, tout ce qui est
      // arrivé pendant la coupure (messages des autres) l'est.
      if (firstSnapshot) ch.seen = lastTs(ch);
      ch.unread = ch.msgs.filter((m) => m.ts > ch.seen && m.id !== myId).length;
      if (isOpen && c.id === active) markSeen(ch);
    }
    for (const id of [...channels.keys()]) if (!known.has(id)) channels.delete(id);
    if (!channels.has(active)) active = 'general';
    firstSnapshot = false;
    render();
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'chat': addChat(msg); return true;
      case 'typing':
        setTyper(msg.channel, msg.id, msg.from);
        if (msg.channel === active) renderTyping();
        return true;
      case 'channel': {
        const ch = ensureChannel(msg.channel.id, msg.channel.label, msg.channel.kind);
        if (msg.history) {
          ch.msgs = msg.history;
          ch.unread = isOpen && ch.id === active ? 0 : msg.history.filter((m) => m.id !== myId).length;
          if (ch.unread === 0) markSeen(ch);
        }
        render();
        return true;
      }
      case 'channel-removed':
        channels.delete(msg.id);
        if (active === msg.id) active = 'general';
        render();
        return true;
      case 'chat-error': {
        const ch = channels.get(active);
        if (ch) {
          const p = document.createElement('p');
          p.className = 'sys';
          p.textContent = 'Doucement, trop de messages !';
          $('chat-log').append(p);
          $('chat-log').scrollTop = $('chat-log').scrollHeight;
        }
        return true;
      }
      default: return false;
    }
  }

  function openDm(playerId) {
    if (!playerId || playerId === myId) return;
    ensureChannel('dm:' + playerId, names.get(playerId), 'dm');
    open();
    switchTo('dm:' + playerId);
    $('chat-input').focus();
  }

  // Ouvre le volet directement sur un canal (ex. le chat de la table).
  function openChannel(id) {
    if (!channels.has(id)) return;
    open();
    switchTo(id);
  }

  function submit(text) {
    const t = text.trim();
    if (!t) return false;
    return send({ type: 'chat', channel: active, text: t }) !== false;
  }

  function init(opts) {
    send = opts.send;

    $('chat-toggle').addEventListener('click', open);
    $('chat-close').addEventListener('click', close);

    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chat-input');
      if (submit(input.value)) input.value = '';
    });

    $('chat-input').addEventListener('input', () => {
      const now = Date.now();
      if (now - lastTypingSent < TYPING_SEND_GAP_MS) return;
      lastTypingSent = now;
      send({ type: 'typing', channel: active });
    });

    const quick = $('chat-quick');
    for (const q of QUICK) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', () => submit(q));
      quick.append(b);
    }

    // Clavier mobile : garde le volet au-dessus du clavier virtuel.
    const vv = window.visualViewport;
    if (vv) {
      const fit = () => {
        $('chat-panel').style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px';
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
    }
  }

  return {
    init, snapshot, onMessage, openDm, openChannel, open, close,
    setIdentity(id) { myId = id; },
    setPlayers(list) {
      names.clear();
      for (const p of list) names.set(p.id, p.name);
      if (channels.size) renderTabs();
    },
  };
})();
