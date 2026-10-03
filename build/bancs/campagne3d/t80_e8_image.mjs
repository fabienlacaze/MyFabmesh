// E8 (1/2) : image du guerrier orc « couvert de sang » : prompt de jeu qui doit passer le filtre du bureau. Prerequis : projet verif_t80_orc ouvert.
import * as l from './t80_lib.mjs';
const h = l.h;
if (l.stop()) { l.note('STOP present'); process.exit(0); }
const p0 = l.pos(); const t0 = Date.now();
const v0 = (await h.etat()).data.inputs['ws-prompt'];
const v1 = v0.replace('An orc warrior holding', 'An orc warrior covered in blood, holding');
if (v1 === v0) { l.note('remplacement du prompt impossible'); process.exit(1); }
const f = await h.remplir({ '#ws-prompt': v1 }); await l.dormir(600);
l.note('prompt = ' + (await h.etat()).data.inputs['ws-prompt'].slice(0, 120));
const g = await h.clic('ws-generate-image').catch(() => null);
l.note('clic generate image : ' + JSON.stringify(g).slice(0, 200));
await l.dormir(5000);
await l.modalesApresLancement();
const m = (await h.modale()).data || [];
l.note('modales : ' + JSON.stringify(m.map((x) => [x.id, x.titre, String(x.texte || '').slice(0, 200)])));
const tt = ((await h.toasts()) || []).map((x) => x.type + ':' + x.text).slice(-3);
l.note('toasts : ' + JSON.stringify(tt));
await h.shot('t80_e8_image_lancement');
const att = await l.attendre(900000);
await l.dormir(2000);
const f2 = l.fichiersApres(t0, /\.(png|jpg|webp)$/i, [l.REPO + '/images/verif_t80_orc']);
const res = { id: 'E8a', nom: 'image_orc_filtre_bureau', ok: f2.length > 0, prompt_contient_blood: /blood/i.test(v1), attente: att, fichiers: f2.map((x) => x.p), toasts: ((await h.toasts()) || []).map((x) => x.type + ':' + x.text).slice(-4), erreurs_journal: l.erreursDepuis(p0), duree_s: Math.round((Date.now() - t0) / 100) / 10 };
l.ligne(res); l.note('E8a : ' + JSON.stringify(res));
await h.shot('t80_e8_image_fin');
