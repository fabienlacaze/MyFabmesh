// Noms de projet NON LATINS ou accentues dans le processus principal du bureau (2026-10-13, audit de la langue du 11/10) :
//   CHAMPS-13      dossier d'images = nom avec [^a-zA-Z0-9_-] -> « _ » : « 兽人战士 » et « 精灵射手 » partageaient « ____ », accents detruits ;
//   CHAMPS-24      mode Cloud : le nom envoye au site etait ce nom de DOSSIER assaini, pas le nom saisi ;
//   MANQUE-SERV-03 marqueurs de projets vides : « 兽人战士 » et « 精灵射手 » s'ecrasaient dans « ____.json ».
// Les VRAIS gestionnaires de src/main/main.js (generate-images, projet-vide:*, delete-project, rename-project-files, import-dropped-file,
// get-project-display-names) sont extraits (acorn) et executes contre un dossier temporaire ; le cloud est une doublure (aucun reseau,
// aucun GPU, aucun Python). Harnais commun : tests/main/_harnais-noms-projet.mjs (toutes les aides de main.js dans une meme portee).
// Chaine complete page -> main -> site (images, partage, clip, « Cloud library ») : tests/main/noms-projet-chaine.test.mjs.
//   node --test tests/main/noms-projet-bureau.test.mjs
// Rejouer contre l'ANCIEN code (les tests de correctif doivent alors ECHOUER) :
//   MAIN_JS=<ancien main.js> SLUG_PROJET=<chemin absent> node --test tests/main/noms-projet-bureau.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bureau, S } from './_harnais-noms-projet.mjs';

const PAIRES = [['chinois', '兽人战士', '精灵射手'], ['arabe', 'تنين', 'فارس'], ['russe', 'орк', 'дом'], ['accents', 'Éléphant', 'Àlèphant']];

/* ═══════════════ regle de slug (src/main/slug_projet.js) ═══════════════ */
test('slug_projet : deux noms non latins ou accentues de meme forme ont des dossiers DIFFERENTS ; un nom ASCII garde son dossier', () => {
  assert.ok(S, 'src/main/slug_projet.js introuvable');
  for (const [langue, a, b] of PAIRES) {
    assert.notEqual(S.slugProjet(a), S.slugProjet(b), langue);
    for (const s of [S.slugProjet(a), S.slugProjet(b)]) {
      assert.match(s, /^[A-Za-z0-9_-]+$/, 'dossier sur : ' + s);
      assert.equal(s.replace(/[^a-zA-Z0-9_-]/g, '_'), s, 'point fixe de l ancienne regle (un dossier rendu comme nom reste ce dossier)');
      assert.equal(s.replace(/_\d+$/, ''), s, 'le regroupement des dossiers (_<chiffres> retire) ne le coupe pas');
    }
  }
  for (const nom of ['Orc', 'Mobilier design', 'orc_woman', 'v1.2', "L'orc"]) assert.equal(S.slugProjet(nom), nom.replace(/[^a-zA-Z0-9_-]/g, '_'), nom);
  assert.equal(S.slugProjet('Épée magique'), 'Epee_magique-h' + S.empreinteNom('Épée magique'));
});

/* ═══════════════ generate-images (mode Cloud) ═══════════════ */
for (const [langue, a, b] of PAIRES) {
  test(`generate-images, ${langue} : « ${a} » et « ${b} » ont chacun leur dossier, le site recoit le nom SAISI`, async () => {
    const b_ = bureau();
    try {
      await b_.generer(a);
      await b_.generer(b);
      const ds = b_.dossiers();
      assert.equal(ds.length, 2, `un seul dossier pour deux projets : ${ds.join(', ')}`);
      assert.deepEqual(b_.site.images, [a, b], 'nom envoye au site (user_assets)');
      for (const d of ds) assert.match(d, /^[A-Za-z0-9_-]+$/);
      // le nom saisi est memorise pour la grille : dossier -> nom
      const dn = b_.nomsAffiches();
      assert.deepEqual(Object.values(dn).sort(), [a, b].sort());
      // 2e generation, lancee depuis le projet rouvert sous son NOM DE DOSSIER : meme dossier, meme nom pour le site
      const dossierA = Object.keys(dn).find((k) => dn[k] === a);
      await b_.generer(dossierA);
      assert.equal(b_.dossiers().length, 2, 'la 2e generation cree un autre dossier');
      assert.equal(b_.site.images[2], a, '2e generation : le site recoit encore le nom saisi');
    } finally { b_.fin(); }
  });
}

