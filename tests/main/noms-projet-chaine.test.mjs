// Noms de projet NON LATINS ou accentues, de bout en bout au BUREAU (revue du lot 3 du 13/10, audit de la langue du 11/10).
// Bloquants de la revue :
//   1. Le clip d'animation (anim:motion -> /api/animate) partait sous le nom de DOSSIER « project-h… » alors que les images partaient
//      sous le nom saisi « 兽人战士 » : sur le site, un projet cree au bureau formait DEUX cartes.
//   2. « Cloud library » -> Import dans le projet ouvert rangeait encore par l'ancienne forme assainie : deux projets neufs « 兽人战士 »
//      et « 精灵射手 » recevaient leurs images dans le MEME dossier « ____ ».
// Mineurs traites avec eux : la page et le processus principal avaient deux regles « nom pour le site » differentes (renommage
// d'affichage : partage sous « Орк », generation sous « orc ») ; config.json reinitialise : le projet repartait sur le site sous
// « project-h… ».
// VRAIES fonctions (voir _harnais-noms-projet.mjs) : page du bureau -> gestionnaires de main.js / cloud_fallback.js / animation.js ->
// ce que le site recoit -> vraie grille du site.
//   node --test tests/main/noms-projet-chaine.test.mjs
// Ancien code (les tests de correctif doivent ECHOUER) : MAIN_JS, CLOUD_FALLBACK_JS, ANIMATION_JS, BUREAU_INDEX2, WEB_INDEX2 = copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bureau, cartesDuSite, S } from './_harnais-noms-projet.mjs';

const JOUR = 86400000;
const base = (r) => path.basename(String(r && r.path || ''));

/* ═══════════════ 1. un seul nom pour le site : images, partage, clip ═══════════════ */
for (const nom of ['兽人战士', 'Château fort', 'орк']) {
  test(`projet NEUF « ${nom} » (mode Cloud) : images, partage et clip d animation partent sous le MEME nom ; le site montre UNE carte`, async () => {
    const b = bureau();
    try {
      await b.creerProjet(nom);
      await b.generer();                   // 1re generation, lancee depuis le projet vide
      await b.page.reloadCurrentProject(); // le projet ouvert devient le dossier « …-h<empreinte> »
      await b.generer();
      await b.partager();
      await b.animer();
      assert.deepEqual(b.site, { images: [nom, nom], partages: [nom], animations: [nom] },
        `noms recus par le site : ${JSON.stringify(b.site)}`);
      const cartes = await cartesDuSite(b.site);
      assert.deepEqual(cartes, [`${nom} (images 3, clips 1)`], 'cartes du site : ' + cartes.join(' | '));
    } finally { b.fin(); }
  });
}

test('non-regression : projet ASCII « Mobilier design » et ANCIEN dossier « ____ » envoient au site le nom d avant, le meme pour les trois envois', async () => {
  const b = bureau();
  try {
    await b.creerProjet('Mobilier design');
    await b.generer();
    await b.page.reloadCurrentProject();
    await b.partager();
    await b.animer();
    assert.deepEqual(b.site, { images: ['Mobilier_design'], partages: ['Mobilier_design'], animations: ['Mobilier_design'] });
  } finally { b.fin(); }
  const c = bureau();
  try {
    // dossier d'avant le lot, relie a son projet vide (cree AVANT son contenu : la grille du lot l'affiche « 兽人战士 »)
    fs.mkdirSync(c.PROJETS_VIDES_DIR, { recursive: true });
    fs.writeFileSync(path.join(c.PROJETS_VIDES_DIR, '____.json'), JSON.stringify({ name: '兽人战士', created: Date.now() - 5 * JOUR }));
    c.ecrireImage('____');
    await c.page.refreshProjectsPage();
    c.state.currentProject = c.state.projects.find((p) => p.name === '____');
    await c.generer();
    await c.partager();
    await c.animer();
    assert.deepEqual(c.site, { images: ['____'], partages: ['____'], animations: ['____'] }, 'le site connait deja ce projet sous « ____ »');
    assert.deepEqual(c.dossiers(), ['____']);
  } finally { c.fin(); }
  const d = bureau();
  try {
    // ancien projet ACCENTUE : marqueur d'avant le lot (« Ch_teau fort.json ») et dossier « Ch_teau_fort »
    fs.mkdirSync(d.PROJETS_VIDES_DIR, { recursive: true });
    fs.writeFileSync(path.join(d.PROJETS_VIDES_DIR, 'Ch_teau fort.json'), JSON.stringify({ name: 'Château fort', assetType: 'building', created: Date.now() - 10 * JOUR }));
    d.ecrireImage('Ch_teau_fort');
    await d.page.refreshProjectsPage();
    assert.equal(d.state.projects.length, 1, 'grille : ' + d.cartes().join(' | '));
    d.state.currentProject = d.state.projects[0];
    await d.generer();
    await d.telecharger('du_site.png');
    await d.partager();
    await d.animer();
    assert.deepEqual(d.dossiers(), ['Ch_teau_fort'], 'nouveau dossier cree pour un ancien projet');
    assert.deepEqual(d.site, { images: ['Ch_teau_fort'], partages: ['Ch_teau_fort'], animations: ['Ch_teau_fort'] });
  } finally { d.fin(); }
});

