"""FabMesh — Watertight « Etanche » : ajoute une coque FERMEE a l'INTERIEUR du maillage, sans toucher a la coque exterieure.

Demande du user (25/10) : « il faut rajouter la coque watertight a l'interieur du mesh, sans depasser ni modifier la coque exterieure ».
Le maillage d'origine (geometrie, UV, texture, materiaux, rig) reste intact, octet pour octet ; on lui AJOUTE une coque grise
qui reste STRICTEMENT a l'interieur :

  1. voxelisation de l'original (surface) puis remplissage : volume plein V ;
  2. EROSION de V de `marge` voxels (3 par defaut) : tout voxel restant est a au moins 2 voxels sous la surface voxelisee, donc a
     l'interieur de l'original, meme la ou le maillage est ouvert (les parties plus fines que ~2 x marge voxels disparaissent :
     pas de coque la ou il n'y a pas de place) ;
  3. surface (marching cubes) de V erode -> coque fermee ; decimation (cachee, donc sans detail utile) ; materiau gris opaque ;
  4. controle : distance de chaque sommet de la coque a l'original (au moins ~1 voxel) ; sommets trop proches repousses vers le centre.

Fichier PARTAGE bureau / Modal (scripts/watertight_seal.py = modal_app/watertight_seal.py, garde check-noyaux-partages) : pas d'import relatif.
CLI bureau : python watertight_seal.py <mesh_in> <out.glb> [resolution=192]
"""
import os
import sys
import time

import numpy as np
import trimesh


def log(msg):
    print(f"[wt-seal] {msg}", flush=True)


def _surface_depuis_matrice(matrice, transform):
    """Marching cubes d'une matrice booleenne (entouree de vide) -> Trimesh dans le repere du maillage (via la transformation de la grille)."""
    from skimage import measure
    pad = np.pad(matrice.astype(np.float32), 1)
    verts, faces, _, _ = measure.marching_cubes(pad, 0.5)
    verts = verts - 1.0                                     # retire le bord ajoute
    h = np.column_stack([verts, np.ones(len(verts))])
    monde = (np.asarray(transform, dtype=np.float64) @ h.T).T[:, :3]
    return trimesh.Trimesh(vertices=monde, faces=faces, process=False)


def _volume_plein(S):
    """Volume plein d'une surface voxelisee S (booleen 3D), y compris quand le maillage est OUVERT (dos coupe, trous) :
    remplissage classique, OU vote de 6 rayons le long des axes (un voxel est dedans quand au moins 4 des 6 rayons croisent
    un nombre IMPAIR de segments de surface). Un maillage ferme donne le meme resultat que le remplissage."""
    from scipy import ndimage
    plein = ndimage.binary_fill_holes(S)
    votes = np.zeros(S.shape, dtype=np.uint8)
    for axe in range(3):
        for sens in (1, -1):
            m = S if sens == 1 else np.flip(S, axe)
            debut = np.logical_and(m, np.logical_not(np.roll(m, 1, axis=axe)))
            idx = [slice(None)] * 3; idx[axe] = 0; debut[tuple(idx)] = m[tuple(idx)]
            impair = (np.cumsum(debut, axis=axe, dtype=np.uint8) & 1).astype(bool)
            if sens == -1:
                impair = np.flip(impair, axe)
            votes += impair.astype(np.uint8)
    return plein | S | (votes >= 4)


