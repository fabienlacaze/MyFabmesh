#!/usr/bin/env node
/**
 * Banc de la DESINSTALLATION COMPLETE (2026-09-30) : src/main/desinstallation.js et build/uninstaller.nsh.
 *
 * Tout se passe dans un FAUX arbre (dossier temporaire neuf, ou MFM_TEST_RACINE) : faux %APPDATA%,
 * %LOCALAPPDATA%, %TEMP%, dossier personnel, Documents et dossiers de donnees deplaces. Rien du vrai
 * profil n'est lu ni touche.
 *
 *   node build/test-desinstallation.mjs          regles de surete + suppression (JS) + parite des listes NSIS
 *   node build/test-desinstallation.mjs --nsis   en plus : compile build/test-desinstalleur.nsi (makensis
 *                                                d'electron-builder) et l'execute sur le faux arbre. Le
 *                                                registre n'est lu que sous une cle de TEST, effacee a la fin.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE_DEPOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const D = require(path.join(RACINE_DEPOT, 'src', 'main', 'desinstallation.js'));

let reussis = 0;
const echecs = [];
async function cas(nom, f) {
  try { await f(); reussis++; console.log('  ok   ' + nom); }
  catch (e) { echecs.push(nom); console.log('  ECHEC ' + nom + '\n        ' + (e && e.message)); }
}

// ───────────────────────── faux arbre ─────────────────────────
function ecrire(p, octets = 10) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(octets, 1));
}
function construireArbre(base) {
  const r = (...p) => path.join(base, ...p);
  const ud = r('AppData', 'Roaming', 'myfabmesh-ai');
  // moteur (emplacement par defaut) + caches confines
  ecrire(path.join(ud, 'python', 'python.exe'), 1000);
  ecrire(path.join(ud, 'python', 'Lib', 'site-packages', 'torch', 'lib', 'x.pyd'), 2000);
  ecrire(path.join(ud, 'hf_cache', 'hub', 'models--a--b', 'blobs', 'f'), 5000);
  ecrire(path.join(ud, 'ai-cache', 'pip', 'w.whl'), 300);
  ecrire(path.join(ud, 'ai-tmp', 'pip-unpack-x', 'y'), 10);
  // projets + config
  ecrire(path.join(ud, 'images', 'proj_1', 'ref_0.png'), 400);
  ecrire(path.join(ud, 'meshes', 'm.glb'), 600);
  ecrire(path.join(ud, 'previews', 'p.png'), 10);
  ecrire(path.join(ud, 'history', 'h', 'v1.glb'), 20);
  ecrire(path.join(ud, 'projets_vides', 'p.json'), 5);
  ecrire(path.join(ud, 'config.json'), 50);
  ecrire(path.join(ud, 'config.json.bak'), 50);
  // etats / journaux / jetons
  ecrire(path.join(ud, 'setup_state.json'), 20);
  ecrire(path.join(ud, 'logs', 'fabmesh.log'), 100);
  ecrire(path.join(ud, 'cloud_session.json'), 30);
  // profil Electron + inconnu : JAMAIS touches depuis l'appli
  ecrire(path.join(ud, 'Local Storage', 'leveldb', '000003.log'), 10);
  ecrire(path.join(ud, 'Cache', 'Cache_Data', 'data_0'), 10);
  ecrire(path.join(ud, 'inconnu.txt'), 10);
  // ancien dossier %APPDATA%\fabmesh
  ecrire(r('AppData', 'Roaming', 'fabmesh', 'startup.log'), 10);
  ecrire(r('AppData', 'Roaming', 'fabmesh', 'cache', 'motion_thumbs', 'a.png'), 10);
  ecrire(r('AppData', 'Roaming', 'fabmesh', 'images', 'old', 'ref.png'), 30);
  // une autre appli : jamais touchee
  ecrire(r('AppData', 'Roaming', 'autre-appli', 'garder.txt'), 10);
  ecrire(r('AppData', 'Local', 'myfabmesh-ai-updater', 'pending', 'setup.exe'), 100);
  // %TEMP%
  ecrire(r('AppData', 'Local', 'Temp', 'fabmesh_dl', 'x'), 10);
  ecrire(r('AppData', 'Local', 'Temp', 'myfabmesh', 'y'), 10);
  ecrire(r('AppData', 'Local', 'Temp', 'rig_complet_abc', 'z'), 10);
  ecrire(r('AppData', 'Local', 'Temp', '_pup_fbx2glb.py'), 10);
  ecrire(r('AppData', 'Local', 'Temp', 'autre_tmp', 'garder'), 10);
  ecrire(r('AppData', 'Local', 'Temp', 'pip-unpack-zz', 'garder'), 10);
  // dossiers deplaces
  const d1 = r('D1', 'MyFabmesh-data');                            // actuel, avec temoin
  ecrire(path.join(d1, 'python', 'python.exe'), 700);
  ecrire(path.join(d1, 'hf_cache', 'hub', 'f'), 900);
  ecrire(path.join(d1, D.TEMOIN), 5);
  ecrire(path.join(d1, 'notes-du-user.txt'), 5);                   // a nous ? non : garde
  const d2 = r('D2', 'MyFabmesh-data');                            // ancien, SANS temoin : refuse
  ecrire(path.join(d2, 'python', 'python.exe'), 700);
  const d3 = r('D3', 'Games');                                     // config editee a la main : mauvais nom
  ecrire(path.join(d3, 'python', 'python.exe'), 700);
  ecrire(path.join(d3, D.TEMOIN), 5);
  const d4 = r('D4', 'MyFabmesh-data');                            // ancien, temoin, avec une JONCTION
  ecrire(path.join(d4, 'python', 'python.exe'), 700);
  ecrire(path.join(d4, D.TEMOIN), 5);
  // Jonctions vers des dossiers ETRANGERS (un user qui aurait relie un cache a un autre disque) : leur
  // cible ne doit jamais etre videe, a faible ou grande profondeur, ni dans le dossier par defaut.
  ecrire(r('Ailleurs', 'precieux', 'ne-pas-effacer.txt'), 10);
  ecrire(r('Ailleurs', 'precieux2', 'ne-pas-effacer.txt'), 10);
  ecrire(r('Ailleurs', 'precieux3', 'ne-pas-effacer.txt'), 10);
  fs.mkdirSync(path.join(d4, 'hf_cache'), { recursive: true });
  fs.symlinkSync(r('Ailleurs', 'precieux'), path.join(d4, 'hf_cache', 'lien'), 'junction');
  fs.mkdirSync(path.join(d4, 'python', 'Lib', 'site-packages', 'pkg', 'sous'), { recursive: true });
  fs.symlinkSync(r('Ailleurs', 'precieux2'), path.join(d4, 'python', 'Lib', 'site-packages', 'pkg', 'sous', 'lien2'), 'junction');
  fs.symlinkSync(r('Ailleurs', 'precieux3'), path.join(ud, 'hf_cache', 'lien3'), 'junction');
  // jonction CASSEE (cible disparue) : doit etre retiree elle aussi, sinon D4 ne se vide jamais
  fs.mkdirSync(r('Ailleurs', 'disparu'), { recursive: true });
  fs.symlinkSync(r('Ailleurs', 'disparu'), path.join(d4, 'python', 'lien-casse'), 'junction');
  fs.rmdirSync(r('Ailleurs', 'disparu'));
  // dossier personnel
  const home = r('Users', 'test');
  ecrire(path.join(home, '.u2net', 'u2net.onnx'), 1760);
  ecrire(path.join(home, '.u2net', 'autre-modele.onnx'), 10);     // a une autre appli : garde
  ecrire(path.join(home, '.cache', 'realesrgan_weights', 'RealESRGAN_x4plus.pth'), 700);
  ecrire(path.join(home, '.cache', 'huggingface', 'hub', 'x'), 10); // cache partage : garde
  ecrire(path.join(home, '.cache', 'huggingface', 'hub', 'models--SG161222--RealVisXL_V4.0', 'blobs', 'x'), 50); // a nous, sur demande
  ecrire(path.join(home, '.cache', 'huggingface', 'hub', 'models--autre--modele', 'blobs', 'y'), 10);          // etranger : garde
  ecrire(path.join(home, '.flex_gemm', 'autotune_cache.json'), 10);
  ecrire(path.join(home, '.fabmesh', 'test_api_token.txt'), 10);
  ecrire(path.join(home, 'Documents', 'MyFabmesh', 'exports', 'a.fbx'), 40);
  ecrire(path.join(home, 'Documents', 'MyFabmesh', 'autre.txt'), 10);
  return {
    ctx: {
      userData: ud,
      appData: r('AppData', 'Roaming'),
      localAppData: r('AppData', 'Local'),
      temp: r('AppData', 'Local', 'Temp'),
      home,
      documents: path.join(home, 'Documents'),
      desktop: path.join(home, 'Desktop'),
      downloads: path.join(home, 'Downloads'),
      installDir: r('AppData', 'Local', 'Programs', 'myfabmesh-ai'),
      dossierActuel: d1,
      dossiersDonnees: [d1, d2, d3, d4],
    },
    d1, d2, d3, d4, r,
  };
}

const existe = (p) => { try { fs.lstatSync(p); return true; } catch (_) { return false; } };

function verifierApres(a, garderProjets, { profilElectronIntact = true, partagesSupprimes = false } = {}) {
  const { ctx, d1, d2, d3, d4, r } = a;
  const ud = ctx.userData;
  for (const n of D.DOSSIERS_MOTEUR) assert.ok(!existe(path.join(ud, n)), 'moteur restant : ' + n);
  for (const n of ['setup_state.json', 'logs', 'cloud_session.json']) assert.ok(!existe(path.join(ud, n)), 'reglage restant : ' + n);
  for (const n of [...D.DOSSIERS_PROJETS, ...D.FICHIERS_CONFIG]) {
    assert.equal(existe(path.join(ud, n)), garderProjets, (garderProjets ? 'projet perdu : ' : 'projet restant : ') + n);
  }
  if (profilElectronIntact) {
    assert.ok(existe(path.join(ud, 'Local Storage', 'leveldb', '000003.log')), 'profil Electron touche');
    assert.ok(existe(path.join(ud, 'Cache', 'Cache_Data', 'data_0')), 'cache Chromium touche');
    assert.ok(existe(path.join(ud, 'inconnu.txt')), 'fichier inconnu touche');
  }
  assert.ok(!existe(r('AppData', 'Roaming', 'fabmesh', 'cache')), 'ancien cache restant');
  assert.equal(existe(r('AppData', 'Roaming', 'fabmesh', 'images')), garderProjets, 'anciens projets');
  assert.ok(existe(r('AppData', 'Roaming', 'autre-appli', 'garder.txt')), 'autre appli touchee');
  assert.ok(!existe(r('AppData', 'Local', 'myfabmesh-ai-updater')), 'cache de mise a jour restant');
  for (const n of ['fabmesh_dl', 'myfabmesh', 'rig_complet_abc', '_pup_fbx2glb.py']) assert.ok(!existe(r('AppData', 'Local', 'Temp', n)), 'temp restant : ' + n);
  for (const n of ['autre_tmp', 'pip-unpack-zz']) assert.ok(existe(r('AppData', 'Local', 'Temp', n)), 'temp etranger efface : ' + n);
  // deplaces
  assert.ok(!existe(path.join(d1, 'python')) && !existe(path.join(d1, 'hf_cache')), 'moteur deplace restant (D1)');
  assert.ok(!existe(path.join(d1, D.TEMOIN)), 'temoin D1 restant');
  assert.ok(existe(path.join(d1, 'notes-du-user.txt')), 'fichier du user efface dans D1');
  assert.ok(existe(path.join(d2, 'python', 'python.exe')), 'D2 (sans temoin) touche');
  assert.ok(existe(path.join(d3, 'python', 'python.exe')), 'D3 (mauvais nom) touche');
  assert.ok(!existe(d4), 'D4 (vide apres suppression) restant');
  for (const c of ['precieux', 'precieux2', 'precieux3']) {
    assert.ok(existe(r('Ailleurs', c, 'ne-pas-effacer.txt')), 'la CIBLE d\'une jonction a ete effacee : ' + c);
  }
  // dossier personnel
  const home = ctx.home;
  assert.ok(!existe(path.join(home, '.u2net', 'u2net.onnx')), 'u2net restant');
  assert.ok(existe(path.join(home, '.u2net', 'autre-modele.onnx')), 'modele etranger efface');
  assert.ok(!existe(path.join(home, '.cache', 'realesrgan_weights')), 'realesrgan restant');
  assert.ok(existe(path.join(home, '.cache', 'huggingface', 'hub', 'x')), 'cache partage efface');
  assert.ok(existe(path.join(home, '.cache', 'huggingface', 'hub', 'models--autre--modele')), 'modele etranger du cache partage efface');
  assert.equal(existe(path.join(home, '.cache', 'huggingface', 'hub', 'models--SG161222--RealVisXL_V4.0')), !partagesSupprimes,
    'notre modele du cache partage : ' + (partagesSupprimes ? 'restant' : 'efface sans demande'));
  assert.ok(!existe(path.join(home, '.flex_gemm')), '.flex_gemm restant');
  assert.ok(!existe(path.join(home, '.fabmesh')), '.fabmesh restant');
  assert.equal(existe(path.join(home, 'Documents', 'MyFabmesh', 'exports')), garderProjets, 'exports');
  assert.ok(existe(path.join(home, 'Documents', 'MyFabmesh', 'autre.txt')), 'Documents\\MyFabmesh\\autre.txt efface');
}

function nouvelleRacine(nom) {
  const base = process.env.MFM_TEST_RACINE || os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'mfm-test-desinst-' + nom + '-'));
}
function effacerRacine(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }

// ───────────────────────── 1. regles de surete ─────────────────────────
console.log('\n[1] regles de surete');
const racineSurete = nouvelleRacine('surete');
const arbreS = construireArbre(racineSurete);
await cas('racines de disque et partages reconnus', () => {
  assert.ok(D.estRacine('C:\\'));
  assert.ok(D.estRacine('D:\\'));
  assert.ok(D.estRacine('\\\\serveur\\partage\\'));
  assert.ok(!D.estRacine('C:\\Users'));
});
await cas('dossier deplace : nom + temoin exiges', () => {
  const c = arbreS.ctx;
  assert.equal(D.dossierDeplaceValide('D:\\', c).ok, false);
  assert.equal(D.dossierDeplaceValide('MyFabmesh-data', c).ok, false);
  assert.equal(D.dossierDeplaceValide(arbreS.d1, c).ok, true);
  assert.equal(D.dossierDeplaceValide(arbreS.d1.replace('MyFabmesh-data', 'myfabmesh-DATA'), c).ok, true);
  assert.equal(D.dossierDeplaceValide(arbreS.d2, c).ok, false, 'sans temoin');
  assert.equal(D.dossierDeplaceValide(arbreS.d2, c, { estActuel: true }).ok, true, 'actuel sans temoin');
  assert.equal(D.dossierDeplaceValide(arbreS.d3, c).ok, false, 'mauvais nom');
  assert.equal(D.dossierDeplaceValide(arbreS.d3, c, { estActuel: true }).ok, false, 'mauvais nom meme actuel');
});
await cas('dossier de l\'appli : exactement %APPDATA%\\myfabmesh-ai ou \\fabmesh', () => {
  const c = arbreS.ctx;
  assert.ok(D.dossierAppliValide(c.userData, c));
  assert.ok(D.dossierAppliValide(path.join(c.appData, 'fabmesh'), c));
  assert.ok(!D.dossierAppliValide(path.join(c.appData, 'autre-appli'), c));
  assert.ok(!D.dossierAppliValide(path.join(c.localAppData, 'myfabmesh-ai'), c));
});
await cas('planification : refus signales, aucune cible protegee', () => {
  const plan = D.planifier(arbreS.ctx);
  const refus = plan.refus.map((x) => x.chemin);
  assert.ok(refus.includes(arbreS.d2) && refus.includes(arbreS.d3), 'D2 et D3 doivent etre refuses');
  const protege = [arbreS.ctx.home, arbreS.ctx.documents, arbreS.ctx.appData, arbreS.ctx.localAppData, arbreS.ctx.temp, arbreS.ctx.userData];
  for (const e of plan.elements) {
    assert.ok(!D.estRacine(e.chemin), 'racine planifiee : ' + e.chemin);
    assert.ok(!protege.some((p) => D.memeChemin(p, e.chemin)), 'dossier protege planifie : ' + e.chemin);
  }
  const noms = plan.elements.map((e) => path.basename(e.chemin));
  for (const n of ['Local Storage', 'Cache', 'inconnu.txt', 'autre-appli', 'autre_tmp', 'pip-unpack-zz', 'huggingface', 'models--autre--modele']) {
    assert.ok(!noms.includes(n), 'element etranger planifie : ' + n);
  }
});
await cas('une racine ou un chemin court ne passe jamais dans l\'arret des processus', () => {
  const env = D.environnementArret({ dossiers: ['C:\\', 'D:\\', 'relatif', arbreS.d1], scripts: 'C:\\', exeAppli: 'x', pidAppli: 42 });
  assert.equal(env.MFM_DOSSIERS, arbreS.d1);
  assert.equal(env.MFM_SCRIPTS, '');
  assert.equal(env.MFM_PID_APPLI, '42');
  assert.ok(!D.SCRIPT_ARRET.includes('"'), 'le script PowerShell ne doit contenir aucun guillemet double');
});
await cas('noms de valeur du registre stables et insensibles a la casse', () => {
  assert.equal(D.nomValeurRegistre('D:\\MyFabmesh-data'), D.nomValeurRegistre('d:\\myfabmesh-data\\'));
  assert.match(D.nomValeurRegistre('D:\\MyFabmesh-data'), /^d[0-9a-f]{12}$/);
  const a = D.argsRegistreAjout('D:\\MyFabmesh-data');
  assert.deepEqual(a.slice(0, 2), ['add', 'HKCU\\Software\\MyFabmesh.AI\\DataDirs']);
});
await cas('temoin : pose seulement dans un dossier « MyFabmesh-data » existant', () => {
  const x = path.join(racineSurete, 'X', 'Autre');
  fs.mkdirSync(x, { recursive: true });
  assert.equal(D.poserTemoin(x), false);
  assert.equal(D.poserTemoin('C:\\'), false);
  assert.equal(D.poserTemoin(arbreS.d2), true);
  assert.ok(fs.existsSync(path.join(arbreS.d2, D.TEMOIN)));
});
effacerRacine(racineSurete);

// ───────────────────────── 2. suppression (JS) ─────────────────────────
console.log('\n[2] suppression depuis l\'appli (JS)');
for (const garder of [true, false]) {
  const rac = nouvelleRacine(garder ? 'garder' : 'tout');
  const a = construireArbre(rac);
  await cas('inventaire puis suppression, projets ' + (garder ? 'GARDES' : 'SUPPRIMES'), async () => {
    const plan = await D.mesurer(D.planifier(a.ctx));
    const res = D.resumer(plan);
    // moteur = python 3000 + hf 5000 + ai-cache 300 + ai-tmp 10 + D1 1600 + temoin D1 5 + D4 700 + temoin D4 5
    //        + u2net 1760 + realesrgan 700 + flex_gemm 10 + jeton 10
    assert.equal(res.moteur.octets, 3000 + 5000 + 300 + 10 + 1600 + 5 + 700 + 5 + 1760 + 700 + 10 + 10);
    assert.equal(res.projets.octets, 400 + 600 + 10 + 20 + 5 + 30 + 40);
    assert.equal(res.config.octets, 100);
    assert.equal(res.partage.octets, 50);
    let progression = 0;
    // projets gardes : cache partage garde ; projets supprimes : cache partage aussi (les deux options)
    const r = await D.supprimer(plan, a.ctx, { supprimerProjets: !garder, supprimerPartages: !garder, surProgression: ({ octets }) => { progression = octets; } });
    assert.equal(r.echecs.length, 0, 'echecs : ' + JSON.stringify(r.echecs));
    assert.ok(progression > 0 && progression === r.liberes, 'progression incoherente');
    const attendu = res.moteur.octets + res.reglages.octets + (garder ? 0 : res.projets.octets + res.config.octets + res.partage.octets);
    assert.equal(r.liberes, attendu, 'octets liberes');
    assert.ok(r.dossiersRetires.some((d) => D.memeChemin(d, a.d1)) && r.dossiersRetires.some((d) => D.memeChemin(d, a.d4)), 'D1 et D4 a oublier');
    verifierApres(a, garder, { partagesSupprimes: !garder });
  });
  effacerRacine(rac);
}

await cas('un plan falsifie (chemin hors planification) est refuse', async () => {
  const rac = nouvelleRacine('falsifie');
  const a = construireArbre(rac);
  const plan = await D.mesurer(D.planifier(a.ctx));
  const cible = path.join(a.ctx.appData, 'autre-appli');
  plan.elements.push({ categorie: 'moteur', chemin: cible, existe: true, octets: 10 });
  const r = await D.supprimer(plan, a.ctx, { supprimerProjets: false });
  assert.ok(r.echecs.some((e) => e.code === 'REFUSED' && D.memeChemin(e.chemin, cible)));
  assert.ok(existe(path.join(cible, 'garder.txt')));
  effacerRacine(rac);
});

// ───────────────────────── 3. parite avec build/uninstaller.nsh ─────────────────────────
console.log('\n[3] parite des listes avec le desinstalleur NSIS');
const nsh = fs.readFileSync(path.join(RACINE_DEPOT, 'build', 'uninstaller.nsh'), 'utf-8');
const fonction = (nom) => {
  const m = nsh.match(new RegExp('Function \\$\\{UN\\}' + nom + '\\b([\\s\\S]*?)FunctionEnd'));
  assert.ok(m, 'fonction absente : ' + nom);
  return m[1];
};
await cas('sous-dossiers du moteur (MfmSupprimerMoteur)', () => {
  const noms = [...fonction('MfmSupprimerMoteur').matchAll(/MFM_SUPPRIMER_SOUS_DOSSIER "\$\{UN\}" "\$0" "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...noms].sort(), [...D.DOSSIERS_MOTEUR].sort());
});
await cas('projets et config gardes (MfmViderDossierAppli)', () => {
  const noms = [...fonction('MfmViderDossierAppli').matchAll(/\$3 == "([^"]+)"/g)].map((m) => m[1]).filter((n) => n !== '.' && n !== '..');
  assert.deepEqual([...noms].sort(), [...D.DOSSIERS_PROJETS, ...D.FICHIERS_CONFIG].sort());
});
await cas('prefixes de %TEMP% (MfmNettoyerTemp)', () => {
  const motifs = [...fonction('MfmNettoyerTemp').matchAll(/Push "([^"$]+)"/g)].map((m) => m[1].replace(/\*$/, ''));
  assert.deepEqual([...motifs].sort(), [...D.PREFIXES_TEMP].sort());
});
await cas('fichiers du dossier personnel (MfmNettoyerResidusPerso)', () => {
  const corps = fonction('MfmNettoyerResidusPerso');
  for (const r of D.RESIDUS_PERSO) {
    const rel = r.rel.join('\\');
    assert.ok(corps.includes('"$0\\' + rel + '"'), 'residu absent du desinstalleur : ' + rel);
  }
});
await cas('mise a jour : rien n\'est supprime (--updated / /KEEP_APP_DATA)', () => {
  assert.match(nsh, /\$\{If\} \$\{isUpdated\}\s+StrCpy \$MfmMode "maj"/);
  assert.match(nsh, /TestParameter\} \$0 "KEEP_APP_DATA"\s+\$\{If\} \$0 == "true"\s+StrCpy \$MfmMode "maj"/);
  assert.match(fonction('MfmDossierDeplaceValide'), /\\MyFabmesh-data/);
});

// ───────────────────────── 4. banc NSIS (optionnel) ─────────────────────────
if (process.argv.includes('--nsis')) {
  console.log('\n[4] desinstalleur NSIS reel sur le faux arbre');
  const nsisDir = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis', 'nsis-3.0.4.1');
  const makensis = path.join(nsisDir, 'Bin', 'makensis.exe');
  const CLE = 'HKCU\\Software\\MyFabmesh.AI-TestDesinstalleur';
  if (!fs.existsSync(makensis)) {
    console.log('  (makensis introuvable : ' + makensis + ') — banc NSIS saute');
  } else {
    for (const garder of [true, false]) {
      const rac = nouvelleRacine('nsis-' + (garder ? 'garder' : 'tout'));
      const a = construireArbre(rac);
      const exe = path.join(rac, 'test-desinstalleur.exe');
      await cas('desinstalleur NSIS, projets ' + (garder ? 'GARDES' : 'SUPPRIMES'), async () => {
        try { execFileSync('reg', ['delete', CLE, '/f'], { stdio: 'ignore' }); } catch (_) {}
        let i = 0;
        for (const d of a.ctx.dossiersDonnees) {
          execFileSync('reg', ['add', CLE + '\\DataDirs', '/v', 'v' + (i++), '/t', 'REG_SZ', '/d', d, '/f'], { stdio: 'ignore' });
        }
        execFileSync(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', '-WX',
          '-DSORTIE=' + exe, '-DDOSSIER_NSH=' + path.join(RACINE_DEPOT, 'build'),
          '-DCLE_TEST=Software\\MyFabmesh.AI-TestDesinstalleur\\DataDirs',
          path.join(RACINE_DEPOT, 'build', 'test-desinstalleur.nsi')],
        { env: { ...process.env, NSISDIR: nsisDir }, stdio: ['ignore', 'pipe', 'pipe'] });
        // Un .exe tout juste ecrit peut etre retenu quelques instants par l'antivirus (erreur UNKNOWN au
        // lancement) : quelques essais espaces.
        const envHarnais = { ...process.env, MFM_TEST_RACINE: rac, MFM_TEST_GARDER: garder ? '1' : '0' };
        for (let essai = 1; ; essai++) {
          const r = spawnSync(exe, [], { env: envHarnais, stdio: 'ignore', timeout: 120000 });
          if (!r.error) { assert.equal(r.status, 0, 'code de sortie du banc NSIS'); break; }
          if (essai >= 6) throw r.error;
          await new Promise((ok) => setTimeout(ok, 2000));
        }
        const res = fs.readFileSync(path.join(rac, 'resultats-nsis.txt'), 'utf-16le').replace(/^\uFEFF/, '');
        const lignes = Object.fromEntries(res.split(/\r?\n/).filter(Boolean).map((l) => l.split('=')));
        assert.equal(lignes.d1, a.d1);
        assert.equal(lignes.d1slash, a.d1);
        for (const k of ['d2', 'd3', 'racine', 'vide', 'relatif', 'faux']) assert.equal(lignes[k] || '', '', 'valide a tort : ' + k);
        // Le desinstalleur vide TOUT le dossier de l'appli sauf les projets : profil Electron compris.
        verifierApres(a, garder, { profilElectronIntact: false });
        assert.ok(!existe(path.join(a.ctx.userData, 'inconnu.txt')), 'le desinstalleur doit vider le profil');
      });
      try { execFileSync('reg', ['delete', CLE, '/f'], { stdio: 'ignore' }); } catch (_) {}
      effacerRacine(rac);
    }
  }
}

// ───────────────────────── 5. arret des processus (optionnel) ─────────────────────────
// Le script PowerShell du desinstalleur (texte REEL extrait de uninstaller.nsh, $$ -> $) et celui de
// l'appli (SCRIPT_ARRET) doivent arreter un processus lance depuis un faux dossier de donnees, et un
// processus dont la ligne de commande cite nos scripts ; jamais un processus etranger. Les processus de
// test sont des copies de PING.EXE / des PowerShell en attente, dans le faux arbre.
if (process.argv.includes('--processus') && process.platform === 'win32') {
  console.log('\n[5] arret des processus (PowerShell)');
  const { spawn } = await import('node:child_process');
  const m = nsh.match(/nsExec::Exec \/TIMEOUT=\d+ `"\$SYSDIR\\WindowsPowerShell\\v1\.0\\powershell\.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "([^`]+)"`/);
  const scriptNsis = m ? m[1].replace(/\$\$/g, '$') : null;
  const vivant = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
  const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const lancerPs = (script, env) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { env: { ...process.env, ...env }, stdio: 'ignore', timeout: 60000 });
  for (const [nom, script, envSup] of [
    ['script du desinstalleur (uninstaller.nsh)', scriptNsis, {}],
    ['script de l\'appli (SCRIPT_ARRET)', D.SCRIPT_ARRET, { MFM_EXE_APPLI: '', MFM_PID_APPLI: '0' }],
  ]) {
    const rac = nouvelleRacine('processus');
    await cas('arret : ' + nom, async () => {
      assert.ok(script, 'script PowerShell introuvable dans uninstaller.nsh');
      const donnees = path.join(rac, 'AppData', 'Roaming', 'myfabmesh-ai');
      const scripts = path.join(rac, 'Programs', 'myfabmesh-ai', 'resources', 'scripts');
      fs.mkdirSync(path.join(donnees, 'python'), { recursive: true });
      fs.mkdirSync(scripts, { recursive: true });
      const pingCopie = path.join(donnees, 'python', 'python.exe');
      fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'PING.EXE'), pingCopie);
      const lancer = (exe, args) => { const p = spawn(exe, args, { stdio: 'ignore', windowsHide: true }); p.on('error', () => {}); return p; };
      const moteur = lancer(pingCopie, ['-n', '120', '127.0.0.1']);                  // executable dans nos donnees
      const script_ = lancer('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 120 # ' + path.join(scripts, 'sdxl_server.py')]);
      const temoin = lancer(path.join(process.env.SystemRoot, 'System32', 'PING.EXE'), ['-n', '120', '127.0.0.1']);
      try {
        await attendre(1500);
        assert.ok(vivant(moteur.pid) && vivant(script_.pid) && vivant(temoin.pid), 'processus de test non demarres');
        // « C:\zq » (trop court) doit etre ignore par le script ; jamais de vraie racine ici, par prudence.
        lancerPs(script, { MFM_DOSSIERS: 'C:\\zq|' + donnees, MFM_SCRIPTS: scripts, ...envSup });
        await attendre(1000);
        assert.ok(!vivant(moteur.pid), 'le processus lance depuis le dossier de donnees tourne encore');
        assert.ok(!vivant(script_.pid), 'le processus qui execute un de nos scripts tourne encore');
        assert.ok(vivant(temoin.pid), 'un processus ETRANGER a ete arrete');
        if (script === D.SCRIPT_ARRET) {                                                // exclusion de l'appli elle-meme
          const appli = lancer(pingCopie, ['-n', '120', '127.0.0.1']);
          await attendre(1500);
          lancerPs(script, { MFM_DOSSIERS: donnees, MFM_SCRIPTS: scripts, MFM_EXE_APPLI: pingCopie, MFM_PID_APPLI: '0' });
          await attendre(1000);
          const encore = vivant(appli.pid);
          try { process.kill(appli.pid); } catch (_) {}
          assert.ok(encore, 'l\'executable de l\'appli ne doit jamais etre arrete');
        }
      } finally {
        for (const p of [moteur, script_, temoin]) { try { process.kill(p.pid); } catch (_) {} }
        await attendre(500);
      }
    });
    effacerRacine(rac);
  }
}

console.log('\n' + reussis + ' cas reussis, ' + echecs.length + ' en echec');
if (echecs.length) { console.log('ECHECS : ' + echecs.join(' ; ')); process.exit(1); }
