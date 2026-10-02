'use strict';
// Rendu de la belote. Aucune règle ici : le serveur envoie ta main, le pli, les scores et
// `hints` (actions possibles, cartes légales, couleurs prenables). La table est dessinée
// vue de dessus : toi en bas, ton partenaire en face. On joue dans le sens inverse des
// aiguilles d'une montre (le joueur suivant est à ta droite), comme en France.

(() => {
  const { el, color, nm } = GPCards.ui;
  const { SYM, SUIT_NAME } = GPCards;

  let sel = null;
  let current = null;

  const ERRORS = {
    'illegal-card': 'Carte interdite : il faut fournir, couper ou monter à l’atout.',
    'bad-suit': 'Choisis une autre couleur que la carte retournée.',
    'not-in-hand': 'Tu n’as pas cette carte.',
  };

  const suitText = (s) => `${SYM[s]} ${SUIT_NAME[s]}`;
  const redSuit = (s) => s === 'H' || s === 'D';

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

  function seatBox(table, s, seat) {
    const me = table.me;
    const box = el('div', `bl-seat ${posOf(me, seat)}` + (s.turn === seat && s.phase !== 'roundover' && s.phase !== 'over' ? ' turn' : ''));
    const team = seat % 2 === me % 2 ? 'ours' : 'theirs';
    box.classList.add(team);
    const dot = el('i');
    dot.style.background = color(seat);
    box.append(dot, el('b', null, nm(table, seat) + (seat === me ? ' (toi)' : '')));
    const chips = el('div', 'chips');
    if (s.dealer === seat) chips.append(el('span', 'chip', 'donneur'));
    if (s.taker === seat) chips.append(el('span', 'chip now', `preneur ${s.trump ? SYM[s.trump] : ''}`));
    if (seat !== me && s.phase === 'play') chips.append(el('span', 'chip', `${s.counts[seat]} 🂠`));
    box.append(chips);
    return box;
  }

  function drawTable(table, s) {
    const me = table.me;
    const felt = el('div', 'bl-felt');
    for (let seat = 0; seat < 4; seat++) felt.append(seatBox(table, s, seat));

    const centre = el('div', 'bl-centre');
    if (s.phase === 'bid1' || s.phase === 'bid2') {
      centre.append(el('div', 'hint', 'Carte retournée'), GPCards.face(s.turned));
      centre.append(el('div', 'hint', s.phase === 'bid1' ? `Tour 1 : prendre à ${SYM[s.turned.slice(-1)]}` : 'Tour 2 : une autre couleur'));
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
    const mine = me % 2;
    const bar = el('div', 'bl-scores');
    const teamNames = (t) => [t, t + 2].map((i) => (i === me ? 'toi' : nm(table, i))).join(' & ');
    const box = (t, label) => {
      const b = el('div', 'bl-score' + (t === mine ? ' ours' : ''));
      b.append(el('b', null, `${label} : ${s.scores[t]}`), el('div', 'hint', teamNames(t)));
      return b;
    };
    bar.append(box(mine, 'Nous'), box(1 - mine, 'Eux'));
    const trump = el('div', 'bl-trump');
    trump.append(el('div', 'hint', `Objectif ${s.target}`));
    if (s.trump) {
      const sym = el('span', 'cp-big', SYM[s.trump]);
      if (redSuit(s.trump)) sym.style.color = '#dc2626';
      trump.append(el('div', 'hint', 'Atout'), sym);
    } else trump.append(el('div', 'hint', `Donne ${s.round}`));
    bar.append(trump);
    return bar;
  }

  function drawActions(ctx, table, s) {
    const { send } = ctx;
    const h = s.hints;
    const box = el('div', 'cp-box');
    const info = (t) => box.append(el('div', 'cp-info', t));
    const btns = el('div', 'cp-btns');

    if (s.phase === 'bid1' || s.phase === 'bid2') {
      if (h.actions.length) {
        info(s.phase === 'bid1' ? `À toi : prends-tu à ${suitText(s.turned.slice(-1))} ?` : 'À toi : prends dans une autre couleur, ou passe.');
        if (s.phase === 'bid1') btns.append(button(`Je prends à ${SYM[s.turned.slice(-1)]}`, () => send({ type: 'take' })));
        else for (const su of h.suits) btns.append(button(`Prendre ${SYM[su]}`, () => send({ type: 'take', suit: su }), 'sec'));
        btns.append(button('Passer', () => send({ type: 'pass' }), 'sec'));
      } else info(`Au tour de ${nm(table, s.turn)} de parler…`);
    } else if (s.phase === 'play') {
      if (h.actions.length) {
        info('À toi de jouer.');
        btns.append(button(sel ? 'Jouer la carte' : 'Choisis une carte', () => { send({ type: 'play', card: sel }); sel = null; }, '', !sel));
      } else info(`Au tour de ${nm(table, s.turn)}…`);
    } else if (s.phase === 'roundover') {
      info(`${s.ready.filter(Boolean).length} / 4 prêts pour la donne suivante`);
      if (h.actions.includes('ready')) btns.append(button('Donne suivante', () => send({ type: 'ready' })));
    } else if (s.phase === 'over') {
      const mine = s.winnerTeam === table.me % 2;
      if (s.forfeit) info('Un joueur a quitté la partie.');
      info(mine ? 'Votre équipe remporte la partie ! 🎉' : 'L’équipe adverse remporte la partie.');
    }
    if (btns.childElementCount) box.append(btns);
    return box;
  }

  function drawResult(table, s) {
    const r = s.result;
    if (!r) return null;
    const me = table.me % 2;
    const lab = (t) => (t === me ? 'Nous' : 'Eux');
    const box = el('div', 'cp-box');
    box.append(el('div', 'cp-info', `Fin de la donne ${s.round}`));
    const lines = [];
    lines.push(`Preneur : ${lab(r.takerTeam)} — ${r.capot !== null ? 'CAPOT ! ' : ''}${r.made ? 'contrat rempli' : 'contrat chuté'}`);
    if (r.capot === null) lines.push(`Points de cartes (+10 de der) : Nous ${r.cardPts[me]} · Eux ${r.cardPts[1 - me]}`);
    if (r.belote !== null) lines.push(`Belote-rebelote : ${lab(r.belote)} (+20)`);
    lines.push(`Marqué : Nous +${r.add[me]} · Eux +${r.add[1 - me]}`);
    lines.push(`Total : Nous ${s.scores[me]} · Eux ${s.scores[1 - me]}`);
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
    const root = el('div', 'cp-root');

    root.append(drawScores(table, s), drawTable(table, s), drawActions(ctx, table, s));
    const res = drawResult(table, s);
    if (res) root.append(res);
    const last = drawLastTrick(table, s);
    if (last) root.append(last);

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

  GPGames.register({
    id: 'belote',
    name: 'Belote',
    blurb: '4 joueurs · 2 équipes (1er+3e / 2e+4e) · en 501',
    errors: ERRORS,
    leaveWarning: 'Quitter la partie ? Ton équipe la perdra (on ne peut pas jouer à 3).',
    isMyTurn: (table) => table.state.hints.actions.length > 0,
    status(table) {
      const s = table.state;
      const mine = table.me % 2;
      if (s.phase === 'over') return s.winnerTeam === mine ? 'Votre équipe gagne ! 🎉' : 'L’équipe adverse gagne';
      if (s.phase === 'roundover') return `Donne ${s.round} terminée`;
      if (s.phase === 'bid1' || s.phase === 'bid2') return s.turn === table.me ? 'À toi de parler' : `Enchères · ${nm(table, s.turn)} parle`;
      return s.turn === table.me ? 'À toi de jouer' : `Au tour de ${nm(table, s.turn)}`;
    },
    render(container, ctx) {
      current = { container, ctx };
      build(container, ctx);
    },
  });
})();
