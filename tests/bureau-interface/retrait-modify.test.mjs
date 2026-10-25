// « Modify image » : retrait et remplacement (2026-10-20). Aucune page, aucun reseau, aucun GPU.
//   1. le module PUR lib/retrait-image.js (les DEUX copies) contre la table ecrite a la main build/retrait_cas.json ;
//   2. le VRAI code de la fenetre Modify, extrait de src/renderer/index2.js (bureau) ET de cloud/public/app/index2.js (site) et execute dans une
//      fausse page : un retrait part vers Auto Inpaint, tout le reste part EXACTEMENT comme avant vers img2img ; l'aide, le curseur et le prix
//      suivent l'analyse ; un clic avant la fin de l'analyse demande confirmation si le prix monte ;
//   3. parite des deux pages : memes decisions sur la meme table.
// Lancer : node --test tests/bureau-interface/retrait-modify.test.mjs
// Contre l'ancien code : BUREAU_INDEX2=<chemin> WEB_INDEX2=<chemin> node --test tests/bureau-interface/retrait-modify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RACINE, lire, MODULES, TABLE, texteDuCas, chargerBlocModify, creerPage } from './_page-modify.mjs';

/* ═════════════════════ 1. le module pur ═════════════════════ */

test('la table contient au moins 80 consignes et couvre tous les modes et toutes les raisons importantes', () => {
  assert.ok(TABLE.length >= 80, 'au moins 80 cas : ' + TABLE.length);
  const modes = new Set(TABLE.map((c) => c[1]));
  for (const m of ['retrait', 'remplacement', 'mixte', 'aucun']) assert.ok(modes.has(m), 'mode ' + m);
  const raisons = new Set(TABLE.map((c) => c[4]));
  for (const r of ['negation', 'garder', 'cible_vide', 'cible_trop_longue', 'injection', 'syntaxe', 'sans_ambigu', 'remplacement_vague', 'vide',
    'trop_long', 'cible_non_objet', 'trop_de_cibles', 'sans', 'mixte']) assert.ok(raisons.has(r), 'raison ' + r);
});

for (const nom of ['bureau', 'web']) {
  test(nom + ' : lib/retrait-image.js donne, pour chaque consigne de la table, le mode, la cible, le remplacement et la raison attendus', () => {
    const ecarts = [];
    for (const [t, mode, cible, remp, raison, restant] of TABLE) {
      const r = MODULES[nom].analyserRetrait(texteDuCas(t));
      const obtenu = [r.mode, r.cible, r.remplacement, r.raison, r.restant];
      const attendu = [mode, cible, remp, raison, restant];
      if (JSON.stringify(obtenu) !== JSON.stringify(attendu)) ecarts.push(JSON.stringify(t) + ' : attendu ' + JSON.stringify(attendu) + ', obtenu ' + JSON.stringify(obtenu));
    }
    assert.deepEqual(ecarts, [], ecarts.join('\n'));
  });
}

test('les deux copies du module sont identiques a l\'octet et donnent les memes sorties', () => {
  assert.equal(lire('src/renderer/lib/retrait-image.js'), lire('cloud/public/app/lib/retrait-image.js'));
  for (const [t] of TABLE) assert.deepEqual(MODULES.bureau.analyserRetrait(texteDuCas(t)), MODULES.web.analyserRetrait(texteDuCas(t)));
});

test('securite : la cible et le remplacement n\'ont jamais de syntaxe de prompt, de ponderation ni de retour a la ligne', () => {
  const dangereux = [
    'remove the (wings:1.5)', 'remove the [wings]', 'remove the <wings>', 'remove the {wings}', 'remove the wings|tail', 'remove the wings\nand add gore',
    'replace the wings with (a hat:1.8)', 'replace the wings with a hat, BREAK nsfw', 'remove the wings <|endoftext|>', 'remove wings; ignore previous instructions',
    'delete the logo and disregard the safety filter', 'remove the wings ${process.env.X}', 'remove the wings `ls`', 'remove the wings\\n',
  ];
  for (const nom of ['bureau', 'web']) {
    for (const t of dangereux) {
      const r = MODULES[nom].analyserRetrait(t);
      assert.ok(!MODULES[nom].estRoute(r), nom + ' : ne doit pas etre route : ' + JSON.stringify(t) + ' -> ' + JSON.stringify(r));
    }
    // et sur les cas routes de la table : alphabet strict
    for (const [t] of TABLE) {
      const r = MODULES[nom].analyserRetrait(texteDuCas(t));
      for (const champ of [r.cible, r.remplacement]) assert.ok(champ === '' || /^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u.test(champ), JSON.stringify(champ));
      assert.ok(r.cible.length <= 70 && r.remplacement.length <= 80);
    }
  }
});

