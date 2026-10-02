'use strict';
// Rendu de « Cherche l'imposteur ». Aucune règle ici : le serveur n'envoie que ce
// que le joueur a le droit de voir (son mot, les indices, les rôles révélés) et
// `hints` (ce qu'il peut faire maintenant : indice, prêt, vote, devinette).

(() => {
  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
  const ROLE = { civil: 'civil', imposter: 'imposteur' };

  const nm = (table, i) => table.players[i]?.name ?? '?';
  const color = (i) => COLORS[i % COLORS.length];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function nameTag(table, i) {
    const b = el('b', null, nm(table, i));
    b.style.color = color(i);
    return b;
  }

  // Saisies conservées lors des rafraîchissements du serveur.
  const draft = { clue: '', guess: '' };
  let lastKey = null; // manche:phase déjà traitée (ouverture / fermeture auto du chat)

  const ERRORS = {
    'bad-clue': 'Un seul mot, 24 lettres maximum.',
    'forbidden-word': 'Tu ne peux pas dire ton propre mot !',
    'bad-target': 'Choisis un autre joueur encore en jeu.',
    'not-your-turn': 'Ce n’est pas à toi de jouer.',
  };

  // ------------------------------------------------------------------ blocs

  function drawWord(table, s) {
    const box = el('div', 'im-word');
    box.append(el('div', 'hint', 'Ton mot secret'));
    box.append(el('div', 'im-w', s.me.word));
    if (s.winner === null) {
      box.append(el('div', 'hint', s.me.alive
        ? 'Les civils ont le même mot ; l’imposteur en a un voisin. Donne des indices sans te trahir.'
        : 'Tu es éliminé : tu peux encore suivre la partie et discuter.'));
    }
    return box;
  }

  function drawPlayers(table, s) {
    const box = el('div', 'im-players');
    const cur = s.phase === 'clues' ? s.order[s.clueTurn] : null;
    s.players.forEach((p, i) => {
      const row = el('div', 'im-p' + (p.alive ? '' : ' dead') + (i === cur ? ' turn' : ''));
      const dot = el('i');
      dot.style.background = color(i);
      const name = el('b', null, nm(table, i) + (i === table.me ? ' (toi)' : ''));
      const chips = el('span', 'chips');
      if (!p.alive) chips.append(el('span', 'chip', p.left ? 'parti' : `éliminé · ${ROLE[p.role] ?? '?'}`));
      else if (s.winner !== null && p.role) chips.append(el('span', 'chip ' + p.role, ROLE[p.role]));
      if (p.alive && s.phase === 'clues' && s.clues.some((c) => c.round === s.round && c.p === i)) chips.append(el('span', 'chip ok', 'a parlé'));
      if (p.alive && s.phase === 'discuss' && p.ready) chips.append(el('span', 'chip ok', 'prêt'));
      if (p.alive && s.phase === 'vote' && p.voted) chips.append(el('span', 'chip ok', 'a voté'));
      if (i === cur) chips.append(el('span', 'chip now', 'à lui de parler'));
      row.append(dot, name, chips);
      box.append(row);
    });
    return box;
  }

  function drawClues(table, s) {
    const box = el('div', 'im-clues');
    if (!s.clues.length) return box;
    box.append(el('h2', null, 'Indices'));
    const rounds = [...new Set(s.clues.map((c) => c.round))];
    for (const r of rounds) {
      const line = el('div', 'im-cl');
      line.append(el('span', 'hint', `Manche ${r} : `));
      s.clues.filter((c) => c.round === r).forEach((c) => {
        const chip = el('span', 'im-clue');
        chip.append(nameTag(table, c.p), document.createTextNode(` « ${c.text} »`));
        line.append(chip);
      });
      box.append(line);
    }
    return box;
  }

  function drawLastVote(table, s) {
    const lv = s.lastVote;
    if (!lv) return null;
    const box = el('div', 'im-last');
    const head = el('div', 'im-info');
    if (lv.tie) head.textContent = `Manche ${lv.round} : égalité, personne n’est éliminé.`;
    else {
      head.append(document.createTextNode(`Manche ${lv.round} : `), nameTag(table, lv.eliminated),
        document.createTextNode(` est éliminé — c’était ${lv.role === 'imposter' ? 'l’imposteur' : 'un civil'}.`));
    }
    box.append(head);
    const detail = el('div', 'hint');
    detail.textContent = 'Votes : ' + lv.votes.map((v) => `${nm(table, v.from)} → ${nm(table, v.to)}`).join(' · ');
    box.append(detail);
    return box;
  }

  function drawActions(ctx, table, s) {
    const { send } = ctx;
    const h = s.hints;
    const box = el('div', 'im-actions');
    const info = (t) => box.append(el('div', 'im-info', t));

    switch (s.phase) {
      case 'clues': {
        const who = s.order[s.clueTurn];
        if (h.actions.includes('clue')) {
          info('À toi : donne UN indice (un seul mot) sans dire ton mot.');
          const form = el('form', 'im-form');
          const input = el('input');
          input.placeholder = 'Ton indice…';
          input.maxLength = 24;
          input.autocomplete = 'off';
          input.value = draft.clue;
          input.addEventListener('input', () => { draft.clue = input.value; });
          const btn = el('button', null, 'Envoyer');
          btn.type = 'submit';
          form.append(input, btn);
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = draft.clue.trim();
            if (text) { send({ type: 'clue', text }); draft.clue = ''; }
          });
          box.append(form);
        } else {
          info(`Manche ${s.round} · au tour de ${nm(table, who)} de donner son indice…`);
        }
        break;
      }
      case 'discuss': {
        info('Discutez dans le chat : qui a un indice suspect ? Passe au vote quand tu es prêt.');
        const alive = s.players.filter((p) => p.alive);
        box.append(el('div', 'hint', `${alive.filter((p) => p.ready).length} / ${alive.length} prêts à voter`));
        const row = el('div', 'im-btns');
        const chat = el('button', 'sec', '💬 Ouvrir le chat');
        chat.type = 'button';
        chat.addEventListener('click', () => GPChat.openChannel(table.channel));
        row.append(chat);
        if (h.actions.includes('ready')) {
          const ready = el('button', null, 'Je suis prêt à voter');
          ready.type = 'button';
          ready.addEventListener('click', () => send({ type: 'ready' }));
          row.append(ready);
        } else if (s.me.alive) {
          row.append(el('span', 'hint', 'Tu es prêt. En attente des autres…'));
        }
        box.append(row);
        break;
      }
      case 'vote': {
        if (h.actions.includes('vote')) {
          info('Qui est l’imposteur ? Vote (secret). Tu peux changer d’avis tant que tout le monde n’a pas voté.');
          const row = el('div', 'im-btns col');
          for (const t of h.targets) {
            const b = el('button', s.myVote === t ? '' : 'sec', `${s.myVote === t ? '✔ ' : ''}${nm(table, t)}`);
            b.type = 'button';
            b.style.borderLeft = `6px solid ${color(t)}`;
            b.addEventListener('click', () => send({ type: 'vote', target: t }));
            row.append(b);
          }
          box.append(row);
        } else {
          info('Vote en cours…');
        }
        const alive = s.players.filter((p) => p.alive);
        box.append(el('div', 'hint', `${alive.filter((p) => p.voted).length} / ${alive.length} ont voté`));
        break;
      }
      case 'guess': {
        if (h.actions.includes('guess')) {
          info('Tu as été démasqué ! Devine le mot des civils pour sauver la partie.');
          const form = el('form', 'im-form');
          const input = el('input');
          input.placeholder = 'Le mot des civils…';
          input.maxLength = 40;
          input.autocomplete = 'off';
          input.value = draft.guess;
          input.addEventListener('input', () => { draft.guess = input.value; });
          const btn = el('button', null, 'Deviner');
          btn.type = 'submit';
          form.append(input, btn);
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = draft.guess.trim();
            if (text) { send({ type: 'guess', text }); draft.guess = ''; }
          });
          box.append(form);
        } else {
          info(`${nm(table, s.guesser)} a été démasqué et tente de deviner le mot des civils…`);
        }
        break;
      }
      case 'over': drawOver(table, s, box); break;
      default: break;
    }
    return box;
  }

  function drawOver(table, s, box) {
    const REASON = {
      guess: s.winner === 'imposter' ? 'L’imposteur a deviné le mot des civils !' : 'L’imposteur n’a pas deviné le mot des civils.',
      outnumber: 'Les imposteurs sont aussi nombreux que les civils.',
      timeout: 'Trop d’égalités : l’imposteur a tenu jusqu’au bout.',
      left: 'Un joueur a quitté la partie.',
      caught: 'Tous les imposteurs sont démasqués.',
    };
    box.append(el('div', 'im-info', s.winner === 'civil' ? '🎉 Les civils gagnent !' : '🕵️ L’imposteur gagne !'));
    if (REASON[s.reason]) box.append(el('div', 'hint', REASON[s.reason]));
    box.append(el('div', 'im-reveal', `Mot des civils : « ${s.words.civil} » · mot de l’imposteur : « ${s.words.imposter} »`));
  }

  // ------------------------------------------------------------------ enregistrement

  GPGames.register({
    id: 'impostor',
    name: 'Cherche l’imposteur',
    blurb: '3 à 8 joueurs · indices, chat, vote · l’hôte lance',
    errors: ERRORS,
    leaveWarning: 'Quitter la partie ? Tu seras retiré du jeu.',

    isMyTurn: (table) => table.state.hints.actions.length > 0,

    status(table) {
      const s = table.state;
      switch (s.phase) {
        case 'clues': return s.order[s.clueTurn] === table.me ? 'À toi de donner un indice' : `Manche ${s.round} · indices`;
        case 'discuss': return `Manche ${s.round} · discussion`;
        case 'vote': return `Manche ${s.round} · vote`;
        case 'guess': return s.guesser === table.me ? 'Devine le mot des civils !' : 'L’imposteur tente de deviner…';
        default: return s.winner === 'civil' ? 'Les civils gagnent !' : 'L’imposteur gagne !';
      }
    },

    render(container, ctx) {
      const { table } = ctx;
      const s = table.state;

      // Au début de chaque phase : le chat s'ouvre pour discuter, se ferme pour agir.
      const key = `${s.round}:${s.phase}`;
      if (key !== lastKey) {
        if (s.phase === 'discuss') GPChat.openChannel(table.channel);
        else GPChat.close();
        lastKey = key;
      }

      const root = el('div', 'im-root');
      root.append(drawWord(table, s), drawActions(ctx, table, s));
      const last = drawLastVote(table, s);
      if (last) root.append(last);
      root.append(drawPlayers(table, s), drawClues(table, s));
      container.append(root);
    },
  });
})();
