'use strict';
// Composant de cartes réutilisable par les jeux de cartes : dessin d'une carte, d'un
// dos, d'une main sur plusieurs lignes avec sélection, et petits outils d'interface.
// Une carte est un code « rang + couleur » : "10H", "AS", "2C" (C ♣, D ♦, H ♥, S ♠).
// Jeu personnalisé : si l'hôte a reçu une image pour une carte (ou pour le dos), elle
// remplace le dessin ; setSkin({ clé: version }) est appelé à la connexion et à chaque envoi.

window.GPCards = (() => {
  // U+FE0E force l'affichage « texte » : sinon iOS dessine ♥ ♦ en emoji.
  const SYM = { C: '♣︎', D: '♦︎', H: '♥︎', S: '♠︎' };
  const SUIT_NAME = { C: 'trèfle', D: 'carreau', H: 'cœur', S: 'pique' };
  const RANK_NAME = { A: 'As', J: 'Valet', Q: 'Dame', K: 'Roi' };
  const RANK_NAME_PL = { A: 'As', J: 'Valets', Q: 'Dames', K: 'Rois' };
  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];

  let skin = {};
  const skinUrl = (key) => (skin[key] ? `/custom-cards/${encodeURIComponent(key)}?v=${skin[key]}` : null);

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
    // Face personnalisée : rang et couleur restent lisibles dans deux coins, par-dessus la photo.
    if (addImage(node, code)) node.append(corner(code, 'tl'), corner(code, 'br'));
    return node;
  }

  function back(small) {
    const node = el('div', 'card back' + (small ? ' small' : ''));
    addImage(node, 'back');
    return node;
  }

  // Index d'un coin (rang au-dessus de la couleur) ; « br » est retourné comme sur une vraie carte.
  function corner(code, pos) {
    const c = el('span', `idx ${pos}`);
    c.setAttribute('aria-hidden', 'true');
    c.append(el('b', '', rankOf(code)), el('i', '', SYM[suitOf(code)]));
    return c;
  }

  // Image perso par-dessus le dessin d'origine, qui réapparaît si elle ne se charge pas.
  // Renvoie vrai si une image a été posée.
  function addImage(node, key) {
    const url = skinUrl(key);
    if (!url) return false;
    const img = el('img', 'skin');
    img.alt = '';
    img.draggable = false;
    img.addEventListener('error', () => { img.remove(); node.classList.remove('custom'); });
    img.src = url;
    node.classList.add('custom');
    node.append(img);
    return true;
  }

  const setSkin = (map) => { skin = map && typeof map === 'object' ? { ...map } : {}; };

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
    SYM, SUIT_NAME, rankOf, suitOf, rankName, face, back, hand, setSkin, hasSkin: (key) => !!skin[key],
    ui: { el, color: (i) => COLORS[i % COLORS.length], nm: (table, i) => table.players[i]?.name ?? '?' },
  };
})();
