#!/usr/bin/env node
/**
 * Refuse une construction dont un NOYAU PARTAGE a diverge entre ses deux
 * copies.
 *
 * POURQUOI DES COPIES. Certains algorithmes doivent tourner sur les deux
 * plateformes, et aucune ne peut importer le fichier de l'autre : l'image
 * Modal ne monte que `modal_app` (app.py `.add_local_python_source`), l'appli
 * bureau packagee n'embarque que `scripts` (package.json `build.files`).
 *
 * Une copie qu'on ne peut pas supprimer, on la SURVEILLE. Sans ca on rejoue le
 * defaut mesure le 2026-09-23 : le detourage manuel etait passe a Lucida en
 * juillet, le pipeline 3D etait reste sur u2net — deux mois, sans un mot.
 *
 * `--sync` recopie le noyau de la SOURCE vers la COPIE au lieu de refuser.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEBUT = '# --- NOYAU PARTAGE : DEBUT';
const FIN = '# --- NOYAU PARTAGE : FIN ---';

/** CRLF normalise : sous Windows, Git et les editeurs changent les fins de
 *  ligne sans rien changer au code. Les comparer ferait crier le garde pour
 *  rien, et on apprendrait a l'ignorer — c'est ainsi qu'un garde meurt. */
const lf = (s) => s.split('\r\n').join('\n');

/** source = le fichier qu'on edite ; copie = regeneree, jamais editee a la main. */
const PAIRES = [
  { nom: 'habits',     source: 'scripts/outfit_cutout.py', copie: 'modal_app/_outfit_cutout.py', verifUI: true },
  { nom: 'recolorier', source: 'scripts/recolor_core.py',  copie: 'modal_app/_recolor.py' },
  { nom: 'image TRELLIS-2', source: 'scripts/trellis2_native_full_pipeline.py', copie: 'modal_app/_mesh.py' },
  { nom: 're-texture (finitions)', source: 'scripts/trellis2_texturing_bridge.py', copie: 'modal_app/_retexture.py' },
  { nom: 'redimensionner / orienter', source: 'scripts/scale_mesh.py', copie: 'modal_app/_mesh_op.py' },
  { nom: 'symetrie de maillage', source: 'scripts/symmetrize_mesh.py', copie: 'modal_app/_symetrie.py' },
  // Texte d'execution de la traduction de l'interface (2026-10-14, revue du lot interface multilingue) : les
  // dictionnaires different entre bureau et web, le code qui les applique doit rester le MEME (detection de la
  // langue, recherche des cles, isolation en arabe, menu accessible). Marqueurs en commentaire JS « // # --- … ».
  { nom: 'i18n (texte d execution)', source: 'src/renderer/i18n.js', copie: 'cloud/public/app/i18n.js' },
];

function noyau(chemin) {
  const txt = lf(readFileSync(join(RACINE, chemin), 'utf-8'));
  const i = txt.indexOf(DEBUT);
  const j = txt.indexOf(FIN);
  if (i < 0 || j < 0) {
    console.error(`\n  ${chemin} : marqueurs NOYAU PARTAGE introuvables.`);
    console.error(`  Le bloc doit etre encadre par :\n    ${DEBUT} ...\n    ${FIN}\n`);
    process.exit(1);
  }
  return { txt, i, j: j + FIN.length, bloc: txt.slice(i, j + FIN.length) };
}

/** Les cases a cocher de la modale Habits envoient des cles au serveur, qui
 *  refuse d'un 400 toute cle inconnue. Une case ajoutee sans sa ligne dans
 *  PIECES_TENUE casserait l'outil au clic, et seulement au clic. */
function verifierPiecesUI(bloc) {
  const table = bloc.slice(bloc.indexOf('PIECES_TENUE = {'));
  const cles = [...table.slice(0, table.indexOf('}')).matchAll(/'([a-z]+)':/g)].map(m => m[1]);
  const soucis = [];
  for (const page of ['src/renderer/index2.html', 'cloud/public/app/index.html']) {
    const html = lf(readFileSync(join(RACINE, page), 'utf-8'));
    const vues = [...html.matchAll(/class="of-piece" value="([^"]+)"/g)].map(m => m[1]);
    if (!vues.length) { soucis.push(`${page} : aucune case .of-piece`); continue; }
    const inconnues = vues.filter(v => !cles.includes(v));
    const oubliees = cles.filter(k => !vues.includes(k));
    if (inconnues.length) soucis.push(`${page} : case(s) inconnues du noyau — ${inconnues.join(', ')}`);
    if (oubliees.length) soucis.push(`${page} : piece(s) du noyau sans case — ${oubliees.join(', ')}`);
  }
  return { cles, soucis };
}

