'use strict';
// Rendu de Business Class (jeu façon Monopoly). Aucune règle ici : le serveur
// envoie l'état complet et, pour le joueur courant, `hints` (ce qu'il peut faire
// maintenant : actions, constructions, hypothèques, enchères). On dessine et on
// envoie des actions { type, … }.

(() => {
  const { SQUARES, GROUPS, GROUP_SQUARES, COUNT } = MonopolyBoard;

  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316'];
  const ICONS = { go: '🛫', chance: '❓', chest: '🎁', tax: '💸', airport: '✈️', utility: '⛽', jail: '🛃', parking: '🛋️', gotojail: '🚔' };
  const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  const money = (n) => `${n.toLocaleString('fr-FR')} €`;
  const nm = (table, i) => table.players[i]?.name ?? '?';
  const color = (i) => COLORS[i % COLORS.length];
  const abbr = (name) => name.replace(/^L[ea]s? /, '').slice(0, 3);

  // État purement local de l'interface (survit aux rafraîchissements du serveur).
  const ui = {
    sel: null,     // case affichée dans la fiche
    trade: null,   // composeur d'échange : { to, give, get } (give/get : { cash, props:Set, cards })
    bid: '',       // mise saisie
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function button(label, onClick, cls, disabled) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  // Texte du journal : « @2 » → pseudo du joueur 2, coloré.
  function fmt(table, text) {
    const frag = document.createDocumentFragment();
    text.split(/(@\d)/).forEach((part) => {
      if (/^@\d$/.test(part)) {
        const i = Number(part[1]);
        const b = el('b', null, nm(table, i));
        b.style.color = color(i);
        frag.append(b);
      } else if (part) {
        frag.append(document.createTextNode(part));
      }
    });
    return frag;
  }

  // Case d'indice i → [ligne, colonne] sur la grille 11 × 11 (départ en bas à droite).
  function posOf(i) {
    if (i <= 10) return [10, 10 - i];
    if (i <= 19) return [20 - i, 0];
    if (i <= 30) return [0, i - 20];
    return [i - 30, 10];
  }

  // ------------------------------------------------------------------ plateau

  function drawBoard(table, s) {
    const board = el('div', 'mo-board');
    for (let i = 0; i < COUNT; i++) {
      const sq = SQUARES[i];
      const pr = s.props[i];
      const [r, c] = posOf(i);
      const cell = el('button', 'mo-sq' + (ui.sel === i ? ' sel' : ''));
      cell.type = 'button';
      cell.style.gridRow = String(r + 1);
      cell.style.gridColumn = String(c + 1);
      cell.setAttribute('aria-label', sq.name);

      if (sq.t === 'prop' || sq.t === 'airport' || sq.t === 'utility') {
        const band = el('span', 'band');
        band.style.background = sq.group ? GROUPS[sq.group].color : '#64748b';
        if (pr.houses > 0) {
          const n = pr.houses === 5 ? 1 : pr.houses;
          for (let k = 0; k < n; k++) band.append(el('i', pr.houses === 5 ? 'H' : 'h'));
        }
        cell.append(band);
        cell.append(el('span', 'lb', sq.group ? abbr(sq.name) : (sq.name === 'Catering' ? '🍽️' : ICONS[sq.t])));
        if (pr.owner !== null) cell.style.setProperty('--own', color(pr.owner));
        if (pr.owner !== null) cell.classList.add('owned');
        if (pr.mortgaged) cell.classList.add('mort');
      } else {
        cell.append(el('span', 'lb big', ICONS[sq.t]));
      }

      const here = s.players.map((p, idx) => ({ p, idx })).filter(({ p }) => !p.bankrupt && p.pos === i);
      if (here.length) {
        const tok = el('span', 'tok');
        for (const { idx } of here) {
          const d = el('i', idx === s.turn ? 'now' : '');
          d.style.background = color(idx);
          tok.append(d);
        }
        cell.append(tok);
      }
      cell.addEventListener('click', () => { ui.sel = i; rerender(); });
      board.append(cell);
    }
    board.append(drawCenter(table, s));
    return board;
  }

  function drawCenter(table, s) {
    const c = el('div', 'mo-center');
    c.append(el('div', 'mo-title', '✈️ Business Class'));
    const dice = el('div', 'mo-dice');
    if (s.dice) dice.textContent = `${DICE[s.dice[0] - 1]}︎ ${DICE[s.dice[1] - 1]}︎`;
    else dice.textContent = '🎲';
    c.append(dice);
    if (s.dice && s.dice[0] === s.dice[1] && s.phase !== 'over') c.append(el('div', 'mo-say', 'Double !'));
    if (s.lastCard) c.append(el('div', 'mo-card', `${s.lastCard.deck === 'chance' ? '❓' : '🎁'} ${s.lastCard.text}`));
    return c;
  }

  // ------------------------------------------------------------------ fiche d'une case

  function drawDetail(table, s) {
    const i = ui.sel ?? (s.players[table.me] ?? s.players[s.turn]).pos; // spectateur : case du joueur actif
    const sq = SQUARES[i];
    const pr = s.props[i];
    const box = el('div', 'mo-detail');
    const head = el('div', 'mo-dhead');
    if (sq.group) { const sw = el('span', 'sw'); sw.style.background = GROUPS[sq.group].color; head.append(sw); }
    head.append(el('b', null, sq.name));
    box.append(head);

    const rows = [];
    if (sq.t === 'prop') {
      rows.push(`Prix ${money(sq.price)} · hypothèque ${money(sq.price / 2)}`);
      rows.push(`Loyer ${sq.rent[0]} (×2 groupe complet) · 1🏠 ${sq.rent[1]} · 2🏠 ${sq.rent[2]} · 3🏠 ${sq.rent[3]} · 4🏠 ${sq.rent[4]} · 🏨 ${sq.rent[5]}`);
      rows.push(`Maison ou hôtel : ${money(GROUPS[sq.group].house)}`);
    } else if (sq.t === 'airport') {
      rows.push(`Prix ${money(sq.price)} · loyer 25 / 50 / 100 / 200 selon le nombre de hubs possédés`);
    } else if (sq.t === 'utility') {
      rows.push(`Prix ${money(sq.price)} · loyer 4 × les dés (10 × avec les deux compagnies)`);
    } else if (sq.t === 'tax') {
      rows.push(`Paie ${money(sq.amount)} à la banque.`);
    } else {
      rows.push({
        go: 'Chaque passage rapporte 200 €.', chance: 'Pioche une carte Imprévu.', chest: 'Pioche une carte Cagnotte.',
        jail: 'Simple visite, ou en douane (sortie : 50 €, carte ou double).', parking: 'Repos : il ne se passe rien.',
        gotojail: 'Direction la douane !',
      }[sq.t]);
    }
    if (pr) {
      const who = pr.owner === null ? 'Libre' : `Propriétaire : ${nm(table, pr.owner)}`;
      const st = pr.mortgaged ? ' · hypothéquée' : (pr.houses === 5 ? ' · 🏨' : (pr.houses ? ` · ${pr.houses}🏠` : ''));
      rows.push(who + st);
    }
    for (const r of rows) box.append(el('div', 'hint', r));
    return box;
  }

  // ------------------------------------------------------------------ actions

  function drawActions(ctx, s, table) {
    const { send } = ctx;
    const h = s.hints;
    const me = table.me;
    const box = el('div', 'mo-actions');
    const line = (t) => box.append(el('div', 'mo-info', t));
    const row = el('div', 'mo-btns');

    if (s.phase === 'over') { line(`${nm(table, s.winner)} remporte la partie ! 🎉`); return box; }
    if (table.spectator) { line(s.phase === 'auction' ? `Enchères en cours sur ${SQUARES[s.auction.sq].name}.` : `Au tour de ${nm(table, s.turn)}.`); return box; }
    if (s.players[me].bankrupt) { line('Tu es éliminé. Tu peux suivre la partie et discuter dans le chat.'); return box; }

    const jailed = s.players[me].jail > 0;
    const LABELS = {
      roll: jailed && s.phase === 'roll' ? '🎲 Tenter un double' : '🎲 Lancer les dés',
      'pay-jail': 'Payer 50 € et sortir',
      'use-card': 'Utiliser la carte',
      buy: `Acheter ${s.buying !== null ? SQUARES[s.buying].name : ''} (${h.buyPrice !== null ? money(h.buyPrice) : ''})`,
      decline: 'Enchères',
      'end-turn': 'Terminer le tour',
    };

    switch (s.phase) {
      case 'roll':
        line(s.turn === me ? (jailed ? `Tu es en douane (essai ${s.players[me].jail}/3).` : 'À toi de lancer les dés.') : `Au tour de ${nm(table, s.turn)}…`);
        break;
      case 'buy':
        line(s.turn === me ? `Tu es sur ${SQUARES[s.buying].name} : libre.` : `${nm(table, s.turn)} hésite à acheter ${SQUARES[s.buying].name}…`);
        break;
      case 'after':
        line(s.turn === me ? 'Gère tes biens, échange, puis termine ton tour.' : `${nm(table, s.turn)} termine son tour…`);
        break;
      case 'auction': drawAuction(ctx, s, table, box); break;
      case 'debt': {
        const d = s.debt;
        line(`${nm(table, d.from)} doit ${money(d.amount)} ${d.to === null ? 'à la banque' : `à ${nm(table, d.to)}`}.`);
        if (d.from === me) line('Vends des bâtiments, hypothèque des titres ou échange… sinon, déclare faillite.');
        break;
      }
      default: break;
    }

    for (const a of h.actions) {
      if (a === 'bid' || a === 'pass') continue; // gérés par le bloc d'enchères
      if (a === 'bankrupt') {
        row.append(button('Déclarer faillite', () => { if (confirm('Déclarer faillite ? Tes biens iront au créancier.')) send({ type: 'bankrupt' }); }, 'danger'));
      } else {
        row.append(button(LABELS[a], () => send({ type: a }), a === 'decline' || a === 'pay-jail' || a === 'use-card' ? 'sec' : ''));
      }
    }
    if (row.childElementCount) box.append(row);
    return box;
  }

  function drawAuction(ctx, s, table, box) {
    const a = s.auction;
    const h = s.hints;
    box.append(el('div', 'mo-info', `Enchères : ${SQUARES[a.sq].name} — ${a.bidder === null ? 'aucune mise' : `${money(a.bid)} (${nm(table, a.bidder)})`}`));
    if (!h.actions.includes('bid') && !h.actions.includes('pass')) {
      box.append(el('div', 'hint', `Au tour de ${nm(table, a.turn)} · ${a.order.map((i) => nm(table, i)).join(', ')} en lice`));
      return;
    }
    const row = el('div', 'mo-btns');
    if (h.bid && h.actions.includes('bid')) {
      for (const inc of [10, 50, 100]) {
        const amount = Math.max(a.bid + inc, h.bid.min);
        if (amount <= h.bid.max) row.append(button(`Miser ${money(amount)}`, () => ctx.send({ type: 'bid', amount })));
      }
      const form = el('form', 'mo-bidform');
      const input = el('input');
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = String(h.bid.min);
      input.max = String(h.bid.max);
      input.placeholder = `≥ ${h.bid.min}`;
      input.value = ui.bid;
      input.dataset.key = 'bid';
      input.addEventListener('input', () => { ui.bid = input.value; });
      form.append(input, button('Miser', () => {}, ''));
      form.lastChild.type = 'submit';
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = Number(ui.bid);
        if (Number.isInteger(amount)) { ui.bid = ''; ctx.send({ type: 'bid', amount }); }
      });
      box.append(row, form);
    }
    box.append(button('Passer', () => ctx.send({ type: 'pass' }), 'sec'));
  }

  // ------------------------------------------------------------------ joueurs

  function drawPlayers(ctx, s, table) {
    const box = el('div', 'mo-players');
    s.players.forEach((p, i) => {
      const row = el('div', 'mo-player' + (i === s.turn && s.phase !== 'over' ? ' turn' : '') + (p.bankrupt ? ' out' : ''));
      const dot = el('i');
      dot.style.background = color(i);
      row.append(dot);
      const name = el('b', null, nm(table, i) + (i === table.me ? ' (toi)' : ''));
      const where = SQUARES[p.pos].name;
      const info = el('span', 'hint', p.bankrupt ? 'éliminé' : `${where}${p.jail ? ' 🔒' : ''}${p.cards ? ` 🃏${p.cards}` : ''}`);
      const cash = el('span', 'cash', p.bankrupt ? '—' : money(p.cash));
      row.append(name, info, cash);
      if (i !== table.me && !p.bankrupt && s.hints.canTrade && !s.players[table.me]?.bankrupt) {
        row.classList.add('tap');
        row.title = 'Proposer un échange';
        row.addEventListener('click', () => openTrade(i));
      }
      box.append(row);
    });
    if (s.hints.canTrade && !s.trade && s.players.filter((p) => !p.bankrupt).length > 1 && !s.players[table.me]?.bankrupt) {
      box.append(el('div', 'hint', 'Touche un joueur pour lui proposer un échange.'));
    }
    return box;
  }

  // ------------------------------------------------------------------ mes titres

  function drawProperties(ctx, s, table) {
    const h = s.hints;
    const mine = Object.keys(s.props).map(Number).filter((q) => s.props[q].owner === table.me);
    const box = el('div', 'mo-props');
    box.append(el('h2', null, `Mes titres (${mine.length})`));
    if (!mine.length) { box.append(el('div', 'hint', 'Aucun titre pour l’instant.')); return box; }
    for (const q of mine) {
      const sq = SQUARES[q];
      const pr = s.props[q];
      const row = el('div', 'mo-prow' + (pr.mortgaged ? ' mort' : ''));
      const sw = el('span', 'sw');
      sw.style.background = sq.group ? GROUPS[sq.group].color : '#64748b';
      const label = el('span', 'nm', sq.name);
      const state = el('span', 'hint', pr.mortgaged ? 'hypothéquée' : (pr.houses === 5 ? '🏨' : (pr.houses ? `${pr.houses}🏠` : '')));
      row.append(sw, label, state);
      const acts = el('span', 'acts');
      if (h.build.includes(q)) acts.append(button(`＋ ${money(GROUPS[sq.group].house)}`, () => ctx.send({ type: 'build', sq: q }), 'mini'));
      if (h.sell.includes(q)) acts.append(button(`－ +${money(GROUPS[sq.group].house / 2)}`, () => ctx.send({ type: 'sell-house', sq: q }), 'mini sec'));
      if (h.mortgage.includes(q)) acts.append(button(`Hyp. +${money(sq.price / 2)}`, () => ctx.send({ type: 'mortgage', sq: q }), 'mini sec'));
      if (h.unmortgage.includes(q)) acts.append(button(`Lever ${money(Math.ceil(sq.price / 2 * 1.1))}`, () => ctx.send({ type: 'unmortgage', sq: q }), 'mini'));
      row.append(acts);
      row.addEventListener('click', (e) => { if (e.target === row || e.target === label) { ui.sel = q; rerender(); } });
      box.append(row);
    }
    return box;
  }

  // ------------------------------------------------------------------ échanges

  const sideEmpty = () => ({ cash: '', props: new Set(), cards: 0 });

  function openTrade(to) {
    ui.trade = { to, give: sideEmpty(), get: sideEmpty() };
    rerender();
  }

  // Titres échangeables d'un joueur : non hypothéqués, groupe sans bâtiment.
  function tradable(s, who) {
    return Object.keys(s.props).map(Number).filter((q) => {
      if (s.props[q].owner !== who || s.props[q].mortgaged) return false;
      const g = SQUARES[q].group;
      return !g || GROUP_SQUARES[g].every((x) => s.props[x].houses === 0);
    });
  }

  function describeSide(side) {
    const parts = [];
    if (side.cash) parts.push(money(side.cash));
    for (const q of side.props) parts.push(SQUARES[q].name);
    if (side.cards) parts.push(`${side.cards} carte${side.cards > 1 ? 's' : ''} de sortie`);
    return parts.length ? parts.join(', ') : 'rien';
  }

  // Proposition en cours (visible de tous), avec boutons pour les concernés.
  function drawPendingTrade(ctx, s, table) {
    const t = s.trade;
    if (!t) return null;
    const box = el('div', 'mo-trade');
    box.append(el('div', 'mo-info', `Échange : ${nm(table, t.from)} donne ${describeSide(t.give)} · ${nm(table, t.to)} donne ${describeSide(t.get)}`));
    const row = el('div', 'mo-btns');
    if (t.to === table.me) {
      row.append(button('Accepter', () => ctx.send({ type: 'trade-accept' })), button('Refuser', () => ctx.send({ type: 'trade-decline' }), 'sec'));
    } else if (t.from === table.me) {
      row.append(button('Annuler ma proposition', () => ctx.send({ type: 'trade-cancel' }), 'sec'));
    }
    if (row.childElementCount) box.append(row);
    return box;
  }

  function drawTradeComposer(ctx, s, table) {
    const t = ui.trade;
    const modal = el('div', 'mo-modal');
    const card = el('div', 'mo-mcard');
    card.append(el('h2', null, 'Proposer un échange'));

    const partners = el('div', 'mo-btns');
    s.players.forEach((p, i) => {
      if (i === table.me || p.bankrupt) return;
      const b = button(nm(table, i), () => { t.to = i; t.get = sideEmpty(); rerender(); }, 'mini' + (t.to === i ? '' : ' sec'));
      b.style.borderBottom = `3px solid ${color(i)}`;
      partners.append(b);
    });
    card.append(partners);

    const cols = el('div', 'mo-cols');
    const column = (title, who, side, key) => {
      const col = el('div');
      col.append(el('b', null, title));
      const me = s.players[who];
      const cash = el('input');
      cash.type = 'number'; cash.inputMode = 'numeric'; cash.min = '0'; cash.max = String(me.cash);
      cash.placeholder = `Argent (max ${me.cash})`;
      cash.value = side.cash;
      cash.dataset.key = `cash-${key}`;
      cash.addEventListener('input', () => { side.cash = cash.value === '' ? '' : Math.max(0, Math.floor(Number(cash.value))); });
      col.append(cash);
      for (const q of tradable(s, who)) {
        const lab = el('label', 'mo-chk');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = side.props.has(q);
        cb.addEventListener('change', () => { if (cb.checked) side.props.add(q); else side.props.delete(q); });
        const sw = el('span', 'sw');
        sw.style.background = SQUARES[q].group ? GROUPS[SQUARES[q].group].color : '#64748b';
        lab.append(cb, sw, document.createTextNode(SQUARES[q].name));
        col.append(lab);
      }
      if (me.cards > 0) {
        const lab = el('label', 'mo-chk');
        lab.append(document.createTextNode('Cartes « sortie de douane » : '));
        const num = el('input');
        num.type = 'number'; num.min = '0'; num.max = String(me.cards); num.value = side.cards; num.dataset.key = `cards-${key}`;
        num.addEventListener('input', () => { side.cards = Math.min(me.cards, Math.max(0, Math.floor(Number(num.value) || 0))); });
        lab.append(num);
        col.append(lab);
      }
      return col;
    };
    cols.append(column('Je donne', table.me, t.give, 'give'), column(`${nm(table, t.to)} donne`, t.to, t.get, 'get'));
    card.append(cols);

    const row = el('div', 'mo-btns');
    row.append(
      button('Proposer', () => {
        const side = (o) => ({ cash: Number(o.cash) || 0, props: [...o.props], cards: o.cards });
        ctx.send({ type: 'trade-propose', to: t.to, give: side(t.give), get: side(t.get) });
        ui.trade = null;
        rerender();
      }),
      button('Fermer', () => { ui.trade = null; rerender(); }, 'sec'),
    );
    card.append(row);
    modal.append(card);
    return modal;
  }

  // ------------------------------------------------------------------ journal

  function drawLog(table, s) {
    const box = el('div', 'mo-log');
    for (const line of s.log.slice(-16)) { const p = el('div'); p.append(fmt(table, line)); box.append(p); }
    queueMicrotask(() => { box.scrollTop = box.scrollHeight; });
    return box;
  }

  // ------------------------------------------------------------------ assemblage

  let current = null; // { container, ctx } du dernier rendu, pour les redessins locaux

  function rerender() {
    if (!current) return;
    // Conserve le champ en cours de saisie (le serveur redessine à chaque coup).
    const active = document.activeElement;
    const key = active && active.dataset ? active.dataset.key : null;
    const start = active && 'selectionStart' in active ? active.selectionStart : null;
    current.container.replaceChildren();
    build(current.container, current.ctx);
    if (key) {
      const again = current.container.querySelector(`[data-key="${key}"]`);
      if (again) { again.focus(); if (start !== null && again.setSelectionRange) try { again.setSelectionRange(start, start); } catch { /* type number */ } }
    }
  }

  function build(container, ctx) {
    const { table } = ctx;
    const s = table.state;
    const root = el('div', 'mo-root');
    root.append(drawBoard(table, s), drawDetail(table, s), drawActions(ctx, s, table));
    const pending = drawPendingTrade(ctx, s, table);
    if (pending) root.append(pending);
    root.append(drawPlayers(ctx, s, table));
    if (!table.spectator) root.append(drawProperties(ctx, s, table)); // « Mes titres » : rien pour un spectateur
    root.append(el('h2', null, 'Journal'), drawLog(table, s));
    if (ui.trade && s.hints.canTrade && !s.trade && !s.players[table.me]?.bankrupt) root.append(drawTradeComposer(ctx, s, table));
    else if (ui.trade) ui.trade = null; // plus possible (phase, proposition en cours…)
    container.append(root);
  }

  const ERRORS = {
    'no-cash': 'Pas assez d’argent.',
    uneven: 'Construis (ou revends) de façon équilibrée dans le groupe.',
    'no-monopoly': 'Il faut posséder tout le groupe de couleur.',
    'no-supply': 'Plus de maisons ou d’hôtels à la banque.',
    'bid-too-low': 'Mise trop basse.',
    mortgaged: 'Un titre est hypothéqué.',
    'has-buildings': 'Revends d’abord les bâtiments du groupe.',
    'trade-pending': 'Un échange est déjà en cours.',
    'bad-trade': 'Échange impossible.',
    'empty-trade': 'L’échange est vide.',
    'not-owner': 'Ce titre ne t’appartient pas.',
    'max-built': 'Déjà un hôtel.',
    'no-buildings': 'Aucun bâtiment à revendre.',
    'already-mortgaged': 'Déjà hypothéqué.',
    'not-mortgaged': 'Pas hypothéqué.',
    'not-in-jail': 'Tu n’es pas en douane.',
    'no-card': 'Pas de carte.',
    'bad-phase': 'Pas possible maintenant.',
    'no-trade': 'Aucun échange à traiter.',
    eliminated: 'Tu es éliminé.',
    'not-enough': 'Pas assez de joueurs pour démarrer.',
  };

  GPGames.register({
    id: 'monopoly',
    name: 'Business Class',
    blurb: 'Façon Monopoly · 2 à 6 joueurs · hôte lance la partie',
    errors: ERRORS,
    leaveWarning: 'Quitter la partie ? Tu seras éliminé et tes biens retourneront à la banque.',

    isMyTurn(table) {
      const s = table.state;
      if (s.winner !== null || !s.players[table.me] || s.players[table.me].bankrupt) return false;
      const h = s.hints;
      return h.actions.length > 0;
    },

    status(table) {
      const s = table.state;
      if (s.winner !== null) return s.winner === table.me ? 'Tu as gagné la partie ! 🎉' : `${nm(table, s.winner)} a gagné la partie.`;
      if (s.players[table.me]?.bankrupt) return 'Tu es éliminé.';
      const who = nm(table, s.turn);
      switch (s.phase) {
        case 'auction': return `Enchères sur ${SQUARES[s.auction.sq].name}`;
        case 'debt': return s.debt.from === table.me ? 'Tu dois de l’argent !' : `${nm(table, s.debt.from)} doit de l’argent`;
        default: return s.turn === table.me ? 'À toi de jouer' : `Au tour de ${who}`;
      }
    },

    render(container, ctx) {
      current = { container, ctx };
      build(container, ctx);
    },
  });
})();
