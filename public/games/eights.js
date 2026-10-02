'use strict';
// Rendu du 8 américain. Aucune règle ici : le serveur envoie la main, la défausse et
// `hints` (cartes jouables, actions : jouer / piocher / passer).

(() => {
  const { el, color, nm } = GPCards.ui;
  const { rankOf } = GPCards;
  const SUITS = ['C', 'D', 'H', 'S'];

  let sel = null;       // carte levée
  let current = null;

  const ERRORS = {
    'not-playable': 'Cette carte ne peut pas être jouée.',
    'must-defend': 'Un 2 t’attend : défends-toi avec un 2 ou pioche.',
    'must-play': 'Tu as une carte jouable : tu ne peux pas piocher.',
    'already-drew': 'Tu as déjà pioché ce tour.',
    'choose-suit': 'Choisis la couleur demandée.',
    'must-draw': 'Pioche d’abord.',
  };

  function button(label, onClick, cls, disabled) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  function build(container, ctx) {
    const { table, send } = ctx;
    const s = table.state;
    const h = s.hints;
    if (sel && !s.hand.includes(sel)) sel = null;
    const root = el('div', 'cp-root');

    // Joueurs
    const players = el('div', 'cp-box cp-players');
    s.players.forEach((p, i) => {
      const row = el('div', 'cp-p' + (i === s.turn && s.winner === null ? ' turn' : '') + (p.left ? ' out' : ''));
      const dot = el('i');
      dot.style.background = color(i);
      row.append(dot, el('b', null, nm(table, i) + (i === table.me ? ' (toi)' : '')));
      const chips = el('span', 'chips');
      chips.append(el('span', 'chip', p.left ? 'parti' : `${p.count} carte${p.count > 1 ? 's' : ''}`));
      if (p.count === 1 && !p.left) chips.append(el('span', 'chip now', 'dernière carte !'));
      row.append(chips);
      players.append(row);
    });
    root.append(players);

    // Table : pioche, défausse, couleur demandée, sens
    const felt = el('div', 'cp-box cp-table');
    const row = el('div', 'cards-row');
    const pile = el('div', 'cp-table');
    pile.append(GPCards.back(), el('div', 'hint', `Pioche : ${s.drawCount}`));
    const disc = el('div', 'cp-table');
    disc.append(GPCards.face(s.top), el('div', 'hint', 'Défausse'));
    row.append(pile, disc);
    felt.append(row);
    const suit = el('div', 'cp-info');
    const sym = el('span', 'cp-big', GPCards.SYM[s.suit]);
    if (s.suit === 'H' || s.suit === 'D') sym.style.color = '#dc2626';
    suit.append(document.createTextNode('Couleur demandée : '), sym, document.createTextNode(`  ${s.dir === 1 ? '↻' : '↺'}`));
    felt.append(suit);
    if (s.pendingDraw > 0) felt.append(el('div', 'cp-info', `⚠️ +${s.pendingDraw} cartes à piocher ! Défends-toi avec un 2, ou pioche.`));
    root.append(felt);

    // Actions
    const actions = el('div', 'cp-box');
    if (s.winner !== null) {
      actions.append(el('div', 'cp-info', `${nm(table, s.winner)} a vidé sa main : victoire ! 🎉`));
    } else if (h.actions.length) {
      actions.append(el('div', 'cp-info', s.drew ? 'Tu as pioché : joue la carte ou passe.' : (h.playable.length ? 'À toi : pose une carte.' : 'Aucune carte jouable : pioche.')));
    } else {
      actions.append(el('div', 'cp-info', `Au tour de ${nm(table, s.turn)}…`));
    }
    const btns = el('div', 'cp-btns');
    if (h.actions.includes('play') && sel) {
      if (rankOf(sel) === '8') { // joker : on choisit la couleur en le jouant
        for (const su of SUITS) {
          const b = button(`8 → ${GPCards.SYM[su]}`, () => { send({ type: 'play', card: sel, suit: su }); sel = null; }, 'sec');
          if (su === 'H' || su === 'D') b.style.color = '#fca5a5';
          btns.append(b);
        }
      } else btns.append(button('Jouer', () => { send({ type: 'play', card: sel }); sel = null; }));
    }
    if (h.actions.includes('draw')) btns.append(button(s.pendingDraw > 0 ? `Piocher ${s.pendingDraw}` : 'Piocher', () => send({ type: 'draw' }), 'sec'));
    if (h.actions.includes('pass')) btns.append(button('Passer', () => send({ type: 'pass' }), 'sec'));
    if (btns.childElementCount) actions.append(btns);
    root.append(actions);

    // Main
    if (s.hand.length) {
      const mine = el('div', 'cp-box');
      mine.append(el('div', 'cp-info', `Ta main (${s.hand.length})`));
      const enabled = h.actions.includes('play') ? new Set(h.playable) : new Set();
      GPCards.hand(mine, s.hand, { selected: sel ? new Set([sel]) : null, enabled, onToggle: (c) => { sel = sel === c ? null : c; rerender(); } });
      root.append(mine);
    }

    const log = el('div', 'cp-box cp-log');
    for (const line of s.log.slice(-6)) {
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
    id: 'eights',
    name: '8 américain',
    blurb: '2 à 6 joueurs · 8 joker, 2 pioche, As passe, Valet inverse · l’hôte lance',
    errors: ERRORS,
    leaveWarning: 'Quitter la partie ? Tes cartes retournent à la pioche.',
    isMyTurn: (table) => table.state.hints.actions.length > 0,
    status(table) {
      const s = table.state;
      if (s.winner !== null) return s.winner === table.me ? 'Tu as gagné ! 🎉' : `${nm(table, s.winner)} a gagné`;
      return s.turn === table.me ? 'À toi de jouer' : `Au tour de ${nm(table, s.turn)}`;
    },
    render(container, ctx) {
      current = { container, ctx };
      build(container, ctx);
    },
  });
})();
