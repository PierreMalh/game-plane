'use strict';
// Registre des jeux. Un jeu expose :
//   id, name, minPlayers, maxPlayers
//   init(playerIds, { first }) → état            (créé au début de chaque manche)
//   action(état, indexJoueur, action) → { ok, error? }   (mute l'état)
//   view(état, indexJoueur) → ce que ce joueur a le droit de voir
//   isOver(état) → booléen
//   nextFirst(état, premierPrécédent) → premier joueur de la manche suivante
// Optionnels :
//   autoStart: false   → l'hôte lance la partie (effectif variable minPlayers..maxPlayers)
//   onLeave(état, indexJoueur) → le joueur quitte en cours de partie sans mettre fin
//                        au jeu (sinon : forfait, l'adversaire gagne)
// Pour ajouter un jeu : un fichier ici + son rendu dans public/games/.

const games = new Map();
for (const g of [require('./connect4'), require('./chess'), require('./monopoly'), require('./impostor'), require('./cards/president'), require('./cards/eights'), require('./cards/liar'), require('./cards/belote'), require('./cards/coinche')]) games.set(g.id, g);

module.exports = { games };
