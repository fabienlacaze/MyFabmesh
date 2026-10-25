// Banc NAVIGATEUR du BUREAU : case « Game-engine relief (normal map) » -> arguments reellement recus par meshyAPI.imageTo3D (2026-10-18).
// Page reelle (src/renderer), vrai Chromium sans tete, faux meshyAPI qui enregistre les appels (voir preparer-bureau.mjs). Aucun reseau externe.
//   node build/bancs/navigateur/preparer-bureau.mjs C:/tmp/banc_bureau
//   node build/bancs/navigateur/serveur-statique.mjs C:/tmp/banc_bureau 8771 index2.html          (en arriere-plan)
//   node ~/.claude/skills/browser-automation/browser.mjs http://127.0.0.1:8771/index2.html --script build/bancs/navigateur/scenario-bureau-option-normales.mjs
// Le resultat imprime { verdict: { ok, echecs: [...] }, ... } : ok doit valoir true. Port : variable BANC_PORT (8771 par defaut).
// PIEGES MESURES : Playwright check() expire dans ce workspace (la SECTION defile elle-meme : cliquer aux coordonnees mesurees apres scrollIntoView) ;
// la fenetre « tache en cours » recouvre la page apres un lancement (la reduire par son bouton) ; page.evaluate tourne dans un monde isole
// (injecter un <script> qui ecrit le resultat dans un attribut du DOM).
const PORT = process.env.BANC_PORT || '8771';

async function main(page, code) {
  const id = 'r' + Math.random().toString(36).slice(2);
  await page.addScriptTag({ content: `(async () => { let out; try { out = await (async () => { ${code} })(); } catch (e) { out = { error: String(e && e.stack || e) }; } document.documentElement.setAttribute('data-${id}', JSON.stringify(out === undefined ? null : out)); })();` });
  await page.waitForFunction((a) => document.documentElement.hasAttribute(a), 'data-' + id, { timeout: 20000 });
  const v = await page.evaluate((a) => document.documentElement.getAttribute(a), 'data-' + id);
  return JSON.parse(v);
}

/** Clique « Generate 3D » comme l'utilisateur, attend l'appel a imageTo3D, ferme les fenetres, rend les arguments recus. */
async function generer(page) {
  const avant = await main(page, `return window.__mock.imageTo3D.length;`);
  await main(page, `document.getElementById('ws-generate-mesh').disabled = false; return true;`);
  await page.locator('#ws-generate-mesh').click({ force: true });
  await page.waitForFunction((n) => window.__mock && window.__mock.imageTo3D.length > n, avant, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2200);
  return main(page, `const a = window.__mock.imageTo3D; const d = a[a.length - 1];
    const m = document.getElementById('modal-confirm'); const echec = m && !m.classList.contains('hidden');
    if (echec) { document.getElementById('confirm-ok').click(); await new Promise(r => setTimeout(r, 500)); }
    const jd = document.getElementById('modal-job-details');
    if (jd && !jd.classList.contains('hidden')) { document.getElementById('job-details-close-x').click(); await new Promise(r => setTimeout(r, 500)); }
    const j = (window.state.jobs || []).filter(x => /Generate 3D/.test(x.name || '')).pop();
    return { appels: a.length, nouveau: a.length > ${avant}, trellis2NormalMap: d && d.trellis2NormalMap, type: typeof (d && d.trellis2NormalMap),
             engine: d && d.engine, options: j && j.params && j.params.Options };`);
}

export default async function run(page) {
  const out = {};
  const echecs = [];
  try { return await corps(page, out, echecs); } catch (e) { echecs.push('exception du banc : ' + String((e && e.message) || e).slice(0, 160)); out.verdict = { ok: false, echecs }; return out; }
}

