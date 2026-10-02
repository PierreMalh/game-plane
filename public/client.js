'use strict';
// Client du salon : connexion WebSocket avec reconnexion automatique.
// L'id du joueur est gardé en localStorage pour retrouver sa place après un
// verrouillage d'écran ou une coupure wifi.

(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  };

  let ws = null;
  let myId = store.get('gp.id');
  let myName = store.get('gp.name') || '';
  let joined = false;
  let retry = 0;
  let timer = null;

  function setStatus(text, ok) {
    const el = $('status');
    el.textContent = text;
    el.className = ok ? 'ok' : 'ko';
  }

  function renderPlayers(list) {
    const ul = $('players');
    ul.replaceChildren();
    for (const p of list) {
      const li = document.createElement('li');
      li.textContent = (p.online ? '● ' : '○ ') + p.name;
      if (!p.online) li.className = 'off';
      if (p.id === myId) li.classList.add('me');
      else {
        li.classList.add('tap'); // ouvre un chat privé
        li.addEventListener('click', () => GPChat.openDm(p.id));
      }
      ul.append(li);
    }
  }

  function showLobby() {
    $('login-box').hidden = true;
    $('lobby').hidden = false;
    GPChat.open();
  }

  function sendJson(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  function connect() {
    clearTimeout(timer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const sock = new WebSocket(`${proto}//${location.host}/ws`);
    ws = sock;

    sock.onopen = () => {
      retry = 0;
      setStatus('Connecté', true);
      // Reconnexion transparente si on s'était déjà identifié.
      if (myName) sock.send(JSON.stringify({ type: 'join', name: myName, id: myId }));
    };

    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'welcome') {
        myId = msg.id;
        store.set('gp.id', myId);
        GPChat.setIdentity(myId);
        GPChat.setPlayers(msg.players);
        GPChat.snapshot(msg.chat);
        if (!joined) { joined = true; showLobby(); }
        renderPlayers(msg.players);
        GPGames.setTables(msg.tables);
        GPGames.setTable(msg.table); // reprise d'une partie en cours après reconnexion
      } else if (msg.type === 'players') {
        GPChat.setPlayers(msg.players);
        renderPlayers(msg.players);
      } else if (!GPGames.onMessage(msg)) {
        GPChat.onMessage(msg);
      }
    };

    sock.onclose = () => {
      if (sock !== ws) return; // socket déjà remplacée
      setStatus('Reconnexion…', false);
      // Attente progressive, plafonnée à 5 s.
      timer = setTimeout(connect, Math.min(500 * 2 ** retry++, 5000));
    };
  }

  $('login').addEventListener('submit', (e) => {
    e.preventDefault();
    myName = $('name').value.trim();
    if (!myName || !ws || ws.readyState !== WebSocket.OPEN) return;
    store.set('gp.name', myName);
    ws.send(JSON.stringify({ type: 'join', name: myName, id: myId }));
  });

  // Au retour au premier plan (iOS coupe les sockets en arrière-plan), on
  // force une reconnexion si la socket n'est plus ouverte.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ws && ws.readyState === WebSocket.CLOSED) { retry = 0; connect(); }
  });

  GPChat.init({ send: sendJson });
  GPGames.init({ send: sendJson });
  if (myName) $('name').value = myName;
  connect();
})();
