'use strict';
// Rendu de la belote classique ET de la belote contrée (même table, enchères différentes).
// Aucune règle ici : le serveur envoie ta main, le pli, les scores, les enchères et `hints`
// (actions possibles, cartes légales, couleurs / valeurs d'enchères). La table est dessinée
// vue de dessus : toi en bas, ton partenaire en face. On joue dans le sens inverse des
// aiguilles d'une montre (le joueur suivant est à ta droite), comme en France.

(() => {
  const { el, color, nm } = GPCards.ui;
  const { SYM, SUIT_NAME, rankOf } = GPCards;

  let sel = null;          // carte levée
  let bidValue = null;     // contrée : valeur choisie
  let bidSuit = null;      // contrée : couleur choisie
  let current = null;

  const ERRORS = {
    'illegal-card': 'Carte interdite : il faut fournir, couper ou monter à l’atout.',
    'bad-suit': 'Choisis une autre couleur que la carte retournée.',
    'not-in-hand': 'Tu n’as pas cette carte.',
    'bad-bid': 'Annonce invalide.',
    'bid-too-low': 'Il faut annoncer plus haut que le contrat actuel.',
    'cannot-contre': 'Tu ne peux pas contrer ce contrat.',
  };
  const KIND = { tierce: 'tierce', cinquante: 'cinquante', cent: 'cent', carre: 'carré' };

  const suitText = (s) => `${SYM[s]} ${SUIT_NAME[s]}`;
  const redSuit = (s) => s === 'H' || s === 'D';
  const valueText = (v) => (v === 250 ? 'Capot' : String(v));
  const contreText = (c) => (c === 2 ? ' · surcontré ×4' : c === 1 ? ' · contré ×2' : '');

  function button(label, onClick, cls, disabled) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  // Place d'un siège autour de la table, vue depuis `me` : bas, droite, haut, gauche.
  const POS = ['bottom', 'right', 'top', 'left'];
  const posOf = (me, seat) => POS[(seat - me + 4) % 4];
  // Siège d'où l'on regarde : le sien, ou le siège 0 pour un spectateur (table.me = -1).
  const viewSeat = (table) => Math.max(table.me, 0);
  // Équipe « nous » (0 ou 1) ; spectateur : l'équipe 0 sert de référence.
  const myTeam = (table) => viewSeat(table) % 2;
  // Nom d'une équipe : « Nous » / « Eux » pour un joueur, « Équipe 1 / 2 » pour un spectateur.
  const teamLabel = (table, t) => (table.spectator ? `Équipe ${t + 1}` : t === myTeam(table) ? 'Nous' : 'Eux');

  function seatBox(table, s, seat) {
    const me = viewSeat(table);
    const live = s.phase !== 'roundover' && s.phase !== 'over';
    const box = el('div', `bl-seat ${posOf(me, seat)}` + (s.turn === seat && live ? ' turn' : ''));
    box.classList.add(seat % 2 === me % 2 ? 'ours' : 'theirs');
    const dot = el('i');
    dot.style.background = color(seat);
    box.append(dot, el('b', null, nm(table, seat) + (seat === table.me ? ' (toi)' : '')));
    const chips = el('div', 'chips');
    if (s.dealer === seat) chips.append(el('span', 'chip', 'donneur'));
    if (s.taker === seat) chips.append(el('span', 'chip now', `preneur ${s.trump ? SYM[s.trump] : ''}`));
    else if (s.bid && s.bid.p === seat && s.phase !== 'play') chips.append(el('span', 'chip now', `${valueText(s.bid.value)} ${SYM[s.bid.suit]}`));
    for (const kind of s.declared[seat] ?? []) chips.append(el('span', 'chip ok', `annonce : ${KIND[kind]}`));
    if (seat !== table.me && s.phase === 'play') chips.append(el('span', 'chip', `${s.counts[seat]} 🂠`));
    box.append(chips);
    return box;
  }

  function drawTable(table, s) {
    const me = viewSeat(table);
    const felt = el('div', 'bl-felt');
    for (let seat = 0; seat < 4; seat++) felt.append(seatBox(table, s, seat));

    const centre = el('div', 'bl-centre');
    if (s.phase === 'bid1' || s.phase === 'bid2') {
      centre.append(el('div', 'hint', 'Carte retournée'), GPCards.face(s.turned));
      centre.append(el('div', 'hint', s.phase === 'bid1' ? `Tour 1 : prendre à ${SYM[s.turned.slice(-1)]}` : 'Tour 2 : une autre couleur'));
    } else if (s.phase === 'bid' || s.phase === 'surcontre') {
      if (s.bid) {
        const sym = el('span', 'cp-big', SYM[s.bid.suit]);
        if (redSuit(s.bid.suit)) sym.style.color = '#fecaca';
        centre.append(el('div', 'hint', 'Contrat'), el('div', 'cp-big', valueText(s.bid.value)), sym);
        centre.append(el('div', 'hint', `par ${nm(table, s.bid.p)}${contreText(s.contre)}`));
      } else centre.append(el('div', 'hint', 'Aucune annonce'));
    } else if (s.phase === 'play') {
      const slots = el('div', 'bl-slots');
      for (const t of s.trick) {
        const slot = el('div', `bl-slot ${posOf(me, t.p)}`);
        slot.append(GPCards.face(t.card, { small: true }));
        slots.append(slot);
      }
      centre.append(slots);
      if (!s.trick.length) centre.append(el('div', 'hint', `${nm(table, s.turn)} entame`));
    }
    felt.append(centre);
    return felt;
  }

  function drawScores(table, s) {
    const me = table.me;
    const mine = myTeam(table);
    const bar = el('div', 'bl-scores');
    const teamNames = (t) => [t, t + 2].map((i) => (i === me ? 'toi' : nm(table, i))).join(' & ');
    const box = (t, label) => {
      const b = el('div', 'bl-score' + (t === mine ? ' ours' : ''));
      b.append(el('b', null, `${label} : ${s.scores[t]}`), el('div', 'hint', teamNames(t)));
      return b;
    };
    bar.append(box(mine, teamLabel(table, mine)), box(1 - mine, teamLabel(table, 1 - mine)));
    const trump = el('div', 'bl-trump');
    trump.append(el('div', 'hint', `Objectif ${s.target}`));
    if (s.trump) {
      const sym = el('span', 'cp-big', SYM[s.trump]);
      if (redSuit(s.trump)) sym.style.color = '#dc2626';
      trump.append(el('div', 'hint', 'Atout'), sym);
      if (s.bid) trump.append(el('div', 'hint', `${valueText(s.bid.value)}${contreText(s.contre)}`));
    } else trump.append(el('div', 'hint', `Donne ${s.round}`));
    bar.append(trump);
    return bar;
  }

  // ------------------------------------------------------------------ enchères

  function bidPanel(ctx, table, s, box, btns, info) {
    const { send } = ctx;
    const h = s.hints;

    if (s.mode !== 'coinche') { // belote classique : prendre ou passer
      if (h.actions.length) {
        info(s.phase === 'bid1' ? `À toi : prends-tu à ${suitText(s.turned.slice(-1))} ?` : 'À toi : prends dans une autre couleur, ou passe.');
        if (s.phase === 'bid1') btns.append(button(`Je prends à ${SYM[s.turned.slice(-1)]}`, () => send({ type: 'take' })));
        else for (const su of h.suits) btns.append(button(`Prendre ${SYM[su]}`, () => send({ type: 'take', suit: su }), 'sec'));
        btns.append(button('Passer', () => send({ type: 'pass' }), 'sec'));
      } else info(`Au tour de ${nm(table, s.turn)} de parler…`);
      return;
    }

    // belote contrée : contrat chiffré + couleur d'atout, contre, surcontre
    if (s.bid) info(`Contrat actuel : ${valueText(s.bid.value)} ${SYM[s.bid.suit]} par ${nm(table, s.bid.p)}${contreText(s.contre)}`);
    else info('Aucune annonce pour l’instant.');

    if (s.phase === 'surcontre') {
      if (h.actions.includes('surcontre')) {
        info('Tes adversaires t’ont CONTRÉ. Surcontres-tu (×4) ?');
        btns.append(button('Surcontre ! ×4', () => send({ type: 'surcontre' }), 'danger'), button('Non, on joue (×2)', () => send({ type: 'pass' }), 'sec'));
      } else info(`${nm(table, s.turn)} décide de surcontrer…`);
      return;
    }
    if (!h.actions.length) { info(`Au tour de ${nm(table, s.turn)} d'annoncer…`); return; }

    if (!h.bid.values.includes(bidValue)) bidValue = null; // ce contrat n'est plus possible
    const vals = el('div', 'bl-vals');
    for (const v of [80, 90, 100, 110, 120, 130, 140, 150, 160, 250]) {
      const ok = h.bid.values.includes(v);
      vals.append(button(valueText(v), () => { bidValue = v; rerender(); }, 'mini' + (bidValue === v ? '' : ' sec'), !ok));
    }
    const suits = el('div', 'bl-vals');
    for (const su of h.bid.suits) {
      const b = button(SYM[su], () => { bidSuit = su; rerender(); }, 'mini' + (bidSuit === su ? '' : ' sec'));
      if (redSuit(su)) b.style.color = bidSuit === su ? '#7f1d1d' : '#fca5a5';
      b.setAttribute('aria-label', SUIT_NAME[su]);
      suits.append(b);
    }
    box.append(vals, suits);
    btns.append(button(bidValue && bidSuit ? `Annoncer ${valueText(bidValue)} ${SYM[bidSuit]}` : 'Choisis un contrat et une couleur', () => { send({ type: 'bid', value: bidValue, suit: bidSuit }); bidValue = null; bidSuit = null; }, '', !(bidValue && bidSuit)));
    if (h.actions.includes('contre')) btns.append(button('Contre !', () => send({ type: 'contre' }), 'danger'));
    btns.append(button('Passer', () => send({ type: 'pass' }), 'sec'));
  }

  function drawActions(ctx, table, s) {
    const { send } = ctx;
    const h = s.hints;
    const box = el('div', 'cp-box');
    const info = (t) => box.append(el('div', 'cp-info', t));
    const btns = el('div', 'cp-btns');

    if (['bid1', 'bid2', 'bid', 'surcontre'].includes(s.phase)) bidPanel(ctx, table, s, box, btns, info);
    else if (s.phase === 'play') {
      if (h.actions.length) {
        info('À toi de jouer.');
        btns.append(button(sel ? 'Jouer la carte' : 'Choisis une carte', () => { send({ type: 'play', card: sel }); sel = null; }, '', !sel));
      } else info(`Au tour de ${nm(table, s.turn)}…`);
    } else if (s.phase === 'roundover') {
      info(`${s.ready.filter(Boolean).length} / 4 prêts pour la donne suivante`);
      if (h.actions.includes('ready')) btns.append(button('Donne suivante', () => send({ type: 'ready' })));
    } else if (s.phase === 'over') {
      const mine = s.winnerTeam === myTeam(table);
      if (s.forfeit) info('Un joueur a quitté la partie.');
      if (table.spectator) info(`${teamLabel(table, s.winnerTeam)} (${nm(table, s.winnerTeam)} & ${nm(table, s.winnerTeam + 2)}) remporte la partie.`);
      else info(mine ? 'Votre équipe remporte la partie ! 🎉' : 'L’équipe adverse remporte la partie.');
    }
    if (btns.childElementCount) box.append(btns);
    return box;
  }

  // ------------------------------------------------------------------ annonces et décompte

  function comboText(c) {
    const cards = c.cards.map((x) => rankOf(x)).join(' ');
    return c.kind === 'carre' ? `carré de ${c.rank}` : `${KIND[c.kind]} ${SYM[c.suit]} (${cards})`;
  }

  function drawAnnounce(table, s) {
    const a = s.announce;
    if (!a || s.phase === 'over') return null;
    const box = el('div', 'cp-box');
    box.append(el('div', 'cp-info', `Annonces : ${teamLabel(table, a.team)} marquent ${a.points} points`));
    for (const c of a.combos) {
      const row = el('div', 'hint');
      row.textContent = `${nm(table, c.p)} : ${comboText(c)} (+${c.points})`;
      box.append(row);
    }
    if (s.taker !== null && a.team === s.taker % 2) box.append(el('div', 'hint', 'Perdues si le contrat chute.'));
    return box;
  }

  function drawResult(table, s) {
    const r = s.result;
    if (!r) return null;
    const me = myTeam(table);
    const lab = (t) => teamLabel(table, t);
    const box = el('div', 'cp-box');
    box.append(el('div', 'cp-info', `Fin de la donne ${s.round}`));
    const lines = [];
    if (r.bid) lines.push(`Contrat : ${valueText(r.bid.value)} ${SYM[r.bid.suit]} (${lab(r.takerTeam)})${contreText(r.contre)} — ${r.made ? 'rempli' : 'chuté'}`);
    else lines.push(`Preneur : ${lab(r.takerTeam)} — ${r.capot !== null ? 'CAPOT ! ' : ''}${r.made ? 'contrat rempli' : 'contrat chuté'}`);
    if (r.capot === null) lines.push(`Points de cartes (+10 de der) : ${lab(me)} ${r.cardPts[me]} · ${lab(1 - me)} ${r.cardPts[1 - me]}`);
    else lines.push(`CAPOT pour ${lab(r.capot)} (252)`);
    if (r.belote !== null) lines.push(`Belote-rebelote : ${lab(r.belote)} (+20)`);
    if (r.announce) lines.push(r.announce.counted ? `Annonces : ${lab(r.announce.team)} +${r.announce.counted}` : `Annonces de ${lab(r.announce.team)} perdues (preneur chuté)`);
    lines.push(`Marqué : ${lab(me)} +${r.add[me]} · ${lab(1 - me)} +${r.add[1 - me]}`);
    lines.push(`Total : ${lab(me)} ${s.scores[me]} · ${lab(1 - me)} ${s.scores[1 - me]}`);
    for (const l of lines) box.append(el('div', 'hint', l));
    return box;
  }

  function drawLastTrick(table, s) {
    if (!s.lastTrick || s.phase !== 'play') return null;
    const box = el('div', 'cp-box cp-table');
    box.append(el('div', 'hint', `Dernier pli : remporté par ${nm(table, s.lastTrick.winner)}`));
    const row = el('div', 'cards-row');
    for (const t of s.lastTrick.cards) row.append(GPCards.face(t.card, { small: true }));
    box.append(row);
    return box;
  }

  function build(container, ctx) {
    const { table } = ctx;
    const s = table.state;
    const h = s.hints;
    if (sel && !h.legal.includes(sel)) sel = null;
    if (s.phase !== 'bid') { bidValue = null; bidSuit = null; }
    const root = el('div', 'cp-root');

    root.append(drawScores(table, s), drawTable(table, s), drawActions(ctx, table, s));
    for (const part of [drawAnnounce(table, s), drawResult(table, s), drawLastTrick(table, s)]) if (part) root.append(part);

    if (s.hand.length && s.phase !== 'over') {
      const mine = el('div', 'cp-box');
      mine.append(el('div', 'cp-info', `Ta main (${s.hand.length})`));
      const enabled = s.phase === 'play' && h.actions.includes('play') ? new Set(h.legal) : new Set();
      GPCards.hand(mine, s.hand, {
        selected: sel ? new Set([sel]) : null,
        enabled: s.phase === 'play' ? enabled : null,
        onToggle: s.phase === 'play' ? (c) => { sel = sel === c ? null : c; rerender(); } : null,
      });
      root.append(mine);
    }

    const log = el('div', 'cp-box cp-log');
    for (const line of s.log.slice(-7)) {
      const p = el('div');
      line.split(/(@\d)/).forEach((part) => {
        if (/^@\d$/.test(part)) { const b = el('b', null, nm(table, Number(part[1]))); b.style.color = color(Number(part[1])); p.append(b); }
        else if (part) p.append(document.createTextNode(part));
      });
      log.append(p);
    }
    root.append(log);
    container.append(root);
  }

  function rerender() {
    if (!current) return;
    current.container.replaceChildren();
    build(current.container, current.ctx);
  }

  function register(id, name, blurb) {
    GPGames.register({
      id,
      name,
      blurb,
      errors: ERRORS,
      leaveWarning: 'Quitter la partie ? Ton équipe la perdra (on ne peut pas jouer à 3).',
      isMyTurn: (table) => table.state.hints.actions.length > 0,
      status(table) {
        const s = table.state;
        const mine = myTeam(table);
        if (s.phase === 'over' && table.spectator) return `${teamLabel(table, s.winnerTeam)} gagne`;
        if (s.phase === 'over') return s.winnerTeam === mine ? 'Votre équipe gagne ! 🎉' : 'L’équipe adverse gagne';
        if (s.phase === 'roundover') return `Donne ${s.round} terminée`;
        if (s.phase === 'surcontre') return s.turn === table.me ? 'Surcontres-tu ?' : `${nm(table, s.turn)} décide de surcontrer`;
        if (['bid1', 'bid2', 'bid'].includes(s.phase)) return s.turn === table.me ? 'À toi de parler' : `Enchères · ${nm(table, s.turn)} parle`;
        return s.turn === table.me ? 'À toi de jouer' : `Au tour de ${nm(table, s.turn)}`;
      },
      render(container, ctx) {
        current = { container, ctx };
        build(container, ctx);
      },
    });
  }

  register('belote', 'Belote', '4 joueurs · 2 équipes (1er+3e / 2e+4e) · prise, annonces · en 501');
  register('coinche', 'Belote contrée', '4 joueurs · 2 équipes · contrats, contre, surcontre, annonces · en 1000');
})();
