#!/usr/bin/env node
// Memoire du worker du site pour un GLB qui TRANSITE par lui en base64 (outils de maillage, operations d'atlas, apercus) — 2026-10-18.
//
// POURQUOI. Un isolat Cloudflare Workers est coupe a 128 Mo (« Exceeded memory limit »). Les outils du site recoivent leur resultat de Modal
// sous la forme { glb_base64: "..." } (cloud/src/worker.ts : handleMeshOp, _opAtlasGpu, apercu de la Marketplace, etapes de construction), puis :
//     const data  = await r.json();                              // corps (1,33 x N) -> chaine (1,33 x N) -> valeur analysee (1,33 x N)
//     const bin   = atob(data.glb_base64);                       // chaine binaire de N caracteres
//     const bytes = new Uint8Array(bin.length);                  // N octets de plus
//     for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
//     await env.MESHES.put(key, bytes);                          // la requete R2 garde (au pire) une copie de plus
// La GENERATION n'est pas concernee : depuis le 29/09 le conteneur 3D televerse lui-meme le GLB dans R2 (URL PUT signee, persistModalGlb).
// Ce banc rejoue EXACTEMENT ces operations dans un PROCESSUS NEUF par mesure (meme moteur V8 que workerd), contre un faux « Modal » local qui sert
// la reponse JSON sur 127.0.0.1, et mesure deux choses, dans deux processus distincts :
//   - mode « pic » : AUCUN ramasse-miettes force. Le PIC de memoire residente au-dessus du repos (process.resourceUsage().maxRSS apres
//     l'operation, moins le RSS juste avant). Borne haute : elle compte aussi les pages que le ramasse-miettes n'a pas encore rendues ;
//   - mode « vivant » : ramasse-miettes force apres chaque etape ; memoire VIVANTE (tas + externe) : ce que l'isolat doit reellement tenir.
// Aucune installation, aucun reseau (boucle locale), aucun GPU. ~1 Go de memoire de travail au plus pour 60 Mo ; a lancer par
// `bash /c/tmp/lourd.sh` sur la machine du proprietaire (Unreal ouvert).
// usage : node build/bancs/memoire_worker_glb.mjs [--tailles 26,33,46] [--repetitions 3] [--json]
//         node build/bancs/memoire_worker_glb.mjs --serveur <port>                        (interne : faux Modal)
//         node --expose-gc build/bancs/memoire_worker_glb.mjs --mesure <port> <Mo> <pic|vivant>   (interne : le « worker »)
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MO = 1e6;
const LIMITE_ISOLAT_MO = 128;
const ARGS = process.argv.slice(2);
const option = (nom, defaut) => { const i = ARGS.indexOf(nom); return i >= 0 ? ARGS[i + 1] : defaut; };

