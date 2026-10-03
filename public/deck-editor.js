'use strict';
// Éditeur du jeu de cartes personnalisé (salon) : une image par carte, plus le dos.
// Toucher une carte ouvre le sélecteur de photos ; l'image est réduite dans le navigateur
// (JPEG ~400 px, quelques dizaines de Ko) puis envoyée à l'hôte, qui la stocke dans
// `custom-cards/` et prévient tous les joueurs (message `card-skin`).

window.GPDeck = (() => {
  const $ = (id) => document.getElementById(id);
  const { el } = GPCards.ui;
  const SUITS = [['S', 'Pique'], ['H', 'Cœur'], ['D', 'Carreau'], ['C', 'Trèfle']];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const MAX_SIDE = 400; // grand côté de l'image envoyée, en pixels (une carte fait ~44 × 62 px à l'écran)
  const ERRORS = {
    'too-big': 'Image trop lourde.',
    'bad-format': 'Format non reconnu (PNG, JPEG, GIF ou WebP).',
    'bad-card': 'Carte inconnue.',
    empty: 'Image vide.',
  };

  let busy = new Set(); // clés en cours d'envoi
  let picking = null;   // clé dont on choisit l'image

  const label = (key) => (key === 'back' ? 'Dos des cartes'
    : `${GPCards.rankName(GPCards.rankOf(key))} de ${GPCards.SUIT_NAME[GPCards.suitOf(key)]}`);

  function setMsg(text, ok) {
    const m = $('deck-msg');
    m.textContent = text;
    m.className = 'hint' + (ok === false ? ' deck-err' : '');
  }

  // Réduit l'image (fond blanc pour les PNG transparents) ; null si le navigateur ne sait pas la lire.
  function shrink(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  async function request(method, path, body) {
    try {
      const res = await fetch(path, { method, body, headers: body ? { 'Content-Type': body.type || 'application/octet-stream' } : {} });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true } : { ok: false, error: data.error ?? (res.status === 413 ? 'too-big' : 'http') };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  async function upload(key, file) {
    busy.add(key);
    render();
    setMsg(`Envoi : ${label(key)}…`);
    // Image illisible par le navigateur (ex. HEIC sur ordinateur) : on tente l'envoi brut.
    const blob = (await shrink(file)) ?? file;
    const r = await request('PUT', `/api/cards/${encodeURIComponent(key)}`, blob);
    busy.delete(key);
    if (r.ok) setMsg(`${label(key)} : image enregistrée sur le téléphone hôte.`, true);
    else setMsg(`${label(key)} : ${ERRORS[r.error] ?? 'envoi impossible.'}`, false);
    render(); // la diffusion `card-skin` redessinera aussi, avec la nouvelle version
  }

  async function reset(key) {
    const r = await request('DELETE', `/api/cards/${encodeURIComponent(key)}`);
    setMsg(r.ok ? `${label(key)} : carte d'origine.` : 'Impossible de retirer l’image.', r.ok);
  }

  async function resetAll() {
    if (!confirm('Revenir au jeu de cartes d’origine pour tout le monde ?')) return;
    const r = await request('DELETE', '/api/cards');
    setMsg(r.ok ? 'Jeu d’origine rétabli.' : 'Impossible de tout retirer.', r.ok);
  }

  function slot(key) {
    const wrap = el('div', 'deck-slot');
    const custom = GPCards.hasSkin(key);
    const card = key === 'back' ? GPCards.back() : GPCards.face(key);
    const btn = el('button', 'deck-pick');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Choisir une image : ${label(key)}`);
    btn.disabled = busy.has(key);
    btn.append(card);
    if (busy.has(key)) btn.append(el('span', 'deck-busy', '…'));
    btn.addEventListener('click', () => { picking = key; $('deck-file').value = ''; $('deck-file').click(); });
    wrap.append(btn);
    if (custom) {
      const x = el('button', 'deck-reset', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', `Carte d'origine : ${label(key)}`);
      x.addEventListener('click', () => reset(key));
      wrap.append(x);
    }
    return wrap;
  }

  function render() {
    const details = $('deck');
    if (!details.open) return; // grille construite seulement à l'ouverture (évite 53 images au salon)
    const grid = $('deck-grid');
    grid.replaceChildren();
    const backRow = el('div', 'deck-row');
    backRow.append(el('div', 'deck-suit', 'Dos'), slot('back'));
    grid.append(backRow);
    for (const [s, name] of SUITS) {
      const row = el('div', 'deck-row');
      row.append(el('div', 'deck-suit', `${GPCards.SYM[s]} ${name}`));
      for (const r of RANKS) row.append(slot(r + s));
      grid.append(row);
    }
    const n = ['back', ...SUITS.flatMap(([s]) => RANKS.map((r) => r + s))].filter(GPCards.hasSkin).length;
    $('deck-count').textContent = n ? `${n} / 53 personnalisée${n > 1 ? 's' : ''}` : 'Jeu d’origine';
    $('deck-reset-all').hidden = n === 0;
  }

  function init() {
    $('deck').addEventListener('toggle', render);
    $('deck-file').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file && picking) upload(picking, file);
      picking = null;
    });
    $('deck-reset-all').addEventListener('click', resetAll);
  }

  return { init, refresh: render };
})();
