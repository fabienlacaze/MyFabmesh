// NETTOYAGE DES PROMPTS D'ANCIENS PROJETS (2026-10-14, revue du lot 2 de l'audit de la langue, bloquant B4) — VRAIE fonction
// stripKnownPromptSuffixes des deux index2.js (bureau et web), extraite avec acorn, sur les gabarits HISTORIQUES releves dans git
// (gabarits-historiques-nettoyage.json : 83 gabarits de type, 32 styles, 3 prefixes).
//   Le lot 2 a exige qu'un marqueur de gabarit soit une PROPOSITION ENTIERE (MANQUE-03 : « a complete boat with white sails » devenait
//   « a »). Mais les ouvertures historiques « ONE complete boat only », « ONE complete passenger aircraft only » et « single flat icon,
//   app icon » ne sont pas des propositions egales au marqueur : 648 prompts d'anciens projets gardaient TOUT leur ancien gabarit, et
//   Generate y recollait le gabarit courant.
//   Attendu : aucun ancien gabarit ne reste entier (ses deux premieres propositions disparaissent), les trois formes ci-dessus sont
//   nettoyees jusqu'au texte de l'utilisateur, et le texte d'un utilisateur qui contient un marqueur reste intact.
// Lancer : node --test tests/bureau-interface/nettoyage-gabarits-historiques.test.mjs
// Ancien code : BUREAU_INDEX2=<copie> WEB_INDEX2=<copie> node --test tests/bureau-interface/nettoyage-gabarits-historiques.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..', '..');
const acorn = createRequire(join(RACINE, 'cloud', 'tests', 'x.js'))('acorn');
const FICHIERS = {
  bureau: process.env.BUREAU_INDEX2 || join(RACINE, 'src/renderer/index2.js'),
  web: process.env.WEB_INDEX2 || join(RACINE, 'cloud/public/app/index2.js'),
};
const H = JSON.parse(readFileSync(join(ICI, 'gabarits-historiques-nettoyage.json'), 'utf-8'));

const dossier = mkdtempSync(join(tmpdir(), 'nettoyage-gabarits-'));
let COMPO;
try {
  const c = join(dossier, 'composeur-intention.mjs');
  writeFileSync(c, readFileSync(join(RACINE, 'src/renderer/lib/composeur-intention.js'), 'utf-8'));
  COMPO = await import(pathToFileURL(c).href);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

const NOMS = ['stripKnownPromptSuffixes', 'ASSET_TYPE_PROMPTS', 'ASSET_STYLE_PROMPTS', 'ASSET_TYPE_PREFIXES', 'ASSET_TYPE_PREFIXES_ANCIENS'];
function charger(chemin) {
  const src = readFileSync(chemin, 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [];
  const vus = new Set();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && NOMS.includes(nom) && !vus.has(nom)) { vus.add(nom); morceaux.push(src.slice(n.start, n.end)); }
  }
  for (const n of NOMS) if (!vus.has(n) && n !== 'ASSET_TYPE_PREFIXES_ANCIENS') throw new Error(chemin + ' : ' + n + ' introuvable');
  const prelude = vus.has('ASSET_TYPE_PREFIXES_ANCIENS') ? '' : 'const ASSET_TYPE_PREFIXES_ANCIENS = [];\n';
  // eslint-disable-next-line no-new-func
  return new Function('retirerClauseFinale', prelude + morceaux.join('\n') + '\nreturn stripKnownPromptSuffixes;')(COMPO.retirerClauseFinale);
}

const UTILISATEURS = ['a red dragon', 'medieval townhall', 'an orc warrior', 'wooden barrel', 'sports car', 'a stone golem'];
const ouverture = (gabarit) => gabarit.split(',').slice(0, 2).join(',').trim();