const sync = process.argv.includes('--sync');
let echecs = 0;

for (const p of PAIRES) {
  const a = noyau(p.source);
  const b = noyau(p.copie);

  if (a.bloc !== b.bloc) {
    if (sync) {
      writeFileSync(join(RACINE, p.copie), b.txt.slice(0, b.i) + a.bloc + b.txt.slice(b.j), 'utf-8');
      console.log(`[noyaux] ${p.nom} : ${p.copie} resynchronise depuis ${p.source}`);
      continue;
    }
    const la = a.bloc.split('\n');
    const lb = b.bloc.split('\n');
    let k = 0;
    while (k < la.length && k < lb.length && la[k] === lb[k]) k++;
    console.error(`\n========================================================================`);
    console.error(`  NOYAU « ${p.nom} » : les deux copies ont diverge.\n`);
    console.error(`  source : ${p.source}`);
    console.error(`  copie  : ${p.copie}`);
    console.error(`\n  premiere difference, ligne ${k + 1} du bloc :`);
    console.error(`    source : ${JSON.stringify(la[k] ?? '(fin du bloc)')}`);
    console.error(`    copie  : ${JSON.stringify(lb[k] ?? '(fin du bloc)')}`);
    console.error(`\n  L'algorithme tourne sur DEUX plateformes qui ne peuvent pas partager`);
    console.error(`  de fichier. Une divergence ici, c'est une amelioration qui n'atteint`);
    console.error(`  qu'une moitie des utilisateurs, en silence.`);
    console.error(`\n  Editer la source, puis :  node build/check-noyaux-partages.mjs --sync`);
    console.error(`========================================================================\n`);
    echecs++;
    continue;
  }

  let extra = '';
  if (p.verifUI) {
    const { cles, soucis } = verifierPiecesUI(a.bloc);
    if (soucis.length) {
      console.error(`\n  NOYAU « ${p.nom} » : la modale et le noyau ne parlent pas des memes pieces.\n`);
      for (const s of soucis) console.error('  ' + s);
      console.error(`\n  Le serveur refuse une piece inconnue par un 400 : le defaut ne se`);
      console.error(`  verrait qu'au clic de l'utilisateur.\n`);
      echecs++;
      continue;
    }
    extra = `, ${cles.length} pieces alignees avec les deux modales`;
  }
  console.log(`[noyaux] ${p.nom} : identique (${a.bloc.split('\n').length} lignes, ${a.bloc.length} octets)${extra}`);
}

/* ── COPIES DE FICHIERS ENTIERS ────────────────────────────────────────────
 *
 * Certains outils sont faits de scripts AUTONOMES qui s'appellent entre eux
 * par chemin de fichier (le nommage des zones : un routeur qui lance deux
 * voies en sous-processus). Les decouper en noyau + colle casserait ces
 * appels. On les copie donc tels quels, sous le MEME nom de fichier dans un
 * sous-dossier de modal_app, et on exige l'identite du fichier entier. */
