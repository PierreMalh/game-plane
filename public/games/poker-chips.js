'use strict';
// Rendu des « Jetons de poker ». Aucune règle ici : le serveur envoie les jetons, les mises,
// les pots et `hints` (actions possibles du joueur dont c'est le tour). Les cartes se jouent
// en vrai ; le croupier (`s.isCroupier`) règle la partie, lance les mains et distribue les pots.
// Vue commune : une table de poker en long (forme de stade) avec les joueurs assis autour,
// celui qui regarde toujours en bas. Croupier : grand bouton « Main suivante » au centre du
// tapis, menu (⚙) pour les réglages, recaves et absences ; à l'abattage, il touche les sièges
// gagnants. Joueur : barre d'actions en bas, plateau de jetons pour composer sa relance.

(() => {
  const { el, color, nm } = GPCards.ui;

  // Valeurs et couleurs des jetons, du plus grand au plus petit.
  const DENOMS = [
    { v: 1000, c: '#e0a526' }, { v: 500, c: '#6d3fc0' }, { v: 100, c: '#1c1c22' },
    { v: 25, c: '#17804a' }, { v: 5, c: '#b8261d' }, { v: 1, c: '#e8e2d2' },
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
  };
  const STREET = { preflop: 'Pré-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

  // État local conservé entre deux rafraîchissements du serveur (le cadre reconstruit tout).
  const draft = { stack: '', sb: '', bb: '', every: '', amount: '' };
  let draftSeen = false; // champs initialisés depuis la configuration du serveur
  let raiseTo = null, raiseKey = null, raiseOpen = false; // relance composée au plateau
  let winners = { hand: -1, picks: [], active: 0 }; // gagnants cochés par pot (par numéro de main)
  let menuOpen = false, target = -1; // menu du croupier et joueur choisi pour la recave
  let logOpen = false;
  let focusKey = null; // champ en cours de saisie, refocalisé après un rafraîchissement

  const fmt = (v) => v.toLocaleString('fr-FR');
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
    return c;
  }

  // Piles de jetons dessinées pour un montant (au plus `cols` colonnes, les plus grosses valeurs).
  function stack(amount, cls = '', cols = 6) {
    const box = el('span', 'ch-stack ' + cls);
    box.setAttribute('aria-hidden', 'true');
    for (const { d, n } of breakdown(amount).slice(0, cols)) {
      const col = el('span', 'ch-col');
      for (let k = 0; k < Math.min(n, MAX_DISCS); k++) col.append(disc(d));
      if (n > MAX_DISCS) col.append(el('b', 'ch-n', `×${n}`));
      box.append(col);
    }
    return box;
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
    node.setAttribute('aria-label', `${nm(table, i)}, ${p.chips} jetons${tag ? `, ${tag[0]}` : ''}`);
    return node;
  }

  // Plaque du croupier, à sa place autour de la table.
  function croupierPlate(table, s) {
    const node = el('div', 'ch-seat ch-dealer-seat');
    node.append(el('span', 'ch-face', '🎩'), el('span', 'ch-name', s.isCroupier ? 'Toi' : nm(table, s.croupier)), el('span', 'ch-amt', 'croupier'));
    return node;
  }

  // Table complète : `center` est posé au milieu du feutre, `seatOpts(i)` personnalise un siège.
  function drawTable(table, s, center, seatOpts = () => ({})) {
    const H = s.isCroupier ? 168 : 136;
    const wrap = el('div', 'ch-table-wrap');
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
      const node = isC ? croupierPlate(table, s) : seat(table, s, i, seatOpts(i));
      at(node, pos.seat);
      felt.append(node);
      if (isC) return;
      const p = s.players[i];
      if (p.bet > 0) {
        const b = el('div', 'ch-bet');
        b.append(stack(p.bet, 'tiny', 3), el('span', null, fmt(p.bet)));
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
    if (s.pot > 0) box.append(stack(s.pot, 'pot', 4), el('div', 'ch-potnum', fmt(s.pot)));
    const parts = [];
    if (s.street) parts.push(STREET[s.street]);
    parts.push(`blindes ${s.config.sb}/${s.config.bb}`);
    box.append(el('div', 'ch-street', parts.join(' · ')));
    return box;
  }

  function blindNote(s) {
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

    const bar = el('div', 'ch-bar');
    bar.append(el('span', 'ch-hand', s.handNo ? `Main n° ${s.handNo}${s.street ? '' : ' terminée'}` : 'Nouvelle partie'));
    bar.append(button('⚙ Réglages', () => { menuOpen = true; GPGames.refresh(); }, 'ch-menu-btn'));
    root.append(bar);

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
      center = [s.phase === 'between' ? resultLines(table, s) : null, go, blindNote(s)];
      seatOpts = (i) => ({ onClick: () => { target = i; menuOpen = true; GPGames.refresh(); } });
    } else {
      const turn = s.turn >= 0 ? logLine(table, `Au tour de @${s.turn}`) : null;
      if (turn) turn.className = 'ch-note';
      center = [potBlock(s), turn];
    }
    root.append(drawTable(table, s, center, seatOpts));
    if (idle) root.append(el('div', 'ch-tip', 'Touche un joueur pour le recaver ou le mettre absent.'));
    root.append(logBox(table, s));
    if (menuOpen) root.append(croupierMenu(table, s, send));
    return root;
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

    // Réglages de la partie.
    if (!draftSeen) {
      Object.assign(draft, { stack: s.config.stack, sb: s.config.sb, bb: s.config.bb, every: s.config.blindEvery });
      draftSeen = true;
    }
    const setup = s.phase === 'setup';
    const conf = el('section', 'ch-sec');
    conf.append(el('h4', null, 'Partie'));
    const grid = el('div', 'ch-grid');
    grid.append(
      number('sb', 'Petite blinde', { min: 1, disabled: !idle }),
      number('bb', 'Grosse blinde', { min: 1, disabled: !idle }),
      number('stack', setup ? 'Tapis de départ' : 'Tapis de départ (fixé)', { min: 1, disabled: !setup }),
      number('every', 'Blindes ×2 toutes les… mains (0 = jamais)', { min: 0, disabled: !idle }),
    );
    conf.append(grid);
    const apply = el('div', 'ch-row');
    apply.append(button('Appliquer', () => send({ type: 'config', ...(setup ? { stack: Number(draft.stack) } : {}), sb: Number(draft.sb), bb: Number(draft.bb), blindEvery: Number(draft.every) }), 'ch-primary', !idle));
    conf.append(apply);
    sheet.append(conf);

    if (s.phase !== 'betting') {
      const end = el('section', 'ch-sec');
      end.append(button('Terminer la partie', () => { if (confirm('Terminer la partie pour tout le monde ?')) { menuOpen = false; send({ type: 'end' }); } }, 'ch-danger'));
      sheet.append(end);
    }
    veil.append(sheet);
    return veil;
  }

  // ---------------------------------------------------------------- joueur

  function playerView(table, s, send) {
    const root = el('div', 'ch-root');
    const me = table.me != null && !table.spectator ? s.players[table.me] : null;
    const crou = nm(table, s.croupier);

    let center;
    if (s.phase === 'betting') center = [potBlock(s)];
    else if (s.phase === 'showdown') center = [potBlock(s), el('div', 'ch-note', `Abattage : ${crou} désigne le gagnant…`)];
    else center = [resultLines(table, s), el('div', 'ch-note', s.phase === 'setup' ? `${crou} règle la partie…` : `${crou} prépare la main suivante…`), blindNote(s)];
    root.append(drawTable(table, s, center));

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
    mine.append(stack(me.chips, 'mine', 5), num);
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
    if (!s.isCroupier) menuOpen = false;
    if (!s.hints.actions.includes('raise')) raiseOpen = false;
    let root;
    if (s.phase === 'over') root = overView(table, s);
    else if (s.isCroupier && !table.spectator) root = croupierView(table, s, send);
    else root = playerView(table, s, send);
    container.append(root);
    if (focusKey) root.querySelector(`[data-ch-key="${focusKey}"]`)?.focus({ preventScroll: true });
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