test('suppression d un projet NEUF « 兽人战士 » (images telechargees et generees) : aucune carte fantome, aucun nom memorise restant', async () => {
  const b = bureau();
  try {
    await b.creerProjet('兽人战士');
    await b.telecharger('du_site.png');
    await b.page.reloadCurrentProject();
    await b.generer();
    await b.page.reloadCurrentProject();
    const r = await b.appeler('delete-project', { projectName: b.state.currentProject.name });
    assert.equal(r.ok, true, JSON.stringify(r));
    await b.page.refreshProjectsPage();
    assert.deepEqual(b.cartes(), [], 'grille apres suppression');
    assert.deepEqual(b.nomsAffiches(), {});
    assert.deepEqual(await b.appeler('get-project-display-names'), {}, 'nom saisi encore fourni par un marqueur restant');
  } finally { b.fin(); }
});

test('renommage d AFFICHAGE seul (« orc » affiche « Орк ») : generation, partage et clip envoient le MEME nom au site (« orc », comme avant)', async () => {
  const b = bureau({ config: { blenderPath: '', projectDisplayNames: { orc: 'Орк' } } });
  try {
    b.ecrireImage('orc');
    await b.page.refreshProjectsPage();
    b.state.currentProject = b.state.projects.find((p) => p.name === 'orc');
    await b.generer();
    await b.partager();
    await b.animer();
    assert.deepEqual(b.site, { images: ['orc'], partages: ['orc'], animations: ['orc'] }, `noms recus par le site : ${JSON.stringify(b.site)}`);
  } finally { b.fin(); }
});

/* ═══════════════ 2. « Cloud library » -> projet ouvert ═══════════════ */
test('« Cloud library » : deux projets NEUFS « 兽人战士 » et « 精灵射手 » recoivent chacun une image -> deux dossiers, chaque image dans SA carte', async () => {
  const b = bureau();
  try {
    await b.creerProjet('兽人战士');
    const r1 = await b.telecharger('image_du_premier.png');
    await b.page.reloadCurrentProject();
    assert.deepEqual(b.state.currentProject.images.map(base), ['image_du_premier.png'], 'le projet ouvert montre l image telechargee');
    await b.creerProjet('精灵射手');
    const r2 = await b.telecharger('image_du_second.png');
    await b.page.reloadCurrentProject();
    assert.equal(r1.success && r2.success, true, JSON.stringify([r1, r2]));
    assert.notEqual(path.dirname(r1.path), path.dirname(r2.path), 'meme dossier pour deux projets : ' + b.dossiers().join(', '));
    assert.deepEqual(b.nomsAffiches(), { [S.slugProjet('兽人战士')]: '兽人战士', [S.slugProjet('精灵射手')]: '精灵射手' },
      'nom saisi memorise pour le dossier cree par le telechargement (comme pour une generation)');
    assert.equal(b.state.currentProject.displayName || b.state.currentProject.name, '精灵射手');
    assert.deepEqual(b.state.currentProject.images.map(base), ['image_du_second.png'], 'le projet ouvert montre l image de l autre projet');
    await b.page.refreshProjectsPage();
    assert.deepEqual(b.cartes(), [
      `兽人战士 (${S.slugProjet('兽人战士')}) : image_du_premier.png`,
      `精灵射手 (${S.slugProjet('精灵射手')}) : image_du_second.png`,
    ].sort(), 'grille : ' + b.cartes().join(' | '));
  } finally { b.fin(); }
});

