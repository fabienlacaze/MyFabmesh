"""Banc de VERACITE de la carte de normales sur de VRAIS maillages TRELLIS (2026-10-14), CPU seul, aucun GPU ni reseau.

Deux GLB de la MEME generation reduite a deux tailles (sorties de to_glb, repere Y haut) : le plus fin sert de maillage FIN, le plus
leger de maillage FINAL. La carte est cuite par scripts/normal_bake.py (hi_axes='none' : les deux sont deja dans le repere du GLB),
puis DECODEE comme three.js r170 la decode (getTangentFrame + normalScale.y = -1 de GLTFLoader sans attribut TANGENT, meme port que
build/bancs/noyaux/test_normal_bake.py, ici vectorise par triangle). Reference : la normale que l'on VERRAIT en affichant le maillage
fin = sa normale de sommet (attribut NORMAL) interpolee au point le plus proche de sa surface (recherche exacte point-triangle parmi
les 16 triangles fins de centre le plus proche ; independante du noyau, qui travaille sur les sommets).

Mesures sur un echantillon de texels couverts (graine fixe) :
  - ecart angulaire a la reference : maillage final SEUL (normale de sommet interpolee) / AVEC la carte / carte au VERT INVERSE / ROUGE
    INVERSE / k = 1 ;
  - ecart d'eclairage (Lambert, 6 directions, sur 255) : seul / avec carte (comparable a la mesure du 2026-09-30, faite a l'ecran).
La carte doit RAPPROCHER le rendu de celui du maillage fin, et les cartes aux canaux inverses doivent l'en ELOIGNER : c'est la preuve,
sur de vrais depliages xatlas (ilots tournes, en miroir, coutures), que les conventions de la carte sont celles du lecteur.

Lancer (machine du proprietaire : par lourd.sh) :
  bash /c/tmp/lourd.sh --max-sec 600 python build/bancs/noyaux/banc_normal_bake_reel.py \
      --fin C:/tmp/trellis_cloud/glb/hr_G3072_tranches_t8192_f3000000.glb \
      --final C:/tmp/trellis_cloud/glb/hr_G3072_tranches_t8192_f500000.glb --atlas 4096
Options : --echantillon N (200 000), --apercu fichier.png (la carte, reduite), --sortie fichier.jsonl (une ligne JSON ajoutee).
Les GLB d'essai ne sont JAMAIS commites (depot public) : ce script ne lit que des chemins passes en argument.
"""
import argparse
import importlib.util
import json
import os
import struct
import sys
import time

import numpy as np

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SOURCE = os.environ.get('NOYAU_NORMAL_BAKE') or os.path.join(RACINE, 'scripts', 'normal_bake.py')
_TYPES = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
_COMPOSANTES = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def charger_noyau():
    spec = importlib.util.spec_from_file_location('normal_bake_reel', SOURCE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def lire_glb_geometrie(chemin):
    """(V, F, N, UV de glTF) du premier maillage du GLB, SANS decoder les images (memoire bornee)."""
    with open(chemin, 'rb') as f:
        tete = f.read(12)
        if tete[:4] != b'glTF':
            raise ValueError('%s : pas un GLB' % chemin)
        lj, _ = struct.unpack('<II', f.read(8))
        j = json.loads(f.read(lj).decode('utf-8'))
        lb, _ = struct.unpack('<II', f.read(8))
        binaire = f.read(lb)

    def accesseur(i):
        a = j['accessors'][i]
        vue = j['bufferViews'][a['bufferView']]
        typ = np.dtype(_TYPES[a['componentType']])
        n = _COMPOSANTES[a['type']]
        debut = vue.get('byteOffset', 0) + a.get('byteOffset', 0)
        pas = vue.get('byteStride') or typ.itemsize * n
        brut = np.frombuffer(binaire, dtype=np.uint8, count=pas * (a['count'] - 1) + typ.itemsize * n, offset=debut)
        x = np.lib.stride_tricks.as_strided(brut, shape=(a['count'], n * typ.itemsize), strides=(pas, 1))
        return np.ascontiguousarray(x).view(typ).reshape(a['count'], n)

    p = j['meshes'][0]['primitives'][0]
    V = accesseur(p['attributes']['POSITION']).astype(np.float64)
    N = accesseur(p['attributes']['NORMAL']).astype(np.float64)
    UV = accesseur(p['attributes']['TEXCOORD_0']).astype(np.float64)
    F = accesseur(p['indices']).reshape(-1, 3).astype(np.int64)
    return V, F, N, UV


def maillage_final(V, F, N, UVg):
    """trimesh.Trimesh texture comme celui que rend to_glb : UV de trimesh (v vers le haut) = (u, 1 - v de glTF)."""
    import trimesh
    from PIL import Image
    uv = np.stack([UVg[:, 0], 1.0 - UVg[:, 1]], 1)
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=Image.new('RGB', (8, 8), (180, 180, 180)))
    return trimesh.Trimesh(V, F, vertex_normals=N, process=False, visual=trimesh.visual.TextureVisuals(uv=uv, material=mat))