const FICHIERS = [
  { nom: 'nommage (routeur)', source: 'scripts/name_parts.py',        copie: 'modal_app/part_namer/name_parts.py' },
  { nom: 'nommage (vision)',  source: 'scripts/part_namer_vision.py', copie: 'modal_app/part_namer/part_namer_vision.py' },
  { nom: 'nommage (squelette)', source: 'scripts/skin_zone_namer.py', copie: 'modal_app/part_namer/skin_zone_namer.py' },
  { nom: 'alignement du transfert SkinTokens', source: 'scripts/patch_skintokens_transfert.py', copie: 'modal_app/patch_skintokens_transfert.py' },
  { nom: 'squelette complet (module)', source: 'scripts/squelette_complet.py', copie: 'modal_app/squelette/squelette_complet.py' },
  { nom: 'squelette complet (pilote)', source: 'scripts/rig_complet.py', copie: 'modal_app/squelette/rig_complet.py' },
  // Reshape a region (auto inpaint 3D) : rendu, masque 3D, decoupe, recalage — portage web du 2026-09-28
  { nom: 'reshape (auto inpaint 3D)', source: 'scripts/mesh_inpaint.py', copie: 'modal_app/reshape/mesh_inpaint.py' },
  // Reshape a region : vue CHOISIE dans le visualiseur 3D (2026-10-19), validation des angles + conversion camera -> yaw / pitch : MEME fichier bureau et site
  { nom: 'reshape (vue choisie)', source: 'src/renderer/lib/reshape-vue.js', copie: 'cloud/public/app/lib/reshape-vue.js' },
  { nom: 'serpent etire (silhouette)', source: 'scripts/serpent_etire.py', copie: 'modal_app/serpent_etire.py' },
  { nom: 'acceleration du GLB (atlas, WebP)', source: 'scripts/acceleration_glb.py', copie: 'modal_app/acceleration_glb.py' },
  { nom: 'rotation autour du centre du modele', source: 'cloud/public/app/lib/centre-rotation.js', copie: 'src/renderer/lib/centre-rotation.js' },
  { nom: 'Etanche : coque interieure (watertight_seal)', source: 'scripts/watertight_seal.py', copie: 'modal_app/watertight_seal.py' },
  // carte de normales cuite du maillage fin vers le maillage final (2026-10-13) : generation bureau ET Modal, outils
  { nom: 'carte de normales (cuisson)', source: 'scripts/normal_bake.py', copie: 'modal_app/normal_bake.py' },
  // Face Fix image (2026-09-29) : visage humain ou TETE d'animal + retouche SDXL, bureau (serveur local) et web
  { nom: 'face fix image (visage / tete d animal)', source: 'scripts/face_fix_image.py', copie: 'modal_app/_face_fix_image.py' },
  { nom: 'align texture (reprojection)', source: 'scripts/texture_project.py', copie: 'modal_app/texproj/texture_project.py' },
  { nom: 'align texture (pre-transformation)', source: 'scripts/mesh_pre_transform.py', copie: 'modal_app/texproj/mesh_pre_transform.py' },
  // moteur de marche procedural (2026-09-28) : MEME fichier sur le bureau et le web
  { nom: 'moteur de marche procedural', source: 'src/renderer/lib/locomotion-procedurale.js', copie: 'cloud/public/app/lib/locomotion-procedurale.js' },
  { nom: 'recoloration de la texture 3D', source: 'scripts/recolor_atlas.py', copie: 'modal_app/recolor_atlas.py' },
  { nom: 'vocabulaire de detection du type de projet', source: 'src/renderer/lib/mots-projet.js', copie: 'cloud/public/app/lib/mots-projet.js' },
  { nom: 'editeur des poids de peau', source: 'src/renderer/lib/editeur-poids.js', copie: 'cloud/public/app/lib/editeur-poids.js' },
  { nom: 'decalques (Paint Mesh)', source: 'src/renderer/lib/editeur-decals.js', copie: 'cloud/public/app/lib/editeur-decals.js' },
  { nom: 'generateur de version legere', source: 'src/main/gen_light_glb.mjs', copie: 'scripts/meshopt/gen_light_glb.mjs' },
  { nom: 'symetrie de maillage (plan, zone peinte)', source: 'src/renderer/lib/symetrie-maillage.js', copie: 'cloud/public/app/lib/symetrie-maillage.js' },
  { nom: 'niveaux de detail (LOD)', source: 'src/renderer/lib/lod-maillage.js', copie: 'cloud/public/app/lib/lod-maillage.js' },
  { nom: 'worker LOD', source: 'src/renderer/lib/lod-worker.js', copie: 'cloud/public/app/lib/lod-worker.js' },
  { nom: 'meshoptimizer simplifier', source: 'src/renderer/lib/meshopt-simplifier.js', copie: 'cloud/public/app/lib/meshopt-simplifier.js' },
  { nom: 'barre commune des visualiseurs 3D (vues, zoom)', source: 'src/renderer/lib/barre-vues-3d.js', copie: 'cloud/public/app/lib/barre-vues-3d.js' },
  { nom: 'apercu des allures', source: 'src/renderer/lib/apercu-animation.js', copie: 'cloud/public/app/lib/apercu-animation.js' },
  // filtrage anisotrope + mipmaps des textures des visualiseurs (2026-10-15) : MEME fichier sur le bureau et le web
  { nom: 'filtrage des textures (anisotropie)', source: 'src/renderer/lib/filtrage-textures.js', copie: 'cloud/public/app/lib/filtrage-textures.js' },
  // redacteur de la fenetre New project (2026-09-30) : meme script sur le bureau (local) et sur Modal (site)
  { nom: 'redacteur (New project)', source: 'scripts/redacteur.py', copie: 'modal_app/redacteur/redacteur.py' },
  // fusion des masques de detourage (2026-10-03) : UNION u2net + Lucida, Python pur + numpy ; le bureau (_prep_image) et Modal (_detourage) l'appellent
  { nom: 'fusion des masques de detourage (union)', source: 'scripts/fusion_masques.py', copie: 'modal_app/fusion_masques.py' },
  // substituts pur torch de timm / kornia pour le code distant de Lucida (2026-10-14) : bureau (lucida_matte) et Modal (conteneur image sans kornia)
  { nom: 'substituts timm / kornia (Lucida)', source: 'scripts/lucida_shims.py', copie: 'modal_app/lucida_shims.py' },
  // composeur d'intention (2026-10-03) : objets tenus, negatifs d'armes, gabarit adapte a ce que l'utilisateur DEMANDE ; Python = bureau (pont) et Modal, JS = les deux pages
  { nom: 'composeur d intention (Python)', source: 'scripts/composeur_intention.py', copie: 'modal_app/composeur_intention.py' },
  { nom: 'composeur d intention (JS)', source: 'src/renderer/lib/composeur-intention.js', copie: 'cloud/public/app/lib/composeur-intention.js' },
  // Bouchage de trous NON DESTRUCTIF (2026-10-21) : UN noyau (soudure par position, pourtours, rustines, diagnostic d'un maillage ferme) pour le
  // bureau (mesh_tools.py), Modal (_mesh_op.py::fill_holes) et les apercus des deux interfaces ; Python = serveur et bureau, JS = les deux pages
  { nom: 'bouchage de trous (Python)', source: 'scripts/bouchage_trous.py', copie: 'modal_app/bouchage_trous.py' },
  { nom: 'bouchage de trous (JS)', source: 'src/renderer/lib/bouchage-trous.js', copie: 'cloud/public/app/lib/bouchage-trous.js' },
  // Bouchon LISSE (2026-10-26) : rustine qui suit la courbure + couleurs du voisinage ; bureau (mesh_tools.py) et Modal (_mesh_op.py::fill_holes)
  { nom: 'bouchon lisse de trous (Python)', source: 'scripts/bouchage_lisse.py', copie: 'modal_app/bouchage_lisse.py' },
  // Lot interface multilingue (2026-10-13) : refus du serveur traduits a l'affichage, et traductions communes
  // bureau / web (une derive entre les deux dictionnaires laissait des libelles traduits d'un seul cote).
  { nom: 'textes du serveur (traduction des refus)', source: 'src/renderer/lib/textes-serveur.js', copie: 'cloud/public/app/lib/textes-serveur.js' },
  { nom: 'traductions communes (lang/_additions6.js)', source: 'src/renderer/lang/_additions6.js', copie: 'cloud/public/app/lang/_additions6.js' },
  // Modify image : retrait et remplacement (2026-10-20) : module pur + ses traductions, memes octets sur les deux pages
  { nom: 'retrait dans Modify (JS)', source: 'src/renderer/lib/retrait-image.js', copie: 'cloud/public/app/lib/retrait-image.js' },
  { nom: 'traductions de Modify (retrait)', source: 'src/renderer/lang/_additions_retrait.js', copie: 'cloud/public/app/lang/_additions_retrait.js' },
  // langue du texte de l'utilisateur (2026-10-13, audit de la langue) : bureau, site ET worker (cloud/src/worker.ts importe la copie du site)
  { nom: 'langue du texte', source: 'src/renderer/lib/langue-texte.js', copie: 'cloud/public/app/lib/langue-texte.js' },
  // encodeur SDXL des prompts longs (2026-10-13) : memes bornes de poids et memes jetons speciaux casses sur le bureau et sur Modal
  { nom: 'encodeur SDXL des prompts (poids, jetons speciaux)', source: 'scripts/_sdxl_prompt_utils.py', copie: 'modal_app/_sdxl_prompt_utils.py' },
];
for (const p of FICHIERS) {
  const a = lf(readFileSync(join(RACINE, p.source), 'utf-8'));
  let b = null;
  try { b = lf(readFileSync(join(RACINE, p.copie), 'utf-8')); } catch (_) { /* copie absente */ }
  if (a === b) {
    console.log(`[noyaux] ${p.nom} : fichier identique (${a.split('\n').length} lignes)`);
    continue;
  }
  if (sync) {
    writeFileSync(join(RACINE, p.copie), a, 'utf-8');
    console.log(`[noyaux] ${p.nom} : copie resynchronisee depuis ${p.source}`);
    continue;
  }
  console.error(`\n========================================================================`);
  console.error(`  FICHIER PARTAGE « ${p.nom} » : ${b === null ? 'copie ABSENTE' : 'les deux copies ont diverge'}.\n`);
  console.error(`  source : ${p.source}`);
  console.error(`  copie  : ${p.copie}`);
  console.error(`\n  Editer la source, puis :  node build/check-noyaux-partages.mjs --sync`);
  console.error(`========================================================================\n`);
  echecs++;
}

process.exit(echecs ? 1 : 0);