async function corps(page, out, echecs) {
  const attendre = (nom, cond) => { if (!cond) echecs.push(nom); };
  await page.route('**/*', (route) => route.request().url().startsWith('http://127.0.0.1:' + PORT + '/') ? route.continue() : route.abort());
  await page.reload();
  await page.waitForTimeout(3500);
  out.ouverture = await main(page, `
    const ok = await window.openProjectByName('orc');
    await new Promise(r => setTimeout(r, 1500));
    const be = document.getElementById('fab-boot-error');
    return { ok, projet: window.state.currentProject && window.state.currentProject.name, bootError: be ? be.innerText.slice(0, 600) : null };`);
  attendre('le projet de test s ouvre', out.ouverture.ok === true && out.ouverture.projet === 'orc' && !out.ouverture.bootError);
  out.panneau = await main(page, `
    const carte = document.getElementById('step-card-mesh'); if (carte) carte.classList.remove('collapsed', 'disabled');
    const det = document.getElementById('ws-3d-trellis2-opts'); if (det) det.open = true;
    const cb = document.getElementById('ws-trellis2-normal-map');
    const r = cb.getBoundingClientRect();
    return { existe: !!cb, cocheeAuDepart: cb.checked, libelle: cb.closest('label').innerText.trim(), visible: r.width > 0 && r.height > 0 };`);
  attendre('la case existe, decochee, visible', out.panneau.existe && out.panneau.cocheeAuDepart === false && out.panneau.visible);
  attendre('libelle', out.panneau.libelle === 'Game-engine relief (normal map)');

  // 1) generation SANS toucher la case : option fausse, jamais une valeur ambigue
  out.sans_toucher = await generer(page);
  attendre('sans toucher : un appel, option fausse (booleen)', out.sans_toucher.nouveau && out.sans_toucher.trellis2NormalMap === false && out.sans_toucher.type === 'boolean');
  attendre('sans toucher : la tuile n annonce pas le relief', !String(out.sans_toucher.options || '').includes('Game-engine relief'));

  // 2) VRAI clic de souris sur la case (aux coordonnees mesurees, apres l'avoir centree), puis generation
  const viser = async () => main(page, `const cb = document.getElementById('ws-trellis2-normal-map'); cb.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 600));
    const r = cb.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; const e = document.elementFromPoint(x, y);
    return { x, y, estLaCase: !!e && (e === cb || cb.contains(e) || e.contains(cb)), dessus: e ? e.tagName + '#' + e.id : null };`);
  const cible = await viser();
  await page.mouse.click(cible.x, cible.y);
  await page.waitForTimeout(300);
  out.clic = { sousLePointeur: cible.estLaCase, dessus: cible.dessus, cochee: await page.locator('#ws-trellis2-normal-map').isChecked() };
  attendre('le clic atteint la case et la coche', cible.estLaCase && out.clic.cochee === true);
  out.case_cochee = await generer(page);
  attendre('case cochee : option vraie (booleen)', out.case_cochee.nouveau && out.case_cochee.trellis2NormalMap === true && out.case_cochee.type === 'boolean');
  attendre('case cochee : la tuile annonce le relief', String(out.case_cochee.options || '').includes('Game-engine relief'));

  // 3) decocher par un clic sur le LIBELLE, regenerer : option fausse de nouveau
  await viser();
  await page.locator('label:has(#ws-trellis2-normal-map)').click({ timeout: 6000 }).catch((e) => { out.libelleErreur = String(e.message || e).slice(0, 200); });
  out.decoche_par_le_libelle = { cochee: await page.locator('#ws-trellis2-normal-map').isChecked() };
  attendre('le libelle decoche la case', out.decoche_par_le_libelle.cochee === false);
  out.case_decochee = await generer(page);
  attendre('case decochee : option fausse', out.case_decochee.nouveau && out.case_decochee.trellis2NormalMap === false);

  // 4) traduction francaise du libelle et de l'infobulle (vrai i18n du renderer)
  out.fr = await main(page, `window.FabI18n.applyLang('fr'); await new Promise(r => setTimeout(r, 900));
    const l = document.getElementById('ws-trellis2-normal-map').closest('label'); const r = { libelle: l.innerText.trim(), infobulle: l.title.slice(0, 60) };
    window.FabI18n.applyLang('en'); return r;`);
  attendre('libelle traduit en francais', out.fr.libelle === 'Relief pour moteur de jeu (carte de normales)');
  attendre('infobulle traduite en francais', out.fr.infobulle.startsWith('Ajoute une carte de normales'));
  out.erreurs = await main(page, `return (window.__mock.logs || []).filter(l => /uncaught|unhandled|TypeError|ReferenceError/i.test(l)).slice(-10);`);
  attendre('aucune erreur de script', out.erreurs.length === 0);
  out.verdict = { ok: echecs.length === 0, echecs };
  return out;
}