test('« Cloud library » PUIS Generate dans un projet NEUF « Château fort » : un dossier, une carte, et le site recoit le nom saisi', async () => {
  const b = bureau();
  try {
    await b.creerProjet('Château fort');
    await b.telecharger('du_site.png');
    await b.page.reloadCurrentProject();
    await b.generer();
    await b.page.reloadCurrentProject();
    await b.page.refreshProjectsPage();
    assert.equal(b.dossiers().length, 1, 'dossiers : ' + b.dossiers().join(', '));
    assert.equal(b.state.projects.length, 1, 'grille : ' + b.cartes().join(' | '));
    assert.equal(b.state.currentProject.images.length, 2);
    assert.deepEqual(b.site.images, ['Château fort'], 'nom recu par le site');
  } finally { b.fin(); }
});

test('non-regression ASCII : « Cloud library » vers « Mobilier design » range dans « Mobilier_design », vers un ancien dossier « ____ » dans « ____ »', async () => {
  const b = bureau();
  try {
    await b.creerProjet('Mobilier design');
    const r = await b.telecharger('a.png');
    assert.equal(path.basename(path.dirname(r.path)), 'Mobilier_design');
    b.ecrireImage('____');
    await b.page.refreshProjectsPage();
    b.state.currentProject = b.state.projects.find((p) => p.name === '____');
    const r2 = await b.telecharger('b.png');
    assert.equal(path.basename(path.dirname(r2.path)), '____');
    assert.deepEqual(b.dossiers(), ['Mobilier_design', '____']);
    assert.deepEqual(b.nomsAffiches(), {}, 'aucun nom memorise pour un nom ASCII');
  } finally { b.fin(); }
});

/* ═══════════════ 3. le nom saisi survit a la perte de config.json ═══════════════ */
test('config.json reinitialise apres la 1re generation de « 兽人战士 » : UNE carte a son nom, et le site recoit encore « 兽人战士 »', async () => {
  const b = bureau();
  try {
    await b.creerProjet('兽人战士');
    await b.generer();
    await b.page.reloadCurrentProject();
    b.setConfig({ blenderPath: '' });   // config perdue ou reinitialisee
    await b.page.refreshProjectsPage();
    assert.equal(b.state.projects.length, 1, 'grille : ' + b.cartes().join(' | '));
    assert.equal(b.state.projects[0].displayName, '兽人战士');
    b.state.currentProject = b.state.projects[0];
    await b.generer();
    await b.partager();
    await b.animer();
    assert.deepEqual(b.site, { images: ['兽人战士', '兽人战士'], partages: ['兽人战士'], animations: ['兽人战士'] },
      `projet coupe en deux sur le site : ${JSON.stringify(b.site)}`);
  } finally { b.fin(); }
});

test('renommage d AFFICHAGE d un projet NEUF « 兽人战士 » (« Orc boss ») : la grille affiche « Orc boss », le site recoit encore « 兽人战士 »', async () => {
  const b = bureau();
  try {
    await b.creerProjet('兽人战士');
    await b.generer();
    await b.page.reloadCurrentProject();
    const dossier = b.state.currentProject.name;
    const r = await b.appeler('rename-project', { oldName: dossier, newName: 'Orc boss' });
    assert.equal(r.success, true);
    await b.page.reloadCurrentProject();
    assert.equal(b.state.currentProject.displayName, 'Orc boss');
    await b.generer();
    await b.partager();
    await b.animer();
    assert.deepEqual(b.site, { images: ['兽人战士', '兽人战士'], partages: ['兽人战士'], animations: ['兽人战士'] },
      `noms recus par le site : ${JSON.stringify(b.site)}`);
  } finally { b.fin(); }
});