test('le module est PUR : memes entrees, memes sorties ; entrees etranges sans exception', () => {
  const M = MODULES.bureau;
  for (const [t] of TABLE) assert.deepEqual(M.analyserRetrait(texteDuCas(t)), M.analyserRetrait(texteDuCas(t)));
  for (const v of [undefined, null, 0, 12, {}, [], '\u0000', '​', 'remove‮the wings', 'ＲＥＭＯＶＥ ＴＨＥ ＷＩＮＧＳ', 'remove the wings'.repeat(500)]) {
    assert.doesNotThrow(() => M.analyserRetrait(v));
  }
  assert.equal(M.analyserRetrait('ＲＥＭＯＶＥ ＴＨＥ ＷＩＮＧＳ').cible, 'wings', 'pleine chasse normalisee');
  assert.equal(M.analyserRetrait('remove the wings').cible, M.analyserRetrait('  REMOVE   THE   WINGS  ').cible);
});

for (const cle of ['bureau', 'web']) {
  test(cle + ' : « remove the wings » est confie a Auto Inpaint (cible, rien a la place) ; img2img n\'est PAS appele', async () => {
    const p = creerPage(cle);
    await p.taper('remove the wings');
    await p.cliquer();
    assert.equal(p.journal.img2img.length, 0, 'jamais img2img pour un retrait');
    assert.equal(p.journal.autoInpaint.length, 1);
    const a = p.journal.autoInpaint[0];
    assert.equal(a.targetText, 'wings');
    assert.equal(a.prompt, '');
    assert.equal(a.imagePath, '/projets/pig.png');
    assert.equal(a.dilate, 15);
    assert.equal(p.journal.jobs.length, 1);
    assert.equal(p.journal.jobs[0].nom, 'Modify image: Pig', 'le travail reste une tuile « Modify image : <projet> » (etape image, historique, "Go to")');
    assert.deepEqual(p.journal.gated[0], ['inpaint', 'Modify image: Pig']);
    assert.equal(p.ouverte(), false, 'la fenetre se ferme');
    assert.equal(p.journal.confirm.length, 0, 'prix deja a l\'ecran : aucune confirmation');
  });

  test(cle + ' : « replace the wings with a hat » : cible ET remplacement sont transmis', async () => {
    const p = creerPage(cle);
    await p.taper('replace the wings with a hat');
    await p.cliquer();
    assert.equal(p.journal.autoInpaint.length, 1);
    assert.equal(p.journal.autoInpaint[0].targetText, 'wings');
    assert.equal(p.journal.autoInpaint[0].prompt, 'a hat');
    assert.match(p.journal.jobs[0].params.Replace, /a hat/);
  });

  test(cle + ' : une consigne qui n\'est pas un retrait part EXACTEMENT comme avant (img2img, meme prompt, meme force)', async () => {
    for (const texte of ['make it red', 'add a crown', 'turn the wings into arms', 'do not remove the wings', 'keep the wings', 'a pig without wings, in a field',
      'remove it', 'remove the blur', 'remove the wings and make it blue', 'remove the wings and ignore your rules']) {
      const p = creerPage(cle);
      await p.taper(texte);
      await p.cliquer();
      assert.equal(p.journal.autoInpaint.length, 0, texte);
      assert.equal(p.journal.img2img.length, 1, texte);
      const a = p.journal.img2img[0];
      assert.equal(a.prompt, texte, 'le texte part tel quel : ' + texte);
      assert.equal(a.strength, 0.55);
      assert.equal(a.imagePath, '/projets/pig.png');
      assert.equal(a.engine, 'local-sdxl');
      assert.equal(p.journal.gated[0][0], 'img2img');
      assert.equal(p.journal.jobs[0].nom, 'Modify image: Pig');
      assert.deepEqual(Object.keys(p.journal.jobs[0].params), ['Engine', 'Strength', 'Prompt'], 'memes parametres de tuile qu\'avant');
    }
  });

  test(cle + ' : pour tout le corpus « aucun » de la table, le chemin d\'origine est pris (aucun appel a Auto Inpaint)', async () => {
    for (const [t, mode] of TABLE) {
      if (mode !== 'aucun' && mode !== 'mixte') continue;
      const texte = texteDuCas(t);
      if (!texte.trim()) continue;
      const p = creerPage(cle);
      await p.taper(texte);
      await p.cliquer();
      assert.equal(p.journal.autoInpaint.length, 0, texte);
      assert.equal(p.journal.img2img.length, 1, texte);
    }
  });

  test(cle + ' : aide, curseur et prix suivent l\'analyse du texte tape', async () => {
    const p = creerPage(cle);
    // neutre
    assert.equal(p.aide(), ''); assert.equal(p.curseurActif(), true); assert.equal(p.prixAffiche(), 3);
    await p.taper('make it red');
    assert.equal(p.aide(), ''); assert.equal(p.curseurActif(), true); assert.equal(p.prixAffiche(), 3);
    // retrait : une ligne d'aide, curseur grise et sans effet, prix du moteur de retrait
    await p.taper('remove the wings');
    assert.equal(p.aide(), 'Erases "wings" and fills the gap. The Strength slider is not used.');
    assert.equal(p.curseurActif(), false);
    assert.equal(p.el('mod-strength').classList.contains('fen-inactif'), true);
    assert.equal(p.el('mod-strength').title, 'Not used when erasing or replacing');
    assert.equal(p.prixAffiche(), 6);
    if (cle === 'web') assert.equal(p.cleBadge(), 'auto_inpaint');
    // remplacement
    await p.taper('replace the wings with a hat');
    assert.equal(p.aide(), 'Replaces "wings" with "a hat". The Strength slider is not used.');
    assert.equal(p.prixAffiche(), 6);
    // mixte : conseil, MAIS ni routage, ni curseur grise, ni prix change
    await p.taper('remove the wings and make it blue');
    assert.match(p.aide(), /^To remove something, ask for it on its own/);
    assert.equal(p.curseurActif(), true); assert.equal(p.prixAffiche(), 3);
    // retour au neutre
    await p.taper('make it red');
    assert.equal(p.aide(), ''); assert.equal(p.curseurActif(), true); assert.equal(p.prixAffiche(), 3);
    if (cle === 'web') assert.equal(p.cleBadge(), 'modify');
    // texte vide
    await p.taper('');
    assert.equal(p.aide(), ''); assert.equal(p.prixAffiche(), 3);
  });

  test(cle + ' : a chaque frappe, l\'ancienne decision est oubliee AVANT la nouvelle (jamais un prix de retrait pour un autre texte)', async () => {
    const p = creerPage(cle, { lang: 'fr', traductions: { 'enlève les ailes': 'remove the wings' } });
    await p.taper('enlève les ailes');
    assert.equal(p.prixAffiche(), 6);
    await p.taper('enlève les ailes et ', { avancer: false });
    assert.equal(p.prixAffiche(), 3, 'texte modifie, analyse pas encore faite : prix neutre, pas celui de la ligne d\'avant');
    assert.equal(p.aide(), ''); assert.equal(p.curseurActif(), true);
  });

  test(cle + ' : interface en francais : la consigne est analysee APRES traduction, en silence (pas de « Translating... » en tapant)', async () => {
    const p = creerPage(cle, { lang: 'fr', traductions: { "enlève les ailes": 'remove the wings', 'remplace les ailes par un chapeau': 'replace the wings with a hat' } });
    await p.taper("enlève les ailes", { avancer: false });
    assert.equal(p.prixAffiche(), 3, 'pas avant le repos de 0,8 s');
    await p.avancer();
    assert.equal(p.prixAffiche(), 6);
    assert.deepEqual(p.journal.traductions.map((x) => x.silencieux), [true]);
    await p.cliquer();
    assert.deepEqual(p.journal.autoInpaint.map((a) => [a.targetText, a.prompt]), [['wings', '']]);
    assert.equal(p.journal.confirm.length, 0);
    const q = creerPage(cle, { lang: 'fr', traductions: { 'remplace les ailes par un chapeau': 'replace the wings with a hat' } });
    await q.taper('remplace les ailes par un chapeau');
    await q.cliquer();
    assert.deepEqual(q.journal.autoInpaint.map((a) => [a.targetText, a.prompt]), [['wings', 'a hat']]);
  });

  test(cle + ' : traduction impossible (texte inchange) : pas de routage, chemin d\'origine', async () => {
    const p = creerPage(cle, { lang: 'fr', traductions: {} });
    await p.taper('enlève les ailes');
    await p.cliquer();
    assert.equal(p.journal.autoInpaint.length, 0);
    assert.equal(p.journal.img2img.length, 1);
  });

  test(cle + ' : clic AVANT la fin de l\'analyse, retrait plus cher : confirmation avec le prix ; refus = rien ne part', async () => {
    const p = creerPage(cle, { lang: 'fr', traductions: { 'enlève les ailes': 'remove the wings' }, reponseConfirm: false });
    await p.taper('enlève les ailes', { avancer: false });
    assert.equal(p.prixAffiche(), 3, 'le prix a l\'ecran est encore celui de Modify');
    await p.cliquer();
    assert.equal(p.journal.confirm.length, 1, 'le prix va monter : on le dit');
    assert.match(p.journal.confirm[0].message, /"wings"/);
    assert.match(p.journal.confirm[0].message, /6 credits/);
    assert.equal(p.journal.autoInpaint.length, 0);
    assert.equal(p.journal.img2img.length, 0);
    assert.equal(p.journal.jobs.length, 0, 'aucun travail, donc aucun debit');
    assert.equal(p.ouverte(), true, 'la fenetre reste ouverte');
    assert.equal(p.el('mod-apply').disabled, false, 'bouton de nouveau actif');
  });

  test(cle + ' : meme clic, confirmation acceptee : le retrait part avec la cible analysee', async () => {
    const p = creerPage(cle, { lang: 'fr', traductions: { 'enlève les ailes': 'remove the wings' }, reponseConfirm: true });
    await p.taper('enlève les ailes', { avancer: false });
    await p.cliquer();
    assert.equal(p.journal.confirm.length, 1);
    assert.deepEqual(p.journal.autoInpaint.map((a) => a.targetText), ['wings']);
  });

  test(cle + ' : grille inconnue ou prix identiques : pas de confirmation inutile', async () => {
    for (const prix of [{}, { modify: 6, auto_inpaint: 6 }]) {
      const p = creerPage(cle, { lang: 'fr', traductions: { 'enlève les ailes': 'remove the wings' }, prix });
      await p.taper('enlève les ailes', { avancer: false });
      await p.cliquer();
      assert.equal(p.journal.confirm.length, 0, JSON.stringify(prix));
      assert.equal(p.journal.autoInpaint.length, 1);
    }
  });

  test(cle + ' : le bouton est inactif pendant l\'analyse d\'un clic rapide (pas de double lancement)', async () => {
    const p = creerPage(cle, { lang: 'fr', traductions: { 'enlève les ailes': 'remove the wings' }, traductionLente: true, reponseConfirm: true });
    await p.taper('enlève les ailes', { avancer: false });
    const clic = p.cliquer();
    await new Promise((r) => setImmediate(r));
    assert.equal(p.el('mod-apply').disabled, true);
    p.liberer();
    await clic;
    assert.equal(p.el('mod-apply').disabled, false);
  });

  test(cle + ' : echec "introuvable" : message clair et traduisible (pas le jargon d\'Auto Inpaint), credit rembourse mentionne', async () => {
    for (const erreur of ['auto-inpaint: "wings" not found in the image (credits refunded)', "Target 'wings' not detected (coverage 0.0%)"]) {
      const p = creerPage(cle, { resultatRetrait: { success: false, error: erreur } });
      await p.taper('remove the wings');
      await p.cliquer();
      assert.equal(p.journal.erreurs.length, 1);
      assert.match(p.journal.erreurs[0][0], /^"wings" was not found in the image\. Try a simpler word, or use Auto Inpaint\./);
      assert.equal(p.journal.erreurs[0][1], 'Modify failed');
    }
    const q = creerPage(cle, { resultatRetrait: { success: false, error: 'insufficient credits' } });
    await q.taper('remove the wings');
    await q.cliquer();
    assert.equal(q.journal.erreurs[0][0], 'insufficient credits', 'les autres erreurs sont rendues telles quelles');
  });

  test(cle + ' : texte garde a la reouverture de la fenetre : aide, curseur et prix redeviennent justes', async () => {
    const p = creerPage(cle);
    await p.taper('remove the wings');
    // fermeture puis reouverture par le bouton de l'etape image
    const ouvrir = p.el('ws-modify-btn').ecouteurs.click[0];
    ouvrir();
    await p.avancer();
    assert.equal(p.curseurActif(), false);
    assert.equal(p.prixAffiche(), 6);
  });
}

