'use strict';
// Rendu de Menteur. Aucune règle ici : le serveur envoie ta main, le nombre de cartes du
// tas, la dernière annonce (jamais les cartes posées) et, après une contestation, les
// cartes révélées. `hints` dit si tu peux poser, accuser ou accepter.

(() => {
  const { el, color, nm } = GPCards.ui;
  const { rankName } = GPCards;

  let sel = new Set();
  let current = null;

  const ERRORS = {
    'bad-cards': 'Pose de 1 à 4 cartes.',
    'not-in-hand': 'Tu n’as pas ces cartes.',
    'must-respond': 'Il a posé sa dernière carte : accuse-le ou accepte.',
    'nothing-to-call': 'Rien à contester.',
  };

  function button(label, onClick, cls, disabled) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

  function build(container, ctx) {
    const { table, send } = ctx;
    const s = table.state;
    const h = s.hints;
    sel = new Set([...sel].filter((c) => s.hand.includes(c)));
    const root = el('div', 'cp-root');

    const players = el('div', 'cp-box cp-players');
    s.players.forEach((p, i) => {
      const row = el('div', 'cp-p' + (i === s.turn && s.winner === null ? ' turn' : '') + (p.left ? ' out' : ''));
      const dot = el('i');
      dot.style.background = color(i);
      row.append(dot, el('b', null, nm(table, i) + (i === table.me ? ' (toi)' : '')));
      const chips = el('span', 'chips');
      chips.append(el('span', 'chip', p.left ? 'parti' : plural(p.count, 'carte')));
      if (s.last && s.last.p === i) chips.append(el('span', 'chip now', 'vient de poser'));
      row.append(chips);
      players.append(row);
    });
    root.append(players);

    // Tas et annonce
    const felt = el('div', 'cp-box cp-table');
    const stack = el('div', 'cards-row');
    stack.append(GPCards.back(), el('div', 'hint', `Tas : ${plural(s.pile, 'carte')}`));
    felt.append(stack);
    if (s.winner === null) {
      felt.append(el('div', 'cp-info', `Rang à annoncer : ${rankName(s.claim, true)}`));
      if (s.last) felt.append(el('div', 'hint', `${nm(table, s.last.p)} a posé ${plural(s.last.count, 'carte')} en annonçant : ${rankName(s.last.rank, true)}.`));
    }
    root.append(felt);

    // Résultat de la dernière contestation
    if (s.reveal) {
      const r = el('div', 'cp-box cp-table');
      r.append(el('div', 'cp-info', `${nm(table, s.reveal.caller)} a accusé ${nm(table, s.reveal.target)} : cartes retournées (annoncées : ${rankName(s.reveal.rank, true)})`));
      const row = el('div', 'cards-row');
      for (const c of s.reveal.cards) row.append(GPCards.face(c, { small: true }));
      r.append(row);
      r.append(el('div', 'cp-info', s.reveal.truthful
        ? `Il disait vrai ! ${nm(table, s.reveal.loser)} ramasse ${plural(s.reveal.taken, 'carte')}.`
        : `Il mentait ! ${nm(table, s.reveal.loser)} ramasse ${plural(s.reveal.taken, 'carte')}.`));
      root.append(r);
    }

    // Actions
    const actions = el('div', 'cp-box');
    if (s.winner !== null) actions.append(el('div', 'cp-info', `${nm(table, s.winner)} a vidé sa main : victoire ! 🎉`));
    else if (s.pendingWin !== null) {
      actions.append(el('div', 'cp-info', h.actions.length
        ? `${nm(table, s.pendingWin)} a posé ses dernières cartes : accuse-le, ou accepte sa victoire.`
        : `${nm(table, s.pendingWin)} a posé ses dernières cartes : ${nm(table, s.turn)} doit trancher…`));
    } else if (h.actions.length) {
      actions.append(el('div', 'cp-info', s.last ? 'À toi : accuse-le de mentir, ou pose tes cartes.' : 'À toi : pose 1 à 4 cartes (tu peux mentir).'));
    } else actions.append(el('div', 'cp-info', `Au tour de ${nm(table, s.turn)}…`));

    const btns = el('div', 'cp-btns');
    if (h.actions.includes('play')) {
      btns.append(button(sel.size ? `Poser ${plural(sel.size, 'carte')} : « ${rankName(s.claim)} »` : `Choisis des cartes à poser (« ${rankName(s.claim)} »)`,
        () => { send({ type: 'play', cards: [...sel] }); sel = new Set(); }, '', sel.size < 1 || sel.size > 4));
    }
    if (h.actions.includes('call')) btns.append(button('🔥 Menteur !', () => send({ type: 'call' }), 'danger'));
    if (h.actions.includes('accept')) btns.append(button('Accepter', () => send({ type: 'accept' }), 'sec'));
    if (btns.childElementCount) actions.append(btns);
    root.append(actions);

    if (s.hand.length) {
      const mine = el('div', 'cp-box');
      mine.append(el('div', 'cp-info', `Ta main (${s.hand.length})`));
      const canPlay = h.actions.includes('play');
      GPCards.hand(mine, s.hand, {
        selected: sel,
        enabled: canPlay ? null : new Set(),
        onToggle: (c) => { if (sel.has(c)) sel.delete(c); else if (sel.size < 4) sel.add(c); rerender(); },
      });
      root.append(mine);
    }

    const log = el('div', 'cp-box cp-log');
    for (const line of s.log.slice(-8)) {
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
    id: 'liar',
    name: 'Menteur',
    blurb: '3 à 8 joueurs · pose, bluffe, contredis · l’hôte lance',
    errors: ERRORS,
    leaveWarning: 'Quitter la partie ? Tes cartes sortent du jeu.',
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
