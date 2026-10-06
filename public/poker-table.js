'use strict';
// Table de poker dessinée (partagée par « Poker » et « Jetons de poker ») : tapis ovale
// avec rebord, joueurs assis autour, mises posées devant chaque siège, bouton du donneur,
// et un centre libre (cartes communes, pot) fourni par le jeu. Aucune règle ici.
//
// GPPokerTable.render({ seats, center, base }) → élément
//   seats : [{ idx, name, color, amount, badge, badgeCls, turn, out, win, dealer, bet, cards, me }]
//           amount : texte du tapis ; bet / cards : nœuds DOM ou null (cartes : en grand
//           devant soi, en petit au-dessus du siège pour les autres).
//   center : nœud placé au milieu du tapis.
//   base : index du joueur assis en bas (soi-même), sinon le premier siège.
// Le joueur suivant est à gauche de celui du bas, comme autour d'une vraie table.

window.GPPokerTable = (() => {
  const { el } = GPCards.ui;

  // Place `node` sur l'ellipse des sièges : r = 1 sur le rebord, r < 1 vers le centre.
  // --px / --py (CSS) gardent les sièges des bords à l'intérieur de l'écran.
  function place(node, angle, r, dy = 0) {
    const x = (Math.cos(angle) * r).toFixed(4);
    const y = (Math.sin(angle) * r).toFixed(4);
    node.style.left = `calc(50% + ${x} * (50% - var(--px)))`;
    node.style.top = `calc(50% + ${y} * (50% - var(--py)) + ${dy}px)`;
  }

  function seatNode(s) {
    const box = el('div', 'pt-seat' + (s.turn ? ' turn' : '') + (s.out ? ' out' : '') + (s.win ? ' win' : '') + (s.me ? ' me' : ''));
    box.style.setProperty('--pc', s.color);
    box.append(el('b', 'pt-name', s.name));
    if (s.amount !== undefined && s.amount !== null) box.append(el('span', 'pt-amount', s.amount));
    if (s.badge) box.append(el('span', 'pt-badge' + (s.badgeCls ? ' ' + s.badgeCls : ''), s.badge));
    // Cartes des adversaires et bouton du donneur accrochés au siège : rien ne déborde sur le tableau.
    if (s.cards && !s.me) { const c = el('div', 'pt-hole'); c.append(s.cards); box.append(c); }
    if (s.dealer) {
      const d = el('span', 'pt-dealer', 'D');
      d.setAttribute('aria-label', 'Donneur');
      box.append(d);
    }
    return box;
  }

  function render({ seats, center, base }) {
    const root = el('div', 'pt');
    const rail = el('div', 'pt-rail');
    const felt = el('div', 'pt-felt');
    rail.append(felt);
    root.append(rail);

    const mid = el('div', 'pt-center');
    if (center) mid.append(center);
    root.append(mid);

    const n = seats.length;
    const k0 = Math.max(0, seats.findIndex((s) => s.idx === base));
    seats.forEach((s, k) => {
      // Bas de l'écran = π/2 ; sens horaire à l'écran = vers la gauche de celui du bas.
      const a = Math.PI / 2 + (2 * Math.PI * (k - k0)) / n;
      const seat = seatNode(s);
      place(seat, a, 1);
      root.append(seat);
      // Ses propres cartes, en grand, devant soi.
      if (s.cards && s.me) {
        const c = el('div', 'pt-cards');
        c.append(s.cards);
        place(c, a, 0.6);
        root.append(c);
      }
      // Mise posée sur le tapis devant le joueur ; sur les côtés, sous le siège, pour ne pas
      // recouvrir les cartes communes.
      if (s.bet) {
        const b = el('div', 'pt-bet');
        b.append(s.bet);
        if (Math.abs(Math.cos(a)) > 0.75) place(b, a, 0.82, 46);
        else place(b, a, s.me ? 0.34 : 0.45);
        root.append(b);
      }
    });
    return root;
  }

  return { render };
})();
