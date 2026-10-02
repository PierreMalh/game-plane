'use strict';
// Composant de cartes réutilisable par les jeux de cartes : dessin d'une carte, d'un
// dos, d'une main sur plusieurs lignes avec sélection, et petits outils d'interface.
// Une carte est un code « rang + couleur » : "10H", "AS", "2C" (C ♣, D ♦, H ♥, S ♠).

window.GPCards = (() => {
  // U+FE0E force l'affichage « texte » : sinon iOS dessine ♥ ♦ en emoji.
  const SYM = { C: '♣︎', D: '♦︎', H: '♥︎', S: '♠︎' };
  const SUIT_NAME = { C: 'trèfle', D: 'carreau', H: 'cœur', S: 'pique' };
  const RANK_NAME = { A: 'As', J: 'Valet', Q: 'Dame', K: 'Roi' };
  const RANK_NAME_PL = { A: 'As', J: 'Valets', Q: 'Dames', K: 'Rois' };
  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];

  const rankOf = (c) => c.slice(0, -1);
  const suitOf = (c) => c.slice(-1);
  const rankName = (r, plural) => (plural ? RANK_NAME_PL : RANK_NAME)[r] ?? r;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Une carte visible. opts : { small, selected, disabled, onClick }.
  function face(code, opts = {}) {
    const s = suitOf(code);
    const node = el(opts.onClick ? 'button' : 'div', `card s${s}` + (opts.small ? ' small' : '') + (opts.selected ? ' sel' : '') + (opts.disabled ? ' dis' : ''));
    if (opts.onClick) { node.type = 'button'; node.addEventListener('click', opts.onClick); }
    node.dataset.code = code;
    node.setAttribute('aria-label', `${rankName(rankOf(code))} de ${SUIT_NAME[s]}`);
    node.append(el('span', 'r', rankOf(code)), el('span', 'su', SYM[s]), el('span', 'big', SYM[s]));
    return node;
  }

  const back = (small) => el('div', 'card back' + (small ? ' small' : ''));

  // Main d'un joueur : cartes sur plusieurs lignes (pas de chevauchement, faciles à toucher).
  //   opts.selected : Set de cartes levées ; opts.enabled : Set de cartes jouables (null = toutes)
  //   opts.onToggle(code) : appelé au toucher d'une carte jouable
  function hand(container, codes, opts = {}) {
    const row = el('div', 'hand');
    for (const c of codes) {
      const can = !opts.enabled || opts.enabled.has(c);
      row.append(face(c, {
        selected: opts.selected && opts.selected.has(c),
        disabled: !can,
        onClick: can && opts.onToggle ? () => opts.onToggle(c) : null,
      }));
    }
    container.append(row);
    return row;
  }

  return {
    SYM, SUIT_NAME, rankOf, suitOf, rankName, face, back, hand,
    ui: { el, color: (i) => COLORS[i % COLORS.length], nm: (table, i) => table.players[i]?.name ?? '?' },
  };
})();
