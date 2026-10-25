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
  // composeurActif / nettoyerVirgules : la queue de stripKnownPromptSuffixes (negations de l'utilisateur, fusionnees le 20/10)
  return new Function('retirerClauseFinale', 'composeurActif', 'nettoyerVirgules', prelude + morceaux.join('\n') + '\nreturn stripKnownPromptSuffixes;')(
    COMPO.retirerClauseFinale, COMPO.actif, COMPO.nettoyerVirgules);
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

/* TROISIEME RELECTURE DU LOT 2 (2026-10-14, B4 bis) : le correctif de la seconde revue coupait a un marqueur (« full body », « isolated »,
 * « flat icon »...) suivi de propositions « de gabarit » prises une a une (« back view », « wide shot », « both wings visible »...), et la
 * passe des jetons retirait « side view », « full body », « photorealistic »... partout : le texte que l'utilisateur tapait apres « full
 * body » ou « isolated » disparaissait au clic Generate (facture). Desormais seul un gabarit EXACT connu est retire.
 * Textes : relecture (strip_r3 PAR_DEFAUT, sceptique_r3 CADRAGES) et mots que les anciens nettoyages prenaient pour du gabarit. */
const COMPLET = JSON.parse(readFileSync(join(ICI, 'gabarits-historiques-releve-complet.json'), 'utf-8'));
const TEXTES_UTILISATEUR = [
  'a red dragon, full body, both wings visible', 'a griffin, full body, both wings visible, tail extending behind',
  'a female elf ranger, full body, back view', 'a knight in silver armor, full body, seen from behind', 'a samurai, full body, in profile',
  'a war horse, full body, side angle', 'a giant troll, full body, wide shot', 'a lighthouse on a cliff, isolated, long shot',
  'a sports car, isolated, wide shot', 'a robot, isolated, back view', 'a beetle, isolated, hard exoskeleton, six legs',
  'a stag beetle, full body, segmented body, six legs', 'a wolf, full body, all four feet on the ground',
  'a crocodile, full body, belly close to ground', 'a medieval castle, isolated, nothing cropped', 'a shark, full body, tail fin visible',
  'a sword icon, flat icon, app icon', 'a cyclops, full body, distant camera', 'a mage, full body, long shot, seen from behind',
  'a viking ship, isolated, single vessel', 'a red dragon, full body, breathing fire', 'a knight, isolated, holding a lantern',
  'a red car, side view', 'a knight, front view, holding a torch', 'a samurai, side profile, katana drawn', 'a dragon, photorealistic',
  'a cute fox, centered', 'a castle on a hill, isolated, at sunset', 'a tree, symmetric branches', 'a dwarf, three-quarter view, braided beard',
  'a spaceship, isometric view, glowing engines', 'a cat, 3/4 view, sitting', 'a wizard, realistic style, purple robes',
  'an old house, sharp details, broken windows', 'a sword, detailed materials, gold hilt', 'a soldier, legs apart, holding a rifle',
  'a goblin, neutral stance, green skin', 'a temple, plain white background, stone columns', 'a lamp, clean silhouette, art deco',
  'an orc, T-pose, war paint', 'a bus, complete vehicle, yellow', 'a bird, both wings visible, blue feathers',
  'a snake, full body, gentle S-curve, green scales', 'a knight, full body, isolated, red cape', 'a red car, isolated, complete vehicle, wide shot',
  'a hero, single isolated 3D character, blue armor', 'a giant, long shot, distant camera', 'a cat, isolated, full item, plush toy',
  'a sword, side profile, isolated', 'an icon of a shield, flat app icon, blue', 'a boat, 3/4 isometric view, red sails',
];

for (const [nom, chemin] of Object.entries(FICHIERS)) {
  const strip = charger(chemin);

  test(nom + ' : troisieme relecture (B4 bis) : un texte d utilisateur n est JAMAIS modifie, meme avec des mots de gabarit (cadrage apres « full body », « isolated »...)', () => {
    const modifies = TEXTES_UTILISATEUR.filter((t) => strip(t) !== t).map((t) => `${t} -> ${strip(t)}`);
    assert.deepEqual(modifies, []);
  });

  test(nom + ' : troisieme relecture : texte d utilisateur + gabarit historique (type, style, prefixe) -> EXACTEMENT le texte de l utilisateur', () => {
    const fautes = [];
    let total = 0;
    const styles = [COMPLET.styles[0], COMPLET.styles[11], COMPLET.styles[30], COMPLET.styles[44]].filter(Boolean);
    for (const u of TEXTES_UTILISATEUR) {
      for (const t of [...COMPLET.types, ...COMPLET.ancienneInterface]) {
        for (const v of [u + ', ' + t, ...styles.map((s) => s + ', ' + u + ', ' + t), COMPLET.prefixes[0] + ', ' + u + ', ' + t]) {
          total++;
          const r = strip(v);
          if (r !== u && fautes.length < 5) fautes.push(`${v.slice(0, 100)}... -> ${r.slice(0, 100)}`);
        }
      }
    }
    assert.ok(total > 20000, 'prompts essayes : ' + total);
    assert.deepEqual(fautes, []);
  });

  test(nom + ' : troisieme relecture : TOUS les gabarits de l historique git (releve exhaustif, toutes branches, ancienne interface) sont nettoyes', () => {
    const restes = [];
    let total = 0;
    for (const u of UTILISATEURS) {
      for (const t of [...COMPLET.types, ...COMPLET.ancienneInterface]) {
        for (const v of [u + ', ' + t, ...COMPLET.styles.map((s) => s + ', ' + u + ', ' + t), ...COMPLET.prefixes.map((p) => p + ', ' + u + ', ' + t)]) {
          total++;
          if (strip(v).trim() !== u) restes.push(`${v.slice(0, 80)}... -> ${strip(v).slice(0, 80)}`);
        }
      }
    }
    assert.equal(total, 6 * (COMPLET.types.length + COMPLET.ancienneInterface.length) * (1 + COMPLET.styles.length + COMPLET.prefixes.length));
    assert.deepEqual(restes.slice(0, 5), [], restes.length + ' prompts gardent un gabarit');
  });

  test(nom + ' : troisieme relecture : ancien gabarit recolle plusieurs fois, ou suivi d un ajout de l utilisateur : seul le gabarit part', () => {
    const t = COMPLET.types.find((x) => x.startsWith('single isolated 3D character, full body, T-pose neutral stance'));
    const s = COMPLET.styles.find((x) => x.startsWith('realistic style'));
    assert.ok(t && s);
    assert.equal(strip(`${s}, ${s}, an orc warrior, ${t}, ${t}`), 'an orc warrior');
    assert.equal(strip(`${s}, an orc warrior, ${t}, with a red banner, ${t}`), 'an orc warrior, with a red banner');
    // un gabarit MODIFIE a la main n'est plus reconnu : il reste ENTIER (rien n'est detruit), Generate recolle le gabarit courant.
    // Depuis les negations de l'utilisateur (fusionnees le 20/10), les segments « no ... » ne sont plus retires non plus : ils sont a l'utilisateur,
    // et partent au negatif a la generation (interrupteur d'urgence coupe : ancien comportement, teste par composeur-prompt.test.mjs).
    const modifie = t.split(', ').filter((p) => p !== 'centered').join(', ');
    assert.equal(strip('an orc warrior, ' + modifie), 'an orc warrior, ' + modifie);
  });
}
