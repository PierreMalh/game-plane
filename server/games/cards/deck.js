'use strict';
// Outils communs aux jeux de cartes : un paquet de 52, codé « rang + couleur »
// (ex. "10H" = dix de cœur, "AS" = as de pique, "2C" = deux de trèfle).
// Couleurs : C trèfle ♣, D carreau ♦, H cœur ♥, S pique ♠.

const SUITS = ['C', 'D', 'H', 'S'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const rankOf = (code) => code.slice(0, -1);
const suitOf = (code) => code.slice(-1);

const makeDeck = () => RANKS.flatMap((r) => SUITS.map((s) => r + s));
const DECK_SET = new Set(makeDeck());
const isCard = (code) => typeof code === 'string' && DECK_SET.has(code);

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { // Fisher-Yates
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Distribue toutes les cartes à tour de rôle : certains joueurs en ont une de plus.
function dealAll(deck, n) {
  const hands = Array.from({ length: n }, () => []);
  deck.forEach((c, i) => hands[i % n].push(c));
  return hands;
}

// Retire `cards` de `hand` (mute) ; false si une carte n'y est pas ou en double.
function takeCards(hand, cards) {
  if (!Array.isArray(cards) || new Set(cards).size !== cards.length) return false;
  if (!cards.every((c) => isCard(c) && hand.includes(c))) return false;
  for (const c of cards) hand.splice(hand.indexOf(c), 1);
  return true;
}

module.exports = { SUITS, RANKS, rankOf, suitOf, makeDeck, isCard, shuffle, dealAll, takeCards };
