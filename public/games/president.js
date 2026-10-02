'use strict';
// Rendu du Président. Aucune règle ici : le serveur envoie la main du joueur, le pli,
// et `hints` (cartes jouables, nombre de cartes attendu, actions possibles).

(() => {
  const { el, color, nm } = GPCards.ui;
  const { rankOf, rankName } = GPCards;
  const MEDAL = ['🥇', '🥈', '🥉'];

  let sel = new Set();   // cartes levées
  let current = null;    // { container, ctx } pour redessiner localement

  const ERRORS = {
    'bad-cards': 'Choisis de 1 à 4 cartes.',
    'not-same-rank': 'Les cartes doivent avoir le même rang.',
    'wrong-count': 'Il faut poser le même nombre de cartes.',
    'too-low': 'Il faut un rang strictement supérieur.',
    'not-in-hand': 'Tu n’as pas ces cartes.',
    'must-lead': 'Tu entames : tu ne peux pas passer.',
  };

  const placeText = (p) => (p.place ? (MEDAL[p.place - 1] ?? `${p.place}e`) : '');

  function button(label, onClick, cls, disabled) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  function drawPlayers(table, s) {
    const box = el('div', 'cp-box cp-players');
    s.players.forEach((p, i) => {
      const row = el('div', 'cp-p' + (i === s.turn && s.phase === 'play' ? ' turn' : '') + (p.out || p.left ? ' out' : ''));
      const dot = el('i');
      dot.style.background = color(i);
      row.append(dot, el('b', null, nm(table, i) + (i === table.me ? ' (toi)' : '')));
      const chips = el('span', 'chips');
      if (p.left) chips.append(el('span', 'chip', 'parti'));
      else if (s.phase === 'play' && p.out) chips.append(el('span', 'chip ok', `a fini ${placeText(p)}`));
      else chips.append(el('span', 'chip', `${p.count} carte${p.count > 1 ? 's' : ''}`));
      if (s.phase === 'play' && p.passed) chips.append(el('span', 'chip', 'a passé'));
      if (p.role && p.role !== 'Neutre') chips.append(el('span', 'chip now', p.role));
      chips.append(el('span', 'chip', `${p.points} pt${p.points > 1 ? 's' : ''}`));
      row.append(chips);
      box.append(row);
    });
    return box;
  }

  function drawTable(table, s) {
    const box = el('div', 'cp-box cp-table');
    if (s.phase === 'play') {
      if (s.trick) {
        box.append(el('div', 'cp-info', `Pli : ${nm(table, s.trick.by)} a posé ${s.trick.count} carte${s.trick.count > 1 ? 's' : ''}`));
        const row = el('div', 'cards-row');
        for (const c of s.trick.cards) row.append(GPCards.face(c));
        box.append(row);
      } else {
        box.append(el('div', 'cp-info', `${nm(table, s.turn)} entame un nouveau pli`));
        box.append(GPCards.back());
      }
    }
    return box;
  }

  function drawResults(table, s) {
    const box = el('div', 'cp-box');
    if (!s.results) return box;
    box.append(el('div', 'cp-info', s.phase === 'over' ? 'Classement final' : `Fin de la manche ${s.round}`));
    s.results.order.forEach((i, k) => {
      const p = s.players[i];
      const row = el('div', 'cp-p');
      const dot = el('i');
      dot.style.background = color(i);
      row.append(dot, el('b', null, `${MEDAL[k] ?? `${k + 1}e`} ${nm(table, i)}`));
      const chips = el('span', 'chips');
      if (p.role && p.role !== 'Neutre') chips.append(el('span', 'chip now', p.role));
      chips.append(el('span', 'chip', `${p.points} pt${p.points > 1 ? 's' : ''} au total`));
      row.append(chips);
      box.append(row);
    });
    return box;
  }

  function validPlay(s, hand) {
    const cards = [...sel];
    if (cards.length < 1 || cards.length > 4) return false;
    if (new Set(cards.map(rankOf)).size !== 1) return false;
    if (s.hints.need !== null && cards.length !== s.hints.need) return false;
    return cards.every((c) => s.hints.playable.includes(c)) && cards.every((c) => hand.includes(c));
  }

  function onCard(s, c) {
    const h = s.hints;
    if (h.actions.includes('give')) { // échange : on choisit librement `count` cartes à rendre
      if (sel.has(c)) sel.delete(c);
      else if (sel.size < h.give.count) sel.add(c);
    } else if (h.need !== null) { // on répond : le bon nombre de cartes du même rang se sélectionne seul
      const same = s.hand.filter((x) => rankOf(x) === rankOf(c)).slice(0, h.need);
      const already = same.length === sel.size && same.every((x) => sel.has(x));
      sel = already ? new Set() : new Set(same);
    } else { // on entame : 1 à 4 cartes du même rang
      if (sel.has(c)) sel.delete(c);
      else {
        if ([...sel].some((x) => rankOf(x) !== rankOf(c))) sel = new Set();
        sel.add(c);
      }
    }
    rerender();
  }

  function build(container, ctx) {
    const { table, send } = ctx;
    const s = table.state;
    const h = s.hints;
    sel = new Set([...sel].filter((c) => s.hand.includes(c)));
    const root = el('div', 'cp-root');

    const head = el('div', 'cp-info', s.phase === 'over' ? 'Partie terminée' : `Manche ${s.round} sur ${s.rounds}`);
    root.append(head, drawPlayers(table, s));
    if (s.phase === 'play') root.append(drawTable(table, s));
    if (s.results) root.append(drawResults(table, s));

    // Zone d'action selon la phase.
    const actions = el('div', 'cp-box');
    const info = (t) => actions.append(el('div', 'cp-info', t));
    if (s.phase === 'play') {
      if (s.turn === table.me) info(h.need === null ? 'À toi d’entamer : pose 1 à 4 cartes de même rang.' : `À toi : pose ${h.need} carte${h.need > 1 ? 's' : ''} de rang supérieur, ou passe.`);
      else info(`Au tour de ${nm(table, s.turn)}…`);
    } else if (s.phase === 'exchange') {
      if (h.actions.includes('give')) {
        info(`Échange : tu as reçu ${h.give.received.map((c) => rankName(rankOf(c))).join(' et ')}. Rends ${h.give.count} carte${h.give.count > 1 ? 's' : ''} à ${nm(table, h.give.to)}.`);
      } else info('Échange de cartes en cours…');
    } else if (s.phase === 'roundover') {
      const live = s.players.filter((p) => !p.left);
      info(`${live.filter((p) => p.ready).length} / ${live.length} prêts pour la manche suivante`);
    }
    const row = el('div', 'cp-btns');
    if (h.actions.includes('play')) row.append(button(`Jouer${sel.size ? ` (${sel.size})` : ''}`, () => { send({ type: 'play', cards: [...sel] }); sel = new Set(); }, '', !validPlay(s, s.hand)));
    if (h.actions.includes('pass')) row.append(button('Passer', () => send({ type: 'pass' }), 'sec'));
    if (h.actions.includes('give')) row.append(button(`Rendre (${sel.size}/${h.give.count})`, () => { send({ type: 'give', cards: [...sel] }); sel = new Set(); }, '', sel.size !== h.give.count));
    if (h.actions.includes('ready')) row.append(button('Manche suivante', () => send({ type: 'ready' })));
    if (row.childElementCount) actions.append(row);
    if (actions.childElementCount) root.append(actions);

    if (s.hand.length && s.phase !== 'over') {
      const mine = el('div', 'cp-box');
      mine.append(el('div', 'cp-info', `Ta main (${s.hand.length})`));
      let enabled = new Set();
      if (h.actions.includes('play')) enabled = new Set(h.playable);
      else if (h.actions.includes('give')) enabled = null;
      GPCards.hand(mine, s.hand, { selected: sel, enabled, onToggle: (c) => onCard(s, c) });
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
    id: 'president',
    name: 'Président',
    blurb: '3 à 6 joueurs · 3 manches · échange de cartes · l’hôte lance',
    errors: ERRORS,
    leaveWarning: 'Quitter la partie ? Tes cartes seront écartées.',
    isMyTurn: (table) => table.state.hints.actions.length > 0,
    status(table) {
      const s = table.state;
      if (s.phase === 'over') return s.winners.length === 1 ? (s.winners[0] === table.me ? 'Tu remportes la partie ! 🎉' : `${nm(table, s.winners[0])} remporte la partie`) : 'Égalité en tête !';
      if (s.phase === 'roundover') return `Manche ${s.round} terminée`;
      if (s.phase === 'exchange') return 'Échange de cartes';
      return s.turn === table.me ? 'À toi de jouer' : `Au tour de ${nm(table, s.turn)}`;
    },
    render(container, ctx) {
      current = { container, ctx };
      build(container, ctx);
    },
  });
})();
