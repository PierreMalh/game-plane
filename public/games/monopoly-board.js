'use strict';
// Plateau de Business Class (jeu « façon Monopoly », thème avion). Données pures
// partagées : le serveur les `require`, le navigateur les charge en <script>
// (global MonopolyBoard). Une seule source de vérité pour les prix et loyers.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MonopolyBoard = factory();
})(this, function () {
  // Groupes de couleur : prix de la maison (l'hôtel = 5e niveau, même prix).
  const GROUPS = {
    brown: { color: '#955436', house: 50 },
    lightblue: { color: '#aae0fa', house: 50 },
    pink: { color: '#d93a96', house: 100 },
    orange: { color: '#f7941d', house: 100 },
    red: { color: '#ed1b24', house: 150 },
    yellow: { color: '#fef200', house: 150 },
    green: { color: '#1fb25a', house: 200 },
    darkblue: { color: '#0072bb', house: 200 },
  };

  // Loyers : [terrain nu, 1, 2, 3, 4 maisons, hôtel].
  const prop = (name, group, price, rent) => ({ t: 'prop', name, group, price, rent });
  const airport = (name) => ({ t: 'airport', name, price: 200, rent: [25, 50, 100, 200] });
  const utility = (name) => ({ t: 'utility', name, price: 150 });

  const SQUARES = [
    { t: 'go', name: 'Décollage' },                                              // 0
    prop('Lagos', 'brown', 60, [2, 10, 30, 90, 160, 250]),                       // 1
    { t: 'chest', name: 'Cagnotte' },                                            // 2
    prop('Hanoï', 'brown', 60, [4, 20, 60, 180, 320, 450]),                      // 3
    { t: 'tax', name: 'Taxe d’aéroport', amount: 200 },                          // 4
    airport('Hub Atlantique'),                                                   // 5
    prop('Lima', 'lightblue', 100, [6, 30, 90, 270, 400, 550]),                  // 6
    { t: 'chance', name: 'Imprévu' },                                            // 7
    prop('Bogota', 'lightblue', 100, [6, 30, 90, 270, 400, 550]),                // 8
    prop('Nairobi', 'lightblue', 120, [8, 40, 100, 300, 450, 600]),              // 9
    { t: 'jail', name: 'Douane' },                                               // 10
    prop('Istanbul', 'pink', 140, [10, 50, 150, 450, 625, 750]),                 // 11
    utility('Kérosène'),                                                         // 12
    prop('Le Caire', 'pink', 140, [10, 50, 150, 450, 625, 750]),                 // 13
    prop('Athènes', 'pink', 160, [12, 60, 180, 500, 700, 900]),                  // 14
    airport('Hub Pacifique'),                                                    // 15
    prop('Lisbonne', 'orange', 180, [14, 70, 200, 550, 750, 950]),               // 16
    { t: 'chest', name: 'Cagnotte' },                                            // 17
    prop('Prague', 'orange', 180, [14, 70, 200, 550, 750, 950]),                 // 18
    prop('Vienne', 'orange', 200, [16, 80, 220, 600, 800, 1000]),                // 19
    { t: 'parking', name: 'Salon VIP' },                                         // 20
    prop('Madrid', 'red', 220, [18, 90, 250, 700, 875, 1050]),                   // 21
    { t: 'chance', name: 'Imprévu' },                                            // 22
    prop('Berlin', 'red', 220, [18, 90, 250, 700, 875, 1050]),                   // 23
    prop('Amsterdam', 'red', 240, [20, 100, 300, 750, 925, 1100]),               // 24
    airport('Hub Sahara'),                                                       // 25
    prop('Rome', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),                 // 26
    prop('Londres', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),              // 27
    utility('Catering'),                                                         // 28
    prop('Singapour', 'yellow', 280, [24, 120, 360, 850, 1025, 1200]),           // 29
    { t: 'gotojail', name: 'Fouille douanière' },                                // 30
    prop('Sydney', 'green', 300, [26, 130, 390, 900, 1100, 1275]),               // 31
    prop('Séoul', 'green', 300, [26, 130, 390, 900, 1100, 1275]),                // 32
    { t: 'chest', name: 'Cagnotte' },                                            // 33
    prop('Dubaï', 'green', 320, [28, 150, 450, 1000, 1200, 1400]),               // 34
    airport('Hub Arctique'),                                                     // 35
    { t: 'chance', name: 'Imprévu' },                                            // 36
    prop('Tokyo', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500]),            // 37
    { t: 'tax', name: 'Surtaxe bagages', amount: 100 },                          // 38
    prop('New York', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000]),         // 39
  ];

  // Cases de chaque groupe de couleur : { brown: [1, 3], … }.
  const GROUP_SQUARES = {};
  SQUARES.forEach((sq, i) => { if (sq.group) (GROUP_SQUARES[sq.group] ??= []).push(i); });

  const indexByName = (name) => SQUARES.findIndex((s) => s.name === name);

  return { SQUARES, GROUPS, GROUP_SQUARES, indexByName, COUNT: SQUARES.length, JAIL: 10 };
});
