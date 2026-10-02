'use strict';
// Business Class : jeu façon Monopoly (2 à 6 joueurs), logique pure côté serveur.
//
// Déroulé d'un tour (st.phase) :
//   roll     le joueur lance les dés (ou, en douane : paie / carte / tente un double)
//   moving   état transitoire pendant la résolution d'une case
//   buy      case libre : acheter ou refuser (→ enchères)
//   auction  enchères, chacun son tour (+ ou passe)
//   debt     un joueur doit de l'argent : il vend / hypothèque, sinon faillite
//   after    fin de tour : gérer ses biens, échanger, puis « fin de tour »
//   over     partie terminée (st.winner)
// Les échanges entre joueurs sont possibles dans presque toutes les phases.
// Les messages du journal contiennent « @i » = pseudo du joueur i (remplacé côté client).

const { SQUARES, GROUPS, GROUP_SQUARES, COUNT, JAIL } = require('../../../public/games/monopoly-board');
const { CHANCE, CHEST, BY_ID } = require('./cards');

const START_CASH = 1500;
const GO_SALARY = 200;
const JAIL_FINE = 50;
const HOUSES_SUPPLY = 32;
const HOTELS_SUPPLY = 12;
const LOG_MAX = 40;
const OWNABLE = new Set(['prop', 'airport', 'utility']);

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
const isOwnable = (sq) => Number.isInteger(sq) && sq >= 0 && sq < COUNT && OWNABLE.has(SQUARES[sq].t);
const mortgageValue = (sq) => SQUARES[sq].price / 2;
const unmortgageCost = (sq) => Math.ceil(mortgageValue(sq) * 1.1);
const activeIdx = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].bankrupt);
const say = (st, text) => { st.log.push(text); if (st.log.length > LOG_MAX) st.log.shift(); };

// ---------------------------------------------------------------- initialisation

