'use strict';
// Rendu du poker (Texas Hold'em sans limite). Aucune règle ici : le serveur envoie les
// jetons, le tableau, les mises et `hints` (actions possibles, relance minimale et maximale).

(() => {
  const { el, color, nm } = GPCards.ui;

  let raiseTo = null; // montant choisi sur le curseur de relance
  let raiseKey = null; // moment d'enchères auquel ce montant se rapporte

  const ERRORS = {
    'must-call': 'Il y a une mise : suis, relance ou couche-toi.',
    'nothing-to-call': 'Rien à suivre : tu peux parler (check).',
    'raise-too-small': 'Relance trop petite.',
    'cannot-raise': 'Tu ne peux plus relancer (tapis incomplet) : suis ou couche-toi.',
    'bad-amount': 'Montant invalide.',
  };

  const STREET = { preflop: 'Pré-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

  function button(label, onClick, cls, disabled) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  // Ligne de journal : « @2 » devient le nom du joueur en couleur.
  function logLine(table, line) {
    const p = el('div');
    line.split(/(@\d)/).forEach((part) => {
      if (/^@\d$/.test(part)) { const b = el('b', null, nm(table, Number(part[1]))); b.style.color = color(Number(part[1])); p.append(b); }
      else if (part) p.append(document.createTextNode(part));
    });
    return p;
  }

  function drawPlayers(table, s) {
    const box = el('div', 'cp-box cp-players');
    const won = new Set((s.result?.pots ?? []).flatMap((p) => p.winners));
    s.players.forEach((p, i) => {
      const out = p.left || (!p.inHand && p.chips === 0);
      const row = el('div', 'cp-p' + (i === s.turn && s.phase === 'betting' ? ' turn' : '') + (out || p.folded ? ' out' : ''));
      const dot = el('i');
      dot.style.background = color(i);
      const who = el('b', null, nm(table, i) + (i === table.me ? ' (toi)' : ''));
      row.append(dot, who);
      if (i === s.dealer && !out) row.append(el('span', 'pk-btn', 'D'));
      const chips = el('span', 'chips');
      if (p.left) chips.append(el('span', 'chip', 'parti'));
      else if (out) chips.append(el('span', 'chip', 'éliminé'));
      else {
        chips.append(el('span', 'chip pk-stack', `${p.chips} 🪙`));
        if (p.bet > 0) chips.append(el('span', 'chip now', `mise ${p.bet}`));
        if (p.folded) chips.append(el('span', 'chip', 'couché'));
        if (p.allIn) chips.append(el('span', 'chip pk-allin', 'tapis'));
        if (s.phase !== 'betting' && won.has(i)) chips.append(el('span', 'chip ok', 'gagne'));
      }
      row.append(chips);
      // Cartes montrées à l'abattage, avec le nom de la combinaison.
      if (p.cards) {
        const shown = el('div', 'pk-shown');
        for (const c of p.cards) shown.append(GPCards.face(c, { small: true }));
        const hand = s.result?.hands?.[i];
        if (hand) shown.append(el('span', 'hint', hand.name));
        row.append(shown);
      }
      box.append(row);
    });
    return box;
  }

  function drawBoard(s) {
    const felt = el('div', 'cp-box pk-felt');
    const row = el('div', 'pk-board');
    for (let k = 0; k < 5; k++) row.append(s.board[k] ? GPCards.face(s.board[k]) : el('div', 'card pk-empty'));
    felt.append(row);
    const info = el('div', 'cp-info pk-info');
    if (s.phase === 'betting') info.textContent = `${STREET[s.street]} · Pot ${s.pot}`;
    else if (s.result) info.textContent = `Pot ${s.result.pots.reduce((t, p) => t + p.amount, 0)}`;
    felt.append(info);
    const next = s.blindEvery - ((s.handNo - 1) % s.blindEvery) - 1;
    felt.append(el('div', 'hint', `Main n° ${s.handNo} · blindes ${s.blinds[0]}/${s.blinds[1]}` + (next > 0 ? ` · elles doublent dans ${next} main${next > 1 ? 's' : ''}` : ' · elles doublent à la prochaine main')));
    return felt;
  }

  // Panneau de relance : curseur + raccourcis (min, ½ pot, pot, tapis).
  function raisePanel(s, box, send) {
    const h = s.hints;
    const key = `${s.handNo}/${s.street}/${s.currentBet}`;
    if (raiseKey !== key || raiseTo === null) { raiseKey = key; raiseTo = h.minRaise; }
    raiseTo = Math.min(Math.max(raiseTo, h.minRaise), h.maxRaise);
    const bet = s.currentBet === 0;

    const panel = el('div', 'pk-raise');
    const slider = el('input');
    slider.type = 'range';
    slider.min = h.minRaise;
    slider.max = h.maxRaise;
    slider.step = s.blinds[0];
    slider.value = raiseTo;
    slider.setAttribute('aria-label', 'Montant de la relance');
    const go = button('', () => send({ type: raiseTo >= h.maxRaise ? 'allin' : 'raise', to: raiseTo }));
    const label = () => { go.textContent = raiseTo >= h.maxRaise ? `Tapis (${h.maxRaise})` : `${bet ? 'Miser' : 'Relancer à'} ${raiseTo}`; };
    slider.addEventListener('input', () => { raiseTo = Number(slider.value); if (raiseTo > h.maxRaise - s.blinds[0]) raiseTo = h.maxRaise; label(); });
    label();

    // Raccourcis : pot calculé comme si l'on suivait d'abord (règle du « pot-size raise »).
    const quick = el('div', 'cp-btns');
    const potAfterCall = s.pot + h.toCall;
    const preset = (text, to) => {
      const v = Math.min(Math.max(to, h.minRaise), h.maxRaise);
      quick.append(button(text, () => { raiseTo = v; slider.value = v; label(); }, 'sec'));
    };
    preset('Min', h.minRaise);
    preset('½ pot', s.currentBet + Math.floor(potAfterCall / 2));
    preset('Pot', s.currentBet + potAfterCall);
    preset('Tapis', h.maxRaise);
    panel.append(slider, quick, el('div', 'cp-btns'));
    panel.lastChild.append(go);
    box.append(panel);
  }

  function drawActions(ctx, table, s) {
    const { send } = ctx;
    const h = s.hints;
    const box = el('div', 'cp-box');
    const info = (t) => box.append(el('div', 'cp-info', t));
    const btns = el('div', 'cp-btns');

    if (s.phase === 'betting') {
      if (h.actions.length) {
        info(h.toCall > 0 ? `À toi : ${h.toCall} pour suivre.` : 'À toi de parler.');
        btns.append(button('Se coucher', () => send({ type: 'fold' }), 'danger'));
        if (h.actions.includes('check')) btns.append(button('Parole (check)', () => send({ type: 'check' }), 'sec'));
        if (h.actions.includes('call')) btns.append(button(h.toCall >= s.players[table.me].chips ? `Suivre à tapis (${h.toCall})` : `Suivre ${h.toCall}`, () => send({ type: 'call' }), 'sec'));
        if (!h.actions.includes('raise') && h.actions.includes('allin')) btns.append(button(`Tapis (${h.maxRaise})`, () => send({ type: 'allin' })));
        box.append(btns);
        if (h.actions.includes('raise')) raisePanel(s, box, send);
        return box;
      }
      info(`Au tour de ${nm(table, s.turn)}…`);
    } else if (s.phase === 'result') {
      const ready = s.ready.filter(Boolean).length;
      info(s.result.showdown ? 'Abattage !' : 'Main terminée.');
      // Pot principal puis pots annexes : qui gagne quoi, et avec quelle combinaison.
      for (const pot of s.result.pots) {
        const who = pot.winners.map((w) => `@${w}`).join(' et ');
        const how = s.result.showdown ? ` avec : ${s.result.hands[pot.winners[0]].name}` : '';
        const line = logLine(table, `${who} ${pot.winners.length > 1 ? 'partagent' : 'remporte'} ${pot.amount}${how}`);
        line.classList.add('pk-center');
        box.append(line);
      }
      info(`Prêts pour la main suivante : ${ready} / ${s.ready.length}`);
      if (h.actions.includes('ready')) btns.append(button('Main suivante', () => send({ type: 'ready' })));
    } else if (s.phase === 'over') {
      if (s.winner === null) info('Partie terminée.');
      else if (s.winner === table.me) info('Tu as tous les jetons : tu remportes le tournoi ! 🏆');
      else info(`${nm(table, s.winner)} remporte le tournoi 🏆`);
    }
    if (btns.childElementCount) box.append(btns);
    return box;
  }

  function build(container, ctx) {
    const { table } = ctx;
    const s = table.state;
    const root = el('div', 'cp-root');
    root.append(drawPlayers(table, s), drawBoard(s), drawActions(ctx, table, s));

    if (s.hand.length) {
      const mine = el('div', 'cp-box');
      mine.append(el('div', 'cp-info', 'Tes cartes'));
      GPCards.hand(mine, s.hand);
      root.append(mine);
    }

    const log = el('div', 'cp-box cp-log');
    for (const line of s.log.slice(-8)) log.append(logLine(table, line));
    root.append(log);
    container.append(root);
    log.scrollTop = log.scrollHeight;
  }

  GPGames.register({
    id: 'poker',
    name: 'Poker',
    blurb: '2 à 8 joueurs · Texas Hold’em sans limite, en tournoi · l’hôte lance',
    errors: ERRORS,
    leaveWarning: 'Quitter le tournoi ? Tu te couches et tes jetons sortent du jeu.',
    isMyTurn: (table) => table.state.hints.actions.length > 0,
    status(table) {
      const s = table.state;
      if (s.phase === 'over') {
        if (s.winner === null) return 'Partie terminée';
        return s.winner === table.me ? 'Tu as gagné ! 🏆' : `${nm(table, s.winner)} a gagné`;
      }
      if (s.phase === 'result') return 'Fin de la main';
      return s.turn === table.me ? 'À toi de jouer' : `Au tour de ${nm(table, s.turn)}`;
    },
    render: build,
  });
})();
