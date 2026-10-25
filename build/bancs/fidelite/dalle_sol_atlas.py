"""Part de l'ATLAS UV prise par la dalle de sol et le socle d'un GLB (2026-10-18). HORS GARDE : un banc de mesure, pas un test.

POURQUOI. Le depliage UV de to_glb (cumesh : regroupement GPU des faces en cartes, puis xatlas) repartit l'atlas au prorata de l'AIRE DE
SURFACE : la dalle et le socle de TRELLIS (66 % de l'aire de l'orc) en prennent donc autant, et le corps garde le reste. Retirer la dalle
AVANT le depliage (retrait_dalle_actif, scripts/acceleration_glb.py) rend cet atlas au corps ; retirer la dalle APRES l'export ne rend rien
(les UV ne bougent pas). Ce banc MESURE les deux cas sur des fichiers, sans GPU :

  - sur le GLB d'AVANT : la part de l'atlas (aire UV) prise par ce que le detecteur retire, et la DENSITE de texels du corps (texels par
    unite de longueur, et sur la hauteur du corps) ;
  - sur un GLB d'APRES (genere avec le retrait avant le depliage, a lancer plus tard sur GPU) : la meme densite et le GAIN LINEAIRE de
    resolution du corps (densite apres / densite avant, mesuree sur la meme unite de longueur).

Estimation sans GPU (le depliage est uniforme en densite de texels) : le gain lineaire vaut 1 / racine(part d'aire du corps), a rendement de
remplissage egal (l'orc : 35,4 % de l'aire -> x1,68). Le GLB reel de l'apres dira ce qu'il en est.

ATTENTION, le gain VISIBLE est plafonne : la couleur vient d'une grille de voxels (1024 par unite de longueur en 1024_cascade, 1536 en
1536_cascade, journal « grille= ») et ne contient pas plus de detail que ses voxels. L'orc a 2048 : 857 texels par unite contre 1024 voxels,
donc au mieux x1,19 de detail visible (et rien du tout a 4096, deja plus fin que la grille) ; en 1536_cascade le plein x1,68. L'option
--grille N calcule ce plafond.

Lancer :  <python de l'appli> build/bancs/fidelite/dalle_sol_atlas.py <glb_avant> [<glb_apres>] [--axe 1] [--grille 1024]
Sortie : un tableau sur la sortie standard et, avec --json, un fichier JSON. Lecture seule, CPU seulement, sans reseau.
"""
import argparse
import importlib.util
import json
import os
import sys

import numpy as np

RACINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))


def charger_module():
    spec = importlib.util.spec_from_file_location('acceleration_glb_atlas', os.path.join(RACINE, 'scripts', 'acceleration_glb.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def charger_glb_uv(chemin):
    """(V float64 monde, F int64, UV float64 par sommet, taille de la texture couleur ou None) : toutes les geometries fusionnees, avec
    les transformations de noeud ; leve ValueError si une geometrie n'a pas de coordonnees UV."""
    import trimesh
    sc = trimesh.load(chemin, force='scene', process=False)
    Vs, Fs, UVs, deca, taille = [], [], [], 0, None
    for nom in sc.graph.nodes_geometry:
        T, g = sc.graph[nom]
        G = sc.geometry[g]
        if not hasattr(G, 'faces') or len(G.faces) == 0:
            continue
        uv = getattr(G.visual, 'uv', None)
        if uv is None:
            raise ValueError('%s : pas de coordonnees UV' % g)
        tex = getattr(getattr(G.visual, 'material', None), 'baseColorTexture', None)
        if tex is not None and taille is None:
            taille = int(max(tex.size))
        Vs.append(np.asarray(G.vertices, np.float64) @ np.asarray(T)[:3, :3].T + np.asarray(T)[:3, 3])
        Fs.append(np.asarray(G.faces, np.int64) + deca)
        UVs.append(np.asarray(uv, np.float64))
        deca += len(G.vertices)
    if not Vs:
        raise ValueError('aucune geometrie')
    return np.concatenate(Vs), np.concatenate(Fs), np.concatenate(UVs), taille


def aires_3d(V, F):
    P = V[F]
    return 0.5 * np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1)


def aires_uv(UV, F):
    Q = UV[F]
    a, b = Q[:, 1] - Q[:, 0], Q[:, 2] - Q[:, 0]
    return 0.5 * np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0])


def part_atlas(V, F, UV, garder, taille=None, axe_haut=1):
    """Mesures de l'atlas pour un maillage dont `garder` (bool par face) designe le CORPS (le reste : dalle et socle).
    Rend un dict JSON-isable :
      aire_3d_retiree_pct   part de l'aire de SURFACE qui part ;
      atlas_retire_pct      part de l'ATLAS (aire UV) prise par ce qui part ;
      atlas_corps_pct       part de l'atlas prise par le corps (100 - la precedente) ;
      occupation_pct        part du carre [0, 1]^2 couverte par les triangles (aire UV totale) : le rendement du remplissage ;
      densite_corps         racine(aire UV du corps / aire 3D du corps) : unites d'UV par unite de longueur ;
      texels_par_unite      densite_corps x taille de la texture (si connue) ;
      hauteur_corps         hauteur du corps (unites) ; texels_sur_la_hauteur : densite x taille x hauteur."""
    V, F, UV = np.asarray(V, np.float64), np.asarray(F, np.int64), np.asarray(UV, np.float64)
    garder = np.asarray(garder, bool)
    a3, au = aires_3d(V, F), aires_uv(UV, F)
    t3, tu = float(a3.sum()), float(au.sum())
    c3, cu = float(a3[garder].sum()), float(au[garder].sum())
    res = {'faces': int(len(F)), 'faces_corps': int(garder.sum()),
           'aire_3d_retiree_pct': 100.0 * (t3 - c3) / t3 if t3 > 0 else 0.0,
           'atlas_retire_pct': 100.0 * (tu - cu) / tu if tu > 0 else 0.0,
           'atlas_corps_pct': 100.0 * cu / tu if tu > 0 else 0.0,
           'occupation_pct': 100.0 * tu,
           'densite_corps': float(np.sqrt(cu / c3)) if c3 > 0 else 0.0}
    sommets = V[np.unique(F[garder].reshape(-1))] if garder.any() else V[:0]
    res['hauteur_corps'] = float(np.ptp(sommets[:, axe_haut])) if len(sommets) else 0.0
    if taille:
        res['texture'] = int(taille)
        res['texels_par_unite'] = res['densite_corps'] * taille
        res['texels_sur_la_hauteur'] = res['densite_corps'] * taille * res['hauteur_corps']
    return res