function makeDeck(cards, rng, shuffle) {
  const order = cards.map((c) => c.id);
  if (shuffle) for (let i = order.length - 1; i > 0; i--) { // Fisher-Yates
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { order };
}

function init(playerIds, { first = 0, rng = Math.random, shuffle = true } = {}) {
  const props = {};
  SQUARES.forEach((_, i) => { if (isOwnable(i)) props[i] = { owner: null, houses: 0, mortgaged: false }; });
  return {
    rng,
    players: playerIds.map(() => ({ cash: START_CASH, pos: 0, jail: null, cards: [], bankrupt: false })),
    props,
    turn: first % playerIds.length,
    phase: 'roll',
    dice: null,
    doubles: 0,          // doubles consécutifs ce tour
    rollAgain: false,    // le dernier jet était un double : on rejoue
    buying: null,        // case en attente d'achat (phase buy)
    decks: { chance: makeDeck(CHANCE, rng, shuffle), chest: makeDeck(CHEST, rng, shuffle) },
    auction: null,       // { sq, bid, bidder, order, pos }
    debt: null,          // { queue: [{ from, to, amount }], resume }
    trade: null,         // { from, to, give, get }
    bank: { houses: HOUSES_SUPPLY, hotels: HOTELS_SUPPLY },
    winner: null,
    lastCard: null,
    log: [],
  };
}

// ---------------------------------------------------------------- argent et dettes

// Paiements dus (de joueur à joueur ou à la banque : to === null). Renvoie true si
// tout est réglé ; sinon la phase passe à « debt » et `resume` dit comment repartir.
function charge(st, entries, resume = null) {
  st.debt = st.debt ?? { queue: [], resume: null };
  if (resume) st.debt.resume = resume;
  st.debt.queue.push(...entries.filter((e) => e.amount > 0));
  return flush(st) !== null;
}

// Règle les dettes dans l'ordre tant que les fonds suffisent. null = bloqué.
function flush(st) {
  const d = st.debt;
  while (d.queue.length) {
    const e = d.queue[0];
    const from = st.players[e.from];
    if (from.cash < e.amount) { st.phase = 'debt'; return null; }
    from.cash -= e.amount;
    if (e.to !== null) st.players[e.to].cash += e.amount;
    d.queue.shift();
  }
  const resume = d.resume;
  st.debt = null;
  return { resume };
}

// Après une vente / hypothèque / échange pendant une dette : on retente de payer.
function settle(st) {
  if (st.phase !== 'debt' || !st.debt) return;
  const done = flush(st);
  if (done) resumeAfterDebt(st, done.resume);
}

function resumeAfterDebt(st, resume) {
  if (resume && resume.move) advance(st, st.turn, resume.move);
  else finishLanding(st);
}

// ---------------------------------------------------------------- déplacements

function finishLanding(st) {
  st.buying = null;
  st.phase = st.rollAgain ? 'roll' : 'after';
}

function payGo(st, idx) {
  st.players[idx].cash += GO_SALARY;
  say(st, `@${idx} passe par le Décollage et touche ${GO_SALARY}.`);
}

function advance(st, idx, steps) {
  const p = st.players[idx];
  if (p.pos + steps >= COUNT) payGo(st, idx);
  p.pos = (p.pos + steps) % COUNT;
  st.phase = 'moving';
  resolveLanding(st, idx, {});
}

function moveTo(st, idx, target, opts = {}) {
  const p = st.players[idx];
  if (target < p.pos) payGo(st, idx); // on repasse par le départ
  p.pos = target;
  st.phase = 'moving';
  resolveLanding(st, idx, opts);
}

function sendToJail(st, idx) {
  const p = st.players[idx];
  p.pos = JAIL;
  p.jail = { turns: 0 };
  st.doubles = 0;
  st.rollAgain = false;
  st.buying = null;
  st.phase = 'after';
  say(st, `@${idx} va à la douane.`);
}

function resolveLanding(st, idx, opts) {
  const p = st.players[idx];
  const sq = SQUARES[p.pos];
  switch (sq.t) {
    case 'prop': case 'airport': case 'utility':
      landOnOwnable(st, idx, opts);
      break;
    case 'tax':
      say(st, `@${idx} paie ${sq.amount} (${sq.name}).`);
      charge(st, [{ from: idx, to: null, amount: sq.amount }]);
      break;
    case 'chance': drawCard(st, idx, 'chance'); break;
    case 'chest': drawCard(st, idx, 'chest'); break;
    case 'gotojail': sendToJail(st, idx); break;
    default: break; // départ, douane (simple visite), salon VIP : rien
  }
  if (st.phase === 'moving') finishLanding(st);
}

function landOnOwnable(st, idx, opts) {
  const sqi = st.players[idx].pos;
  const pr = st.props[sqi];
  if (pr.owner === null) { st.phase = 'buy'; st.buying = sqi; return; }
  if (pr.owner === idx || pr.mortgaged) return;
  const amount = rentFor(st, sqi, opts);
  say(st, `@${idx} paie ${amount} de loyer à @${pr.owner} (${SQUARES[sqi].name}).`);
  charge(st, [{ from: idx, to: pr.owner, amount }]);
}

// ---------------------------------------------------------------- loyers

function ownsGroup(st, group, idx) {
  return GROUP_SQUARES[group].every((q) => st.props[q].owner === idx);
}

function countOwned(st, type, idx) {
  return SQUARES.reduce((n, sq, i) => n + (sq.t === type && st.props[i].owner === idx ? 1 : 0), 0);
}

function rentFor(st, sqi, opts = {}) {
  const sq = SQUARES[sqi];
  const pr = st.props[sqi];
  if (sq.t === 'prop') {
    if (pr.houses > 0) return sq.rent[pr.houses];
    return sq.rent[0] * (ownsGroup(st, sq.group, pr.owner) ? 2 : 1); // groupe complet nu : double
  }
  if (sq.t === 'airport') return sq.rent[countOwned(st, 'airport', pr.owner) - 1] * (opts.rentMult ?? 1);
  // Compagnie : 4 × (ou 10 × avec les deux) le total des dés ; la carte impose 10 × un nouveau jet.
  if (opts.freshDice) {
    st.dice = [rollDie(st), rollDie(st)];
    say(st, `@${st.turn} lance les dés pour la compagnie : ${st.dice[0]} + ${st.dice[1]}.`);
  }
  const mult = opts.freshDice ? 10 : (countOwned(st, 'utility', pr.owner) === 2 ? 10 : 4);
  return mult * (st.dice[0] + st.dice[1]);
}

// ---------------------------------------------------------------- cartes

function drawCard(st, idx, deckName) {
  const deck = st.decks[deckName];
  const id = deck.order.shift();
  const card = BY_ID.get(id);
  const keep = card.fx.type === 'jailcard';
  if (keep) st.players[idx].cards.push({ deck: deckName, id });
  else deck.order.push(id);
  st.lastCard = { deck: deckName, text: card.text, player: idx };
  say(st, `@${idx} pioche ${deckName === 'chance' ? 'Imprévu' : 'Cagnotte'} : « ${card.text} ».`);
  applyCard(st, idx, card.fx);
}

function applyCard(st, idx, fx) {
  const p = st.players[idx];
  switch (fx.type) {
    case 'goto':
      moveTo(st, idx, fx.to);
      break;
    case 'nearest': {
      let target = p.pos;
      do { target = (target + 1) % COUNT; } while (SQUARES[target].t !== fx.kind);
      moveTo(st, idx, target, fx.kind === 'airport' ? { rentMult: 2 } : { freshDice: true });
      break;
    }
    case 'money':
      if (fx.amount >= 0) p.cash += fx.amount;
      else charge(st, [{ from: idx, to: null, amount: -fx.amount }]);
      break;
    case 'back':
      p.pos = (p.pos - fx.n + COUNT) % COUNT;
      st.phase = 'moving';
      resolveLanding(st, idx, {});
      break;
    case 'jail':
      sendToJail(st, idx);
      break;
    case 'repairs': {
      let houses = 0;
      let hotels = 0;
      for (const pr of Object.values(st.props)) {
        if (pr.owner !== idx) continue;
        if (pr.houses === 5) hotels++; else houses += pr.houses;
      }
      const cost = houses * fx.house + hotels * fx.hotel;
      if (cost > 0) charge(st, [{ from: idx, to: null, amount: cost }]);
      break;
    }
    case 'payEach':
      charge(st, activeIdx(st).filter((i) => i !== idx).map((i) => ({ from: idx, to: i, amount: fx.amount })));
      break;
    case 'collectEach':
      charge(st, activeIdx(st).filter((i) => i !== idx).map((i) => ({ from: i, to: idx, amount: fx.amount })));
      break;
    default: break; // jailcard : déjà rangée dans la main du joueur
  }
}

// ---------------------------------------------------------------- tour de jeu

function rollDie(st) { return 1 + Math.floor(st.rng() * 6); }

function nextTurn(st) {
  const n = st.players.length;
  let i = st.turn;
  do { i = (i + 1) % n; } while (st.players[i].bankrupt);
  st.turn = i;
  st.phase = 'roll';
  st.dice = null;
  st.doubles = 0;
  st.rollAgain = false;
  st.buying = null;
  st.lastCard = null;
}

function checkWinner(st) {
  const alive = activeIdx(st);
  if (alive.length === 1) {
    st.winner = alive[0];
    st.phase = 'over';
    st.debt = null;
    st.auction = null;
    st.trade = null;
    say(st, `@${alive[0]} remporte la partie !`);
  }
}

function roll(st, idx) {
  const p = st.players[idx];
  const a = rollDie(st);
  const b = rollDie(st);
  st.dice = [a, b];
  const dbl = a === b;

  if (p.jail) return rollInJail(st, idx, a, b, dbl);

  say(st, `@${idx} lance les dés : ${a} + ${b}${dbl ? ' (double !)' : ''}.`);
  if (dbl) {
    st.doubles++;
    if (st.doubles >= 3) { say(st, `Trois doubles de suite : @${idx} file à la douane.`); sendToJail(st, idx); return; }
    st.rollAgain = true;
  } else {
    st.rollAgain = false;
  }
  advance(st, idx, a + b);
}

function rollInJail(st, idx, a, b, dbl) {
  const p = st.players[idx];
  say(st, `@${idx} tente un double en douane : ${a} + ${b}.`);
  st.rollAgain = false;
  if (dbl) {
    p.jail = null;
    say(st, `Double ! @${idx} est libéré.`);
    advance(st, idx, a + b);
    return;
  }
  p.jail.turns++;
  if (p.jail.turns >= 3) {
    // 3e échec : amende obligatoire, puis on avance du jet.
    say(st, `@${idx} paie l’amende de ${JAIL_FINE} et sort de douane.`);
    p.jail = null;
    if (charge(st, [{ from: idx, to: null, amount: JAIL_FINE }], { move: a + b })) advance(st, idx, a + b);
    return;
  }
  st.phase = 'after';
}

// ---------------------------------------------------------------- achat et enchères

function buy(st, idx) {
  const sqi = st.buying;
  const price = SQUARES[sqi].price;
  st.players[idx].cash -= price;
  st.props[sqi].owner = idx;
  say(st, `@${idx} achète ${SQUARES[sqi].name} pour ${price}.`);
  finishLanding(st);
}

function startAuction(st, sqi) {
  const alive = activeIdx(st);
  const k = alive.indexOf(st.turn);
  const order = [...alive.slice(k + 1), ...alive.slice(0, k + 1)]; // le refuseur enchérit en dernier
  st.auction = { sq: sqi, bid: 0, bidder: null, order, pos: 0 };
  st.phase = 'auction';
  st.buying = null;
  say(st, `Enchères sur ${SQUARES[sqi].name}.`);
}

// Fin des enchères : un seul restant ayant enchéri → vendu ; plus personne → invendu.
function checkAuction(st) {
  const a = st.auction;
  if (a.order.length === 0 || (a.order.length === 1 && a.bidder === a.order[0])) {
    if (a.bidder !== null && st.players[a.bidder].cash >= a.bid) {
      st.players[a.bidder].cash -= a.bid;
      st.props[a.sq].owner = a.bidder;
      say(st, `@${a.bidder} remporte ${SQUARES[a.sq].name} aux enchères pour ${a.bid}.`);
    } else {
      say(st, `${SQUARES[a.sq].name} reste à la banque.`);
    }
    st.auction = null;
    finishLanding(st);
  }
}

// ---------------------------------------------------------------- constructions et hypothèques

const groupOf = (sqi) => GROUP_SQUARES[SQUARES[sqi].group];

function buildError(st, idx, sqi) {
  if (!isOwnable(sqi) || SQUARES[sqi].t !== 'prop') return 'not-buildable';
  const pr = st.props[sqi];
  if (pr.owner !== idx) return 'not-owner';
  const group = groupOf(sqi);
  if (!group.every((q) => st.props[q].owner === idx)) return 'no-monopoly';
  if (group.some((q) => st.props[q].mortgaged)) return 'mortgaged';
  if (pr.houses >= 5) return 'max-built';
  if (pr.houses > Math.min(...group.map((q) => st.props[q].houses))) return 'uneven';
  if (st.players[idx].cash < GROUPS[SQUARES[sqi].group].house) return 'no-cash';
  if (pr.houses === 4 ? st.bank.hotels < 1 : st.bank.houses < 1) return 'no-supply';
  return null;
}

function sellError(st, idx, sqi) {
  if (!isOwnable(sqi) || SQUARES[sqi].t !== 'prop') return 'not-buildable';
  const pr = st.props[sqi];
  if (pr.owner !== idx) return 'not-owner';
  if (pr.houses === 0) return 'no-buildings';
  if (pr.houses < Math.max(...groupOf(sqi).map((q) => st.props[q].houses))) return 'uneven';
  if (pr.houses === 5 && st.bank.houses < 4) return 'no-supply';
  return null;
}

function mortgageError(st, idx, sqi) {
  if (!isOwnable(sqi)) return 'not-ownable';
  const pr = st.props[sqi];
  if (pr.owner !== idx) return 'not-owner';
  if (pr.mortgaged) return 'already-mortgaged';
  if (SQUARES[sqi].t === 'prop' && groupOf(sqi).some((q) => st.props[q].houses > 0)) return 'has-buildings';
  return null;
}

function unmortgageError(st, idx, sqi) {
  if (!isOwnable(sqi)) return 'not-ownable';
  const pr = st.props[sqi];
  if (pr.owner !== idx) return 'not-owner';
  if (!pr.mortgaged) return 'not-mortgaged';
  if (st.players[idx].cash < unmortgageCost(sqi)) return 'no-cash';
  return null;
}

function doBuild(st, idx, sqi) {
  const pr = st.props[sqi];
  const cost = GROUPS[SQUARES[sqi].group].house;
  if (pr.houses === 4) { st.bank.houses += 4; st.bank.hotels -= 1; } else st.bank.houses -= 1;
  pr.houses++;
  st.players[idx].cash -= cost;
  say(st, `@${idx} construit ${pr.houses === 5 ? 'un hôtel' : 'une maison'} à ${SQUARES[sqi].name}.`);
}

function doSell(st, idx, sqi) {
  const pr = st.props[sqi];
  const cost = GROUPS[SQUARES[sqi].group].house;
  if (pr.houses === 5) { st.bank.hotels += 1; st.bank.houses -= 4; } else st.bank.houses += 1;
  pr.houses--;
  st.players[idx].cash += cost / 2;
  say(st, `@${idx} revend un bâtiment à ${SQUARES[sqi].name}.`);
}

// Qui peut gérer ses biens maintenant ? « full » : construire / lever une hypothèque ;
// « liquidate » : vendre / hypothéquer (aussi pour le débiteur en phase debt).
function canManage(st, idx, kind) {
  if (st.phase === 'debt') return kind === 'liquidate' && st.debt.queue[0].from === idx;
  return idx === st.turn && (st.phase === 'roll' || st.phase === 'after');
}

// ---------------------------------------------------------------- échanges

const tradeSide = (o) => ({
  cash: Number.isInteger(o?.cash) && o.cash > 0 ? o.cash : 0,
  props: Array.isArray(o?.props) ? [...new Set(o.props)] : [],
  cards: Number.isInteger(o?.cards) && o.cards > 0 ? o.cards : 0,
});

function tradeError(st, t) {
  const players = st.players;
  if (t.from === t.to || !players[t.from] || !players[t.to]) return 'bad-trade';
  if (players[t.from].bankrupt || players[t.to].bankrupt) return 'bad-trade';
  for (const [who, side] of [[t.from, t.give], [t.to, t.get]]) {
    const p = players[who];
    if (side.cash > p.cash || side.cards > p.cards.length) return 'not-enough';
    for (const sqi of side.props) {
      if (!isOwnable(sqi) || st.props[sqi].owner !== who) return 'not-owner';
      if (st.props[sqi].mortgaged) return 'mortgaged';
      if (SQUARES[sqi].t === 'prop' && groupOf(sqi).some((q) => st.props[q].houses > 0)) return 'has-buildings';
    }
  }
  const items = (s) => s.cash + s.props.length + s.cards;
  if (items(t.give) + items(t.get) === 0) return 'empty-trade';
  return null;
}

function executeTrade(st, t) {
  for (const [from, to, side] of [[t.from, t.to, t.give], [t.to, t.from, t.get]]) {
    st.players[from].cash -= side.cash;
    st.players[to].cash += side.cash;
    for (const sqi of side.props) st.props[sqi].owner = to;
    for (let i = 0; i < side.cards; i++) st.players[to].cards.push(st.players[from].cards.pop());
  }
  say(st, `@${t.from} et @${t.to} concluent un échange.`);
}

// ---------------------------------------------------------------- faillite et départ

// Retire un joueur : ses biens vont au créancier (joueur) ou retournent à la banque.
function eliminate(st, idx, creditor) {
  const p = st.players[idx];
  for (const pr of Object.values(st.props)) {
    if (pr.owner !== idx) continue;
    if (pr.houses === 5) st.bank.hotels += 1; else st.bank.houses += pr.houses;
    pr.houses = 0;
    if (creditor !== null) pr.owner = creditor;
    else { pr.owner = null; pr.mortgaged = false; }
  }
  if (creditor !== null) {
    st.players[creditor].cash += p.cash;
    st.players[creditor].cards.push(...p.cards);
  } else {
    for (const c of p.cards) st.decks[c.deck].order.push(c.id);
  }
  p.cash = 0;
  p.cards = [];
  p.jail = null;
  p.bankrupt = true;
  if (st.trade && (st.trade.from === idx || st.trade.to === idx)) st.trade = null;
  checkWinner(st);
}

// Recolle les morceaux de la partie après le retrait de `idx`.
function afterElimination(st, idx) {
  if (st.winner !== null) return;
  if (st.turn === idx) { // son tour s'arrête net
    st.debt = null;
    st.auction = null;
    st.buying = null;
    nextTurn(st);
    return;
  }
  if (st.debt) st.debt.queue = st.debt.queue.filter((e) => e.from !== idx && e.to !== idx);
  if (st.auction) {
    const a = st.auction;
    const at = a.order.indexOf(idx);
    if (at !== -1) {
      a.order.splice(at, 1);
      if (at < a.pos) a.pos--;
      if (a.pos >= a.order.length) a.pos = 0;
    }
    if (a.bidder === idx) a.bidder = null;
    checkAuction(st);
  } else if (st.phase === 'debt') {
    if (!st.debt || st.debt.queue.length === 0) { st.debt = null; finishLanding(st); } else settle(st);
  }
}

function onLeave(st, idx) {
  const p = st.players[idx];
  if (!p || p.bankrupt || st.winner !== null) return;
  say(st, `@${idx} a quitté la partie.`);
  eliminate(st, idx, null);
  afterElimination(st, idx);
}

// ---------------------------------------------------------------- actions

const TRADE_PHASES = ['roll', 'after', 'debt', 'buy'];

function action(st, idx, act) {
  if (st.winner !== null) return fail('over');
  if (!act || typeof act.type !== 'string') return fail('bad-action');
  const me = st.players[idx];
  if (!me || me.bankrupt) return fail('eliminated');
  const isTurn = idx === st.turn;

  switch (act.type) {
    case 'roll':
      if (st.phase !== 'roll' || !isTurn) return fail('not-your-turn');
      roll(st, idx);
      return ok();

    case 'pay-jail':
      if (st.phase !== 'roll' || !isTurn || !me.jail) return fail('not-in-jail');
      if (me.cash < JAIL_FINE) return fail('no-cash');
      me.cash -= JAIL_FINE;
      me.jail = null;
      say(st, `@${idx} paie ${JAIL_FINE} pour sortir de douane.`);
      return ok();

    case 'use-card': {
      if (st.phase !== 'roll' || !isTurn || !me.jail) return fail('not-in-jail');
      if (me.cards.length === 0) return fail('no-card');
      const c = me.cards.pop();
      st.decks[c.deck].order.push(c.id);
      me.jail = null;
      say(st, `@${idx} utilise sa carte et sort de douane.`);
      return ok();
    }

    case 'buy':
      if (st.phase !== 'buy' || !isTurn) return fail('not-your-turn');
      if (me.cash < SQUARES[st.buying].price) return fail('no-cash');
      buy(st, idx);
      return ok();

    case 'decline':
      if (st.phase !== 'buy' || !isTurn) return fail('not-your-turn');
      if (activeIdx(st).length < 2) return fail('bad-action');
      startAuction(st, st.buying);
      return ok();

    case 'bid': {
      const a = st.auction;
      if (st.phase !== 'auction' || a.order[a.pos] !== idx) return fail('not-your-turn');
      if (!Number.isInteger(act.amount) || act.amount <= a.bid) return fail('bid-too-low');
      if (act.amount > me.cash) return fail('no-cash');
      a.bid = act.amount;
      a.bidder = idx;
      a.pos = (a.pos + 1) % a.order.length;
      say(st, `@${idx} enchérit à ${act.amount}.`);
      checkAuction(st); // le dernier restant qui enchérit emporte le titre
      return ok();
    }

    case 'pass': {
      const a = st.auction;
      if (st.phase !== 'auction' || a.order[a.pos] !== idx) return fail('not-your-turn');
      a.order.splice(a.pos, 1);
      if (a.pos >= a.order.length) a.pos = 0;
      say(st, `@${idx} passe.`);
      checkAuction(st);
      return ok();
    }

    case 'end-turn':
      if (st.phase !== 'after' || !isTurn) return fail('not-your-turn');
      nextTurn(st);
      return ok();

    case 'build': case 'unmortgage': case 'sell-house': case 'mortgage': {
      const kind = act.type === 'build' || act.type === 'unmortgage' ? 'full' : 'liquidate';
      if (!canManage(st, idx, kind)) return fail('not-your-turn');
      const sqi = act.sq;
      const err = { build: buildError, 'sell-house': sellError, mortgage: mortgageError, unmortgage: unmortgageError }[act.type](st, idx, sqi);
      if (err) return fail(err);
      if (act.type === 'build') doBuild(st, idx, sqi);
      else if (act.type === 'sell-house') doSell(st, idx, sqi);
      else if (act.type === 'mortgage') {
        me.cash += mortgageValue(sqi);
        st.props[sqi].mortgaged = true;
        say(st, `@${idx} hypothèque ${SQUARES[sqi].name} (+${mortgageValue(sqi)}).`);
      } else {
        me.cash -= unmortgageCost(sqi);
        st.props[sqi].mortgaged = false;
        say(st, `@${idx} lève l’hypothèque de ${SQUARES[sqi].name} (−${unmortgageCost(sqi)}).`);
      }
      settle(st); // en phase debt, de l'argent frais peut régler la dette
      return ok();
    }

    case 'bankrupt': {
      if (st.phase !== 'debt' || st.debt.queue[0].from !== idx) return fail('not-in-debt');
      const creditor = st.debt.queue[0].to;
      say(st, `@${idx} fait faillite${creditor === null ? '' : ` au profit de @${creditor}`}.`);
      eliminate(st, idx, creditor);
      afterElimination(st, idx);
      return ok();
    }

    case 'trade-propose': {
      if (!TRADE_PHASES.includes(st.phase)) return fail('bad-phase');
      if (st.trade) return fail('trade-pending');
      if (!Number.isInteger(act.to)) return fail('bad-trade');
      const t = { from: idx, to: act.to, give: tradeSide(act.give), get: tradeSide(act.get) };
      const err = tradeError(st, t);
      if (err) return fail(err);
      st.trade = t;
      say(st, `@${idx} propose un échange à @${t.to}.`);
      return ok();
    }

    case 'trade-accept': {
      const t = st.trade;
      if (!t || t.to !== idx) return fail('no-trade');
      const err = tradeError(st, t); // les biens ont pu bouger depuis la proposition
      if (err) { st.trade = null; return fail(err); }
      executeTrade(st, t);
      st.trade = null;
      settle(st);
      return ok();
    }

    case 'trade-decline':
    case 'trade-cancel': {
      const t = st.trade;
      const who = act.type === 'trade-decline' ? t?.to : t?.from;
      if (!t || who !== idx) return fail('no-trade');
      say(st, act.type === 'trade-decline' ? `@${idx} refuse l’échange.` : `@${idx} retire sa proposition.`);
      st.trade = null;
      return ok();
    }

    default:
      return fail('bad-action');
  }
}

// ---------------------------------------------------------------- vue réseau

// Ce que le joueur `idx` peut faire maintenant (le client n'a aucune règle à connaître).
function hintsFor(st, idx) {
  const h = { actions: [], build: [], sell: [], mortgage: [], unmortgage: [], bid: null, buyPrice: null, canTrade: false };
  const me = st.players[idx];
  if (st.winner !== null || !me || me.bankrupt) return h;
  h.canTrade = TRADE_PHASES.includes(st.phase);

  const owned = Object.keys(st.props).map(Number).filter((q) => st.props[q].owner === idx);
  const list = (check, kind) => (canManage(st, idx, kind) ? owned.filter((q) => check(st, idx, q) === null) : []);
  h.build = list(buildError, 'full');
  h.unmortgage = list(unmortgageError, 'full');
  h.sell = list(sellError, 'liquidate');
  h.mortgage = list(mortgageError, 'liquidate');

  const isTurn = idx === st.turn;
  if (st.phase === 'roll' && isTurn) {
    h.actions.push('roll');
    if (me.jail && me.cash >= JAIL_FINE) h.actions.push('pay-jail');
    if (me.jail && me.cards.length > 0) h.actions.push('use-card');
  } else if (st.phase === 'after' && isTurn) {
    h.actions.push('end-turn');
  } else if (st.phase === 'buy' && isTurn) {
    h.buyPrice = SQUARES[st.buying].price;
    if (me.cash >= h.buyPrice) h.actions.push('buy');
    h.actions.push('decline');
  } else if (st.phase === 'auction' && st.auction.order[st.auction.pos] === idx) {
    h.bid = { min: st.auction.bid + 1, max: me.cash };
    if (h.bid.min <= h.bid.max) h.actions.push('bid');
    h.actions.push('pass');
  } else if (st.phase === 'debt' && st.debt.queue[0].from === idx) {
    h.actions.push('bankrupt');
  }
  return h;
}

function view(st, idx) {
  const head = st.debt?.queue[0] ?? null;
  return {
    players: st.players.map((p) => ({
      cash: p.cash, pos: p.pos, jail: p.jail ? p.jail.turns + 1 : 0, cards: p.cards.length, bankrupt: p.bankrupt,
    })),
    props: Object.fromEntries(Object.entries(st.props).map(([q, pr]) => [q, { owner: pr.owner, houses: pr.houses, mortgaged: pr.mortgaged }])),
    turn: st.turn,
    phase: st.phase,
    dice: st.dice,
    doubles: st.doubles,
    buying: st.buying,
    auction: st.auction && { sq: st.auction.sq, bid: st.auction.bid, bidder: st.auction.bidder, turn: st.auction.order[st.auction.pos], order: [...st.auction.order] },
    debt: head && { from: head.from, to: head.to, amount: head.amount },
    trade: st.trade && { from: st.trade.from, to: st.trade.to, give: st.trade.give, get: st.trade.get },
    bank: { ...st.bank },
    winner: st.winner,
    lastCard: st.lastCard,
    log: [...st.log],
    hints: hintsFor(st, idx),
  };
}

module.exports = {
  id: 'monopoly',
  name: 'Business Class',
  blurb: 'Façon Monopoly · 2 à 6 joueurs',
  minPlayers: 2,
  maxPlayers: 6,
  autoStart: false,
  init: (ids, opts) => init(ids, opts),
  action,
  view,
  onLeave,
  isOver: (st) => st.winner !== null,
  nextFirst: (_st, previousFirst) => previousFirst + 1, // init() prend le modulo du nombre de joueurs
  // Exposés pour les tests :
  rentFor,
  unmortgageCost,
  mortgageValue,
};
