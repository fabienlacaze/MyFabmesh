// Importmap des pages rejouee sous Node (2026-10-15, filtrage anisotrope des visualiseurs) : appeler UNE fois, au debut du
// fichier de test, AVANT tout import dynamique de 'three' ou d'un module de lib/. Chaque fichier de test tourne dans son
// propre processus (node --test), donc l'enregistrement ne deborde pas sur les autres.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

/** @param {{ three: string, addons: string }} chemins  three = fichier three.module.js ; addons = dossier qui contient loaders/, controls/ ... */
export function brancherImportmap({ three, addons }) {
  const dossier = pathToFileURL(addons).href.replace(/\/?$/, '/');
  register('./_importmap-hooks.mjs', { parentURL: import.meta.url, data: { three: pathToFileURL(three).href, addons: dossier } });
}
