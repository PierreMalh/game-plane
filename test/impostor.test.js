'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/games/impostor');

// ---- outils -----------------------------------------------------------------

// Partie scriptée : mots Chat (civils) / Chien (imposteur), imposteur = joueur `imp`.
const game = (n = 4, imp = 3, opts = {}) => g.init(Array(n).fill('x'), { words: ['Chat', 'Chien'], imposters: [imp], ...opts });
const act = (st, who, a) => g.action(st, who, a);
const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);

// Tous les joueurs vivants donnent un indice, dans l'ordre imposé par la partie.
function allClues(st, word = 'indice') {
  for (const i of [...st.order]) must(act(st, i, { type: 'clue', text: `${word}${i}` }));
}
const allReady = (st) => { for (let i = 0; i < st.n; i++) if (st.players[i].alive) must(act(st, i, { type: 'ready' })); };
// Chaque vivant vote pour `target` (le visé vote pour un autre).
function everyoneVotes(st, target) {
  const living = st.players.map((_, i) => i).filter((i) => st.players[i].alive);
  for (const i of living) {
    const t = i === target ? living.find((x) => x !== target) : target;
    must(act(st, i, { type: 'vote', target: t }));
  }
}
const toVote = (st) => { allClues(st); allReady(st); };

// ---- initialisation -----------------------------------------------------------

test('départ : 1 imposteur jusqu’à 7 joueurs, 2 à partir de 8 ; ordre de parole sur tous', () => {
  for (const n of [3, 5, 7]) {
    const st = g.init(Array(n).fill('x'), {});
    assert.equal(st.players.filter((p) => p.role === 'imposter').length, 1);
    assert.equal(st.order.length, n);
    assert.equal(st.phase, 'clues');
  }
  assert.equal(g.init(Array(8).fill('x'), {}).players.filter((p) => p.role === 'imposter').length, 2);
});

test('mots : paire tirée au sort, civils et imposteur ont des mots différents', () => {
  for (let i = 0; i < 30; i++) {
    const st = g.init(['a', 'b', 'c'], {});
    assert.notEqual(st.words.civil, st.words.imposter);
  }
});

// ---- secret ------------------------------------------------------------------------

test('chacun ne voit que son mot ; aucun rôle ni mot adverse avant la fin', () => {
  const st = game(4, 3);
  for (let i = 0; i < 4; i++) {
    const v = g.view(st, i);
    const json = JSON.stringify(v);
    assert.equal(v.me.word, i === 3 ? 'Chien' : 'Chat');
    assert.equal(json.includes(i === 3 ? 'Chat' : 'Chien'), false, `joueur ${i} voit le mot de l’autre camp`);
    assert.equal(v.players.every((p) => p.role === null), true);
    assert.equal(v.words, null);
  }
});

// ---- indices ---------------------------------------------------------------------------

test('indices : chacun à son tour, un seul mot, jamais son propre mot', () => {
  const st = game(4, 3);
  const first = st.order[0];
  const other = st.order[1];
  assert.equal(act(st, other, { type: 'clue', text: 'poil' }).error, 'not-your-turn');
  assert.equal(act(st, first, { type: 'clue', text: '' }).error, 'bad-clue');
  assert.equal(act(st, first, { type: 'clue', text: 'deux mots' }).error, 'bad-clue');
  assert.equal(act(st, first, { type: 'clue', text: 'x'.repeat(25) }).error, 'bad-clue');
  const own = first === 3 ? 'Chien' : 'Chat';
  assert.equal(act(st, first, { type: 'clue', text: own }).error, 'forbidden-word');
  assert.equal(act(st, first, { type: 'clue', text: own.toUpperCase() }).error, 'forbidden-word');
  assert.equal(act(st, first, { type: 'clue', text: 'Châ-t'.replace('-', '') }).error, first === 3 ? undefined : 'forbidden-word'); // accent ignoré
  assert.equal(st.clueTurn <= 1, true);
});

test('indices : le mot de l’autre camp est permis ; après le dernier, la discussion s’ouvre', () => {
  const st = game(3, 2);
  const [a, b, c] = st.order;
  // Un civil peut citer le mot de l'imposteur (c'est son problème) : seul SON mot est interdit.
  const civilFirst = [a, b, c].find((i) => i !== 2);
  const idx = st.order.indexOf(civilFirst);
  for (let k = 0; k < idx; k++) must(act(st, st.order[k], { type: 'clue', text: 'x' + k }));
  must(act(st, civilFirst, { type: 'clue', text: 'Chien' }));
  for (let k = idx + 1; k < 3; k++) must(act(st, st.order[k], { type: 'clue', text: 'y' + k }));
  assert.equal(st.phase, 'discuss');
  assert.equal(st.clues.length, 3);
  assert.equal(g.view(st, 0).clues.length, 3);
});

