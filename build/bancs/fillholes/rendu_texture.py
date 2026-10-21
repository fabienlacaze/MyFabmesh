# -*- coding: utf-8 -*-
"""Rendu TEXTURE a faces simples, en numpy (20/10/2026) : ce que montre la visionneuse de l'appli (mat.side = FrontSide), sans
GPU. Camera orthographique, eclairage doux fixe, texture echantillonnee au plus proche voisin, fond clair. Sert a REGARDER une
zone du diagnostic (avec l'apparence reelle, texture comprise) a cote de sa carte de causes.

Usage :  python rendu_texture.py <glb> <sortie.png> --dir x,y,z [--taille 768] [--zoom cx,cy,cz,rayon_rel]
  --dir  : direction de visee (la camera regarde vers +dir)
  --zoom : centre en coordonnees relatives a la boite (0..1) et demi-largeur en fraction de la diagonale
  --double : rendu double face (par defaut : faces simples)
"""
import argparse
import io
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_lecture import Glb, fusionner  # noqa: E402
from rasteur import Camera, rasteriser_triangles  # noqa: E402


def charger_texture(g, mats, max_cote=2048):
    from PIL import Image
    texs = {}
    for m in mats:
        if m['image'] is None:
            continue
        octets, _ = g.octets_image(m['image'])
        if octets is None:
            continue
        im = Image.open(io.BytesIO(octets)).convert('RGB')
        k = max(1, max(im.size) // max_cote)
        if k > 1:
            im = im.reduce(k)
        texs[m['index']] = np.asarray(im)
    return texs


def rendre(chemin, d, S=768, zoom=None, double_face=False):
    g = Glb(chemin)
    prims = g.primitives()
    V, F, UV, mat, pid = fusionner(prims)
    mats = g.materiaux()
    texs = charger_texture(g, mats)
    lo, hi = V.min(0), V.max(0)
    diag = float(np.linalg.norm(hi - lo))
    centre = (lo + hi) / 2
    rayon = float(np.linalg.norm(V - centre, axis=1).max())
    if zoom is not None:
        cr, demi = zoom[:3], zoom[3]
        centre = lo + np.asarray(cr) * (hi - lo)
        rayon = demi * diag
    cam = Camera(centre, rayon, d, S, marge=1.0)
    px, py, z = cam.projeter(V)
    N = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    ln = np.linalg.norm(N, axis=1)
    un = np.divide(N, ln[:, None], out=np.zeros_like(N), where=ln[:, None] > 0)
    avant = (N @ cam.d) < 0
    ok = ln > 0
    idx = np.nonzero((ok if double_face else (avant & ok)))[0]
    zF, idF = rasteriser_triangles(px[F[idx]], py[F[idx]], z[F[idx]], idx.astype(np.int32), S)
    idF = idF.reshape(S, S)
    img = np.full((S, S, 3), 244, np.uint8)
    yy, xx = np.nonzero(idF >= 0)
    f = idF[yy, xx]
    # barycentriques au centre du pixel
    x0, x1, x2 = px[F[f, 0]], px[F[f, 1]], px[F[f, 2]]
    y0, y1, y2 = py[F[f, 0]], py[F[f, 1]], py[F[f, 2]]
    pxc, pyc = xx + 0.5, yy + 0.5
    den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    den = np.where(np.abs(den) < 1e-12, 1e-12, den)
    l0 = ((y1 - y2) * (pxc - x2) + (x2 - x1) * (pyc - y2)) / den
    l1 = ((y2 - y0) * (pxc - x2) + (x0 - x2) * (pyc - y2)) / den
    l2 = 1.0 - l0 - l1
    col = np.full((len(f), 3), 150.0)
    if UV is not None:
        u = l0 * UV[F[f, 0], 0] + l1 * UV[F[f, 1], 0] + l2 * UV[F[f, 2], 0]
        v = l0 * UV[F[f, 0], 1] + l1 * UV[F[f, 1], 1] + l2 * UV[F[f, 2], 1]
        for mi, t in texs.items():
            sel = mat[f] == mi
            if not sel.any():
                continue
            H, W = t.shape[:2]
            ix = np.clip((u[sel] % 1.0 * W).astype(int), 0, W - 1)
            iy = np.clip((v[sel] % 1.0 * H).astype(int), 0, H - 1)
            col[sel] = t[iy, ix]
    sh = 0.55 + 0.45 * np.abs(un[f] @ (-cam.d))
    img[yy, xx] = (col * sh[:, None]).clip(0, 255).astype(np.uint8)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('sortie')
    ap.add_argument('--dir', required=True)
    ap.add_argument('--taille', type=int, default=768)
    ap.add_argument('--zoom')
    ap.add_argument('--double', action='store_true', help='rendu double face (par defaut : faces simples, comme la visionneuse)')
    a = ap.parse_args()
    from PIL import Image
    d = [float(x) for x in a.dir.split(',')]
    zoom = [float(x) for x in a.zoom.split(',')] if a.zoom else None
    img = rendre(a.glb, d, a.taille, zoom, a.double)
    os.makedirs(os.path.dirname(os.path.abspath(a.sortie)), exist_ok=True)
    Image.fromarray(img).save(a.sortie)
    print(a.sortie)


if __name__ == '__main__':
    main()