test('generate-images, non-regression ASCII : « Mobilier design » et « Orc » gardent leur dossier et leur nom de site d avant', async () => {
  const b_ = bureau();
  try {
    await b_.generer('Mobilier design');
    await b_.generer('Orc');
    await b_.generer('Mobilier_design');
    assert.deepEqual(b_.dossiers(), ['Mobilier_design', 'Orc']);
    assert.deepEqual(b_.site.images, ['Mobilier_design', 'Orc', 'Mobilier_design']);
    assert.deepEqual(b_.nomsAffiches(), {}, 'aucun nom d affichage memorise pour un nom ASCII');
  } finally { b_.fin(); }
});

test('generate-images : un ancien dossier « ____ » (avant le correctif) continue de recevoir ses images sous le meme nom de site', async () => {
  const b_ = bureau();
  try {
    fs.mkdirSync(path.join(b_.IMAGES_DIR, '____'));
    await b_.generer('____');   // projet rouvert sous son nom de dossier
    assert.deepEqual(b_.dossiers(), ['____']);
    assert.equal(b_.site.images[0], '____');
  } finally { b_.fin(); }
});

/* ═══════════════ projets vides : marqueurs ═══════════════ */
test('projets vides : « 兽人战士 » puis « 精灵射手 » -> deux marqueurs (le second n ecrase plus le premier) ; ASCII inchange', async () => {
  const b_ = bureau();
  try {
    for (const name of ['兽人战士', '精灵射手', 'تنين', 'فارس', 'Mobilier design']) await b_.appeler('projet-vide:creer', { name, assetType: 'character' });
    const liste = (await b_.appeler('projet-vide:lister')).map((x) => x.name).sort();
    assert.deepEqual(liste, ['兽人战士', '精灵射手', 'تنين', 'فارس', 'Mobilier design'].sort());
    assert.ok(b_.marqueurs().includes('Mobilier design.json'), 'nom de fichier ASCII d avant : ' + b_.marqueurs().join(', '));
  } finally { b_.fin(); }
});

test('delete-project : supprime le marqueur et le nom memorise du projet non latin, pas ceux de l autre projet', async () => {
  const b_ = bureau();
  try {
    await b_.appeler('projet-vide:creer', { name: '兽人战士' });
    await b_.appeler('projet-vide:creer', { name: '精灵射手' });
    await b_.generer('兽人战士');
    await b_.generer('精灵射手');
    const dn = b_.nomsAffiches();
    const dossierA = Object.keys(dn).find((k) => dn[k] === '兽人战士');
    assert.ok(dossierA, 'nom saisi non memorise');
    const r = await b_.appeler('delete-project', { projectName: dossierA });
    assert.equal(r.ok, true);
    assert.deepEqual((await b_.appeler('projet-vide:lister')).map((x) => x.name), ['精灵射手'], 'marqueur restant');
    assert.deepEqual(Object.values(b_.nomsAffiches()), ['精灵射手']);
    assert.equal(b_.dossiers().length, 1);
  } finally { b_.fin(); }
});

test('delete-project : un ANCIEN marqueur « ____.json » n est retire que s il porte le nom du projet supprime', async () => {
  const b_ = bureau();
  try {
    fs.mkdirSync(b_.PROJETS_VIDES_DIR, { recursive: true });
    fs.writeFileSync(path.join(b_.PROJETS_VIDES_DIR, '____.json'), JSON.stringify({ name: '精灵射手', created: 1 }));
    await b_.appeler('delete-project', { projectName: '兽人战士' });
    assert.deepEqual(b_.marqueurs(), ['____.json'], 'le marqueur d un AUTRE projet a ete supprime');
    await b_.appeler('delete-project', { projectName: '精灵射手' });
    assert.deepEqual(b_.marqueurs(), [], 'ancien marqueur du projet supprime encore present');
  } finally { b_.fin(); }
});

/* ═══════════════ nom saisi retrouve dans les marqueurs (revue du lot 3) ═══════════════ */
test('get-project-display-names : un dossier « project-h… » sans nom memorise (config.json reinitialise) reprend le nom saisi de son marqueur', async () => {
  const b_ = bureau();
  try {
    await b_.appeler('projet-vide:creer', { name: '兽人战士' });
    await b_.appeler('projet-vide:creer', { name: 'Mobilier design' });
    await b_.generer('兽人战士');
    const dossier = S.slugProjet('兽人战士');
    assert.deepEqual(b_.nomsAffiches(), { [dossier]: '兽人战士' });
    b_.setConfig({ blenderPath: '', projectDisplayNames: { orc: 'Mon orc' } });   // config perdue, puis un renommage d'affichage
    assert.deepEqual(await b_.appeler('get-project-display-names'), { [dossier]: '兽人战士', orc: 'Mon orc' },
      'nom saisi retrouve, nom ASCII ignore, renommage garde');
    // un nom memorise l'emporte toujours sur le marqueur (renommage d'affichage du projet non latin)
    b_.setConfig({ blenderPath: '', projectDisplayNames: { [dossier]: 'Orc boss' } });
    assert.deepEqual(await b_.appeler('get-project-display-names'), { [dossier]: 'Orc boss' });
    // generation suivante (projet rouvert sous son dossier) : le site recoit encore le nom saisi
    await b_.generer(dossier);
    assert.deepEqual(b_.site.images, ['兽人战士', '兽人战士']);
  } finally { b_.fin(); }
});

