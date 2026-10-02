'use strict';
// Paires de mots voisins pour « Cherche l'imposteur » : [mot A, mot B].
// Au lancement, l'un devient le mot des civils et l'autre celui de l'imposteur
// (tirage au sort), pour qu'aucun des deux ne soit « le bon » par défaut.
// Ils doivent être assez proches pour qu'un indice puisse convenir aux deux.

const PAIRS = [
  ['Chat', 'Chien'], ['Pizza', 'Burger'], ['Café', 'Thé'], ['Plage', 'Piscine'], ['Avion', 'Hélicoptère'],
  ['Football', 'Rugby'], ['Guitare', 'Violon'], ['Pomme', 'Poire'], ['Lune', 'Soleil'], ['Montagne', 'Colline'],
  ['Cinéma', 'Théâtre'], ['Voiture', 'Moto'], ['Livre', 'Magazine'], ['Fromage', 'Beurre'], ['Chocolat', 'Caramel'],
  ['Hôpital', 'Clinique'], ['Médecin', 'Dentiste'], ['Roi', 'Empereur'], ['Château', 'Palais'], ['Pluie', 'Neige'],
  ['Rivière', 'Fleuve'], ['Lac', 'Mer'], ['Forêt', 'Jungle'], ['Tigre', 'Lion'], ['Loup', 'Renard'],
  ['Cheval', 'Âne'], ['Poule', 'Canard'], ['Pain', 'Brioche'], ['Vin', 'Bière'], ['Hôtel', 'Auberge'],
  ['Tente', 'Caravane'], ['Train', 'Métro'], ['Bus', 'Tramway'], ['Valise', 'Sac à dos'], ['Passeport', 'Visa'],
  ['Pilote', 'Chauffeur'], ['Nuage', 'Brouillard'], ['Étoile', 'Planète'], ['Ordinateur', 'Tablette'], ['Téléphone', 'Radio'],
  ['Piano', 'Orgue'], ['Cuisine', 'Salon'], ['Fourchette', 'Cuillère'], ['Verre', 'Tasse'], ['Chaussette', 'Gant'],
  ['Chapeau', 'Casquette'], ['Lunettes', 'Jumelles'], ['Montre', 'Réveil'], ['Pirate', 'Corsaire'], ['Sorcier', 'Magicien'],
  ['Dragon', 'Dinosaure'], ['Vampire', 'Fantôme'], ['Police', 'Gendarmerie'], ['Pompier', 'Ambulancier'], ['Boulanger', 'Pâtissier'],
  ['Crêpe', 'Gaufre'], ['Glace', 'Sorbet'], ['Fraise', 'Framboise'], ['Citron', 'Orange'], ['Carotte', 'Radis'],
  ['Sandwich', 'Hot-dog'], ['Tennis', 'Badminton'], ['Natation', 'Plongée'], ['Ski', 'Snowboard'], ['Vélo', 'Trottinette'],
  ['Bateau', 'Sous-marin'], ['Camping', 'Randonnée'], ['Mariage', 'Anniversaire'], ['Noël', 'Pâques'], ['Musée', 'Bibliothèque'],
];

module.exports = { PAIRS };
