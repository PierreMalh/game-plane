'use strict';
// Rendu des « Jetons de poker ». Aucune règle ici : le serveur envoie les jetons, les mises,
// les pots et `hints` (actions possibles du joueur dont c'est le tour). Les cartes se jouent
// en vrai ; le croupier (`s.isCroupier`) règle la partie, lance les mains et distribue les pots.
// Module de jetons (GPChips) : piles dessinées pour les tapis, mises et pots, et plateau de
// jetons à toucher pour composer sa mise.

(() => {
  const { el, color, nm } = GPCards.ui;

  // Valeurs et couleurs des jetons, du plus grand au plus petit.
  const DENOMS = [
    { v: 1000, c: '#f59e0b' }, { v: 500, c: '#7c3aed' }, { v: 100, c: '#1f2937' },
    { v: 25, c: '#16a34a' }, { v: 5, c: '#dc2626' }, { v: 1, c: '#e5e7eb' },
  ];
  const MAX_DISCS = 6; // jetons dessinés par colonne (le reste est indiqué par « ×n »)

  const ERRORS = {
    'must-call': 'Il y a une mise : suis, relance ou couche-toi.',
    'nothing-to-call': 'Rien à suivre : tu peux parler (check).',
    'raise-too-small': 'Relance trop petite.',
    'cannot-raise': 'Tu ne peux plus relancer (tapis incomplet) : suis ou couche-toi.',
    'bad-amount': 'Montant invalide.',
    'bad-blinds': 'Blindes invalides (la grosse blinde doit être ≥ la petite).',
    'bad-winners': 'Choisis au moins un gagnant par pot.',
    'hand-running': 'Impossible pendant une main.',
    'not-croupier': 'Réservé au croupier.',
    'not-enough': 'Il faut au moins 2 joueurs avec des jetons.',
    'bad-target': 'Joueur introuvable.',
  };
  const STREET = { preflop: 'Pré-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

  // Saisies conservées lors des rafraîchissements du serveur.
  const draft = { stack: '', sb: '', bb: '', every: '', player: '0', amount: '' };
  let draftSeen = false; // champs initialisés depuis la configuration du serveur
  let raiseTo = null, raiseKey = null; // mise composée au plateau de jetons
  let winners = { hand: -1, picks: [] }; // gagnants cochés par pot (par numéro de main)

  // ---------------------------------------------------------------- jetons

  // Décompose un montant en jetons (glouton) : [{ d, n }].
  function breakdown(amount) {
    const out = [];
    let rest = Math.max(0, Math.floor(amount));
    for (const d of DENOMS) {
      const k = Math.floor(rest / d.v);
      if (k) { out.push({ d, n: k }); rest -= k * d.v; }
    }
    return out;
  }

  function disc(d, label) {
    const c = el('i', 'ch-disc', label);
    c.style.setProperty('--c', d.c);
    return c;
  }

  // Piles de jetons dessinées pour un montant ; `small` pour les listes.
  function stack(amount, small) {
    const box = el('span', 'ch-stack' + (small ? ' small' : ''));
    box.setAttribute('aria-label', `${amount} jetons`);
    for (const { d, n } of breakdown(amount)) {
      const col = el('span', 'ch-col');
      for (let k = 0; k < Math.min(n, MAX_DISCS); k++) col.append(disc(d));
      if (n > MAX_DISCS) col.append(el('b', 'ch-n', `×${n}`));
      box.append(col);
    }
    if (amount <= 0) box.append(el('span', 'ch-none', '—'));
    return box;
  }

  // ---------------------------------------------------------------- éléments d'interface

  function button(label, onClick, cls, disabled) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  function number(key, label, opts = {}) {
    const wrap = el('label', 'ch-field');
    wrap.append(el('span', 'hint', label));
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = opts.min ?? 0;
    input.value = draft[key];
    input.disabled = !!opts.disabled;
    input.addEventListener('input', () => { draft[key] = input.value; });
    wrap.append(input);
    return wrap;
  }

  // Ligne de journal : « @2 » devient le nom du joueur en couleur.
  function logLine(table, line) {
    const p = el('div');
    line.split(/(@\d+)/).forEach((part) => {
      if (/^@\d+$/.test(part)) { const i = Number(part.slice(1)); const b = el('b', null, nm(table, i)); b.style.color = color(i); p.append(b); }
      else if (part) p.append(document.createTextNode(part));
    });
    return p;
  }

  // ---------------------------------------------------------------- blocs

  function drawFelt(s) {
    const felt = el('div', 'cp-box ch-felt');
    felt.append(el('div', 'ch-potlabel', 'POT'));
    felt.append(stack(s.pot));
    felt.append(el('div', 'ch-potnum', String(s.pot)));
    const parts = [];
    if (s.street) parts.push(`${STREET[s.street]} · main n° ${s.handNo}`);
    else if (s.handNo) parts.push(`Main n° ${s.handNo} terminée`);
    parts.push(`blindes ${s.config.sb}/${s.config.bb}`);
    if (s.config.blindEvery) {
      const left = s.config.blindEvery - ((s.handNo - 1) % s.config.blindEvery) - 1;
      if (s.handNo) parts.push(left > 0 ? `doublées dans ${left} main${left > 1 ? 's' : ''}` : 'doublées à la prochaine main');
    }
    felt.append(el('div', 'hint', parts.join(' · ')));
    return felt;
  }

  function drawPlayers(table, s) {
    const box = el('div', 'cp-box cp-players');
    s.players.forEach((p, i) => {
      const out = p.left || p.sitOut || (!p.inHand && p.chips === 0);
      const row = el('div', 'cp-p' + (i === s.turn && s.phase === 'betting' ? ' turn' : '') + (out || (p.inHand && p.folded) ? ' out' : ''));
      const dot = el('i');
      dot.style.background = color(i);
      row.append(dot, el('b', null, nm(table, i) + (i === table.me ? ' (toi)' : '')));
      if (i === s.dealer && s.street) row.append(el('span', 'ch-btn', 'D'));
      if (i === s.croupier) row.append(el('span', 'chip ch-croupier', 'croupier'));
      const chips = el('span', 'chips');
      if (p.left) chips.append(el('span', 'chip', 'parti'));
      else {
        if (p.sitOut) chips.append(el('span', 'chip', 'absent'));
        else if (p.chips === 0 && !p.inHand) chips.append(el('span', 'chip', 'à sec'));
        if (p.inHand && p.folded) chips.append(el('span', 'chip', 'couché'));
        if (p.allIn && !p.folded) chips.append(el('span', 'chip ch-allin', 'tapis'));
        if (p.bet > 0) chips.append(el('span', 'chip now', `mise ${p.bet}`));
        chips.append(el('span', 'chip ch-stacknum', `${p.chips} 🪙`));
      }
      row.append(chips);
      if (!p.left && p.chips > 0) row.append(stack(p.chips, true));
      box.append(row);
    });
    return box;
  }

  // Plateau de jetons : chaque toucher ajoute la valeur du jeton à la mise (dans les limites).
  function raisePanel(s, box, send) {
    const h = s.hints;
    const key = `${s.handNo}/${s.street}/${s.currentBet}`;
    if (raiseKey !== key || raiseTo === null) { raiseKey = key; raiseTo = h.minRaise; }
    const clamp = (v) => Math.min(Math.max(v, h.minRaise), h.maxRaise);
    raiseTo = clamp(raiseTo);
    const betting = s.currentBet === 0;

    const panel = el('div', 'ch-raise');
    const go = button('', () => send({ type: raiseTo >= h.maxRaise ? 'allin' : 'raise', to: raiseTo }));
    const slider = el('input');
    slider.type = 'range';
    slider.min = h.minRaise;
    slider.max = h.maxRaise;
    slider.step = Math.max(1, Math.min(s.config.sb, 25));
    slider.setAttribute('aria-label', 'Montant de la mise');
    const preview = el('div', 'ch-preview');
    const refresh = () => {
      slider.value = raiseTo;
      go.textContent = raiseTo >= h.maxRaise ? `Tapis (${h.maxRaise})` : `${betting ? 'Miser' : 'Relancer à'} ${raiseTo}`;
      preview.replaceChildren(stack(raiseTo, true), el('b', null, String(raiseTo)));
    };
    const set = (v) => { raiseTo = clamp(v); refresh(); };
    slider.addEventListener('input', () => set(Number(slider.value)));

    // Jetons à toucher : on ne propose que ceux qui ne dépassent pas la marge restante.
    const tray = el('div', 'ch-tray');
    const mine = s.players[s.me];
    for (const d of DENOMS) {
      if (d.v > mine.chips) continue;
      const b = el('button', 'ch-tap', String(d.v));
      b.type = 'button';
      b.style.setProperty('--c', d.c);
      b.setAttribute('aria-label', `Ajouter ${d.v}`);
      b.addEventListener('click', () => set(raiseTo + d.v));
      tray.append(b);
    }

    const quick = el('div', 'cp-btns');
    const potAfterCall = s.pot + h.toCall;
    const preset = (text, to) => quick.append(button(text, () => set(to), 'sec'));
    preset('Min', h.minRaise);
    preset('½ pot', s.currentBet + Math.floor(potAfterCall / 2));
    preset('Pot', s.currentBet + potAfterCall);
    preset('Tapis', h.maxRaise);

    refresh();
    const goRow = el('div', 'cp-btns');
    goRow.append(go);
    panel.append(el('div', 'hint', 'Touche des jetons pour composer ta mise :'), tray, preview, slider, quick, goRow);
    box.append(panel);
  }

  function drawMine(table, s, send) {
    const box = el('div', 'cp-box');
    const me = s.players[table.me];
    const head = el('div', 'ch-mine');
    head.append(el('div', 'hint', 'Tes jetons'), el('div', 'ch-mynum', `${me.chips} 🪙`), stack(me.chips));
    if (me.bet > 0) head.append(el('div', 'hint', `Déjà misé ce tour : ${me.bet}`));
    box.append(head);

    const h = s.hints;
    const info = (t) => box.append(el('div', 'cp-info', t));
    const btns = el('div', 'cp-btns');
    if (s.phase === 'betting') {
      if (h.actions.length) {
        info(h.toCall > 0 ? `À toi de parler : ${h.toCall} pour suivre.` : 'À toi de parler.');
        btns.append(button('Se coucher', () => send({ type: 'fold' }), 'danger'));
        if (h.actions.includes('check')) btns.append(button('Parole (check)', () => send({ type: 'check' }), 'sec'));
        if (h.actions.includes('call')) btns.append(button(h.toCall >= me.chips ? `Suivre à tapis (${h.toCall})` : `Suivre ${h.toCall}`, () => send({ type: 'call' }), 'sec'));
        box.append(btns);
        if (h.actions.includes('raise')) raisePanel(s, box, send);
      } else if (me.inHand && !me.folded) info(me.allIn ? 'Tu es à tapis : attends l’abattage.' : `Au tour de ${nm(table, s.turn)}…`);
      else info('Tu es couché pour cette main.');
    }
    return box;
  }

  // ---------------------------------------------------------------- croupier

  function setupForm(s, send, firstTime) {
    if (!draftSeen) {
      Object.assign(draft, { stack: s.config.stack, sb: s.config.sb, bb: s.config.bb, every: s.config.blindEvery });
      draftSeen = true;
    }
    const form = el('div', 'ch-form');
    form.append(
      number('stack', 'Tapis de départ', { min: 1, disabled: !firstTime }),
      number('sb', 'Petite blinde', { min: 1 }),
      number('bb', 'Grosse blinde', { min: 1 }),
      number('every', 'Blindes ×2 toutes les N mains (0 = jamais)', { min: 0 }),
    );
    const num = (v) => Number(v);
    const msg = () => ({ type: 'config', ...(firstTime ? { stack: num(draft.stack) } : {}), sb: num(draft.sb), bb: num(draft.bb), blindEvery: num(draft.every) });
    const row = el('div', 'cp-btns');
    row.append(button('Appliquer les réglages', () => send(msg()), 'sec'));
    form.append(row);
    return { form, msg };
  }

  function giveForm(table, s, send) {
    const box = el('div', 'ch-form');
    box.append(el('div', 'hint', 'Recave / correction de jetons :'));
    const sel = el('select');
    s.players.forEach((p, i) => { if (!p.left) { const o = el('option', null, nm(table, i)); o.value = i; sel.append(o); } });
    sel.value = draft.player;
    sel.addEventListener('change', () => { draft.player = sel.value; });
    box.append(sel, number('amount', 'Montant'));
    const row = el('div', 'cp-btns');
    const give = (sign) => { const a = Number(draft.amount) * sign; if (a) { send({ type: 'give', player: Number(sel.value), amount: a }); draft.amount = ''; } };
    row.append(button('Donner', () => give(1), 'sec'), button('Retirer', () => give(-1), 'sec'));
    box.append(row);
    return box;
  }

  function awardForm(table, s, send) {
    const box = el('div', 'ch-form');
    if (winners.hand !== s.handNo) winners = { hand: s.handNo, picks: s.pots.map((p) => (p.eligible.length === 1 ? [p.eligible[0]] : [])) };
    s.pots.forEach((p, k) => {
      const part = el('div', 'ch-award');
      part.append(el('div', 'cp-info', `${k === 0 ? 'Pot principal' : `Pot annexe ${k}`} : ${p.amount}`));
      const row = el('div', 'cp-btns');
      for (const i of p.eligible) {
        const on = winners.picks[k].includes(i);
        const b = button(nm(table, i), () => {
          const cur = winners.picks[k];
          winners.picks[k] = on ? cur.filter((x) => x !== i) : [...cur, i];
          GPGames.refresh();
        }, on ? '' : 'sec');
        b.style.borderColor = color(i);
        row.append(b);
      }
      part.append(row);
      box.append(part);
    });
    const ready = winners.picks.every((w) => w.length > 0);
    const go = el('div', 'cp-btns');
    go.append(button('Distribuer les pots', () => send({ type: 'award', winners: winners.picks }), '', !ready));
    box.append(el('div', 'hint', 'Plusieurs gagnants sur un pot = partage à parts égales.'), go);
    return box;
  }

  function drawCroupier(table, s, send) {
    const box = el('div', 'cp-box ch-croupier-box');
    box.append(el('div', 'cp-info', '🎩 Table du croupier'));
    const idle = s.phase === 'setup' || s.phase === 'between';

    if (s.phase === 'showdown') {
      box.append(el('div', 'hint', 'Cartes sur table : qui gagne chaque pot ?'), awardForm(table, s, send));
    } else if (idle) {
      const { form } = setupForm(s, send, s.phase === 'setup');
      const start = el('div', 'cp-btns');
      start.append(button(s.phase === 'setup' ? 'Commencer la partie' : 'Main suivante', () => send({ type: 'start' })));
      box.append(form, giveForm(table, s, send), start);
    } else {
      box.append(el('div', 'hint', 'Une main est en cours : le croupier suit les enchères.'));
    }
    if (s.phase !== 'betting') {
      const end = el('div', 'cp-btns');
      end.append(button('Terminer la partie', () => { if (confirm('Terminer la partie pour tout le monde ?')) send({ type: 'end' }); }, 'danger'));
      box.append(end);
    }
    return box;
  }

  function drawResult(table, s) {
    const box = el('div', 'cp-box');
    if (!s.result) return null;
    box.append(el('div', 'cp-info', s.result.fold ? 'Main terminée' : 'Pots distribués'));
    for (const p of s.result.pots) {
      const who = p.winners.map((w) => `@${w}`).join(' et ');
      const line = logLine(table, `${who} ${p.winners.length > 1 ? 'partagent' : 'remporte'} ${p.amount}`);
      line.classList.add('pk-center');
      box.append(line);
    }
    return box;
  }

  function drawWaiting(table, s, send) {
    const box = el('div', 'cp-box');
    const me = s.players[table.me];
    const idle = s.phase === 'setup' || s.phase === 'between';
    box.append(el('div', 'cp-info', s.phase === 'setup'
      ? `${nm(table, s.croupier)} règle la partie…` : `${nm(table, s.croupier)} prépare la prochaine main…`));
    const btns = el('div', 'cp-btns');
    btns.append(button('Devenir croupier', () => send({ type: 'croupier' }), 'sec'));
    btns.append(button(me.sitOut ? 'Revenir à la table' : 'Sauter les prochaines mains', () => send({ type: 'sitout', out: !me.sitOut }), 'sec'));
    if (idle) box.append(btns);
    return box;
  }

  function drawOver(table, s) {
    const box = el('div', 'cp-box');
    box.append(el('div', 'cp-info', 'Partie terminée — classement'));
    const order = s.players.map((p, i) => i).filter((i) => !s.players[i].left).sort((a, b) => s.players[b].chips - s.players[a].chips);
    order.forEach((i, rank) => {
      const row = logLine(table, `${rank + 1}. @${i} : ${s.players[i].chips} 🪙`);
      row.classList.add('pk-center');
      box.append(row);
    });
    return box;
  }

  // ---------------------------------------------------------------- vue

  function build(container, ctx) {
    const { table, send } = ctx;
    const s = table.state;
    const root = el('div', 'cp-root');
    if (s.phase === 'over') {
      root.append(drawFelt(s), drawOver(table, s));
    } else {
      root.append(drawFelt(s), drawPlayers(table, s));
      if (!table.spectator) {
        const mine = drawMine(table, s, send);
        root.append(mine);
        const idle = s.phase === 'setup' || s.phase === 'between';
        if (s.phase === 'between') { const r = drawResult(table, s); if (r) root.append(r); }
        if (s.isCroupier) root.append(drawCroupier(table, s, send));
        else if (idle) root.append(drawWaiting(table, s, send));
        else if (s.phase === 'showdown') {
          const b = el('div', 'cp-box');
          b.append(el('div', 'cp-info', `Abattage : ${nm(table, s.croupier)} désigne le gagnant…`));
          root.append(b);
        }
      } else if (s.phase === 'between') { const r = drawResult(table, s); if (r) root.append(r); }
    }
    const log = el('div', 'cp-box cp-log');
    for (const line of s.log.slice(-8)) log.append(logLine(table, line));
    root.append(log);
    container.append(root);
    log.scrollTop = log.scrollHeight;
  }

  GPGames.register({
    id: 'chips',
    name: 'Jetons de poker',
    blurb: '2 à 10 joueurs · jetons, mises, blindes et pots pour jouer au poker avec de vraies cartes · l’hôte lance',
    errors: ERRORS,
    leaveWarning: 'Quitter la table ? Tu te couches et tes jetons sortent du jeu.',
    isMyTurn: (table) => table.state.hints.actions.length > 0 || (table.state.isCroupier && table.state.phase === 'showdown'),
    status(table) {
      const s = table.state;
      if (s.phase === 'over') return 'Partie terminée';
      if (s.phase === 'setup') return s.isCroupier ? 'Règle la partie, puis commence' : `${nm(table, s.croupier)} règle la partie`;
      if (s.phase === 'between') return s.isCroupier ? 'Prêt pour la main suivante' : 'Entre deux mains';
      if (s.phase === 'showdown') return s.isCroupier ? 'Désigne les gagnants' : 'Abattage';
      return s.turn === table.me ? 'À toi de parler' : `Au tour de ${nm(table, s.turn)}`;
    },
    render: build,
  });
})();