test('get-project-display-names : un ANCIEN marqueur « ____.json » ne donne aucun nom a un dossier (seul le dossier de SON nom compte)', async () => {
  const b_ = bureau();
  try {
    fs.mkdirSync(b_.PROJETS_VIDES_DIR, { recursive: true });
    fs.writeFileSync(path.join(b_.PROJETS_VIDES_DIR, '____.json'), JSON.stringify({ name: '兽人战士', created: 1 }));
    fs.writeFileSync(path.join(b_.PROJETS_VIDES_DIR, S.slugProjet('精灵射手') + '.json'), JSON.stringify({ name: '兽人战士', created: 1 }));
    assert.deepEqual(await b_.appeler('get-project-display-names'), {}, 'nom qui ne donne pas ce dossier : ignore');
  } finally { b_.fin(); }
});

/* ═══════════════ renommage et glisser-deposer ═══════════════ */
test('rename-project-files : renommer en « 精灵射手 » fonctionne (plus « invalid name ») et memorise le nom saisi', async () => {
  const b_ = bureau();
  try {
    await b_.generer('Orc');
    const r = await b_.appeler('rename-project-files', { oldName: 'Orc', newName: '精灵射手' });
    assert.equal(r.success, true, r.error);
    assert.match(r.newName, /^project-h[0-9a-f]{8}$/);
    assert.equal(b_.dossiers().length, 1);
    assert.ok(b_.dossiers()[0].startsWith(r.newName + '_'), 'dossier renomme : ' + b_.dossiers()[0]);
    assert.equal(b_.nomsAffiches()[r.newName], '精灵射手');
    const r2 = await b_.appeler('rename-project-files', { oldName: 'x', newName: 'Mobilier design' });
    assert.equal(r2.newName, 'Mobilier_design', 'nom ASCII : regle d avant');
  } finally { b_.fin(); }
});

test('import-dropped-file : une image deposee dans un NOUVEAU projet « 兽人战士 » ne devient plus « imported »', async () => {
  const b_ = bureau();
  try {
    const src = path.join(b_.IMAGES_DIR, '..', 'photo.png');
    fs.writeFileSync(src, 'png');
    const r1 = await b_.appeler('import-dropped-file', { filePath: src, projectName: '兽人战士' });
    const r2 = await b_.appeler('import-dropped-file', { filePath: src, projectName: '精灵射手' });
    assert.equal(r1.success && r2.success, true);
    assert.notEqual(r1.projectName, 'imported');
    assert.notEqual(r1.projectName, r2.projectName, 'deux projets de meme forme, meme dossier');
    assert.equal(b_.nomsAffiches()[r1.projectName], '兽人战士');
    const r3 = await b_.appeler('import-dropped-file', { filePath: src, projectName: 'Mobilier design' });
    assert.equal(r3.projectName, 'Mobilier_design', 'nom ASCII : regle d avant');
  } finally { b_.fin(); }
});

test('import-dropped-file : un modele 3D depose dans le projet OUVERT « 兽人战士 » (encore vide) prend le prefixe du dossier de CE projet', async () => {
  const b_ = bureau();
  try {
    const glb = path.join(b_.IMAGES_DIR, '..', 'statue.glb');
    fs.writeFileSync(glb, 'glTF');
    const r1 = await b_.appeler('import-dropped-file', { filePath: glb, projectName: '兽人战士' });
    const r2 = await b_.appeler('import-dropped-file', { filePath: glb, projectName: '精灵射手' });
    assert.equal(r1.success && r2.success, true, JSON.stringify([r1, r2]));
    const prefixe = (r) => path.basename(r.path).replace(/_\d+\.glb$/, '');
    assert.equal(prefixe(r1), S.slugProjet('兽人战士'), 'le maillage doit etre rattache au dossier que generate-images donnera a ce projet');
    assert.equal(prefixe(r2), S.slugProjet('精灵射手'));
    assert.equal(b_.nomsAffiches()[prefixe(r1)], '兽人战士', 'nom saisi memorise pour ce prefixe');
    // nom ASCII : regle d'avant (40 caracteres, rien d'autre)
    const r3 = await b_.appeler('import-dropped-file', { filePath: glb, projectName: 'Mobilier design' });
    assert.equal(prefixe(r3), 'Mobilier_design');
  } finally { b_.fin(); }
});