for (const [nom, chemin] of Object.entries(FICHIERS)) {
  const strip = charger(chemin);

  test(nom + ' : un ancien gabarit ne reste JAMAIS entier dans le champ (17 928 prompts d anciens projets)', () => {
    let total = 0;
    const gardes = [];
    for (const u of UTILISATEURS) {
      for (const t of H.types) {
        const variantes = [u + ', ' + t, ...H.styles.map((s) => s + ', ' + u + ', ' + t), ...H.prefixes.map((p) => p + ', ' + u + ', ' + t)];
        for (const v of variantes) {
          total++;
          const r = strip(v);
          if (r.includes(ouverture(t))) gardes.push(`${v.slice(0, 90)}... -> ${r.slice(0, 90)}...`);
        }
      }
    }
    assert.equal(total, 17928);
    assert.deepEqual(gardes.slice(0, 5), [], gardes.length + ' prompts gardent leur ancien gabarit entier');
  });

  test(nom + ' : les ouvertures historiques « ONE ... only » et « single flat icon » sont nettoyees jusqu au texte de l utilisateur', () => {
    const anciens = H.types.filter((t) => /^(?:ONE complete (?:boat|passenger aircraft) only|single flat icon, app icon),/.test(t));
    assert.equal(anciens.length, 3, 'gabarits historiques concernes');
    for (const t of anciens) {
      for (const u of UTILISATEURS) assert.equal(strip(u + ', ' + t), u, t.slice(0, 60));
    }
  });

  test(nom + ' : le texte de l utilisateur qui CONTIENT un marqueur reste intact (MANQUE-03, pas de retour en arriere)', () => {
    for (const u of ['a complete boat with white sails', 'one complete boat only with red sails', 'single flat icon of a sword',
      'a complete passenger aircraft with open doors']) {
      assert.equal(strip(u), u);
    }
  });

  /* SECONDE REVUE DU LOT 2 (2026-10-14, B4) : les marqueurs ajoutes par 51af1bcb coupaient « jusqu a la fin » ; un texte d utilisateur
   * qui CONTENAIT un marqueur SUIVI d autre chose perdait la suite, juste avant Generate (facture). Une coupe exige desormais une queue
   * faite UNIQUEMENT de gabarit. */
  const HOSTILES = [
    'a husky, full body shot from head to tail, running in the snow',
    'a red fox, full body shot from nose to tail, jumping over a log',
    'wildlife photography of ONE animal only, a snow leopard on a rock',
    'a lone wolf, ONE animal only, howling at the moon',
    'a castle, ONE structure only, with a moat and a drawbridge',
    'ONE complete boat only, with red sails and a golden figurehead',
    'a cartoon rocket, single flat icon, app icon, with a smiling face',
    'a tiger, full body shot from head to tail',
    'a knight, isolated 3D character, holding a sword',
    'a dragon, full body creature, with red scales',
    'a pirate ship, complete boat, with black sails',
    'a lighthouse, architectural building exterior, on a cliff',
    'a frog, ONE animal only, single creature, sitting on a leaf',
    'a beetle, hard exoskeleton, antennae, six legs',
    'a robot, ONE vehicle only, steampunk, glossy',
  ];
  test(nom + ' : un marqueur SUIVI du texte de l utilisateur (ou seul en fin de texte) ne coupe rien (revue du 14/10, B4)', () => {
    const perdus = HOSTILES.filter((t) => strip(t) !== t).map((t) => `${t} -> ${strip(t)}`);
    assert.deepEqual(perdus, []);
  });

  test(nom + ' : chaque prompt d ancien projet est nettoye JUSQU AU texte de l utilisateur (17 928 sur 17 928 ; HEAD : 17 496 bureau, 16 848 site)', () => {
    const restes = [];
    for (const u of UTILISATEURS) {
      for (const t of H.types) {
        for (const v of [u + ', ' + t, ...H.styles.map((s) => s + ', ' + u + ', ' + t), ...H.prefixes.map((p) => p + ', ' + u + ', ' + t)]) {
          const r = strip(v).trim();
          if (r !== u) restes.push(`${v.slice(0, 80)}... -> ${r.slice(0, 80)}`);
        }
      }
    }
    assert.deepEqual(restes.slice(0, 5), [], restes.length + ' prompts ne reviennent pas au texte de l utilisateur');
  });

  test(nom + ' : un ancien gabarit SUIVI d un ajout de l utilisateur n est pas coupe (le texte ajoute reste)', () => {
    const t = H.types.find((x) => x.startsWith('ONE complete boat only,'));
    const r = strip('a pirate ship, ' + t + ', with a red flag');
    assert.ok(r.endsWith('with a red flag'), r.slice(-80));
    assert.ok(r.startsWith('a pirate ship'), r.slice(0, 80));
  });
}

test('parite : le nettoyage donne EXACTEMENT le meme texte sur le bureau et sur le site (« a castle, ONE structure only, with a moat » : « a castle » sur le site, « a castle, with a moat » sur le bureau)', () => {
  const bureau = charger(FICHIERS.bureau), web = charger(FICHIERS.web);
  const ecarts = [];
  const textes = ['a castle, ONE structure only, with a moat and a drawbridge', 'a frog, single creature, on a leaf',
    'a crate, complete object, wooden', 'a truck, ONE vehicle only, red'];
  for (const u of UTILISATEURS) for (const t of H.types) textes.push(u + ', ' + t);
  for (const t of textes) if (bureau(t) !== web(t)) ecarts.push(`${t.slice(0, 80)} : bureau ${JSON.stringify(bureau(t).slice(0, 60))} / site ${JSON.stringify(web(t).slice(0, 60))}`);
  assert.deepEqual(ecarts.slice(0, 5), [], ecarts.length + ' ecarts');
});
