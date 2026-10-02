'use strict';
// Rendu du puissance 4. Les règles vivent côté serveur : ici on dessine l'état
// reçu et on envoie « poser dans la colonne N ».

(() => {
  const COLS = 7;
  const EMOJI = ['🔴', '🟡'];

  const name = (table, idx) => table.players[idx]?.name ?? '?';

  GPGames.register({
    id: 'connect4',
    name: 'Puissance 4',
    blurb: '2 joueurs · aligne 4 jetons',

    isMyTurn: (table) => table.state.winner === null && table.state.turn === table.me,

    status(table) {
      const s = table.state;
      if (s.winner === 'draw') return 'Match nul !';
      if (s.winner !== null) {
        if (s.forfeit) return s.winner === table.me ? 'Ton adversaire a abandonné. Tu gagnes !' : 'Tu as abandonné.';
        return s.winner === table.me ? 'Tu as gagné ! 🎉' : `${name(table, s.winner)} a gagné.`;
      }
      return s.turn === table.me ? `À toi de jouer ${EMOJI[table.me]}` : `Au tour de ${name(table, s.turn)} ${EMOJI[s.turn]}`;
    },

    render(el, { table, send, myTurn }) {
      const s = table.state;
      const legend = document.createElement('p');
      legend.className = 'c4-legend';
      legend.textContent = `${EMOJI[0]} ${name(table, 0)}   ${EMOJI[1]} ${name(table, 1)}`;

      const board = document.createElement('div');
      board.className = 'c4-board';
      const win = new Set((s.winLine ?? []).map(([r, c]) => `${r},${c}`));

      for (let c = 0; c < COLS; c++) {
        const col = document.createElement('button');
        col.type = 'button';
        col.className = 'c4-col';
        col.setAttribute('aria-label', `Colonne ${c + 1}`);
        col.disabled = !myTurn || s.board[0][c] !== null;
        col.addEventListener('click', () => send({ type: 'drop', col: c }));
        for (let r = 0; r < s.board.length; r++) {
          const cell = document.createElement('span');
          const v = s.board[r][c];
          cell.className = 'c4-cell' + (v === null ? '' : ` p${v}`);
          if (s.lastMove && s.lastMove.row === r && s.lastMove.col === c) cell.classList.add('last');
          if (win.has(`${r},${c}`)) cell.classList.add('win');
          col.append(cell);
        }
        board.append(col);
      }
      el.append(legend, board);
    },
  });
})();
