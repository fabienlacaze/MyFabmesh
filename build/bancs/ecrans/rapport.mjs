// Rapport HTML du banc des ecrans : une ligne par ecran, une colonne par taille, defauts mesures en rouge ; --ref : captures precedentes a cote.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Defauts d'un ecran mesure (liste de textes courts). Pure. */
export function defauts(e, largeur) {
  if (!e) return ['non capture'];
  if (!e.ok) return [e.raison || 'echec'];
  const m = e.mesure || {}, d = [];
  if (m.debordeH) d.push(`page plus large que l'ecran (${m.largeurPage} px)`);
  if (m.horsEcran && m.horsEcran.length) d.push(`${m.horsEcran.length} element(s) hors ecran`);
  if (largeur < 1100 && m.petits && m.petits.length >= 3) d.push(`${m.petits.length}+ cibles tactiles < 32 px`);
  const f = m.fenetre;
  if (f) {
    if (f.deborde) d.push('fenetre plus large que l\'ecran');
    if (f.pied && !f.pied.visible) d.push('boutons du bas hors ecran');
    if (f.pied && !f.pied.libre) d.push('boutons du bas recouverts');
  }
  return d;
}
export function ecrireRapport(sortie, tailles, ref) {
  const bilans = tailles.map((t) => { try { return JSON.parse(fs.readFileSync(path.join(sortie, t.dossier, '_bilan.json'), 'utf8')); } catch { return { ecrans: {} }; } });
  const noms = [...new Set(bilans.flatMap((b) => Object.keys(b.ecrans || {})))].sort();
  let nbDef = 0;
  const lignes = noms.map((n) => {
    const cellules = tailles.map((t, i) => {
      const e = bilans[i].ecrans[n], d = defauts(e, t.w); nbDef += d.length ? 1 : 0;
      const img = e && e.ok ? `<a href="${t.dossier}/${n}.png" target="_blank"><img loading="lazy" src="${t.dossier}/${n}.png" alt=""></a>` : '<div class="vide">—</div>';
      const av = ref && fs.existsSync(path.join(ref, t.dossier, n + '.png')) ? `<a class="ref" href="${path.join(ref, t.dossier, n + '.png').replace(/\\/g, '/')}" target="_blank">capture precedente</a>` : '';
      const det = e && e.ok && e.mesure ? esc(JSON.stringify({ horsEcran: e.mesure.horsEcran, petits: e.mesure.petits, fenetre: e.mesure.fenetre })) : '';
      return `<td class="${d.length ? 'ko' : 'ok'}">${img}<div class="def">${d.map(esc).join('<br>') || 'OK'}</div>${av}${det ? `<details><summary>mesures</summary><pre>${det}</pre></details>` : ''}</td>`;
    }).join('');
    const ko = tailles.some((t, i) => defauts(bilans[i].ecrans[n], t.w).length);
    return `<tr data-ko="${ko ? 1 : 0}"><th>${esc(n)}</th>${cellules}</tr>`;
  }).join('\n');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Banc des écrans</title>
<style>
:root{--fond:#f4f5f7;--carte:#fff;--texte:#1d2330;--doux:#5b6472;--ko:#b42318;--ok:#067647;--bord:#d0d5dd}
@media (prefers-color-scheme:dark){:root{--fond:#121418;--carte:#1c2027;--texte:#e7eaf0;--doux:#9aa3b2;--ko:#f97066;--ok:#47cd89;--bord:#333a45}}
body{margin:0;background:var(--fond);color:var(--texte);font:14px/1.45 system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--fond);padding:12px 16px;border-bottom:1px solid var(--bord)}
h1{margin:0 0 4px;font-size:19px} .resume{color:var(--doux)} label{margin-left:12px;cursor:pointer}
.tab{overflow:auto;padding:0 16px 32px} table{border-collapse:collapse} th,td{border:1px solid var(--bord);vertical-align:top;padding:6px;background:var(--carte)}
thead th{position:sticky;top:0;z-index:1} tbody th{text-align:left;white-space:nowrap;font-weight:600}
td img{width:180px;display:block;border-radius:4px} td.ko{outline:2px solid var(--ko);outline-offset:-2px} .def{font-size:12px;margin-top:4px;max-width:180px} td.ko .def{color:var(--ko)} td.ok .def{color:var(--ok)}
.vide{width:180px;height:60px;display:flex;align-items:center;justify-content:center;color:var(--doux)} pre{white-space:pre-wrap;font-size:11px;max-width:180px} .ref{font-size:11px}
body.seulsKo tr[data-ko="0"]{display:none}
</style></head><body>
<header><h1>Banc des écrans</h1><div class="resume">${noms.length} écrans × ${tailles.length} tailles · <b>${nbDef}</b> capture(s) avec un défaut · ${esc(new Date().toLocaleString('fr-FR'))}
<label><input type="checkbox" id="ko"> problèmes seulement</label></div></header>
<div class="tab"><table><thead><tr><th>Écran</th>${tailles.map((t) => `<th>${esc(t.nom)}<br><small>${t.w}×${t.h}</small></th>`).join('')}</tr></thead><tbody>
${lignes}
</tbody></table></div>
<script>document.getElementById('ko').addEventListener('change',(e)=>document.body.classList.toggle('seulsKo',e.target.checked));</script>
</body></html>`;
  const f = path.join(sortie, 'index.html');
  fs.writeFileSync(f, html);
  return f;
}