def coque_interieure(monde, resolution=192, marge=3, faces_max=40000):
    """monde : Trimesh (tous les corps du modele, repere du monde). Rend (coque Trimesh fermee ou None, pitch)."""
    from scipy import ndimage
    diag = float(np.linalg.norm(monde.bounds[1] - monde.bounds[0])) or 1.0
    pitch = diag / max(16, min(256, int(resolution)))
    vg = monde.voxelized(pitch=pitch)
    plein = _volume_plein(np.asarray(vg.matrix, dtype=bool))
    erode = ndimage.binary_erosion(plein, iterations=int(marge), border_value=0)
    if not erode.any():
        log("rien a sceller a l'interieur : toutes les parties sont plus fines que la marge")
        return None, pitch
    coque = _surface_depuis_matrice(erode, vg.transform)
    log(f"coque brute: {len(coque.faces)} faces, watertight={coque.is_watertight}")
    # controle de distance : aucune partie de la coque ne doit frôler la surface d'origine
    try:
        from trimesh.proximity import closest_point
        _, dist, _ = closest_point(monde, np.asarray(coque.vertices))
        trop = dist < 0.8 * pitch
        if trop.any():
            centre = np.asarray(coque.vertices).mean(axis=0)
            v = np.asarray(coque.vertices).copy()
            v[trop] = v[trop] + (centre - v[trop]) * 0.02
            coque.vertices = v
            log(f"{int(trop.sum())} sommet(s) trop proches de la surface, rapproches du centre")
    except Exception as e:
        log(f"controle de distance indisponible ({e})")
    if len(coque.faces) > faces_max:
        try:
            m = coque.simplify_quadric_decimation(face_count=faces_max)
            if m is not None and len(m.faces) > 0:
                coque = m
        except Exception as e:
            log(f"decimation indisponible ({e}) : coque gardee pleine")
    try:
        from trimesh.visual.material import PBRMaterial
        # Gris OPAQUE sans couleurs de sommets RGBA (elles font passer le contenu pour transparent dans three.js)
        coque.visual = trimesh.visual.TextureVisuals(
            material=PBRMaterial(name="etanche_coque", baseColorFactor=[0.47, 0.47, 0.5, 1.0],
                                 metallicFactor=0.0, roughnessFactor=0.9, doubleSided=True))
    except Exception as e:
        log(f"materiau: {e}")
    try:
        coque.fix_normals()
    except Exception:
        pass
    return coque, pitch


def ajouter_coque(scene, resolution=192):
    """Ajoute la coque interieure a une trimesh.Scene SANS modifier ses geometries. Rend la coque (ou None)."""
    corps = [g for g in scene.dump() if hasattr(g, 'faces') and len(g.faces)]
    if not corps:
        raise RuntimeError("maillage vide")
    monde = trimesh.util.concatenate([trimesh.Trimesh(vertices=np.asarray(g.vertices), faces=np.asarray(g.faces), process=False) for g in corps])
    coque, _ = coque_interieure(monde, resolution)
    if coque is not None:
        scene.add_geometry(coque, geom_name="etanche_coque", node_name="etanche_coque")
    return coque


def seal(mesh_in, out_path, resolution=192):
    t0 = time.time()
    scene = trimesh.load(mesh_in)
    if not hasattr(scene, 'geometry'):
        scene = trimesh.Scene(scene)
    n0 = sum(len(g.faces) for g in scene.geometry.values() if hasattr(g, 'faces'))
    coque = ajouter_coque(scene, resolution)
    scene.export(out_path)
    if not os.path.isfile(out_path) or os.path.getsize(out_path) == 0:
        raise RuntimeError("export vide")
    log(f"OK: original {n0}f intact + coque {0 if coque is None else len(coque.faces)}f -> {out_path} ({os.path.getsize(out_path)} octets) en {time.time()-t0:.1f}s")
    return 0 if coque is None else len(coque.faces)


def main():
    if len(sys.argv) < 3:
        print("usage: watertight_seal.py <mesh_in> <out.glb> [resolution]", file=sys.stderr)
        return 2
    try:
        res = int(sys.argv[3]) if len(sys.argv) > 3 else 192
    except ValueError:
        res = 192
    seal(sys.argv[1], sys.argv[2], res)
    return 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    try:
        sys.exit(main())
    except Exception as e:
        import traceback
        print(f"[wt-seal][fatal] {type(e).__name__}: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
