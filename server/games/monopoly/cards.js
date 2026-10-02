'use strict';
// Cartes Imprévu (« chance ») et Cagnotte (« caisse commune »). Textes originaux.
// Effets (fx) :
//   goto {to}              avance jusqu'à la case (touche le salaire si on repasse par le départ)
//   nearest {kind}         avance jusqu'au hub / à la compagnie la plus proche
//   money {amount}         ±amount (négatif = on paie la banque)
//   back {n}               recule de n cases
//   jail                   direct à la douane
//   jailcard               carte « sortie de douane » (conservée jusqu'à usage)
//   repairs {house,hotel}  paie par maison / hôtel possédés
//   payEach / collectEach {amount}  paie à / reçoit de chaque autre joueur

const { indexByName } = require('../../../public/games/monopoly-board');

const at = (name) => indexByName(name);

const CHANCE = [
  { id: 'i1', text: 'Embarquement immédiat : avance jusqu’au Décollage et touche 200.', fx: { type: 'goto', to: 0 } },
  { id: 'i2', text: 'Un ami t’invite à Dubaï : avance jusqu’à cette case.', fx: { type: 'goto', to: at('Dubaï') } },
  { id: 'i3', text: 'Week-end à Rome : avance jusqu’à cette case.', fx: { type: 'goto', to: at('Rome') } },
  { id: 'i4', text: 'Tokyo t’attend : avance jusqu’à cette case.', fx: { type: 'goto', to: at('Tokyo') } },
  { id: 'i5', text: 'Correspondance : avance jusqu’au Hub Atlantique.', fx: { type: 'goto', to: at('Hub Atlantique') } },
  { id: 'i6', text: 'Avance jusqu’au hub le plus proche. S’il est à un joueur, paie-lui le double du loyer.', fx: { type: 'nearest', kind: 'airport' } },
  { id: 'i7', text: 'Avance jusqu’au hub le plus proche. S’il est à un joueur, paie-lui le double du loyer.', fx: { type: 'nearest', kind: 'airport' } },
  { id: 'i8', text: 'Avance jusqu’à la compagnie de services la plus proche. Si elle est à un joueur, lance les dés et paie-lui 10 fois le résultat.', fx: { type: 'nearest', kind: 'utility' } },
  { id: 'i9', text: 'Tes actions décollent : reçois 50.', fx: { type: 'money', amount: 50 } },
  { id: 'i10', text: 'Ton prêt arrive à échéance : reçois 150.', fx: { type: 'money', amount: 150 } },
  { id: 'i11', text: 'Excès de vitesse sur le tarmac : paie 15.', fx: { type: 'money', amount: -15 } },
  { id: 'i12', text: 'Turbulences : recule de 3 cases.', fx: { type: 'back', n: 3 } },
  { id: 'i13', text: 'Contrôle suspect : va directement à la douane, sans passer par le Décollage.', fx: { type: 'jail' } },
  { id: 'i14', text: 'Passe-droit : cette carte te sort de la douane. Conserve-la jusqu’à usage.', fx: { type: 'jailcard' } },
  { id: 'i15', text: 'Rénovation de tes biens : paie 25 par maison et 100 par hôtel.', fx: { type: 'repairs', house: 25, hotel: 100 } },
  { id: 'i16', text: 'Tu offres le champagne à bord : paie 50 à chaque joueur.', fx: { type: 'payEach', amount: 50 } },
];

const CHEST = [
  { id: 'c1', text: 'Embarquement immédiat : avance jusqu’au Décollage et touche 200.', fx: { type: 'goto', to: 0 } },
  { id: 'c2', text: 'Erreur de la compagnie en ta faveur : reçois 200.', fx: { type: 'money', amount: 200 } },
  { id: 'c3', text: 'Frais de médecin du voyageur : paie 50.', fx: { type: 'money', amount: -50 } },
  { id: 'c4', text: 'Vente de souvenirs à la boutique : reçois 50.', fx: { type: 'money', amount: 50 } },
  { id: 'c5', text: 'Passe-droit : cette carte te sort de la douane. Conserve-la jusqu’à usage.', fx: { type: 'jailcard' } },
  { id: 'c6', text: 'Fouille approfondie : va directement à la douane, sans passer par le Décollage.', fx: { type: 'jail' } },
  { id: 'c7', text: 'Remboursement de taxes : reçois 20.', fx: { type: 'money', amount: 20 } },
  { id: 'c8', text: 'C’est ton anniversaire : chaque joueur te donne 10.', fx: { type: 'collectEach', amount: 10 } },
  { id: 'c9', text: 'Assurance annulation : reçois 100.', fx: { type: 'money', amount: 100 } },
  { id: 'c10', text: 'Frais d’hôpital : paie 100.', fx: { type: 'money', amount: -100 } },
  { id: 'c11', text: 'Frais de formation des pilotes : paie 50.', fx: { type: 'money', amount: -50 } },
  { id: 'c12', text: 'Honoraires de consultant : reçois 25.', fx: { type: 'money', amount: 25 } },
  { id: 'c13', text: 'Entretien de tes biens : paie 40 par maison et 115 par hôtel.', fx: { type: 'repairs', house: 40, hotel: 115 } },
  { id: 'c14', text: 'Tu gagnes le concours de la meilleure valise : reçois 10.', fx: { type: 'money', amount: 10 } },
  { id: 'c15', text: 'Héritage d’une tante voyageuse : reçois 100.', fx: { type: 'money', amount: 100 } },
  { id: 'c16', text: 'Vente d’actions : reçois 50.', fx: { type: 'money', amount: 50 } },
];

const BY_ID = new Map([...CHANCE, ...CHEST].map((c) => [c.id, c]));

module.exports = { CHANCE, CHEST, BY_ID };
