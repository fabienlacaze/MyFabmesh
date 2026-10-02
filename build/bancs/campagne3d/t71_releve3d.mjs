// Releve des outils 3D du bureau : pour chaque bouton de l'etape Mesh, on selectionne la version de base (v4), on clique, on lit la fenetre qui s'ouvre
// (titre, champs, boutons), puis on la ferme SANS rien lancer. Ecrit releve_outils_3d.json. Les boutons qui agissent sans fenetre sont notes (travaux, nouvelle version).
import * as h from './h.mjs';
import { writeFileSync } from 'node:fs';

const BOUTONS = ['ws-mesh-smooth-btn', 'ws-mesh-decimate-btn', 'ws-mesh-subdivide-btn', 'ws-mesh-fixnormals-btn', 'ws-mesh-fillholes-btn', 'ws-mesh-watertight-btn', 'ws-mesh-center-btn',
  'ws-mesh-retexture-btn', 'ws-mesh-texvar-btn', 'ws-mesh-enhance-tex-btn', 'ws-mesh-detail-synth-btn', 'ws-mesh-trellis2-btn', 'ws-mesh-region-retex-btn', 'ws-mesh-reshape-btn',
  'ws-mesh-segment-btn', 'ws-mesh-name-btn', 'ws-mesh-explode-btn', 'ws-mesh-sculpt-btn', 'ws-mesh-paintvert-btn', 'ws-mesh-selectface-btn', 'ws-mesh-clone3d-btn',
  'ws-mesh-reshape-draw-btn', 'ws-mesh-resize-btn', 'ws-mesh-aligntex-btn', 'ws-mesh-paint-mesh-btn', 'ws-mesh-material-btn', 'ws-mesh-export-btn', 'ws-mesh-stages3d-btn'];
const sortie = {};
await h.clic('back-to-projects').catch(() => {}); await h.dormir(1500); await h.clic('texte:chevalier_medieval').catch(() => {}); await h.dormir(3500);
async function fermerTout() {
  for (let i = 0; i < 4; i++) {
    const m = await h.modale(); const l = (m.data || []); if (!l.length) return true;
    for (const x of l) {
      let r = await h.clic({ text: 'Cancel', within: x.id });
      if (!r.ok) r = await h.clic({ text: 'Close', within: x.id });
      if (!r.ok) r = await h.clic({ text: 'Back', within: x.id });
      await h.dormir(500);
    }
  }
  return ((await h.modale()).data || []).length === 0;
}
const nbMeshes = async () => (await h.projet()).meshes.length;
for (const b of BOUTONS) {
  await fermerTout();
  const avant = await nbMeshes();
  await h.clic({ text: 'v4', within: 'step-card-mesh' }); await h.dormir(1200);
  const jAvant = (await h.jobs()).length;
  const c = await h.clic(b); await h.dormir(1800);
  const m = await h.modale(); const l = (m.data || []);
  const tt = await h.toasts().catch(() => []);
  const jApres = (await h.jobs()).length;
  sortie[b] = { clic: !!c.ok, erreur: c.ok ? null : JSON.stringify(c).slice(0, 160), modales: l, toasts: (Array.isArray(tt) ? tt : []).map((x) => x.text || x.message || String(x)).slice(-3), travaux_lances: jApres - jAvant, nouvelles_versions: (await nbMeshes()) - avant };
  console.log(b.padEnd(28), c.ok ? 'clic' : 'ECHEC', '| fenetres:', l.map((x) => x.id + ':' + String(x.titre || '').slice(0, 40)).join(' | ') || '-', '| travaux', jApres - jAvant, '| versions +' + (sortie[b].nouvelles_versions));
  await h.shot('04_releve_' + b.replace('ws-mesh-', '').replace('-btn', ''));
  await fermerTout();
  if (jApres > jAvant) { console.log('   travail lance par ce bouton : attente de la fin (20 min max)'); const w = await h.attendreTravaux(20 * 60 * 1000); console.log('   fin:', JSON.stringify(w)); sortie[b].attente = w; }
}
writeFileSync('C:/tmp/campagne/releve_outils_3d.json', JSON.stringify(sortie, null, 1));
console.log('fini');
