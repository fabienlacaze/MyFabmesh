import * as h from './h.mjs';
import { execFileSync } from 'node:child_process';
const lireRigs = async () => JSON.parse((await h.evalue('const p=window.state.currentProject; return JSON.stringify((p.rigs||[]).map(x=>typeof x==="string"?x:(x.path||x.url||"")))')).data);
for (let i = 0; i < 3; i++) { const m = await h.modale(); if ((m.data || []).find((x) => x.id === 'modal-confirm')) await h.clic({ text: 'OK', within: 'modal-confirm' }); await h.api('POST', '/ui/key', { key: 'Escape' }); await h.dormir(1000); }
const avant = (await lireRigs()).length;
const l = await h.essayer({ categorie: '05_rig', nom: 'rig_reskin_confirme', max: 900000, cible: '#ws-rig-canvas', note: 'Re-skin only, confirmation « Re-skin » cliquee', lancer: async () => {
  const o = await h.clic('ws-rig-reskin-btn'); if (!o.ok) return o; await h.dormir(2000); const c = await h.clic({ text: 'Re-skin', within: 'modal-confirm' }); return c; } });
const apres = await lireRigs(); l.ajoutes = apres.length - avant;
console.log(h.resume(l), '| rigs', avant, '->', apres.length);
if (apres.length > avant) { const f = apres[0]; try { l.mesures = JSON.parse(execFileSync(process.env.APPDATA + '/myfabmesh-ai/python/python.exe', ['C:/tmp/campagne/valider_rig.py', f], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } }).trim().split('\n').pop()); } catch (e) { l.mesures = { erreur: String(e).slice(0, 100) }; } console.log(JSON.stringify(l.mesures)); }
import { appendFileSync } from 'node:fs'; appendFileSync('C:/tmp/campagne/resultats3d.jsonl', JSON.stringify({ groupe: '05_rig', nom: 'rig_reskin_confirme', ...l }) + '\n');