// ---- discussion et vote ------------------------------------------------------------------------

test('discussion : on passe au vote quand tous les vivants sont prêts', () => {
  const st = game(4, 3);
  allClues(st);
  assert.equal(st.phase, 'discuss');
  assert.deepEqual(g.view(st, 0).hints.actions, ['ready']);
  must(act(st, 0, { type: 'ready' }));
  assert.equal(act(st, 0, { type: 'ready' }).ok, true); // idempotent
  assert.equal(st.phase, 'discuss');
  assert.deepEqual(g.view(st, 0).hints.actions, []);
  for (const i of [1, 2, 3]) must(act(st, i, { type: 'ready' }));
  assert.equal(st.phase, 'vote');
});

test('vote : cibles valides, vote secret, on peut changer d’avis', () => {
  const st = game(4, 3);
  toVote(st);
  assert.equal(act(st, 0, { type: 'vote', target: 0 }).error, 'bad-target');
  assert.equal(act(st, 0, { type: 'vote', target: 9 }).error, 'bad-target');
  assert.equal(act(st, 0, { type: 'vote', target: '1' }).error, 'bad-target');
  assert.equal(act(st, 0, { type: 'vote' }).error, 'bad-target');
  must(act(st, 0, { type: 'vote', target: 1 }));
  must(act(st, 0, { type: 'vote', target: 2 })); // changement
  const v = g.view(st, 1);
  assert.equal(v.players[0].voted, true);
  assert.equal(v.myVote, null);
  assert.equal(g.view(st, 0).myVote, 2);
  assert.equal(JSON.stringify(v).includes('"votes"'), false, 'les votes ne fuitent pas avant le dépouillement');
  assert.deepEqual(g.view(st, 0).hints.targets, [1, 2, 3]);
});

// ---- issues d'un vote ---------------------------------------------------------------------------------

test('imposteur éliminé : il tente de deviner ; bonne réponse → l’imposteur gagne', () => {
  const st = game(4, 3);
  toVote(st);
  everyoneVotes(st, 3);
  assert.equal(st.phase, 'guess');
  assert.equal(st.guesser, 3);
  assert.deepEqual(g.view(st, 3).hints.actions, ['guess']);
  assert.equal(act(st, 0, { type: 'guess', text: 'Chat' }).error, 'not-your-turn');
  const lv = g.view(st, 0).lastVote;
  assert.equal(lv.eliminated, 3);
  assert.equal(lv.role, 'imposter');
  assert.equal(lv.votes.length, 4);
  must(act(st, 3, { type: 'guess', text: ' CHÂT ' }));
  assert.equal(st.winner, 'imposter');
  assert.deepEqual(g.view(st, 0).words, { civil: 'Chat', imposter: 'Chien' });
  assert.equal(g.view(st, 0).players.every((p) => p.role !== null), true);
});

test('imposteur éliminé : mauvaise devinette → les civils gagnent', () => {
  const st = game(4, 3);
  toVote(st);
  everyoneVotes(st, 3);
  must(act(st, 3, { type: 'guess', text: 'Hamster' }));
  assert.equal(st.winner, 'civil');
  assert.equal(act(st, 0, { type: 'ready' }).error, 'over');
});

test('civil éliminé : rôle révélé, nouvelle manche entre les vivants', () => {
  const st = game(5, 4);
  toVote(st);
  everyoneVotes(st, 1);
  assert.equal(st.players[1].alive, false);
  assert.equal(st.phase, 'clues');
  assert.equal(st.round, 2);
  assert.equal(st.order.length, 4);
  assert.equal(st.order.includes(1), false);
  const v = g.view(st, 0);
  assert.equal(v.players[1].role, 'civil');
  assert.equal(v.lastVote.role, 'civil');
  assert.equal(v.players[4].role, null); // l'imposteur reste caché
  assert.equal(act(st, 1, { type: 'clue', text: 'fantome' }).error, 'not-your-turn');
});