if (ARGS[0] === '--serveur') {
  /* ───────────── processus « Modal » : sert { ok, op_type, bytes, glb_base64 } pour un GLB de N Mo ───────────── */
  const port = Number(ARGS[1]);
  http.createServer((req, res) => {
    const mo = Number(new URL(req.url, 'http://x').searchParams.get('mo') || 1);
    const n = Math.round(mo * MO);
    const glb = Buffer.alloc(n);
    for (let i = 0; i < n; i += 61) glb[i] = (i * 2654435761) & 255;      // octets quelconques : la taille seule compte
    const corps = Buffer.from(JSON.stringify({ ok: true, op_type: 'center', bytes: n, glb_base64: glb.toString('base64') }));
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': corps.length });
    res.end(corps);
  }).listen(port, '127.0.0.1');
} else if (ARGS[0] === '--mesure') {
  /* ───────────── processus « worker » : une seule mesure, a froid ───────────── */
  const port = Number(ARGS[1]);
  const mo = Number(ARGS[2]);
  const mode = ARGS[3] === 'vivant' ? 'vivant' : 'pic';
  const url = `http://127.0.0.1:${port}/?mo=`;
  const vivant = () => { global.gc(); const m = process.memoryUsage(); return (m.heapUsed + m.external) / MO; };
  // echauffement : la pile reseau et le tas sont initialises avant la ligne de base (comme un worker deja chaud)
  await (await fetch(url + '0.05')).json();
  global.gc();
  const repos = vivant();
  const rss0 = process.memoryUsage().rss / MO;
  const etapes = {};
  const noter = (nom) => { if (mode === 'vivant') etapes[nom] = +(vivant() - repos).toFixed(1); };
  // === code du worker (cloud/src/worker.ts : handleMeshOp) ===
  const r = await fetch(url + mo);
  const data = await r.json();
  noter('apres_json');
  const bin = atob(data.glb_base64);
  noter('apres_atob');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  noter('apres_copie');
  // env.MESHES.put(key, bytes) : modele pessimiste, la requete R2 garde une copie des octets pendant l'envoi
  const copiePut = new Uint8Array(bytes);
  noter('apres_put');
  // === fin ===
  const pic = process.resourceUsage().maxRSS * 1024 / MO;       // Ko -> Mo
  console.log(JSON.stringify({ glb_mo: mo, mode, octets: bytes.length, copie_put: copiePut.length, ...etapes, pic_rss_au_dessus_du_repos_mo: +(pic - rss0).toFixed(1) }));
  process.exit(0);
} else {
  /* ───────────── pilote ───────────── */
  const tailles = String(option('--tailles', '20,26,33,40,46,52,60')).split(',').map(Number);
  const repetitions = Number(option('--repetitions', 3));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const ici = fileURLToPath(import.meta.url);
  const serveur = spawn(process.execPath, [ici, '--serveur', String(port)], { stdio: 'ignore' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  const mediane = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const mesurer = (mo, mode) => {
    const r = spawnSync(process.execPath, ['--expose-gc', ici, '--mesure', String(port), String(mo), mode], { encoding: 'utf8', timeout: 300000 });
    if (r.status !== 0) return { erreur: String(r.stderr || r.error || '').slice(0, 200) };
    return JSON.parse(r.stdout.trim().split('\n').pop());
  };
  const lignes = [];
  try {
    for (const mo of tailles) {
      const pics = [], vivants = [];
      for (let k = 0; k < repetitions; k++) {
        const p = mesurer(mo, 'pic'); if (!p.erreur) pics.push(p.pic_rss_au_dessus_du_repos_mo);
        const v = mesurer(mo, 'vivant'); if (!v.erreur) vivants.push(v);
      }
      const med = (cle) => (vivants.length ? mediane(vivants.map((x) => x[cle])) : null);
      const ligne = {
        glb_mo: mo, essais: pics.length,
        pic_rss_mediane_mo: pics.length ? mediane(pics) : null, pic_rss_max_mo: pics.length ? Math.max(...pics) : null,
        vivant_apres_json_mo: med('apres_json'), vivant_apres_atob_mo: med('apres_atob'), vivant_apres_copie_mo: med('apres_copie'), vivant_apres_put_mo: med('apres_put'),
      };
      lignes.push(ligne);
      if (ARGS.includes('--json')) console.log(JSON.stringify(ligne));
      else console.log(`GLB ${String(mo).padStart(3)} Mo : pic RSS mediane ${String(ligne.pic_rss_mediane_mo).padStart(6)} Mo (max ${ligne.pic_rss_max_mo}) ; vivant : json ${ligne.vivant_apres_json_mo}, +atob ${ligne.vivant_apres_atob_mo}, +copie ${ligne.vivant_apres_copie_mo}, +put ${ligne.vivant_apres_put_mo} Mo`);
    }
  } finally { serveur.kill(); }
  // droite des moindres carres du pic RSS (borne haute) et de la memoire vivante finale (borne basse) en fonction de la taille du GLB
  const ajuster = (cle) => {
    const pts = lignes.filter((l) => l[cle] != null).map((l) => [l.glb_mo, l[cle]]);
    const n = pts.length; const sx = pts.reduce((a, p) => a + p[0], 0); const sy = pts.reduce((a, p) => a + p[1], 0);
    const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0); const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
    const a = (n * sxy - sx * sy) / (n * sxx - sx * sx); const b = (sy - a * sx) / n;
    return { pente: +a.toFixed(2), origine: +b.toFixed(1) };
  };
  if (lignes.length >= 3) {
    const haut = ajuster('pic_rss_mediane_mo'); const bas = ajuster('vivant_apres_put_mo');
    console.log(`\najustement (Mo de memoire au-dessus du repos = pente x Mo de GLB + origine) : pic RSS ${JSON.stringify(haut)} ; vivant apres put ${JSON.stringify(bas)}`);
    for (const repos of [20, 40, 60]) {
      const budget = LIMITE_ISOLAT_MO - repos;
      console.log(`isolat de ${LIMITE_ISOLAT_MO} Mo, ${repos} Mo deja pris par le worker : GLB maximal ~${((budget - bas.origine) / bas.pente).toFixed(0)} Mo (modele vivant) a ~${((budget - haut.origine) / haut.pente).toFixed(0)} Mo (pic RSS)`);
    }
  }
}