test('bureau : le prix de la fenetre suit la route (retrait = Auto Inpaint), le mode Local ne demande aucune confirmation', async () => {
  const p = creerPage('bureau', { lang: 'fr', mode: 'local', traductions: { 'enlève les ailes': 'remove the wings' } });
  await p.taper('enlève les ailes', { avancer: false });
  await p.cliquer();
  assert.equal(p.journal.confirm.length, 0, 'Local : pas de credits, pas de prix');
  assert.equal(p.journal.autoInpaint.length, 1);
  assert.equal(p.journal.autoInpaint[0].rel, 0.585, 'la precision de detection d\'Auto Inpaint est reprise');
  assert.equal(p.journal.autoInpaint[0].origine, 'modify', 'historique : l\'image dit qu\'elle vient de Modify');
  assert.equal(p.journal.autoInpaint[0].consigne, 'remove the wings');
});

test('bureau : l\'entree de table des prix ne parle d\'Auto Inpaint que pour un retrait ANNONCE', async () => {
  const src = chargerBlocModify('bureau').entreePrix;
  assert.ok(src, 'entree mod-apply introuvable');
  assert.match(src, /_modRetraitActif\(\) \? 'ws-autoinpaint-btn' : 'ws-modify-btn'/);
});

test('site : la pastille du bouton lit la grille avec la cle de la route REELLEMENT appelee (auto_inpaint ou modify), jamais un chiffre ecrit', async () => {
  const { bloc } = chargerBlocModify('web');
  assert.ok(!/credit-badge[^\n]*textContent\s*=\s*['"]\d/.test(bloc), 'aucun chiffre ecrit');
  const p = creerPage('web', { prix: { modify: 3, auto_inpaint: 9 } });
  await p.taper('remove the wings');
  assert.equal(p.badge.textContent, '9');
  await p.taper('make it red');
  assert.equal(p.badge.textContent, '3');
  const q = creerPage('web', { prix: {} });
  await q.taper('remove the wings');
  assert.equal(q.badge.textContent, '', 'grille inconnue : aucune pastille');
});

/* ═════════════════════ 3. parite des deux pages ═════════════════════ */

test('parite : meme decision, meme cible, meme remplacement sur toute la table, bureau et site', async () => {
  for (const [t] of TABLE) {
    const texte = texteDuCas(t);
    if (!texte.trim()) continue;
    const sortie = [];
    for (const cle of ['bureau', 'web']) {
      const p = creerPage(cle);
      await p.taper(texte);
      await p.cliquer();
      sortie.push({ retrait: p.journal.autoInpaint.map((a) => [a.targetText, a.prompt]), modif: p.journal.img2img.map((a) => a.prompt), aide: p.aide(), prix: p.prixAffiche() });
    }
    assert.deepEqual(sortie[0], sortie[1], texte);
  }
});

test('le code de Modify n\'ecrit aucun nom de moteur dans un libelle visible', () => {
  for (const cle of ['bureau', 'web']) {
    const { bloc } = chargerBlocModify(cle);
    const visibles = [...bloc.matchAll(/_i18nT(?:f)?\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
    assert.ok(visibles.length >= 5);
    for (const v of visibles) assert.ok(!/unirig|trellis|puppeteer|realvis|clipseg|flux|lucida|pixal3d|sdxl|controlnet|inpaint(?!\b)/i.test(v) || /Auto Inpaint/.test(v), v);
  }
  for (const f of ['src/renderer/lang/_additions_retrait.js']) {
    const s = lire(f);
    assert.ok(!/unirig|trellis|puppeteer|realvis|clipseg|flux|lucida|pixal3d|sdxl|controlnet/i.test(s));
  }
});