def unitaires(x):
    n = np.linalg.norm(x, axis=-1, keepdims=True)
    return x / np.where(n > 0, n, 1.0)


def point_triangle(P, A, B, C):
    """Point le plus proche de P sur le triangle ABC (vectorise ; Ericson, Real-Time Collision Detection 5.1.5). Rend (Q, l0, l1, l2)."""
    ab, ac, ap = B - A, C - A, P - A
    d1, d2 = (ab * ap).sum(-1), (ac * ap).sum(-1)
    bp = P - B
    d3, d4 = (ab * bp).sum(-1), (ac * bp).sum(-1)
    cp = P - C
    d5, d6 = (ab * cp).sum(-1), (ac * cp).sum(-1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    with np.errstate(all='ignore'):
        den = va + vb + vc
        v = np.where(den != 0, vb / den, 0.0)
        w = np.where(den != 0, vc / den, 0.0)
        l = np.stack([1 - v - w, v, w], -1)
        # regions de sommet / d'arete
        t_ab = np.clip(np.where((d1 - d3) != 0, d1 / (d1 - d3), 0.0), 0, 1)
        t_ac = np.clip(np.where((d2 - d6) != 0, d2 / (d2 - d6), 0.0), 0, 1)
        t_bc = np.clip(np.where(((d4 - d3) + (d5 - d6)) != 0, (d4 - d3) / ((d4 - d3) + (d5 - d6)), 0.0), 0, 1)
    cas = [
        ((d1 <= 0) & (d2 <= 0), np.stack([np.ones_like(d1), 0 * d1, 0 * d1], -1)),
        ((d3 >= 0) & (d4 <= d3), np.stack([0 * d1, np.ones_like(d1), 0 * d1], -1)),
        ((d6 >= 0) & (d5 <= d6), np.stack([0 * d1, 0 * d1, np.ones_like(d1)], -1)),
        ((vc <= 0) & (d1 >= 0) & (d3 <= 0), np.stack([1 - t_ab, t_ab, 0 * d1], -1)),
        ((vb <= 0) & (d2 >= 0) & (d6 <= 0), np.stack([1 - t_ac, 0 * d1, t_ac], -1)),
        ((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), np.stack([0 * d1, 1 - t_bc, t_bc], -1)),
    ]
    pris = np.zeros(d1.shape, bool)
    for masque, bary in cas:
        m = masque & ~pris
        l = np.where(m[..., None], bary, l)
        pris |= m
    Q = l[..., 0:1] * A + l[..., 1:2] * B + l[..., 2:3] * C
    return Q, l


def reference_fine(P, Vf, Ff, Nf, k=16, bloc=50_000):
    """Normale du maillage fin VUE au point le plus proche de P : normale de sommet interpolee (attribut NORMAL du GLB fin)."""
    from scipy.spatial import cKDTree
    centres = Vf[Ff].mean(axis=1)
    arbre = cKDTree(centres)
    sortie = np.empty_like(P)
    dist = np.empty(len(P))
    for d in range(0, len(P), bloc):
        p = P[d:d + bloc]
        _, cand = arbre.query(p, k=k, workers=-1)
        tri = Ff[cand]                                           # (m, k, 3)
        A, B, C = Vf[tri[..., 0]], Vf[tri[..., 1]], Vf[tri[..., 2]]
        Q, l = point_triangle(p[:, None, :], A, B, C)
        d2 = ((Q - p[:, None, :]) ** 2).sum(-1)
        i = d2.argmin(axis=1)
        r = np.arange(len(p))
        lb = l[r, i]
        t = tri[r, i]
        sortie[d:d + bloc] = unitaires(lb[:, 0:1] * Nf[t[:, 0]] + lb[:, 1:2] * Nf[t[:, 1]] + lb[:, 2:3] * Nf[t[:, 2]])
        dist[d:d + bloc] = np.sqrt(d2[r, i])
    return sortie, dist


def decoder_threejs(carte, rr, cc, tri, bary, V, N, UVg, F, inverser=(False, False)):
    """Port vectorise du decodeur de three.js r170 (voir test_normal_bake.DecodeurThreeJs) aux texels (rr, cc) de triangles `tri`."""
    f = F[tri]
    Nn = unitaires((bary[:, :, None] * N[f]).sum(1))
    p0, p1, p2 = V[f[:, 0]], V[f[:, 1]], V[f[:, 2]]
    e1, e2 = p1 - p0, p2 - p0
    ng = unitaires(np.cross(e1, e2))
    ex = unitaires(e1)
    ey = np.cross(ng, ex)
    q0, q1 = 1e-3 * ex, 1e-3 * ey                         # derivees d'ecran : une paire du plan, orientee comme la face
    E = np.stack([e1, e2], 2)                              # (m, 3, 2)
    D = np.stack([UVg[f[:, 1]] - UVg[f[:, 0]], UVg[f[:, 2]] - UVg[f[:, 0]]], 2)   # (m, 2, 2)
    J = D @ np.linalg.pinv(E)                              # (m, 2, 3) : d(uv de glTF) / d(position)
    st0 = (J @ q0[:, :, None])[:, :, 0]
    st1 = (J @ q1[:, :, None])[:, :, 0]
    q1perp = np.cross(q1, Nn)
    q0perp = np.cross(Nn, q0)
    T = q1perp * st0[:, 0:1] + q0perp * st1[:, 0:1]
    B = q1perp * st0[:, 1:2] + q0perp * st1[:, 1:2]
    det = np.maximum((T * T).sum(1), (B * B).sum(1))
    s = np.where(det > 0, 1.0 / np.sqrt(np.where(det > 0, det, 1.0)), 0.0)[:, None]
    m = carte[rr, cc].astype(np.float64) / 255.0 * 2.0 - 1.0
    if inverser[0]:
        m[:, 0] = -m[:, 0]
    if inverser[1]:
        m[:, 1] = -m[:, 1]
    m[:, 1] *= -1.0                                        # GLTFLoader : normalScale.y = -1 sans attribut TANGENT
    return unitaires(T * s * m[:, 0:1] + B * s * m[:, 1:2] + Nn * m[:, 2:3]), Nn


def angles(a, b):
    return np.degrees(np.arccos(np.clip((a * b).sum(1), -1.0, 1.0)))


def lambert(n, lumieres):
    return np.clip(n @ lumieres.T, 0.0, 1.0) * 255.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fin', required=True)
    ap.add_argument('--final', required=True)
    ap.add_argument('--atlas', type=int, default=4096)
    ap.add_argument('--echantillon', type=int, default=200_000)
    ap.add_argument('--apercu', default='')
    ap.add_argument('--sortie', default='')
    a = ap.parse_args()
    NB = charger_noyau()
    t0 = time.perf_counter()
    Vh, Fh, Nh, _ = lire_glb_geometrie(a.fin)
    V, F, N, UVg = lire_glb_geometrie(a.final)
    m = maillage_final(V, F, N, UVg)
    print('fin : %d sommets / %d faces ; final : %d sommets / %d faces (lecture %.1f s)'
          % (len(Vh), len(Fh), len(V), len(F), time.perf_counter() - t0), flush=True)

    def cuire(**kw):
        stats = {}
        t = time.perf_counter()
        c = NB.bake_normal_map(m, Vh.astype(np.float32), Fh.astype(np.int32), a.atlas, hi_axes='none', log=None, stats=stats, **kw)
        return c, time.perf_counter() - t, stats
    carte, duree, stats = cuire()
    if carte is None:
        print('AUCUNE CARTE (refus : %s)' % stats.get('refus'))
        return 1
    carte_k1, _, _ = cuire(k=1)
    print('carte %d en %.1f s (phases %s)' % (a.atlas, duree, {k: round(v, 1) for k, v in stats['phases'].items()}), flush=True)

    # texels couverts : proprietaire par le rasteriseur du noyau (verifie contre une rasterisation de reference par les tests)
    g = NB._reperes_faces(V, np.stack([UVg[:, 0], 1.0 - UVg[:, 1]], 1), F, a.atlas, a.atlas)
    prop = NB._rasteriser(g, a.atlas, a.atlas)
    couverts = np.flatnonzero(prop >= 0)
    rng = np.random.default_rng(0)
    ti = np.sort(rng.choice(couverts, size=min(a.echantillon, couverts.size), replace=False))
    rr, cc = ti // a.atlas, ti % a.atlas
    tri = prop[ti].astype(np.int64)
    xc, yc = cc + 0.5, rr + 0.5
    ax, ay, bx, by, cx, cy = (g[k][tri] for k in ('ax', 'ay', 'bx', 'by', 'cx', 'cy'))
    ia = g['inv_aire2'][tri]
    la = ((bx - xc) * (cy - yc) - (by - yc) * (cx - xc)) * ia
    lb = ((cx - xc) * (ay - yc) - (cy - yc) * (ax - xc)) * ia
    bary = np.stack([la, lb, 1.0 - la - lb], 1)
    P = (bary[:, :, None] * V[F[tri]]).sum(1)

    t = time.perf_counter()
    ref, dist = reference_fine(P, Vh, Fh, Nh)
    print('reference fine (%d texels) en %.1f s ; distance mediane au fin %.2g' % (len(P), time.perf_counter() - t, np.median(dist)),
          flush=True)
    n_avec, n_seul = decoder_threejs(carte, rr, cc, tri, bary, V, N, UVg, F)
    ref = np.where(((ref * n_seul).sum(1) < 0)[:, None], -ref, ref)     # orientation du fin sans effet sur la comparaison
    variantes = {
        'final_seul': n_seul,
        'avec_carte': n_avec,
        'avec_carte_k1': decoder_threejs(carte_k1, rr, cc, tri, bary, V, N, UVg, F)[0],
        'vert_inverse': decoder_threejs(carte, rr, cc, tri, bary, V, N, UVg, F, inverser=(False, True))[0],
        'rouge_inverse': decoder_threejs(carte, rr, cc, tri, bary, V, N, UVg, F, inverser=(True, False))[0],
    }
    lum = unitaires(np.array([[0.3, 0.8, 0.5], [-0.6, 0.5, 0.6], [0.7, 0.2, -0.6], [-0.2, 0.9, -0.4], [0.0, -0.3, 1.0],
                              [-0.8, -0.2, -0.5]]))
    L_ref = lambert(ref, lum)
    res = {'fin': os.path.basename(a.fin), 'final': os.path.basename(a.final), 'sommets_fins': int(len(Vh)), 'faces_finales': int(len(F)),
           'atlas': a.atlas, 'duree_cuisson_s': round(duree, 2), 'texels_mesures': int(len(ti)),
           'part_atlas': round(stats['part_atlas'], 3)}
    for nom, n in variantes.items():
        e = angles(n, ref)
        res[nom] = {'ecart_moyen_deg': round(float(e.mean()), 3), 'ecart_median_deg': round(float(np.median(e)), 3),
                    'p90_deg': round(float(np.percentile(e, 90)), 3),
                    'eclairage_ecart_moyen_255': round(float(np.abs(lambert(n, lum) - L_ref).mean()), 3)}
        print('%-14s angle moyen %6.2f deg, median %6.2f, p90 %6.2f ; eclairage %.2f / 255'
              % (nom, res[nom]['ecart_moyen_deg'], res[nom]['ecart_median_deg'], res[nom]['p90_deg'],
                 res[nom]['eclairage_ecart_moyen_255']), flush=True)
    if a.apercu:
        from PIL import Image
        Image.fromarray(carte).resize((1024, 1024), Image.NEAREST).save(a.apercu)
    print(json.dumps(res, ensure_ascii=False))
    if a.sortie:
        with open(a.sortie, 'a', encoding='utf-8') as f:
            f.write(json.dumps(res, ensure_ascii=False) + '\n')
    gain = res['avec_carte']['ecart_moyen_deg'] < res['final_seul']['ecart_moyen_deg']
    inverses_pires = min(res['vert_inverse']['ecart_moyen_deg'], res['rouge_inverse']['ecart_moyen_deg']) > res['avec_carte']['ecart_moyen_deg']
    print('VERDICT : carte %s le maillage final du fin ; canaux inverses %s' % ('RAPPROCHE' if gain else "N'APPROCHE PAS",
                                                                                 'plus loin (conventions justes)' if inverses_pires
                                                                                 else 'PAS plus loin (convention douteuse)'))
    return 0 if (gain and inverses_pires) else 2


if __name__ == '__main__':
    sys.exit(main())