test('égalité : personne n’est éliminé, nouvelle manche', () => {
  const st = game(4, 3);
  toVote(st);
  // 0→1, 1→0, 2→1, 3→0 : deux voix chacun
  must(act(st, 0, { type: 'vote', target: 1 }));
  must(act(st, 1, { type: 'vote', target: 0 }));
  must(act(st, 2, { type: 'vote', target: 1 }));
  must(act(st, 3, { type: 'vote', target: 0 }));
  assert.equal(st.players.every((p) => p.alive), true);
  assert.equal(st.round, 2);
  assert.equal(st.phase, 'clues');
  assert.equal(g.view(st, 0).lastVote.tie, true);
  assert.equal(g.view(st, 0).lastVote.eliminated, null);
});

test('l’imposteur gagne quand il est aussi nombreux que les civils', () => {
  const st = game(4, 3); // 3 civils + 1 imposteur
  toVote(st);
  everyoneVotes(st, 0); // un civil sort : 2 civils vs 1 imposteur → on continue
  assert.equal(st.winner, null);
  toVote(st);
  everyoneVotes(st, 1); // 1 civil vs 1 imposteur → l'imposteur gagne
  assert.equal(st.winner, 'imposter');
  assert.equal(st.reason, 'outnumber');
});

test('trop d’égalités de suite : l’imposteur tient bon', () => {
  const st = game(4, 3);
  for (let r = 0; r < 6 && st.winner === null; r++) {
    toVote(st);
    must(act(st, 0, { type: 'vote', target: 1 }));
    must(act(st, 1, { type: 'vote', target: 0 }));
    must(act(st, 2, { type: 'vote', target: 1 }));
    must(act(st, 3, { type: 'vote', target: 0 }));
  }
  assert.equal(st.winner, 'imposter');
  assert.equal(st.reason, 'timeout');
});

test('8 joueurs : éliminer un imposteur ne suffit pas, la partie continue sans devinette', () => {
  const st = g.init(Array(8).fill('x'), { words: ['Chat', 'Chien'], imposters: [6, 7] });
  toVote(st);
  everyoneVotes(st, 6);
  assert.equal(st.phase, 'clues'); // le 2e imposteur est encore là
  assert.equal(st.winner, null);
  toVote(st);
  everyoneVotes(st, 7); // le dernier : devinette
  assert.equal(st.phase, 'guess');
  must(act(st, 7, { type: 'guess', text: 'nope' }));
  assert.equal(st.winner, 'civil');
});

// ---- départs ------------------------------------------------------------------------------------------------

// Rôles fixés d'après l'ordre de parole (tiré au hasard) : seul `imp` est imposteur.
function setImposter(st, imp) {
  st.players.forEach((p, i) => { p.role = i === imp ? 'imposter' : 'civil'; });
}

test('départ pendant les indices : le tour est recalé sans sauter personne', () => {
  const st = game(6, 0);
  const [a, b, c, d, e, f] = st.order;
  setImposter(st, b); // les partants (a, c, e) sont tous civils
  must(act(st, a, { type: 'clue', text: 'un' }));
  must(act(st, b, { type: 'clue', text: 'deux' })); // c est le prochain
  g.onLeave(st, a); // il avait déjà parlé
  assert.equal(st.order[st.clueTurn], c);
  g.onLeave(st, c); // c'était son tour
  assert.equal(st.order[st.clueTurn], d);
  g.onLeave(st, e); // pas encore parlé, plus loin
  assert.deepEqual(st.order, [b, d, f]);
  assert.equal(st.order[st.clueTurn], d);
  assert.equal(st.winner, null);
});

test('départ : le dernier à parler ouvre la discussion ; en discussion, recale les « prêts »', () => {
  const st = game(5, 0);
  const [a, b, c, d, e] = st.order;
  setImposter(st, a);
  for (const i of [a, b, c, d]) must(act(st, i, { type: 'clue', text: 'm' + i }));
  g.onLeave(st, e); // le dernier à parler part : la discussion s'ouvre
  assert.equal(st.phase, 'discuss');
  for (const i of [a, b, c]) must(act(st, i, { type: 'ready' }));
  assert.equal(st.phase, 'discuss'); // d n'est pas prêt
  g.onLeave(st, d); // le seul non prêt part : tout le monde l'est
  assert.equal(st.phase, 'vote');
});

test('départ en vote : ses votes et les votes contre lui disparaissent, le vote peut se conclure', () => {
  const st = game(5, 4);
  toVote(st);
  must(act(st, 0, { type: 'vote', target: 1 }));
  must(act(st, 2, { type: 'vote', target: 3 }));
  must(act(st, 3, { type: 'vote', target: 1 }));
  g.onLeave(st, 1); // 0 et 3 devront revoter ; il n'a pas voté
  assert.equal('0' in st.votes, false);
  assert.equal('3' in st.votes, false);
  assert.equal(st.phase, 'vote');
  assert.deepEqual(Object.keys(st.votes), ['2']);
  assert.equal(g.view(st, 0).hints.targets.includes(1), false);
});

