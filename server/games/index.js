'use strict';
// Registre des jeux. Un jeu expose :
//   id, name, minPlayers, maxPlayers
//   init(playerIds, { first }) → état            (créé au début de chaque manche)
//   action(état, indexJoueur, action) → { ok, error? }   (mute l'état)
//   view(état, indexJoueur) → ce que ce joueur a le droit de voir
//   isOver(état) → booléen
// Pour ajouter un jeu : un fichier ici + son rendu dans public/games/.

const games = new Map();
for (const g of [require('./connect4')]) games.set(g.id, g);

module.exports = { games };
