# Dépendances copiées dans le dépôt

Le projet n'a aucune dépendance npm (rien à installer hors ligne, dans l'avion).
Les rares bibliothèques tierces sont donc copiées ici, sans modification.

| Fichier | Origine | Version | Licence |
|---|---|---|---|
| `chess.js` | https://github.com/jhlywa/chess.js (`dist/cjs/chess.js`, paquet npm `chess.js`) | 1.4.0 | BSD-2-Clause (`chess.js.LICENSE`) |

Pour mettre à jour : `npm pack chess.js`, extraire, recopier `dist/cjs/chess.js`
et `LICENSE`, puis relancer `npm test`.
