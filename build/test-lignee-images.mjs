// Banc d'essai de src/main/lignee_images.js : deduction du parent / de l'operation depuis le nom, parametres propres, sorties d'un resultat IPC.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../src/main/lignee_images.js');
let echecs = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  ECHEC ') + m); if (!c) echecs++; };
const D = 'C:\\Users\\x\\images\\knight\\';
const deps = { existe: () => true, mtime: () => 2_000_000 };

// --- deduction depuis le nom
let d = L.deduireDuNom(D + 'ref_0_brightness_1790855805952.png');
ok(d && d.op === 'brightness' && d.parent.endsWith('ref_0.png') && d.ts === 1790855805952, 'ref_0_brightness_<ts> -> parent ref_0.png, op brightness');
d = L.deduireDuNom(D + 'ref_0_refined_1790856069539_217144404.png');
ok(d && d.op === 'modify' && d.parent.endsWith('ref_0.png'), 'refined_<ts>_<alea> -> op modify, parent ref_0.png');
d = L.deduireDuNom(D + 'ref_0_texvar_1790856436011_0.png');
ok(d && d.op === 'texvar' && d.parent.endsWith('ref_0.png'), 'texvar_<ts>_0 -> op texvar');
d = L.deduireDuNom(D + 'ref_0_inpaint_1790856156923.png');
ok(d && d.op === 'inpaint', 'inpaint');
d = L.deduireDuNom(D + 'ref_0_brightness_1790855805952_refined_1790855865074_142134766.png');
ok(d && d.op === 'modify' && d.parent.endsWith('ref_0_brightness_1790855805952.png'), 'chaine : on ne retire QUE la derniere operation');
ok(L.deduireDuNom(D + 'ref_0.png') === null && L.deduireDuNom(D + 'ref_1790857000000_0.png') === null, 'images racines (ref_0, ref_<ts>_<i>) : pas de parent');
ok(L.deduireDuNom(D + 'ref_0_inconnu_1790855805952.png') === null, 'suffixe inconnu : pas de deduction hasardeuse');

// --- parametres propres
const a0 = { imagePath: D + 'ref_0.png', prompt: 'a knight', strength: 0.55, maskDataUrl: 'data:image/png;base64,AAAA', dataUrl: 'data:image/png;base64,BBB', lignee: { op: 'style' }, tab: [1, 2, 3], gros: 'x'.repeat(5000), nested: { a: 1, b: { c: 2, d: { e: 3 } } }, projectName: 'p' };
const pp = L.parametresPropres(a0);
ok(pp.prompt === 'a knight' && pp.strength === 0.55, 'parametres exacts conserves (prompt, force)');
ok(!('imagePath' in pp) && !('maskDataUrl' in pp) && !('dataUrl' in pp) && !('lignee' in pp) && !('projectName' in pp), 'chemins, data-URL, masques et indice retires');
ok(pp.gros.length <= 1201 && pp.gros.endsWith('…'), 'texte trop long tronque');
ok(Array.isArray(pp.tab) && pp.nested && pp.nested.a === 1 && !(pp.nested.b && pp.nested.b.d), 'petits objets conserves, profondeur bornee');
ok(JSON.stringify(L.parametresPropres('chaine')) === '{}' && JSON.stringify(L.parametresPropres(null)) === '{}', 'argument non objet -> {}');

// --- sorties d'un resultat
const res = { success: true, images: [D + 'ref_1.png', D + 'ref_2.png'], thumb: D + 'ref_9_thumb.png', pieces: [{ nom: 'a', chemin: D + 'ref_0_outfit_top.png' }], texte: 'x.txt' };
const so = L.sortiesDe(res);
ok(so.includes(D + 'ref_1.png') && so.includes(D + 'ref_0_outfit_top.png') && !so.some((x) => /thumb/.test(x)) && !so.includes('x.txt'), 'sorties : images et pieces, sans miniature ni texte');

// --- lignees : un appel complet
let r = L.lignees('generate-images', [{ prompt: 'a knight', engine: 'local-flux', steps: 28, numImages: 1 }], { success: true, images: [D + 'ref_0.png'] }, 56800, 1_000_000, deps);
ok(r.length === 1 && r[0].meta.kind === 'image' && r[0].meta.op === 'generate' && !r[0].meta.parent && r[0].meta.engine === 'local-flux' && r[0].meta.params.steps === 28 && r[0].meta.durationMs === 56800, 'generation : racine (pas de parent), moteur, pas, duree');
r = L.lignees('img2img', [{ imagePath: D + 'ref_0.png', prompt: 'sword', strength: 0.55 }], { success: true, newImagePath: D + 'ref_0_refined_1790856069539_217144404.png' }, 28500, 1_000_000, deps);
ok(r.length === 1 && r[0].meta.parent === D + 'ref_0.png' && r[0].meta.op === 'modify' && r[0].meta.params.strength === 0.55, 'img2img : parent = image de depart, op deduite du nom (modify), force enregistree');
r = L.lignees('img2img', [{ imagePath: D + 'ref_0.png', prompt: 'x', lignee: { op: 'style', params: { style: 'anime' } } }], { success: true, newImagePath: D + 'ref_0_refined_1790856334687_6.png' }, 1, 1_000_000, deps);
ok(r[0].meta.op === 'style' && r[0].meta.params.style === 'anime', 'indice du rendu : operation et parametres ajoutes');
r = L.lignees('remove-background', [D + 'ref_0.png'], { success: true, outputPath: D + 'ref_0_nobg_1790856191069.png' }, 15600, 1_000_000, deps);
ok(r.length === 1 && r[0].meta.op === 'nobg' && r[0].meta.parent === D + 'ref_0.png', 'remove-background : argument texte = parent');
r = L.lignees('save-image-data-url', [{ basePath: D + 'ref_0.png', dataUrl: 'data:image/png;base64,AAA', suffix: 'blur' }], { success: true, path: D + 'ref_0_blur_1790857013898.png' }, 5, 1_000_000, deps);
ok(r.length === 1 && r[0].meta.op === 'blur' && !JSON.stringify(r[0].meta).includes('base64'), 'canevas : op deduite du suffixe, aucune image dans le sidecar');
ok(L.lignees('img2img', [{ imagePath: D + 'ref_0.png' }], { success: false, error: 'x' }, 1, 1_000_000, deps).length === 0, 'echec : aucun sidecar');
ok(L.lignees('canal-inconnu', [{}], { success: true, path: D + 'a.png' }, 1, 1_000_000, deps).length === 0, 'canal hors table : rien');
ok(L.lignees('img2img', [{ imagePath: D + 'ref_0.png' }], { success: true, newImagePath: D + 'ref_0.png' }, 1, 1_000_000, deps).length === 0, 'la sortie ne peut pas etre son propre parent');
ok(L.lignees('img2img', [{ imagePath: D + 'ref_0.png' }], { success: true, newImagePath: D + 'ref_0_refined_1790856069539_1.png' }, 1, 1_000_000, { existe: () => true, mtime: () => 100 }).length === 0, 'fichier plus ancien que l appel : ignore (pas de sidecar sur une image deja la)');
console.log(echecs ? '\n' + echecs + ' ECHEC(S)' : '\nTOUT PASSE');
process.exit(echecs ? 1 : 0);