test('départ : de l’imposteur → civils ; d’un civil jusqu’à l’égalité → imposteur ; du devineur → civils', () => {
  let st = game(4, 3);
  g.onLeave(st, 3);
  assert.equal(st.winner, 'civil');
  assert.equal(st.reason, 'left');

  st = game(4, 3);
  g.onLeave(st, 0);
  assert.equal(st.winner, null);
  g.onLeave(st, 1); // 1 civil vs 1 imposteur
  assert.equal(st.winner, 'imposter');

  st = game(4, 3);
  toVote(st);
  everyoneVotes(st, 3);
  g.onLeave(st, 3);
  assert.equal(st.winner, 'civil');

  st = game(3, 2);
  g.onLeave(st, 0);
  assert.equal(st.winner, 'imposter'); // 1 civil vs 1 imposteur
  assert.doesNotThrow(() => JSON.stringify(g.view(st, 1)));
  g.onLeave(st, 1); // après la fin : sans effet
});

test('départ d’un éliminé : sans effet sur la partie', () => {
  const st = game(5, 4);
  toVote(st);
  everyoneVotes(st, 1);
  const before = JSON.stringify(g.view(st, 0));
  g.onLeave(st, 1);
  assert.equal(JSON.stringify(g.view(st, 0)), before);
});

// ---- parties aléatoires -------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('parties aléatoires : toujours une fin, jamais de blocage, secret respecté', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rand = mulberry32(seed);
    const n = 3 + (seed % 6);
    const st = g.init(Array(n).fill('x'), { rng: rand });
    for (let step = 0; step < 400 && st.winner === null; step++) {
      const moves = [];
      for (let i = 0; i < n; i++) {
        const h = g.view(st, i).hints;
        for (const a of h.actions) {
          if (a === 'clue') moves.push([i, { type: 'clue', text: `m${Math.floor(rand() * 5)}` }]);
          else if (a === 'vote') moves.push([i, { type: 'vote', target: h.targets[Math.floor(rand() * h.targets.length)] }]);
          else if (a === 'guess') moves.push([i, { type: 'guess', text: rand() < 0.3 ? st.words.civil : 'faux' }]);
          else moves.push([i, { type: a }]);
        }
      }
      if (rand() < 0.01) moves.push([Math.floor(rand() * n), 'leave']);
      if (moves.length === 0) assert.fail(`seed ${seed} étape ${step} : bloquée en phase ${st.phase}`);
      const [who, a] = moves[Math.floor(rand() * moves.length)];
      if (a === 'leave') g.onLeave(st, who); else act(st, who, a);

      // Invariants : au moins un joueur vivant, secret des mots avant la fin.
      if (st.winner === null) {
        assert.ok(st.players.some((p) => p.alive), `seed ${seed} : plus personne`);
        for (let i = 0; i < n; i++) {
          const json = JSON.stringify(g.view(st, i));
          const other = st.words[st.players[i].role === 'civil' ? 'imposter' : 'civil'];
          assert.equal(json.includes(`"${other}"`), false, `seed ${seed} : le mot adverse fuite`);
        }
      }
    }
    assert.notEqual(st.winner, null, `seed ${seed} : partie non terminée`);
  }
});

// ---- tables ----------------------------------------------------------------------------------------------------------------

test('tables : 3 joueurs minimum, démarrage par l’hôte, vue personnelle', () => {
  const { createChat } = require('../server/chat');
  const { createTables } = require('../server/tables');
  const players = new Map();
  for (const id of ['a', 'b', 'c']) {
    const got = [];
    players.set(id, { id, name: id.toUpperCase(), got, conn: { send: (t) => got.push(JSON.parse(t)) } });
  }
  const chat = createChat({ players });
  const tables = createTables({ players, chat, broadcast: () => {} });
  const last = (id) => players.get(id).got.filter((m) => m.type === 'table').at(-1).table;

  tables.create('a', 'impostor');
  const t = tables.list()[0];
  assert.deepEqual([t.min, t.max, t.manual], [3, 8, true]);
  tables.join('b', t.id);
  assert.equal(tables.start('a').error, 'not-enough');
  tables.join('c', t.id);
  assert.equal(tables.start('a').ok, true);
  const words = [0, 1, 2].map((i) => ['a', 'b', 'c'][i]).map((id) => last(id).state.me.word);
  assert.equal(new Set(words).size, 2); // deux mots différents en jeu
});
