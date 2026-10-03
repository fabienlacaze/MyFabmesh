// Voie « web-reste » (vague 5, 2026-10-03) : MP-03 / M3 (badge « genere par IA »), ADM-03 (bouton de revocation des sessions
// admin), D-08 (nom du projet masque dans les rapports d'erreur, textes de confidentialite), F2 (texte integral de la
// licence DINOv3, lien vers /legal/licenses). Aucun reseau, aucun navigateur : sources lues, console-capture.js executee
// dans un bac a sable (vm).
// Lancer : cd cloud && node --test tests/web-reste.test.mjs
// Prouver qu'un test echoue sur l'ancien code : WEB_RESTE_RACINE=<dossier> vise une copie de l'arbre
// (<dossier>/cloud/..., <dossier>/THIRD_PARTY_LICENSES.txt), p. ex. obtenue par `git show HEAD:<chemin>`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const RACINE = process.env.WEB_RESTE_RACINE || new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const lire = (p) => readFileSync(RACINE.replace(/[\\/]$/, '') + '/' + p, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- C-1 : badge IA (MP-03, M3)
test('place de marche : badge « Genere par IA » / « AI-generated » sur chaque carte et sur la fiche', () => {
  const m = lire('cloud/src/app/market/page.tsx');
  assert.match(m, /function BadgeIA\b/, 'composant BadgeIA absent');
  assert.match(m, /<T fr="Généré par IA" en="AI-generated" \/>/, 'les deux langues doivent etre portees par <T> (mecanisme de langue du site)');
  assert.match(m, /import \{ T \} from '@\/lib\/langue'/);
  // une occurrence dans la carte (grille) ET une dans la fiche detaillee (modale)
  assert.ok((m.match(/<BadgeIA\b/g) || []).length >= 2, 'badge attendu sur la carte ET la fiche detaillee');
  const iCarte = m.indexOf('data-listing-card');
  const iFiche = m.indexOf('{/* Detail modal */}');
  assert.ok(iCarte > 0 && iFiche > iCarte);
  assert.ok(m.slice(iCarte, iFiche).includes('<BadgeIA'), 'badge absent de la carte');
  assert.ok(m.slice(iFiche).includes('<BadgeIA'), 'badge absent de la fiche detaillee');
  // le badge ne depend PAS du champ ai_generated du worker
  assert.ok(!/\.ai_generated/.test(m), 'le badge ne doit pas lire le champ ai_generated');
  });

test('profil d\'auteur : les cartes portent aussi le badge IA', () => {
  const a = lire('cloud/src/app/market/author/page.tsx');
  assert.match(a, /<T fr="Généré par IA" en="AI-generated" \/>/);
  assert.match(a, /<BadgeIA\b/);
  assert.ok(!/\.ai_generated/.test(a), 'le badge ne depend pas du champ');
});

