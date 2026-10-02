'use strict';
// Rendu des échecs. Aucune règle ici : le serveur envoie le FEN et la liste des
// coups légaux ({ e2: ['e3','e4'], … }) ; on dessine, on gère la sélection et
// on envoie { type:'move', from, to, promotion? }.

(() => {
  // U+FE0E force l'affichage « texte » : sans lui, iOS dessine le pion ♟ en emoji.
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const glyph = (t) => GLYPH[t] + '︎';
  const PROMO = ['q', 'r', 'b', 'n'];
  const FILES = 'abcdefgh';
  const COLOR_EMOJI = { w: '⚪', b: '⚫' };

  const REASONS = {
    stalemate: 'Pat : match nul.',
    threefold: 'Nulle par triple répétition.',
    insufficient: 'Nulle : matériel insuffisant.',
    'fifty-moves': 'Nulle : règle des 50 coups.',
    agreement: 'Nulle par accord.',
  };

  const name = (table, idx) => table.players[idx]?.name ?? '?';
  const colorOf = (table, idx) => (table.state.white === idx ? 'w' : 'b');

  // FEN → grille 8×8 (ligne 0 = rang 8) de { type, color } ou null.
  function parseFen(fen) {
    return fen.split(' ')[0].split('/').map((row) => {
      const out = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push(null);
        else out.push({ type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' });
      }
      return out;
    });
  }

  // Sélection locale (case de départ) ; invalidée dès que la position change.
  let sel = null; // { fen, from }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function movesText(history) {
    const parts = [];
    history.forEach((san, i) => parts.push(i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san));
    return parts.join(' ');
  }

  function draw(root, ctx) {
    const { table, send, myTurn } = ctx;
    const s = table.state;
    root.replaceChildren();
    if (sel && sel.fen !== s.fen) sel = null;

    const myColor = table.spectator ? 'w' : colorOf(table, table.me); // spectateur : blancs en bas
    const grid = parseFen(s.fen);
    const legal = s.legal ?? {};
    const targets = sel ? legal[sel.from] ?? [] : [];

    // Case du roi en échec (celui dont c'est le tour).
    let checkSq = null;
    if (s.check) {
      const sideToMove = colorOf(table, s.turn);
      grid.forEach((row, r) => row.forEach((p, c) => {
        if (p && p.type === 'k' && p.color === sideToMove) checkSq = FILES[c] + (8 - r);
      }));
    }

    const legend = el('p', 'ch-legend');
    const whiteIdx = s.white;
    legend.textContent = [whiteIdx, 1 - whiteIdx] // blancs d'abord
      .map((i) => `${COLOR_EMOJI[colorOf(table, i)]} ${name(table, i)}${i === table.me ? ' (toi)' : ''}`)
      .join('   ');
    root.append(legend);

    const board = el('div', 'ch-board');
    const rows = myColor === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    const cols = myColor === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

    rows.forEach((r, ri) => cols.forEach((c, ci) => {
      const sq = FILES[c] + (8 - r);
      const piece = grid[r][c];
      const btn = el('button', 'sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark'));
      btn.type = 'button';
      btn.dataset.sq = sq;
      btn.setAttribute('aria-label', sq + (piece ? ` ${piece.color === 'w' ? 'blanc' : 'noir'}` : ''));
      if (ci === 0) btn.dataset.rank = String(8 - r);
      if (ri === 7) btn.dataset.file = FILES[c];
      if (s.lastMove && (s.lastMove.from === sq || s.lastMove.to === sq)) btn.classList.add('last');
      if (sq === checkSq) btn.classList.add('check');
      if (sel && sel.from === sq) btn.classList.add('sel');
      if (targets.includes(sq)) btn.classList.add(piece ? 'capture' : 'target');
      if (piece) {
        const g = el('span', 'pc ' + piece.color, glyph(piece.type));
        btn.append(g);
      }
      btn.disabled = !myTurn;
      btn.addEventListener('click', () => onSquare(root, ctx, grid, sq, piece, myColor));
      board.append(btn);
    }));
    root.append(board);

    if (ctx.promo) root.append(promoPicker(root, ctx));

    root.append(drawControls(table, send));

    if (s.history.length) {
      const list = el('div', 'ch-moves', movesText(s.history.slice(-24)));
      root.append(list);
      list.scrollTop = list.scrollHeight;
    }
  }

  function onSquare(root, ctx, grid, sq, piece, myColor) {
    const { table, send } = ctx;
    const s = table.state;
    const legal = s.legal ?? {};
    ctx.promo = null;

    // Clic sur une case d'arrivée possible : on joue (ou on demande la promotion).
    if (sel && (legal[sel.from] ?? []).includes(sq)) {
      const from = sel.from;
      const mover = grid[8 - Number(from[1])][FILES.indexOf(from[0])];
      const lastRank = myColor === 'w' ? '8' : '1';
      if (mover && mover.type === 'p' && sq[1] === lastRank) {
        ctx.promo = { from, to: sq };
        draw(root, ctx);
        return;
      }
      sel = null;
      send({ type: 'move', from, to: sq });
      return;
    }
    // Sinon : (re)sélection d'une de ses pièces jouables, ou désélection.
    if (sel && sel.from === sq) sel = null; // re-toucher la pièce choisie la relâche
    else if (piece && piece.color === myColor && legal[sq]) sel = { fen: s.fen, from: sq };
    else sel = null;
    draw(root, ctx);
  }

  function promoPicker(root, ctx) {
    const { table, send } = ctx;
    const color = colorOf(table, table.me);
    const box = el('div', 'ch-promo');
    box.append(el('span', null, 'Promotion :'));
    for (const t of PROMO) {
      const b = el('button', 'sec');
      b.type = 'button';
      b.setAttribute('aria-label', `Promouvoir en ${t}`);
      b.append(el('span', 'pc ' + color, glyph(t)));
      b.addEventListener('click', () => {
        const { from, to } = ctx.promo;
        ctx.promo = null;
        sel = null;
        send({ type: 'move', from, to, promotion: t });
      });
      box.append(b);
    }
    const cancel = el('button', 'sec', 'Annuler');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { ctx.promo = null; sel = null; draw(root, ctx); });
    box.append(cancel);
    return box;
  }

  function drawControls(table, send) {
    const s = table.state;
    const box = el('div', 'ch-draw');
    if (s.winner !== null || table.status !== 'playing') return box;
    if (table.spectator) { // spectateur : on montre la proposition sans pouvoir y répondre
      if (s.drawOffer !== null) box.append(el('span', null, `${name(table, s.drawOffer)} propose la nulle`));
      return box;
    }

    if (s.drawOffer === null) {
      const b = el('button', 'sec', 'Proposer la nulle');
      b.type = 'button';
      b.addEventListener('click', () => send({ type: 'draw-offer' }));
      box.append(b);
    } else if (s.drawOffer === table.me) {
      box.append(el('span', null, 'Nulle proposée, en attente de réponse…'));
    } else {
      box.append(el('span', null, `${name(table, s.drawOffer)} propose la nulle`));
      const yes = el('button', null, 'Accepter');
      yes.type = 'button';
      yes.addEventListener('click', () => send({ type: 'draw-accept' }));
      const no = el('button', 'sec', 'Refuser');
      no.type = 'button';
      no.addEventListener('click', () => send({ type: 'draw-decline' }));
      box.append(yes, no);
    }
    return box;
  }

  GPGames.register({
    id: 'chess',
    name: 'Échecs',
    blurb: '2 joueurs · règles complètes, nulle par accord',

    isMyTurn: (table) => table.state.winner === null && table.state.turn === table.me,

    status(table) {
      const s = table.state;
      if (s.winner !== null) {
        if (s.forfeit) {
          if (table.spectator) return `${name(table, s.winner)} gagne par abandon.`;
          return s.winner === table.me ? 'Ton adversaire a abandonné. Tu gagnes !' : 'Tu as abandonné.';
        }
        if (s.winner === 'draw') return REASONS[s.reason] ?? 'Match nul.';
        return s.winner === table.me ? 'Échec et mat ! Tu as gagné 🎉' : `Échec et mat : ${name(table, s.winner)} a gagné.`;
      }
      const check = s.check ? ' — échec !' : '';
      const mark = COLOR_EMOJI[colorOf(table, s.turn)];
      return s.turn === table.me ? `À toi de jouer ${mark}${check}` : `Au tour de ${name(table, s.turn)} ${mark}${check}`;
    },

    render(container, ctx) {
      const root = el('div', 'ch-root');
      container.append(root);
      draw(root, { ...ctx, promo: null });
    },
  });
})();