def gain_utile_estime(gain, texels_par_unite, grille):
    """Gain de resolution VISIBLE : la couleur vient d'une grille de `grille` voxels par unite de longueur et n'a pas plus de detail que ses
    voxels. Une texture deja plus fine que la grille ne gagne rien a recevoir plus de texels ; une texture plus grossiere gagne au plus
    l'ecart a la grille. Rend min(gain, max(1, grille / texels_par_unite)) ; le gain tel quel si l'un des deux est inconnu."""
    if not texels_par_unite or not grille:
        return float(gain)
    return float(min(gain, max(1.0, grille / texels_par_unite)))


def mesurer(acc, chemin, axe_haut=1, tout_est_corps=False):
    V, F, UV, taille = charger_glb_uv(chemin)
    if tout_est_corps:
        garder = np.ones(len(F), bool)
    else:
        garder, rapport = acc.masque_dalle_sol(V, F, axe_haut)
        if not rapport:
            garder = np.ones(len(F), bool)
    r = part_atlas(V, F, UV, garder, taille, axe_haut)
    r['fichier'] = os.path.basename(chemin)
    r['detecteur'] = 'retire' if not garder.all() else 'inchange'
    return r


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('avant')
    ap.add_argument('apres', nargs='?')
    ap.add_argument('--axe', type=int, default=1)
    ap.add_argument('--grille', type=int, default=None, help='voxels par unite de longueur de la grille de couleur (1024 en 1024_cascade)')
    ap.add_argument('--json', default=None)
    a = ap.parse_args(argv)
    acc = charger_module()
    avant = mesurer(acc, a.avant, a.axe)
    sortie = {'avant': avant}
    print('AVANT  %s : %d faces, detecteur %s' % (avant['fichier'], avant['faces'], avant['detecteur']))
    print('   ce qui part : %.1f %% de l\'aire de surface, %.1f %% de l\'atlas ; le corps garde %.1f %% de l\'atlas (occupation du carre UV %.1f %%)' % (
        avant['aire_3d_retiree_pct'], avant['atlas_retire_pct'], avant['atlas_corps_pct'], avant['occupation_pct']))
    if 'texels_par_unite' in avant:
        print('   corps : %.0f texels par unite de longueur (texture %d), %.0f texels sur sa hauteur (%.3f)' % (
            avant['texels_par_unite'], avant['texture'], avant['texels_sur_la_hauteur'], avant['hauteur_corps']))
    part_corps = 1.0 - avant['aire_3d_retiree_pct'] / 100.0
    if part_corps > 0:
        sortie['gain_lineaire_estime'] = 1.0 / float(np.sqrt(part_corps))
        print('   estimation sans GPU du gain lineaire de resolution du corps si la dalle est retiree AVANT le depliage : x%.2f '
              '(1 / racine de la part d\'aire du corps)' % sortie['gain_lineaire_estime'])
        if a.grille and avant.get('texels_par_unite'):
            avant['texels_par_voxel'] = avant['texels_par_unite'] / a.grille
            sortie['gain_visible_estime'] = gain_utile_estime(sortie['gain_lineaire_estime'], avant['texels_par_unite'], a.grille)
            print('   texels par voxel de la grille (%d) : %.2f (moins de 1 : la texture est plus grossiere que la couleur generee) ; '
                  'gain VISIBLE estime, plafonne par la grille : x%.2f' % (a.grille, avant['texels_par_voxel'], sortie['gain_visible_estime']))
    if a.apres:
        apres = mesurer(acc, a.apres, a.axe, tout_est_corps=True)
        sortie['apres'] = apres
        print('APRES  %s : %d faces' % (apres['fichier'], apres['faces']))
        print('   le corps garde %.1f %% de l\'atlas (occupation du carre UV %.1f %%)' % (apres['atlas_corps_pct'], apres['occupation_pct']))
        if 'texels_par_unite' in apres:
            print('   corps : %.0f texels par unite de longueur (texture %d), %.0f texels sur sa hauteur (%.3f)' % (
                apres['texels_par_unite'], apres['texture'], apres['texels_sur_la_hauteur'], apres['hauteur_corps']))
        if avant.get('texels_par_unite') and apres.get('texels_par_unite'):
            sortie['gain_lineaire_mesure'] = apres['texels_par_unite'] / avant['texels_par_unite']
            print('   GAIN LINEAIRE MESURE de resolution du corps : x%.2f' % sortie['gain_lineaire_mesure'])
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump(sortie, f, indent=1, ensure_ascii=False)
        print('ecrit', a.json)
    return 0


if __name__ == '__main__':
    sys.exit(main())
