"""Recolorier la texture d'un GLB (bureau). Meme noyau que Modal (scripts/recolor_atlas.py = modal_app/recolor_atlas.py).

Usage : mesh_recolor.py <entree.glb> <sortie.glb> --color '#rrggbb' [--intensity 1.0] [--mask masque.png]
La luminance de chaque texel est gardee ; --mask (blanc = zone, meme repere que « Re-texture a region ») limite l'effet a une partie.
Ne touche ni la forme, ni les UV, ni les autres cartes. Code de sortie 2 : pas de texture couleur ; 3 : couleur invalide.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image  # noqa: E402
import trimesh  # noqa: E402
from recolor_atlas import recolorer_image  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('entree')
    ap.add_argument('sortie')
    ap.add_argument('--color', required=True)
    ap.add_argument('--intensity', type=float, default=1.0)
    ap.add_argument('--mask', default=None)
    a = ap.parse_args()
    scene = trimesh.load(a.entree, force='scene')
    masque_brut = Image.open(a.mask).convert('L') if a.mask else None
    vus, nb = set(), 0
    for g in scene.geometry.values():
        mat = getattr(getattr(g, 'visual', None), 'material', None)
        tex = getattr(mat, 'baseColorTexture', None) if mat is not None else None
        if tex is None or id(mat) in vus:
            continue
        vus.add(id(mat))
        masque = masque_brut.resize(tex.size, Image.LANCZOS) if masque_brut is not None else None
        try:
            mat.baseColorTexture = recolorer_image(tex, a.color, a.intensity, masque)
        except ValueError as e:
            print(f'ERREUR {e}', flush=True)
            sys.exit(3)
        nb += 1
    if nb == 0:
        print("ERREUR ce maillage n'a pas de texture couleur a recolorier", flush=True)
        sys.exit(2)
    scene.export(a.sortie)
    print(f'DONE {nb} texture(s) recoloree(s) -> {a.sortie}', flush=True)


if __name__ == '__main__':
    main()
