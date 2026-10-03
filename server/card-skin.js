'use strict';
// Jeu de cartes personnalisé : une image par carte (et une pour le dos), envoyée
// depuis un téléphone et stockée sur l'hôte dans le dossier `custom-cards/` du projet.
// Les fichiers survivent au redémarrage du serveur : le dossier est relu au lancement.
// Nom de fichier : « <clé>.<ext> », clé = code de carte (« AS », « 10H »…) ou « back ».

const fs = require('fs');
const path = require('path');
const { makeDeck } = require('./games/cards/deck');

const DEFAULT_DIR = path.join(__dirname, '..', 'custom-cards');
const KEYS = new Set([...makeDeck(), 'back']);
const MAX_BYTES = 2 * 1024 * 1024; // le client réduit l'image avant l'envoi : quelques dizaines de Ko

// Format reconnu à la signature des premiers octets (on ne se fie pas au Content-Type).
const FORMATS = [
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8' },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];
const BY_EXT = new Map(FORMATS.map((f) => [f.ext, f]));

const isKey = (key) => typeof key === 'string' && KEYS.has(key);
const sniff = (buf) => FORMATS.find((f) => f.test(buf)) ?? null;

function createCardSkin({ dir = DEFAULT_DIR } = {}) {
  // clé → { file, mime, version } ; version = horodatage, sert à contourner le cache du navigateur.
  const entries = new Map();

  // Relecture du dossier au démarrage (fichiers déjà envoyés lors d'une session précédente).
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* dossier absent : aucun visuel perso */ }
  for (const name of names) {
    const m = /^(.+)\.([a-z]+)$/.exec(name);
    const fmt = m && BY_EXT.get(m[2]);
    if (!fmt || !isKey(m[1]) || entries.has(m[1])) continue;
    const file = path.join(dir, name);
    let version = 0;
    try { version = Math.floor(fs.statSync(file).mtimeMs); } catch { continue; }
    entries.set(m[1], { file, mime: fmt.mime, version });
  }

  // Vue publique : { clé: version }.
  const list = () => Object.fromEntries([...entries].map(([k, e]) => [k, e.version]));

  function unlinkQuiet(file) { try { fs.unlinkSync(file); } catch { /* déjà absent */ } }

  function save(key, buf) {
    if (!isKey(key)) return { ok: false, error: 'bad-card' };
    if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, error: 'empty' };
    if (buf.length > MAX_BYTES) return { ok: false, error: 'too-big' };
    const fmt = sniff(buf);
    if (!fmt) return { ok: false, error: 'bad-format' };
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${key}.${fmt.ext}`);
    // Écriture atomique (fichier temporaire puis renommage) : jamais d'image à moitié écrite.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    const old = entries.get(key);
    if (old && old.file !== file) unlinkQuiet(old.file); // changement de format (png → jpg)
    // Version strictement croissante, même pour deux envois dans la même milliseconde.
    const version = Math.max(Date.now(), (old?.version ?? 0) + 1);
    entries.set(key, { file, mime: fmt.mime, version });
    return { ok: true };
  }

  function remove(key) {
    if (!isKey(key)) return { ok: false, error: 'bad-card' };
    const e = entries.get(key);
    if (!e) return { ok: true, changed: false };
    unlinkQuiet(e.file);
    entries.delete(key);
    return { ok: true, changed: true };
  }

  function clear() {
    for (const e of entries.values()) unlinkQuiet(e.file);
    entries.clear();
    return { ok: true };
  }

  const get = (key) => (isKey(key) ? entries.get(key) ?? null : null);

  return { list, save, remove, clear, get };
}

module.exports = { createCardSkin, MAX_BYTES, isKey };