// ---------------------------------------------------------------- C-2 : /admin2, revocation des sessions admin (ADM-03)
test('/admin2 : bouton « Deconnecter toutes les sessions admin » cable sur POST /api/admin/revoke-sessions', () => {
  const h = lire('cloud/public/admin2.html');
  assert.match(h, /id="b-rev"/, 'bouton b-rev absent');
  assert.match(h, /Déconnecter toutes les sessions admin/);
  assert.match(h, /id="rev-mdp"[^>]*type="password"|type="password" id="rev-mdp"/, 'champ mot de passe de confirmation');
  // meme gestion que « force logout all » : mdp:true (un 401 « invalid » reste affichable), corps { password }
  const ligne = h.split('\n').find((l) => l.includes("t.closest('#b-rev-ok')"));
  assert.ok(ligne, 'gestionnaire du clic de confirmation absent');
  assert.match(ligne, /http\('\/api\/admin\/revoke-sessions', \{ method: 'POST', mdp: true, body: \{ password: rpw \} \}/);
  assert.match(ligne, /Mot de passe requis\./);
  assert.match(ligne, /Mot de passe incorrect\./);
  assert.match(ligne, /✓ Sessions admin révoquées/);
  // ouverture / annulation de la confirmation
  assert.match(h, /t\.closest\('#b-rev'\)\) \{ S\.revOuvert = true/);
  assert.match(h, /t\.closest\('#b-rev-non'\)\) \{ S\.revOuvert = false/);
  // etat remis a zero a la fermeture de la section
  assert.match(h, /function viderSecurite\(\) \{[^\n]*S\.revOuvert = false/);
  // le bouton existant n'est pas touche
  assert.match(h, /http\('\/api\/admin\/force-logout-all', \{ method: 'POST', mdp: true, body: \{ password: pw \} \}/);
  // la route appelee existe dans le worker
  const w = lire('cloud/src/worker.ts');
  assert.match(w, /pathname === '\/api\/admin\/revoke-sessions' && method === 'POST'/);
});

// ---------------------------------------------------------------- C-3a : nom du projet masque (D-08)
// pousse des lignes dans le tampon : console-capture enveloppe console.log du bac a sable
function journaliser(sandbox, lignes) { for (const l of lignes) sandbox.console.log(l); }

function chargerCapture(nomProjet = 'Mon Chateau Secret') {
  const envois = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    localStorage: { getItem: () => null, setItem() {} },   // pas d'opt-in complet ; rapports d'erreur autorises par defaut
    navigator: { userAgent: 'UA-test' },
    location: { href: 'https://exemple.test/app/' },
    fetch: async (url, opts) => { envois.push({ url, corps: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ path: 'x' }) }; },
    Blob: class {}, URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
    addEventListener() {}, setTimeout, state: { currentProject: { name: nomProjet } },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(lire('cloud/public/app/console-capture.js'), sandbox, { filename: 'console-capture.js' });
  return { cc: sandbox.__consoleCapture, envois, sandbox };
}

test('rapport d\'erreur : le nom du projet n\'est plus envoye, un identifiant court et stable le remplace', async () => {
  const { cc, envois, sandbox } = chargerCapture();
  const nom = 'Mon Chateau Secret';
  cc.clear();
  journaliser(sandbox, [
    'step start project=' + nom,
    'saving ' + nom.toLowerCase() + ' to disk',
    'HTTP 500 on /api/mesh',
    'prompt: un dragon bleu',
  ]);
  const r1 = await cc.flush({ kind: 'mesh', status: 'error', project: nom });
  assert.equal(r1.ok, true);
  const p = envois[0].corps;
  assert.equal(p.mode, 'erreur');
  const json = JSON.stringify(p);
  assert.ok(!/chateau/i.test(json), 'le nom du projet est parti en clair : ' + json);
  assert.match(p.project, /^projet-[0-9a-f]{8}$/, 'identifiant court attendu, recu : ' + p.project);
  assert.ok(p.lines.some((l) => l.includes(p.project)), 'les lignes gardent un identifiant exploitable');
  assert.ok(p.lines.some((l) => l.includes('HTTP 500 on /api/mesh')), 'le diagnostic reste lisible');
  assert.ok(!json.includes('dragon bleu'), 'les prompts restent masques (comportement existant)');
  // stable : le meme nom donne le meme identifiant, un autre nom un autre
  await cc.flush({ kind: 'mesh', status: 'error', project: nom });
  assert.equal(envois[1].corps.project, p.project);
  await cc.flush({ kind: 'mesh', status: 'error', project: 'Autre projet' });
  assert.notEqual(envois[2].corps.project, p.project);
});

test('rapport d\'erreur : nom pris dans l\'etat de l\'appli quand meta.project est absent', async () => {
  const { cc, envois, sandbox } = chargerCapture();
  cc.clear();
  journaliser(sandbox, ['ouverture de Mon Chateau Secret']);
  await cc.flush({ kind: 'rig', status: 'failed' });
  const json = JSON.stringify(envois[0].corps);
  assert.ok(!/chateau/i.test(json), json);
  assert.match(envois[0].corps.project, /^projet-[0-9a-f]{8}$/);
});

test('rapport d\'erreur : majuscules, slug et URL encodee du nom sont masques aussi (relecture C-3a)', async () => {
  const { cc, envois, sandbox } = chargerCapture();
  const nom = 'Mon Chateau Secret';
  cc.clear();
  journaliser(sandbox, [
    'MON CHATEAU SECRET charge',
    'fichier mon_chateau_secret.glb ecrit',
    'GET /meshes/Mon%20Chateau%20Secret/a.glb 404',
    'export Mon-Chateau-Secret_v2.glb',
    'Mon Chateau Secret, Mon Chateau Secret',
    'HTTP 500 on /api/mesh',
  ]);
  await cc.flush({ kind: 'mesh', status: 'error', project: nom });
  const p = envois[0].corps;
  const json = JSON.stringify(p);
  assert.ok(!/chateau/i.test(json), 'une variante du nom est restee en clair : ' + json);
  assert.ok(!/projet-[0-9a-f]{8}-[0-9a-f]{8}/.test(json), 'identifiant double : ' + json);
  assert.ok(p.lines.some((l) => l.includes('HTTP 500 on /api/mesh')), 'le diagnostic reste lisible');
  assert.ok(p.lines.filter((l) => l.includes(p.project)).length >= 5, 'chaque variante est remplacee par le meme identifiant');
});

test('rapport d\'erreur : un projet nomme « Projet » ne produit pas d\'identifiant double', async () => {
  const { cc, envois, sandbox } = chargerCapture('Projet');
  cc.clear();
  journaliser(sandbox, ['ouverture de Projet', 'projet ferme', 'PROJET: ok']);
  await cc.flush({ kind: 'mesh', status: 'error', project: 'Projet' });
  const p = envois[0].corps;
  const json = JSON.stringify(p);
  assert.ok(!/projet-[0-9a-f]{8}-[0-9a-f]{8}/.test(json), 'identifiant double : ' + json);
  assert.equal(json.split(p.project).join('').match(/projet/gi), null, 'le mot projet est reste en clair hors identifiant : ' + json);
});

test('rapport d\'erreur : le nom ne masque pas l\'interieur d\'un autre mot', async () => {
  const { cc, envois, sandbox } = chargerCapture('Bus');
  cc.clear();
  journaliser(sandbox, ['abus de langage', 'Bus charge', 'bus_1727.glb']);
  await cc.flush({ kind: 'mesh', status: 'error', project: 'Bus' });
  const lignes = envois[0].corps.lines;
  assert.ok(lignes.some((l) => l.includes('abus de langage')), 'abus ne doit pas etre touche');
  assert.ok(lignes.every((l) => !/(^|[^a-z0-9])bus([^a-z0-9]|$)/i.test(l.replace(/\[[^\]]*\]/g, ''))), 'le mot bus entier est masque : ' + JSON.stringify(lignes));
});

test('publication web : une fiche payante en CC-BY est refusee AVANT l\'appel serveur, avec un message lisible (MP-11)', () => {
  const o = lire('cloud/public/app/cloud-overrides.js');
  const i = o.indexOf("const licence     = document.getElementById('pub-licence')");
  assert.ok(i > 0, 'lecture de la licence du formulaire');
  const bloc = o.slice(i, i + 2500);
  assert.match(bloc, /if \(priceUSD > 0 && licence !== 'personal' && licence !== 'commercial'\) \{\s*notify\('A paid listing must use the/);
  // le pre-controle vient avant le verrouillage du bouton et l'appel reseau
  assert.ok(bloc.indexOf('A paid listing must use') < bloc.indexOf('go.disabled = true'));
  // le serveur applique la meme regle
  assert.match(lire('cloud/src/worker.ts'), /function validerLicencePourPrix/);
});

// ---------------------------------------------------------------- C-3b : textes de confidentialite (D-08)
test('confidentialite FR / EN : contact et signalements = 12 mois, IP TRONQUEE (/24, /48), empreinte hachee', () => {
  const fr = lire('cloud/src/app/legal/privacy/PrivacyFr.tsx');
  const en = lire('cloud/src/app/legal/privacy/PrivacyEn.tsx');
  assert.match(fr, /adresse IP\s*<strong> tronquée<\/strong> \(IPv4&nbsp;: \/24&nbsp;; IPv6&nbsp;: \/48\)/);
  assert.match(fr, /empreinte hachée/);
  assert.match(fr, /Conservés 12 mois, puis supprimés/);
  assert.match(fr, /e-mail, adresse IP tronquée, contenu et pièces jointes\)&nbsp;: 12 mois/);
  assert.match(en, /truncated<\/strong> IP address \(IPv4: \/24; IPv6: \/48\)/);
  assert.match(en, /hashed fingerprint/);
  assert.match(en, /for 12 months, then deleted/);
  assert.match(en, /e-mail, truncated IP address, content and attachments\): 12 months/);
  // la date de mise a jour reste la meme dans les deux langues
  assert.match(fr, /Dernière mise à jour&nbsp;: 2026-10-03/);
  assert.match(en, /Last updated: 2026-10-03/);
  // l'ancienne formulation (IP complete) a disparu de ces deux phrases
  assert.ok(!/le nom que vous indiquez, votre adresse IP et le/.test(fr));
  assert.ok(!/the name you give, your IP address/.test(en));
});

// ---------------------------------------------------------------- C-4 : licence DINOv3 (F2)
test('THIRD_PARTY_LICENSES.txt : section DINOv3 delimitee, texte integral, URL source et date de consultation', () => {
  const t = lire('THIRD_PARTY_LICENSES.txt');
  assert.match(t, /ANNEX A -- Full text of the DINOv3 License/);
  for (const n of ['1 of 2', '2 of 2']) {
    assert.ok(t.includes('BEGIN DINOv3 LICENSE TEXT ' + n), 'debut ' + n);
    assert.ok(t.includes('END DINOv3 LICENSE TEXT ' + n), 'fin ' + n);
  }
  assert.ok(t.includes('Source:   https://ai.meta.com/resources/models-and-libraries/dinov3-license/'));
  assert.ok(t.includes('https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md'));
  assert.equal((t.match(/Consulted: 2026-10-03/g) || []).length, 2);
  // le texte integral : debut, clauses cles et fin des deux versions
  const debut = t.indexOf('BEGIN DINOv3 LICENSE TEXT 1 of 2');
  const fin = t.indexOf('END DINOv3 LICENSE TEXT 2 of 2');
  const corps = t.slice(debut, fin);
  for (const phrase of [
    'means the terms and conditions for use, reproduction, distribution and modification of the DINO Materials set forth herein',
    'prominently display “Built with DINOv3”',
    'provide a copy of this Agreement with any such DINO Materials',
    'Last Updated: August 19, 2025',
    '## 1. License Rights and Redistribution.',
    'Governing Law and Jurisdiction',
    'The courts of California shall have exclusive jurisdiction',
    'Modifications and Amendments',
    'signed by an authorized representative of both you and Meta.',
  ]) assert.ok(corps.includes(phrase), 'phrase absente : ' + phrase);
  assert.ok(corps.length > 14000, 'texte trop court pour deux licences completes : ' + corps.length);
  // l'ambiguite entre les deux textes est dite, pas devinee
  assert.match(t, /TWO TEXTS EXIST, AND THEY DIFFER/);
});

test('client web : lien vers la page des licences (/legal/licenses), traduit', () => {
  const h = lire('cloud/public/app/index.html');
  assert.match(h, /<a href="\/legal\/licenses" id="about-link-licenses">Licenses<\/a>/);
  assert.match(lire('cloud/public/app/i18n.js'), /'Licenses': 'Licences'/);
  // pas de nom de moteur en vedette dans le libelle
  const lib = h.match(/id="about-link-licenses">([^<]*)</)[1];
  assert.ok(!/dino|trellis|meta/i.test(lib), lib);
});
