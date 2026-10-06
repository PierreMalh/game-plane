'use strict';
// Rendu des « Jetons de poker ». Aucune règle ici : le serveur envoie les jetons, les mises,
// les pots et `hints` (actions possibles du joueur dont c'est le tour). Les cartes se jouent
// en vrai ; le croupier (`s.isCroupier`) règle la partie, lance les mains et distribue les pots.
// Vue commune : une table de poker en long (forme de stade) avec les joueurs assis autour,
// celui qui regarde toujours en bas. Croupier : grand bouton « Main suivante » au centre du
// tapis, menu (⚙) pour les réglages, recaves et absences ; à l'abattage, il touche les sièges
// gagnants. Joueur : barre d'actions en bas, plateau de jetons pour composer sa relance.
// Croupier en gros plan : la table seule, plein écran, écran maintenu allumé. Horloge des blindes
// (durée de partie) affichée au centre. Pour rire : toucher des jetons les fait exploser sur
// l'écran (compteur de clics par joueur), toucher quelqu'un permet de lui lancer un œuf qu'il
// doit nettoyer.

(() => {
  const { el, color, nm } = GPCards.ui;

  // Valeurs et couleurs des jetons, du plus grand au plus petit.
  const DENOMS = [
    { v: 1000, c: '#d99a1e', s: '#fff7e0' }, { v: 500, c: '#6a3dbd', s: '#f3ecff' }, { v: 100, c: '#202028', s: '#f2f2f2' },
    { v: 25, c: '#16834b', s: '#f4fff8' }, { v: 5, c: '#c0261b', s: '#fff1ef' }, { v: 1, c: '#ece6d6', s: '#2f6fd6' },
  ];
  const MAX_DISCS = 6; // jetons dessinés par colonne (le reste est indiqué par « ×n »)

  const ERRORS = {
    'must-call': 'Il y a une mise : suis, relance ou couche-toi.',
    'nothing-to-call': 'Rien à suivre : tu peux parler (check).',
    'raise-too-small': 'Relance trop petite.',
    'cannot-raise': 'Tu ne peux plus relancer (tapis incomplet) : suis ou couche-toi.',
    'bad-amount': 'Montant invalide.',
    'bad-blinds': 'Blindes invalides (la grosse blinde doit être ≥ la petite).',
    'bad-winners': 'Choisis au moins un gagnant par pot.',
    'hand-running': 'Impossible pendant une main.',
    'not-croupier': 'Réservé au croupier.',
    'not-enough': 'Il faut au moins 2 joueurs avec des jetons.',
    'game-running': 'Le croupier ne peut plus changer une fois la partie commencée.',
    'bad-target': 'Joueur introuvable.',
    'no-clock': 'Pas d’horloge : choisis d’abord une durée de partie.',
    'no-level': 'Pas d’autre niveau.',
    'no-eggs': 'Plus d’œufs : gagne une main pour en récupérer un !',
    'protected': 'Il vient de se nettoyer : protégé encore quelques secondes.',
  };
  const STREET = { preflop: 'Pré-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

  // État local conservé entre deux rafraîchissements du serveur (le cadre reconstruit tout).
  const draft = { stack: '', amount: '', lsb: '', lbb: '', lmin: '' };
  let draftSeen = false; // champs initialisés depuis la configuration du serveur
  let raiseTo = null, raiseKey = null, raiseOpen = false; // relance composée au plateau
  let winners = { hand: -1, picks: [], active: 0 }; // gagnants cochés par pot (par numéro de main)
  let menuOpen = false, target = -1; // menu du croupier et joueur choisi pour la recave
  let editLv = -1; // niveau de la structure en cours de modification
  let logOpen = false;
  let focusKey = null; // champ en cours de saisie, refocalisé après un rafraîchissement
  let zoom = false, wake = null; // gros plan du croupier et verrou d'écran allumé
  let pop = -1, flyTo = -1; // joueur touché (petit menu) et cible d'un œuf en vol
  let eggSeen = 0; // œufs déjà animés sur mon écran
  let taps = 0, tapTimer = null, sendFn = null; // clics sur les jetons pas encore envoyés
  let inflight = 0, lastMyTaps = null, myIdx = null; // clics envoyés pas encore confirmés par le serveur
  const shownTaps = {}; // dernier compteur affiché par joueur (pour l'effet « +1 »)
  const flights = new Map(); // colonne en vol (`pile|couleur`) → fin du vol, gardée cachée au redessin
  const arrived = new WeakMap(); // état reçu → heure d'arrivée (les durées du serveur deviennent des échéances locales)
  let ticker = null;
  let lastLevel = null, levelUpAt = 0; // changement de niveau de blindes : son et bandeau
  let confirmUntil = { restart: 0, end: 0 }; // double toucher de confirmation
  let audio = null;

  const fmt = (v) => v.toLocaleString('fr-FR');
  const short = (v) => (v >= 1e4 ? `${Math.floor(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')}k` : String(v));
  const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function mmss(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }
  const durLabel = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`);
  // Son sans fichier (Web Audio) : débloqué au premier toucher, comme l'exigent les navigateurs.
  function unlockAudio() {
    try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { audio = null; }
  }
  document.addEventListener?.('pointerdown', unlockAudio, { capture: true });
  function chime(notes = [659, 784, 1047]) {
    if (!audio) return;
    const t0 = audio.currentTime + 0.02;
    notes.forEach((f, k) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = t0 + k * 0.17;
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.75);
    });
  }

  // Hasard reproductible (mêmes taches d'œuf à chaque rafraîchissement).
  function rand(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const idleOf = (s) => s.phase === 'setup' || s.phase === 'between';

  // ---------------------------------------------------------------- jetons

  // Décompose un montant en jetons (glouton) : [{ d, n }].
  function breakdown(amount) {
    const out = [];
    let rest = Math.max(0, Math.floor(amount));
    for (const d of DENOMS) {
      const k = Math.floor(rest / d.v);
      if (k) { out.push({ d, n: k }); rest -= k * d.v; }
    }
    return out;
  }

  function disc(d) {
    const c = el('i', 'ch-disc');
    c.style.setProperty('--c', d.c);
    c.style.setProperty('--s', d.s);
    return c;
  }

  // Piles de jetons dessinées pour un montant (au plus `cols` colonnes, les plus grosses valeurs).
  function stack(amount, cls = '', cols = 6) {
    const box = el('span', 'ch-stack ' + cls);
    box.setAttribute('aria-hidden', 'true');
    for (const { d, n } of breakdown(amount).slice(0, cols)) {
      const col = el('span', 'ch-col');
      col.dataset.c = d.c;
      col.dataset.s = d.s;
      col.dataset.n = n;
      for (let k = 0; k < Math.min(n, MAX_DISCS); k++) col.append(disc(d));
      if (n > MAX_DISCS) col.append(el('b', 'ch-n', `×${n}`));
      box.append(col);
    }
    return box;
  }

  // Pile à toucher : la colonne touchée (une couleur) saute en l'air et retombe, et le clic est
  // compté (envoyé par paquets).
  function tappable(node, key) {
    if (!sendFn) return node;
    // Colonne encore en vol depuis le rendu précédent : elle reste cachée jusqu'à sa retombée.
    for (const col of node.querySelectorAll('.ch-col')) {
      const until = flights.get(`${key}|${col.dataset.c}`) ?? 0;
      if (until > Date.now()) { col.style.visibility = 'hidden'; setTimeout(() => { col.style.visibility = ''; col.classList.add('ch-reform'); }, until - Date.now()); }
    }
    node.classList.add('ch-tapme');
    node.setAttribute('role', 'button');
    node.removeAttribute('aria-hidden');
    node.setAttribute('aria-label', 'Faire sauter les jetons');
    node.addEventListener('click', (e) => {
      // Colonne visée : celle sous le doigt, sinon la plus proche horizontalement.
      const cols = [...node.querySelectorAll('.ch-col')];
      const col = e.target.closest?.('.ch-col') ?? cols.sort((a, b) => dist(a, e.clientX) - dist(b, e.clientX))[0];
      if (col && burst(col)) flights.set(`${key}|${col.dataset.c}`, Date.now() + 900);
      taps++;
      showMyTaps();
      // Premier clic envoyé tout de suite, les suivants par paquets toutes les 400 ms.
      if (!tapTimer) { flushTaps(); tapTimer = setTimeout(function again() { if (taps) { flushTaps(); tapTimer = setTimeout(again, 400); } else tapTimer = null; }, 400); }
    });
    return node;
  }

  function flushTaps() {
    if (!taps) return;
    const n = Math.min(taps, 50);
    taps -= n;
    inflight += n;
    sendFn?.({ type: 'tap', n });
  }

  // Mon compteur affiché tout de suite, sans attendre le serveur.
  function showMyTaps() {
    if (myIdx == null) return;
    for (const b of document.querySelectorAll(`[data-ch-taps="${myIdx}"]`)) {
      b.textContent = `👆 ${short((lastMyTaps ?? 0) + inflight + taps)}`;
      b.classList.remove('bump');
      void b.offsetWidth; // relance l'animation
      b.classList.add('bump');
    }
  }

  const dist = (node, x) => { const r = node.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - x); };

  // Explosion d'une colonne de jetons : chaque jeton part de sa place dans la pile, monte, tourne
  // puis retombe sous l'effet de la gravité, rebondit une fois sur le bas de l'écran et sort.
  // Simulation simple (requestAnimationFrame), sans image ni bibliothèque. La colonne disparaît
  // le temps du vol puis se reforme.
  function burst(col) {
    if (calm() || col.dataset.flying) return false;
    const discs = [...col.querySelectorAll('.ch-disc')];
    if (!discs.length) return false;
    const count = Math.min(Math.max(discs.length, Number(col.dataset.n) || 0), 24);
    const H = window.innerHeight, W = window.innerWidth;
    const layer = el('div', 'ch-burst');
    layer.setAttribute('aria-hidden', 'true');
    const g = 2600; // gravité en px/s²
    const bits = [];
    for (let k = 0; k < count; k++) {
      const from = discs[Math.min(k, discs.length - 1)].getBoundingClientRect();
      const c = el('i', 'ch-flyer');
      c.style.setProperty('--c', col.dataset.c);
      c.style.setProperty('--s', col.dataset.s);
      const size = Math.max(26, from.width * 0.85);
      c.style.width = c.style.height = `${size}px`;
      layer.append(c);
      bits.push({
        node: c, x: from.left, y: from.top - (k - discs.length + 1 > 0 ? (k - discs.length + 1) * from.height * 0.5 : 0),
        vx: (Math.random() - 0.5) * 520, vy: -(900 + Math.random() * 700 + k * 25),
        a: 0, va: (Math.random() - 0.5) * 1440, flip: 0, vf: 360 + Math.random() * 900, bounced: false,
      });
    }
    document.body.append(layer);
    col.dataset.flying = '1';
    col.style.visibility = 'hidden';
    let last = performance.now();
    const t0 = last;
    const step = (t) => {
      const dt = Math.min(0.04, (t - last) / 1000);
      last = t;
      let alive = 0;
      for (const b of bits) {
        b.vy += g * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.a += b.va * dt; b.flip += b.vf * dt;
        if (!b.bounced && b.y > H - 14 && b.vy > 0) { b.bounced = true; b.vy *= -0.45; b.vx *= 0.7; b.vf *= 0.5; }
        if (b.y < H + 40 && b.x > -60 && b.x < W + 60) alive++;
        b.node.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.a}deg) rotateX(${b.flip}deg)`;
      }
      if (alive && t - t0 < 4000) requestAnimationFrame(step);
      else layer.remove();
    };
    requestAnimationFrame(step);
    // La pile se reforme (si la page n'a pas déjà été redessinée entre-temps).
    setTimeout(() => { col.style.visibility = ''; delete col.dataset.flying; col.classList.add('ch-reform'); }, 900);
    return true;
  }

  // Œuf lancé depuis le bas de l'écran vers le siège visé.
  function throwEgg(i) {
    const seatNode = document.querySelector(`[data-ch-seat="${i}"]`);
    if (!seatNode || calm()) return;
    const r = seatNode.getBoundingClientRect();
    const egg = el('div', 'ch-egg-fly', '🥚');
    egg.setAttribute('aria-hidden', 'true');
    document.body.append(egg);
    const x0 = window.innerWidth / 2, y0 = window.innerHeight - 40;
    const x1 = r.left + r.width / 2, y1 = r.top + r.height / 2;
    egg.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(0) scale(1.4)` },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 80}px) rotate(300deg) scale(1.1)`, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) rotate(640deg) scale(.7)` },
    ], { duration: 650, easing: 'ease-in' }).onfinish = () => egg.remove();
  }

  // ---------------------------------------------------------------- éléments d'interface

  function button(label, onClick, cls, disabled) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  function number(key, label, opts = {}) {
    const wrap = el('label', 'ch-field');
    wrap.append(el('span', null, label));
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = opts.min ?? 0;
    input.value = draft[key];
    input.disabled = !!opts.disabled;
    input.dataset.chKey = key;
    input.addEventListener('input', () => { draft[key] = input.value; });
    input.addEventListener('focus', () => { focusKey = key; });
    input.addEventListener('blur', () => setTimeout(() => { if (!document.activeElement?.dataset?.chKey) focusKey = null; }));
    wrap.append(input);
    return wrap;
  }

  // Ligne de journal : « @2 » devient le nom du joueur en couleur.
  function logLine(table, line, tag = 'div') {
    const p = el(tag);
    line.split(/(@\d+)/).forEach((part) => {
      if (/^@\d+$/.test(part)) { const i = Number(part.slice(1)); const b = el('b', null, nm(table, i)); b.style.color = color(i); p.append(b); }
      else if (part) p.append(document.createTextNode(part));
    });
    return p;
  }

  // ---------------------------------------------------------------- géométrie de la table

  // La table est un stade vertical dans une boîte de 100 × H unités. Les sièges sont posés à
  // intervalles réguliers sur le rebord (même écart sur les côtés droits et dans les virages),
  // en partant du bas et en tournant dans le sens des aiguilles d'une montre (sens du jeu).
  function track(H, R) {
    const S = H / 2 - 50; // demi-longueur des côtés droits (les virages ont un rayon de 50)
    const cy = H / 2;
    const segs = [
      { len: Math.PI * R / 2, at: (f) => arc(cy + S, 90 + 90 * f) },
      { len: 2 * S, at: (f) => [50 - R, cy + S - 2 * S * f] },
      { len: Math.PI * R, at: (f) => arc(cy - S, 180 + 180 * f) },
      { len: 2 * S, at: (f) => [50 + R, cy - S + 2 * S * f] },
      { len: Math.PI * R / 2, at: (f) => arc(cy + S, 90 * f) },
    ];
    function arc(y0, deg) { const a = deg * Math.PI / 180; return [50 + R * Math.cos(a), y0 + R * Math.sin(a)]; }
    return segs;
  }

  // Position du k-ième de `count` sièges : { seat, bet } en pourcentage de la boîte.
  function place(H, k, count) {
    const outer = track(H, 41), inner = track(H, 23);
    const total = outer.reduce((t, s) => t + s.len, 0);
    let t = total * k / count;
    let j = 0;
    while (j < outer.length - 1 && t > outer[j].len) { t -= outer[j].len; j++; }
    const f = outer[j].len ? t / outer[j].len : 0;
    const pct = ([x, y]) => ({ x, y: y / H * 100 });
    return { seat: pct(outer[j].at(f)), bet: pct(inner[j].at(f)) };
  }

  const at = (node, p) => { node.style.left = `${p.x}%`; node.style.top = `${p.y}%`; };

  // ---------------------------------------------------------------- sièges

  function initials(name) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
  }

  function seat(table, s, i, opts) {
    const p = s.players[i];
    const playing = s.phase === 'betting';
    const out = p.sitOut || (!p.inHand && p.chips === 0) || (p.inHand && p.folded && s.street);
    const cls = ['ch-seat'];
    if (i === s.turn && playing) cls.push('turn');
    if (out) cls.push('out');
    if (i === table.me) cls.push('me');
    if (opts.pick) cls.push('pick');
    if (opts.won) cls.push('won');
    const node = el(opts.onClick ? 'button' : 'div', cls.join(' '));
    if (opts.onClick) { node.type = 'button'; node.addEventListener('click', opts.onClick); }
    node.dataset.chSeat = i;

    const face = el('span', 'ch-face', initials(nm(table, i)));
    face.style.setProperty('--pc', color(i));
    node.append(face);
    node.append(el('span', 'ch-name', i === table.me ? 'Toi' : nm(table, i)));
    node.append(el('span', 'ch-amt', fmt(p.chips)));

    let tag = null;
    if (opts.won) tag = ['✓ gagne', 'win'];
    else if (p.sitOut) tag = ['absent', ''];
    else if (p.inHand && p.folded && s.street) tag = ['couché', ''];
    else if (p.allIn && p.inHand) tag = ['tapis', 'allin'];
    else if (!p.inHand && p.chips === 0) tag = ['à sec', ''];
    if (tag) node.append(el('span', 'ch-tag ' + tag[1], tag[0]));
    badges(node, p, i, s);
    node.setAttribute('aria-label', `${nm(table, i)}, ${p.chips} jetons${tag ? `, ${tag[0]}` : ''}${p.taps ? `, ${p.taps} clics` : ''}${p.eggs ? ', plein d’œuf' : ''}`);
    return node;
  }

  // Compteur de clics sur les jetons et œuf reçu, accrochés à côté du siège.
  // Le compteur est toujours affiché (même à 0) ; il « saute » quand il augmente.
  function badges(node, p, i, s) {
    const mine = i === myIdx;
    const value = mine ? p.taps + inflight + taps : p.taps;
    const b = el('span', 'ch-taps' + (shownTaps[i] !== undefined && value > shownTaps[i] ? ' bump' : ''), `👆 ${short(value)}`);
    b.dataset.chTaps = i;
    shownTaps[i] = value;
    node.append(b);
    if (p.eggs) node.append(el('span', 'ch-egged', '🍳'));
    if (p.shield > 0) {
      const sh = el('span', 'ch-shield', '🛡');
      sh.dataset.chUntil = arrived.get(s) + p.shield;
      node.append(sh);
      startTicker();
    }
  }

  // Plaque du croupier, à sa place autour de la table.
  function croupierPlate(table, s, opts = {}) {
    const node = el(opts.onClick ? 'button' : 'div', 'ch-seat ch-dealer-seat' + (s.isCroupier ? ' me' : ''));
    if (opts.onClick) { node.type = 'button'; node.addEventListener('click', opts.onClick); }
    node.dataset.chSeat = s.croupier;
    node.append(el('span', 'ch-face', '🎩'), el('span', 'ch-name', s.isCroupier ? 'Toi' : nm(table, s.croupier)), el('span', 'ch-amt', 'croupier'));
    badges(node, s.players[s.croupier], s.croupier, s);
    return node;
  }

  // Table complète : `center` est posé au milieu du feutre, `seatOpts(i)` personnalise un siège.
  function drawTable(table, s, center, seatOpts = () => ({})) {
    const H = s.isCroupier ? 168 : 136;
    const wrap = el('div', 'ch-table-wrap');
    // Par défaut, toucher quelqu'un d'autre ouvre son petit menu (lancer un œuf…).
    const me = table.spectator ? null : table.me;
    const defOpts = (i) => (me == null || i === me || s.phase === 'over' ? {} : { onClick: () => { pop = i; GPGames.refresh(); } });
    const felt = el('div', 'ch-table' + (s.isCroupier ? ' tall' : ''));
    felt.style.setProperty('--h', H);
    wrap.append(felt);

    // Ordre de jeu, en partant de celui qui regarde (ou du croupier pour un spectateur).
    const anchor = table.me ?? s.croupier;
    const order = [];
    for (let k = 0; k < s.players.length; k++) {
      const i = (anchor + k) % s.players.length;
      if (!s.players[i].left) order.push(i);
    }
    order.forEach((i, k) => {
      const pos = place(H, k, order.length);
      const isC = i === s.croupier;
      const o = seatOpts(i);
      const opts = o.onClick || o.pick ? o : { ...o, ...defOpts(i) };
      const node = isC ? croupierPlate(table, s, opts) : seat(table, s, i, opts);
      at(node, pos.seat);
      felt.append(node);
      if (isC) return;
      const p = s.players[i];
      if (p.bet > 0) {
        const b = el('div', 'ch-bet');
        b.append(stack(p.bet, 'small', 3), el('span', null, fmt(p.bet)));
        at(b, pos.bet);
        felt.append(b);
      }
      if (i === s.dealer && s.street) {
        const d = el('div', 'ch-dbtn', 'D');
        d.setAttribute('aria-label', 'Bouton du donneur');
        at(d, { x: pos.seat.x + (pos.bet.x - pos.seat.x) * 0.45 + (pos.seat.x < 50 ? 9 : -9), y: pos.seat.y + (pos.bet.y - pos.seat.y) * 0.45 });
        felt.append(d);
      }
    });

    const mid = el('div', 'ch-center');
    mid.append(...center.filter(Boolean));
    felt.append(mid);
    return wrap;
  }

  // Pot et rue en cours, au centre du feutre.
  function potBlock(s) {
    const box = el('div', 'ch-pot');
    if (s.pot > 0) box.append(tappable(stack(s.pot, 'pot', 4), 'pot'), el('div', 'ch-potnum', fmt(s.pot)));
    const parts = [];
    if (s.street) parts.push(STREET[s.street]);
    parts.push(`blindes ${s.config.sb}/${s.config.bb}`);
    box.append(el('div', 'ch-street', parts.join(' · ')));
    return box;
  }

  // Chrono des blindes posé sur la table : niveau, blindes, temps restant. Le croupier peut le
  // mettre en pause et passer à la blinde suivante d'un toucher.
  function chrono(s, send) {
    const c = s.clock;
    if (!c) return null;
    const lv = c.levels[c.level], nx = c.levels[c.level + 1];
    const fresh = Date.now() - levelUpAt < 4000;
    const box = el('div', 'ch-chrono' + (c.paused ? ' paused' : '') + (fresh ? ' up' : ''));
    box.append(el('div', 'ch-chrono-lv', fresh ? `Niveau ${c.level + 1} · les blindes montent !` : `Niveau ${c.level + 1}`));
    const row = el('div', 'ch-chrono-row');
    row.append(el('b', 'ch-chrono-bl', `${fmt(lv.sb)}/${fmt(lv.bb)}`));
    const t = el('b', 'ch-chrono-t', mmss(c.left));
    if (c.started && !c.paused) {
      const end = arrived.get(s) + c.left;
      t.dataset.chDeadline = end;
      t.textContent = end > Date.now() ? mmss(end - Date.now()) : '0:00';
      if (s.isCroupier) t.dataset.chChime = '1';
      startTicker();
    }
    row.append(t);
    box.append(row);
    box.append(el('div', 'ch-chrono-nx', c.paused ? '⏸ en pause' : !c.started ? 'démarre à la 1re main' : nx ? `puis ${fmt(nx.sb)}/${fmt(nx.bb)}` : 'dernier niveau'));
    if (s.isCroupier && send) {
      const ctl = el('div', 'ch-chrono-ctl');
      ctl.append(
        button(c.paused ? '▶' : '⏸', () => send({ type: 'pause', on: !c.paused }), 'ch-chrono-btn', !c.started),
        button('Blinde suivante ⏭', () => send({ type: 'level', delta: 1 }), 'ch-chrono-btn next', !nx),
      );
      ctl.firstChild.setAttribute('aria-label', c.paused ? 'Reprendre l’horloge' : 'Mettre l’horloge en pause');
      box.append(ctl);
    }
    return box;
  }

  // Horloge des blindes : niveau, temps restant (qui défile), blindes suivantes.
  function clockNote(s) {
    const c = s.clock;
    const box = el('div', 'ch-clock' + (c.paused ? ' paused' : ''));
    box.append(el('span', null, `Niv. ${c.level + 1}`));
    const t = el('b', null, mmss(c.left));
    if (c.started && !c.paused) {
      t.dataset.chDeadline = arrived.get(s) + c.left;
      t.textContent = mmss(arrived.get(s) + c.left - Date.now());
      startTicker();
    }
    box.append(t);
    if (c.paused) box.append(el('span', null, '⏸ pause'));
    else if (!c.started) box.append(el('span', null, 'démarre à la 1re main'));
    const nx = c.levels[c.level + 1];
    if (nx && c.started) box.append(el('span', 'ch-clock-nx', `puis ${nx.sb}/${nx.bb}`));
    return box;
  }

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(() => {
      const nodes = document.querySelectorAll('[data-ch-deadline]');
      const shields = document.querySelectorAll('[data-ch-until]');
      if (!nodes.length && !shields.length) { clearInterval(ticker); ticker = null; return; }
      for (const n of nodes) {
        const left = Number(n.dataset.chDeadline) - Date.now();
        n.textContent = left > 0 ? mmss(left) : 'fin du niveau';
        // Fin du niveau vue en direct par le croupier : petit signal sonore, une seule fois.
        if (left <= 0 && left > -1500 && n.dataset.chChime && !n.dataset.rang) { n.dataset.rang = '1'; chime([784, 659]); }
      }
      for (const n of shields) if (Number(n.dataset.chUntil) <= Date.now()) n.remove();
    }, 1000);
  }

  function blindNote(s) {
    if (s.clock) return null; // le chrono est affiché à part
    if (!s.config.blindEvery || !s.handNo) return null;
    const left = s.config.blindEvery - ((s.handNo - 1) % s.config.blindEvery) - 1;
    return el('div', 'ch-note', left > 0 ? `Blindes doublées dans ${left} main${left > 1 ? 's' : ''}` : 'Blindes doublées à la prochaine main');
  }

  function resultLines(table, s) {
    if (!s.result) return null;
    const box = el('div', 'ch-result');
    for (const p of s.result.pots) {
      const who = p.winners.map((w) => `@${w}`).join(' et ');
      box.append(logLine(table, `${who} ${p.winners.length > 1 ? 'partagent' : 'remporte'} ${fmt(p.amount)}`));
    }
    return box;
  }

  // ---------------------------------------------------------------- croupier

  function croupierView(table, s, send) {
    const root = el('div', 'ch-root');
    const idle = idleOf(s);

    const bar = el('div', zoom ? 'ch-zoombar' : 'ch-bar');
    bar.append(el('span', 'ch-hand', s.handNo ? `Main n° ${s.handNo}${s.street ? '' : ' terminée'}` : 'Nouvelle partie'));
    bar.append(el('span', 'ch-stock', `🥚 ×${s.players[s.croupier].eggStock}`));
    const tools = el('span', 'ch-tools');
    tools.append(
      button(zoom ? '✕ Sortir' : '⛶ Gros plan', () => setZoom(!zoom), 'ch-menu-btn'),
      button('⚙', () => { menuOpen = true; GPGames.refresh(); }, 'ch-menu-btn ch-gear'),
    );
    tools.lastChild.setAttribute('aria-label', 'Réglages de la partie');
    bar.append(tools);
    root.append(bar);
    if (zoom) root.classList.add('ch-zoom');

    let center, seatOpts;
    if (s.phase === 'showdown') {
      if (winners.hand !== s.handNo) winners = { hand: s.handNo, active: 0, picks: s.pots.map((p) => (p.eligible.length === 1 ? [p.eligible[0]] : [])) };
      const k = Math.min(winners.active, s.pots.length - 1);
      const pot = s.pots[k];
      center = [showdownCenter(s, send, k)];
      seatOpts = (i) => {
        if (!pot?.eligible.includes(i)) return {};
        const on = winners.picks[k].includes(i);
        return {
          pick: true, won: on,
          onClick: () => {
            winners.picks[k] = on ? winners.picks[k].filter((x) => x !== i) : [...winners.picks[k], i];
            // Pot réglé : on passe au suivant encore sans gagnant.
            if (!on) { const nextK = winners.picks.findIndex((w) => w.length === 0); if (nextK >= 0 && s.pots[k].eligible.length > 1 && winners.picks[k].length === 1) winners.active = nextK; }
            GPGames.refresh();
          },
        };
      };
    } else if (idle) {
      const go = el('button', 'ch-go');
      go.type = 'button';
      go.append(el('span', 'ch-go-main', s.phase === 'setup' ? 'Commencer' : 'Main suivante'));
      go.append(el('span', 'ch-go-sub', `Main n° ${s.handNo + 1}`));
      go.addEventListener('click', () => send({ type: 'start' }));
      center = [chrono(s, send), s.phase === 'between' ? resultLines(table, s) : null, go, blindNote(s)];
      seatOpts = () => ({});
    } else {
      const turn = s.turn >= 0 ? logLine(table, `Au tour de @${s.turn}`) : null;
      if (turn) turn.className = 'ch-note';
      center = [chrono(s, send), potBlock(s), turn];
    }
    if (s.phase === 'showdown') center.unshift(chrono(s, send));
    root.append(drawTable(table, s, center, seatOpts));
    if (s.clock) root.lastChild.classList.add('has-chrono');
    if (!zoom) {
      if (idle) root.append(el('div', 'ch-tip', 'Touche un joueur pour le recaver, le mettre absent… ou lui lancer un œuf.'));
      root.append(logBox(table, s));
    }
    if (menuOpen) root.append(croupierMenu(table, s, send));
    return root;
  }

  // Gros plan : la table remplit l'écran (plein écran si le navigateur le permet) et l'écran
  // reste allumé, pour le téléphone posé au milieu des joueurs.
  function setZoom(on, redraw = true) {
    zoom = on;
    const doc = document.documentElement;
    try {
      if (on && !document.fullscreenElement) doc.requestFullscreen?.().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* plein écran refusé : le gros plan reste affiché dans la page */ }
    if (on) navigator.wakeLock?.request('screen').then((l) => { wake = l; }).catch(() => {});
    else { wake?.release().catch(() => {}); wake = null; }
    if (redraw) GPGames.refresh();
  }

  function showdownCenter(s, send, k) {
    const box = el('div', 'ch-showdown');
    if (s.pots.length > 1) {
      const tabs = el('div', 'ch-pottabs');
      s.pots.forEach((p, j) => {
        const label = `${j === 0 ? 'Principal' : `Annexe ${j}`} · ${fmt(p.amount)}`;
        const b = button(label, () => { winners.active = j; GPGames.refresh(); }, 'ch-pottab' + (j === k ? ' on' : '') + (winners.picks[j].length ? ' done' : ''));
        tabs.append(b);
      });
      box.append(tabs);
    } else {
      box.append(stack(s.pots[0].amount, 'pot', 4), el('div', 'ch-potnum', fmt(s.pots[0].amount)));
    }
    box.append(el('div', 'ch-note', 'Touche le ou les gagnants'));
    const ready = winners.picks.every((w) => w.length > 0);
    box.append(button(s.pots.length > 1 ? 'Distribuer les pots' : 'Distribuer le pot', () => send({ type: 'award', winners: winners.picks }), 'ch-award-btn', !ready));
    return box;
  }

  // Menu du croupier (feuille du bas) : recave, absences, réglages de la partie, fin de partie.
  function croupierMenu(table, s, send) {
    const idle = idleOf(s);
    const close = () => { menuOpen = false; GPGames.refresh(); };
    const veil = el('div', 'ch-veil');
    veil.addEventListener('click', (e) => { if (e.target === veil) close(); });
    const sheet = el('div', 'ch-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Réglages de la partie');
    const head = el('div', 'ch-sheet-head');
    head.append(el('h3', null, 'Réglages de la partie'), button('Fermer', close, 'ch-close'));
    sheet.append(head);
    if (!idle) sheet.append(el('p', 'ch-lock', 'Une main est en cours : recaves et réglages se font entre deux mains.'));
    if (!draftSeen) {
      draft.stack = s.config.stack;
      draftSeen = true;
    }
    const setup = s.phase === 'setup';
    sheet.append(settingsSection(s, send, setup, idle));

    // Recave / correction de jetons.
    const seats = s.players.map((p, i) => i).filter((i) => !s.players[i].left && i !== s.croupier);
    if (!seats.includes(target)) target = seats[0] ?? -1;
    const rebuy = el('section', 'ch-sec');
    rebuy.append(el('h4', null, 'Recave'));
    const who = el('div', 'ch-who');
    for (const i of seats) {
      const p = s.players[i];
      const b = button('', () => { target = i; GPGames.refresh(); }, 'ch-who-btn' + (i === target ? ' on' : ''));
      const dot = el('i');
      dot.style.background = color(i);
      b.append(dot, el('span', null, nm(table, i)), el('small', null, fmt(p.chips)));
      who.append(b);
    }
    rebuy.append(who);
    if (target >= 0) {
      const p = s.players[target];
      const quick = el('div', 'ch-row');
      quick.append(button(`Recave +${fmt(s.config.stack)}`, () => send({ type: 'give', player: target, amount: s.config.stack }), 'ch-primary', !idle));
      quick.append(button(p.sitOut ? 'Remettre en jeu' : 'Mettre absent', () => send({ type: 'sitout', player: target, out: !p.sitOut }), 'sec', !idle));
      rebuy.append(quick);
      const custom = el('div', 'ch-row ch-custom');
      const give = (sign) => { const a = Number(draft.amount) * sign; if (Number.isInteger(a) && a) { send({ type: 'give', player: target, amount: a }); draft.amount = ''; } };
      custom.append(number('amount', 'Autre montant', { min: 1, disabled: !idle }), button('Donner', () => give(1), 'sec', !idle), button('Retirer', () => give(-1), 'sec', !idle));
      rebuy.append(custom);
    }
    sheet.append(rebuy);

    const end = el('section', 'ch-sec');
    end.append(el('h4', null, 'Recommencer ou terminer'));
    end.append(confirmButton('restart', '↺ Recommencer la partie', 'Toucher encore : tout le monde repart avec le tapis de départ', () => send({ type: 'restart' })));
    if (s.phase !== 'betting') end.append(confirmButton('end', 'Terminer la partie', 'Toucher encore pour terminer la partie', () => send({ type: 'end' })));
    sheet.append(end);
    veil.append(sheet);
    return veil;
  }

  // Bouton à double toucher : le premier arme (4 s), le second exécute.
  function confirmButton(key, label, armed, run) {
    const on = confirmUntil[key] > Date.now();
    return button(on ? armed : label, () => {
      if (confirmUntil[key] > Date.now()) { confirmUntil[key] = 0; menuOpen = false; run(); return; }
      confirmUntil[key] = Date.now() + 4000;
      GPGames.refresh();
      setTimeout(() => GPGames.refresh(), 4100);
    }, 'ch-danger' + (on ? ' armed' : ''));
  }

  const hmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

  // Réglage unique de la partie, façon tournoi : tapis de départ et durée → structure de blindes
  // calculée par le serveur (niveaux, blindes, temps), dont chaque niveau se modifie d'un toucher.
  function settingsSection(s, send, setup, idle) {
    const sec = el('section', 'ch-sec ch-sec-time');
    sec.append(el('h4', null, '⏱ Partie'));
    const duration = s.config.duration || 90;

    const top = el('div', 'ch-row ch-custom');
    top.append(number('stack', setup ? 'Tapis de départ' : 'Tapis de départ (fixé une fois la partie lancée)', { min: 1, disabled: !setup }));
    if (setup) top.append(button('Recalculer', () => send({ type: 'config', stack: Number(draft.stack), duration }), 'sec'));
    sec.append(top);

    sec.append(el('div', 'ch-label', 'Durée de la partie'));
    const presets = el('div', 'ch-presets');
    for (const m of [30, 45, 60, 90, 120, 150, 180, 240]) {
      presets.append(button(durLabel(m), () => send({ type: 'config', ...(setup ? { stack: Number(draft.stack) || s.config.stack } : {}), duration: m }),
        'ch-preset' + (s.clock && s.config.duration === m ? ' on' : ''), !idle));
    }
    sec.append(presets);
    const c = s.clock;
    if (!c) {
      sec.append(el('p', 'ch-help', 'Choisis une durée : les blindes et le temps de chaque niveau sont calculés pour finir à l’heure.'));
      return sec;
    }
    sec.append(el('p', 'ch-help', setup
      ? 'Départ à ~100 grosses blindes, arrivée quand il ne reste qu’une poignée de grosses blindes à chacun. Touche un niveau pour le modifier. L’horloge part à la 1re main.'
      : 'Touche un niveau pour le modifier. Changer la durée recalcule les niveaux à partir des blindes actuelles.'));

    // Horloge en cours et commandes.
    const now = el('div', 'ch-clockbox');
    now.append(el('b', null, `${fmt(c.levels[c.level].sb)}/${fmt(c.levels[c.level].bb)}`), clockNote(s));
    sec.append(now);
    const row = el('div', 'ch-row');
    row.append(
      button('⏮', () => send({ type: 'level', delta: -1 }), 'sec ch-narrow', c.level === 0),
      button(c.paused ? '▶ Reprendre' : '⏸ Pause', () => send({ type: 'pause', on: !c.paused }), 'sec', !c.started),
      button('Niveau suivant ⏭', () => send({ type: 'level', delta: 1 }), 'ch-primary', c.level >= c.levels.length - 1),
    );
    row.firstChild.setAttribute('aria-label', 'Niveau précédent');
    sec.append(row);

    // Structure : un niveau par ligne (début, durée, blindes), modifiable.
    const planned = c.levels.slice(0, c.planned).reduce((t, l) => t + l.min, 0);
    sec.append(el('p', 'ch-plan', `${c.planned} niveaux · ${durLabel(planned)} (+ ${c.levels.length - c.planned} de prolongation)`));
    const table = el('div', 'ch-struct');
    const head = el('div', 'ch-struct-row ch-struct-head');
    head.append(el('span', null, 'Niv.'), el('span', null, 'Début'), el('span', null, 'Durée'), el('span', null, 'Blindes'), el('span'));
    table.append(head);
    let start = 0;
    c.levels.forEach((l, k) => {
      const state = k === c.level ? ' on' : k < c.level ? ' done' : k >= c.planned ? ' extra' : '';
      if (k === editLv) {
        const form = el('div', 'ch-struct-edit');
        form.append(el('b', null, `Niveau ${k + 1}`));
        const fields = el('div', 'ch-grid3');
        fields.append(number('lsb', 'Petite blinde', { min: 1 }), number('lbb', 'Grosse blinde', { min: 1 }), number('lmin', 'Minutes', { min: 1 }));
        form.append(fields);
        const act = el('div', 'ch-row');
        act.append(
          button('Annuler', () => { editLv = -1; GPGames.refresh(); }, 'sec'),
          button('Enregistrer', () => { editLv = -1; send({ type: 'editLevel', level: k, sb: Number(draft.lsb), bb: Number(draft.lbb), min: Number(draft.lmin) }); }, 'ch-primary'),
        );
        form.append(act);
        table.append(form);
      } else {
        const r = button('', () => { editLv = k; Object.assign(draft, { lsb: l.sb, lbb: l.bb, lmin: l.min }); GPGames.refresh(); }, 'ch-struct-row' + state, k < c.level);
        r.append(el('span', null, k >= c.planned ? `+${k - c.planned + 1}` : String(k + 1)), el('span', null, hmm(start)), el('span', null, `${l.min} min`), el('b', null, `${fmt(l.sb)}/${fmt(l.bb)}`), el('span', 'ch-edit', '✎'));
        r.setAttribute('aria-label', `Modifier le niveau ${k + 1}`);
        table.append(r);
      }
      start += l.min;
    });
    sec.append(table);
    return sec;
  }

  // Petit menu d'un joueur touché à la table : œuf, et pour le croupier, recave/réglages.
  function seatMenu(table, s, send) {
    const i = pop;
    const close = () => { pop = -1; GPGames.refresh(); };
    const veil = el('div', 'ch-veil');
    veil.addEventListener('click', (e) => { if (e.target === veil) close(); });
    const sheet = el('div', 'ch-sheet ch-mini');
    sheet.setAttribute('role', 'dialog');
    const p = s.players[i];
    const head = el('div', 'ch-sheet-head');
    const title = el('h3', null, nm(table, i));
    title.style.color = color(i);
    head.append(title, el('span', 'ch-amt', i === s.croupier ? 'croupier' : `${fmt(p.chips)} jetons`));
    sheet.append(head);
    if (p.taps) sheet.append(el('p', 'ch-help', `👆 ${fmt(p.taps)} clics sur les jetons`));
    const stock = s.players[table.me].eggStock;
    const shielded = p.shield > 0 && arrived.get(s) + p.shield > Date.now();
    const label = stock <= 0 ? '🥚 Plus d’œufs (gagne une main !)' : shielded ? '🛡 Protégé : il vient de se nettoyer' : `🥚 Lancer un œuf · il t’en reste ${stock}`;
    const egg = button(label, () => { pop = -1; flyTo = i; send({ type: 'egg', player: i }); GPGames.refresh(); }, 'ch-egg-btn', stock <= 0 || shielded);
    sheet.append(egg);
    if (s.isCroupier && i !== s.croupier) {
      sheet.append(button('💰 Recave, absence…', () => { pop = -1; target = i; menuOpen = true; GPGames.refresh(); }, 'sec'));
    }
    sheet.append(button('Annuler', close, 'ch-link'));
    veil.append(sheet);
    return veil;
  }

  // Œufs reçus : taches sur tout l'écran jusqu'à ce qu'on appuie sur « Nettoyer ».
  function eggLayer(table, s, send) {
    const me = table.spectator || table.me == null ? null : s.players[table.me];
    if (!me || !me.eggs) { eggSeen = 0; return null; }
    const box = el('div', 'ch-eggs');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', 'Tu as reçu un œuf');
    for (let k = 0; k < me.eggs; k++) {
      const r = rand(k * 7919 + 17);
      const fresh = k >= eggSeen;
      const sp = el('i', 'ch-splat' + (fresh ? ' fresh' : ''));
      sp.style.left = `${10 + r() * 80}%`;
      sp.style.top = `${8 + r() * 70}%`;
      sp.style.setProperty('--s', (0.8 + r() * 0.8).toFixed(2));
      sp.style.setProperty('--r', `${Math.floor(r() * 360)}deg`);
      if (fresh) sp.style.animationDelay = `${(k - eggSeen) * 90}ms`;
      box.append(sp);
    }
    if (me.eggs > eggSeen) { navigator.vibrate?.([70, 40, 140]); box.classList.add('shake'); }
    eggSeen = me.eggs;
    const card = el('div', 'ch-egg-card');
    const who = me.eggBy >= 0 ? `@${me.eggBy}` : 'Quelqu’un';
    card.append(logLine(table, `${who} t’a lancé ${me.eggs > 1 ? `${me.eggs} œufs` : 'un œuf'} !`), button('🧽 Nettoyer', () => send({ type: 'clean' }), 'ch-clean'));
    box.append(card);
    return box;
  }

  // ---------------------------------------------------------------- joueur

  function playerView(table, s, send) {
    const root = el('div', 'ch-root');
    const me = table.me != null && !table.spectator ? s.players[table.me] : null;
    const crou = nm(table, s.croupier);

    let center;
    if (s.phase === 'betting') center = [chrono(s), potBlock(s)];
    else if (s.phase === 'showdown') center = [chrono(s), potBlock(s), el('div', 'ch-note', `Abattage : ${crou} désigne le gagnant…`)];
    else center = [chrono(s), resultLines(table, s), el('div', 'ch-note', s.phase === 'setup' ? `${crou} règle la partie…` : `${crou} prépare la main suivante…`), blindNote(s)];
    root.append(drawTable(table, s, center));
    if (s.clock) root.lastChild.classList.add('has-chrono');

    if (me) root.append(dock(table, s, me, send));
    root.append(logBox(table, s));
    return root;
  }

  // Ma place : mes jetons et, quand c'est à moi, les actions à portée de pouce.
  function dock(table, s, me, send) {
    const box = el('div', 'ch-dock' + (s.hints.actions.length ? ' live' : ''));
    const mine = el('div', 'ch-mine');
    const num = el('div', 'ch-mine-num');
    num.append(el('b', null, fmt(me.chips)), el('span', null, me.bet > 0 ? ` · ${fmt(me.bet)} misés` : ' jetons'));
    mine.append(tappable(stack(me.chips, 'mine', 5), 'mine'), num, el('span', 'ch-stock', `🥚 ×${me.eggStock}`));
    box.append(mine);

    const h = s.hints;
    const say = (t) => box.append(el('div', 'ch-say', t));
    if (s.phase === 'betting') {
      if (h.actions.length) {
        say(h.toCall > 0 ? `À toi : ${fmt(h.toCall)} pour suivre` : 'À toi de parler');
        const acts = el('div', 'ch-acts');
        acts.append(button('Se coucher', () => send({ type: 'fold' }), 'ch-fold'));
        if (h.actions.includes('check')) acts.append(button('Parole', () => send({ type: 'check' }), 'ch-call'));
        if (h.actions.includes('call')) acts.append(button(h.toCall >= me.chips ? `Tapis ${fmt(h.toCall)}` : `Suivre ${fmt(h.toCall)}`, () => send({ type: 'call' }), 'ch-call'));
        if (h.actions.includes('raise')) acts.append(button(raiseOpen ? 'Fermer' : s.currentBet === 0 ? 'Miser…' : 'Relancer…', () => { raiseOpen = !raiseOpen; GPGames.refresh(); }, 'ch-raise-btn' + (raiseOpen ? ' on' : '')));
        box.append(acts);
        if (h.actions.includes('raise') && raiseOpen) raisePanel(s, box, send);
      } else if (me.inHand && !me.folded) say(me.allIn ? 'Tu es à tapis : attends l’abattage.' : logLine(table, `Au tour de @${s.turn}…`, 'span').textContent);
      else say(me.sitOut ? 'Tu es absent pour cette main.' : 'Tu es couché pour cette main.');
    } else if (s.phase === 'showdown') {
      say(me.inHand && !me.folded ? 'Montre tes cartes !' : 'Abattage en cours.');
    } else if (idleOf(s)) {
      const row = el('div', 'ch-row');
      if (s.phase === 'setup') row.append(button('Devenir croupier', () => send({ type: 'croupier' }), 'sec'));
      row.append(button(me.sitOut ? 'Revenir à la table' : 'Sauter les prochaines mains', () => send({ type: 'sitout', out: !me.sitOut }), 'sec'));
      box.append(row);
      if (s.phase === 'setup') box.append(el('div', 'ch-tip', 'Le croupier ne joue pas : prends ce rôle si ton téléphone reste au centre.'));
    }
    return box;
  }

  // Plateau de jetons : chaque toucher ajoute la valeur du jeton à la mise (dans les limites).
  function raisePanel(s, box, send) {
    const h = s.hints;
    const key = `${s.handNo}/${s.street}/${s.currentBet}`;
    if (raiseKey !== key || raiseTo === null) { raiseKey = key; raiseTo = h.minRaise; }
    const clamp = (v) => Math.min(Math.max(v, h.minRaise), h.maxRaise);
    raiseTo = clamp(raiseTo);
    const betting = s.currentBet === 0;

    const panel = el('div', 'ch-raise');
    const preview = el('div', 'ch-preview');
    const go = button('', () => { raiseOpen = false; send({ type: raiseTo >= h.maxRaise ? 'allin' : 'raise', to: raiseTo }); }, 'ch-confirm');
    const slider = el('input');
    slider.type = 'range';
    slider.min = h.minRaise;
    slider.max = h.maxRaise;
    slider.step = Math.max(1, Math.min(s.config.sb, 25));
    slider.setAttribute('aria-label', 'Montant de la mise');
    const refresh = () => {
      slider.value = raiseTo;
      go.textContent = raiseTo >= h.maxRaise ? `Tapis · ${fmt(h.maxRaise)}` : `${betting ? 'Miser' : 'Relancer à'} ${fmt(raiseTo)}`;
      preview.replaceChildren(stack(raiseTo, 'mine', 5), el('b', null, fmt(raiseTo)));
    };
    const set = (v) => { raiseTo = clamp(v); refresh(); };
    slider.addEventListener('input', () => set(Number(slider.value)));

    const quick = el('div', 'ch-quick');
    const potAfterCall = s.pot + h.toCall;
    const preset = (text, to) => quick.append(button(text, () => set(to), 'ch-chipbtn'));
    preset('Min', h.minRaise);
    preset('½ pot', s.currentBet + Math.floor(potAfterCall / 2));
    preset('Pot', s.currentBet + potAfterCall);
    preset('Tapis', h.maxRaise);

    // Jetons à toucher : on ne propose que ceux qui ne dépassent pas mes jetons.
    const tray = el('div', 'ch-tray');
    const mine = s.players[s.me];
    for (const d of DENOMS) {
      if (d.v > mine.chips) continue;
      const b = el('button', 'ch-tap', String(d.v));
      b.type = 'button';
      b.style.setProperty('--c', d.c);
      b.style.setProperty('--s', d.s);
      b.setAttribute('aria-label', `Ajouter ${d.v}`);
      b.addEventListener('click', () => set(raiseTo + d.v));
      tray.append(b);
    }
    const reset = button('Effacer', () => set(h.minRaise), 'ch-link');

    refresh();
    panel.append(preview, tray, slider, quick, go, reset);
    box.append(panel);
  }

  // ---------------------------------------------------------------- communs

  function logBox(table, s) {
    const box = el('details', 'ch-log');
    box.open = logOpen;
    box.addEventListener('toggle', () => { logOpen = box.open; });
    const last = s.log[s.log.length - 1];
    const sum = el('summary');
    sum.append(last ? logLine(table, last, 'span') : el('span', null, 'Historique'));
    box.append(sum);
    const list = el('div', 'ch-log-list');
    for (const line of s.log.slice(-12, -1).reverse()) list.append(logLine(table, line));
    box.append(list);
    return box;
  }

  function overView(table, s) {
    const root = el('div', 'ch-root');
    root.append(drawTable(table, s, [el('div', 'ch-street', 'Partie terminée')]));
    const box = el('ol', 'ch-rank');
    const order = s.players.map((p, i) => i).filter((i) => !s.players[i].left && i !== s.croupier).sort((a, b) => s.players[b].chips - s.players[a].chips);
    for (const i of order) {
      const li = el('li');
      const name = el('b', null, nm(table, i));
      name.style.color = color(i);
      li.append(name, el('span', null, fmt(s.players[i].chips)));
      box.append(li);
    }
    root.append(box);
    return root;
  }

  // ---------------------------------------------------------------- vue

  function build(container, ctx) {
    const { table, send } = ctx;
    const s = table.state;
    sendFn = table.spectator ? null : send;
    const fresh = !arrived.has(s);
    if (fresh) arrived.set(s, Date.now());
    myIdx = table.spectator ? null : table.me;
    if (fresh && myIdx != null) {
      // Mes clics confirmés par le serveur sortent du compte « en vol ».
      const server = s.players[myIdx].taps;
      if (lastMyTaps !== null && server >= lastMyTaps) inflight = Math.max(0, inflight - (server - lastMyTaps));
      else inflight = 0; // nouvelle partie
      lastMyTaps = server;
    }
    // Passage au niveau de blindes suivant : son et bandeau sur le chrono.
    if (fresh) {
      const lv = s.clock ? s.clock.level : null;
      if (lv !== null && lastLevel !== null && lv > lastLevel) { levelUpAt = Date.now(); chime(); navigator.vibrate?.([80, 60, 80]); setTimeout(() => GPGames.refresh(), 4100); }
      lastLevel = lv;
    }
    if (!s.isCroupier) menuOpen = false;
    if (!menuOpen || !s.clock || editLv >= s.clock.levels.length) editLv = -1;
    if (zoom && (!s.isCroupier || s.phase === 'over')) setZoom(false, false); // déjà en plein rendu
    if (!s.hints.actions.includes('raise')) raiseOpen = false;
    if (pop >= 0 && (table.spectator || s.phase === 'over' || !s.players[pop] || s.players[pop].left)) pop = -1;
    let root;
    if (s.phase === 'over') root = overView(table, s);
    else if (s.isCroupier && !table.spectator) root = croupierView(table, s, send);
    else root = playerView(table, s, send);
    if (pop >= 0 && !menuOpen) root.append(seatMenu(table, s, send));
    const eggs = eggLayer(table, s, send);
    if (eggs) root.append(eggs);
    container.append(root);
    if (focusKey) root.querySelector(`[data-ch-key="${focusKey}"]`)?.focus({ preventScroll: true });
    if (flyTo >= 0) { throwEgg(flyTo); flyTo = -1; }
  }

  GPGames.register({
    id: 'chips',
    name: 'Jetons de poker',
    blurb: 'Jusqu’à 10 joueurs + 1 croupier (téléphone à part) · jetons, mises, blindes et pots pour jouer au poker avec de vraies cartes · l’hôte lance',
    errors: ERRORS,
    leaveWarning: 'Quitter la table ? Tu te couches et tes jetons sortent du jeu.',
    isMyTurn: (table) => table.state.hints.actions.length > 0 || (table.state.isCroupier && table.state.phase === 'showdown'),
    status(table) {
      const s = table.state;
      if (s.phase === 'over') return 'Partie terminée';
      if (s.phase === 'setup') return s.isCroupier ? 'Règle la partie, puis commence' : `${nm(table, s.croupier)} règle la partie`;
      if (s.phase === 'between') return s.isCroupier ? 'Prêt pour la main suivante' : 'Entre deux mains';
      if (s.phase === 'showdown') return s.isCroupier ? 'Désigne les gagnants' : 'Abattage';
      return s.turn === table.me ? 'À toi de parler' : `Au tour de ${nm(table, s.turn)}`;
    },
    render: build,
  });
})();
