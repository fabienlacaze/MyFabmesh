'use strict';
/* NOMS DE PROJET NON LATINS OU ACCENTUES (2026-10-13, audit de la langue du 11/10 : CHAMPS-13, CHAMPS-24, MANQUE-SERV-03).
 *
 * Le dossier d'images d'un projet (et le prefixe de ses maillages) etait le nom saisi avec tout caractere hors [a-zA-Z0-9_-] remplace
 * par « _ » : « Épée magique » -> « _p_e_magique », et tout nom chinois, arabe, hindi, russe... devenait une suite de « _ » de sa
 * longueur. Deux projets de meme longueur (« 兽人战士 » et « 精灵射手 » -> « ____ ») partageaient donc le MEME dossier : images,
 * prompts.json et prompt.txt melanges, nom mutile dans la grille et dans le prompt.
 *
 * Regle (la MEME que le worker, cloud/src/worker.ts : slugNonLatin / slugProjet) :
 *   - nom entierement ASCII : la regle d'AVANT de l'appelant, inchangee a l'octet pres (aucun dossier existant ne change de nom) ;
 *   - sinon : partie lisible ASCII (accents retires, cyrillique et grec translitteres, le reste ecarte) + « -h » + empreinte
 *     FNV-1a 32 bits du nom EXACT (forme NFC) : stable, unique par nom, et deja sure (que [A-Za-z0-9_-]), donc point fixe des
 *     anciennes regles : un dossier de ce type rendu comme nom de projet reste le meme dossier.
 * Le « -h » protege l'empreinte des regles de rattachement par nom de fichier (« _<chiffres> » retire en fin de nom, motif hexadecimal
 * pris pour un maillage orphelin sur le site).
 * Les anciens dossiers (« ____ », « _p_e_magique ») restent lus tels quels : rien n'est renomme sur le disque. */

/** Lettres que la decomposition NFKD ne ramene pas a l'ASCII : latin etendu, cyrillique, grec. Les autres ecritures n'ont pas de
 *  translitteration simple : elles ne laissent que l'empreinte (« project-h1a2b3c4d »). */
const TRANSLIT = {
  'ß': 'ss', 'ẞ': 'SS', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', 'œ': 'oe', 'Œ': 'OE', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D',
  'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H', 'ŋ': 'ng', 'Ŋ': 'Ng',
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh',
  'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', 'є': 'ye', 'і': 'i', 'ґ': 'g', 'ђ': 'dj', 'ј': 'j',
  'љ': 'lj', 'њ': 'nj', 'ћ': 'c', 'џ': 'dz',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'К': 'K', 'Л': 'L', 'М': 'M',
  'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh',
  'Щ': 'Shch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya', 'Є': 'Ye', 'І': 'I', 'Ґ': 'G', 'Ђ': 'Dj', 'Ј': 'J',
  'Љ': 'Lj', 'Њ': 'Nj', 'Ћ': 'C', 'Џ': 'Dz',
  'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm',
  'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'ch', 'ψ': 'ps',
  'ω': 'o', 'Α': 'A', 'Β': 'B', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'I', 'Θ': 'Th', 'Ι': 'I', 'Κ': 'K', 'Λ': 'L',
  'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O', 'Π': 'P', 'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'F', 'Χ': 'Ch', 'Ψ': 'Ps',
  'Ω': 'O',
};

/** Vrai si le nom ne contient que de l'ASCII (code < 128) : c'est lui qui garde la regle d'avant. */
function estNomAscii(nom) {
  return !/[^\x00-\x7f]/.test(String(nom == null ? '' : nom));
}

/** Empreinte du nom EXACT : FNV-1a 32 bits des octets UTF-8 de sa forme NFC, en 8 chiffres hexadecimaux. */
function empreinteNom(nom) {
  const octets = new TextEncoder().encode(String(nom == null ? '' : nom).normalize('NFC'));
  let h = 0x811c9dc5;
  for (const o of octets) { h ^= o; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Partie LISIBLE (ASCII) : accents retires, lettres translitterees, tout le reste en « _ » (series fusionnees), 40 caracteres au plus. */
function partieLisible(nom) {
  const sansAccents = String(nom == null ? '' : nom).normalize('NFKD').replace(/\p{M}+/gu, '');
  let s = '';
  for (const c of sansAccents) s += (Object.prototype.hasOwnProperty.call(TRANSLIT, c) ? TRANSLIT[c] : c);
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '');
}

/** Slug d'un nom NON entierement ASCII : « Éléphant » -> « Elephant-h<8 hex> », « 兽人战士 » -> « project-h<8 hex> ». */
function slugNonLatin(nom) {
  return (partieLisible(nom) || 'project') + '-h' + empreinteNom(nom);
}

/** Regle d'avant du dossier d'images du bureau (generate-images) : tout caractere hors [a-zA-Z0-9_-] devient « _ ». */
const regleDossierBureau = (n) => n.replace(/[^a-zA-Z0-9_-]/g, '_');

/** Slug d'un nom de projet : regle d'avant de l'appelant (`regleAscii`) pour un nom ASCII, slugNonLatin sinon. */
function slugProjet(nom, regleAscii = regleDossierBureau) {
  const n = nom == null ? '' : String(nom);
  return estNomAscii(n) ? regleAscii(n) : slugNonLatin(n);
}

/* NOM D'AFFICHAGE (config.projectDisplayNames : cle = dossier, valeur = nom affiche ; deja lu par la grille du bureau). Le dossier d'un
 * nom non latin ne dit plus rien du nom (« project-h1a2b3c4d ») : le nom SAISI est memorise des la creation du dossier, pour la grille,
 * le prompt (nom du projet place devant la description) et le nom envoye au site en mode Cloud. Un nom ASCII n'est jamais memorise :
 * son dossier et ce qu'il envoie au site restent ceux d'avant. */

/** Nom a memoriser pour `dossier` (ou null) : seulement un nom non latin, qui DONNE ce dossier, et si rien n'est deja memorise. */
function nomAffichageAMemoriser(dossier, nomSaisi, dejaMemorise) {
  const saisi = String(nomSaisi == null ? '' : nomSaisi);
  if (!saisi.trim() || !dossier || dejaMemorise || estNomAscii(saisi)) return null;
  return slugNonLatin(saisi) === dossier ? saisi : null;
}

/** Nom envoye au site pour une generation rangee dans `dossier` (CHAMPS-24 : c'etait le nom de DOSSIER assaini, « ____ » ou
 *  « _p_e_magique »). Le nom saisi memorise pour ce dossier ; a defaut le nom recu s'il est non latin ; sinon (nom ASCII, ou ancien
 *  dossier d'avant ce correctif) le nom de dossier, comme avant : le site garde le meme nom de projet que pour les generations passees.
 *  Un nom d'affichage pose par un simple renommage (« orc » affiche « Mon orc ») n'est PAS utilise : il ne donne pas ce dossier. */
function nomPourLeSite(dossier, nomSaisi, nomsAffiches) {
  const memorise = nomsAffiches && Object.prototype.hasOwnProperty.call(nomsAffiches, dossier) ? String(nomsAffiches[dossier] || '') : '';
  if (memorise && !estNomAscii(memorise) && slugNonLatin(memorise) === dossier) return memorise;
  const saisi = String(nomSaisi == null ? '' : nomSaisi);
  return saisi.trim() && !estNomAscii(saisi) ? saisi : dossier;
}

module.exports = {
  TRANSLIT, estNomAscii, empreinteNom, partieLisible, slugNonLatin, slugProjet, regleDossierBureau,
  nomAffichageAMemoriser, nomPourLeSite,
};
