# -*- coding: utf-8 -*-
"""Banc d'evaluation de la detection de trous (Fill holes) : GENERATEUR DE CAS AVEC VERITE TERRAIN (2026-10-26).

Pourquoi : le detecteur d'aretes de bord ne voit pas les trous de PEAU des maillages TRELLIS (double peau, peau collee). On fabrique donc des
maillages dont on SAIT ou sont les trous, a partir de la moissonneuse saine (C:/tmp/moissonneuse.glb, 514 139 faces, une seule peau).

Tout est ecrit HORS du depot (le depot est public) : C:/tmp/fillbench/cases/<cas>.glb + C:/tmp/fillbench/verite.json.

Conventions (voir aussi C:/tmp/fillbench/LISEZMOI.md) :
  * diag      = diagonale de la boite englobante du maillage de depart (unites du maillage).
  * taille    = DIAMETRE du trou / diag. Trous a boucher : 0,3 % a 8 %. Ouvertures voulues (fenetres) : 15 % a 30 %.
  * max_trou_relatif = 0,10 : un trou de diametre > 10 % de diag est une ouverture legitime, a laisser.
  * rayon     = RAYON CIRCONSCRIT reel du trou (distance maximale du centre aux centres des faces retirees), en unites du maillage.
  * Les GLB contiennent 1 ou 2 geometries : 'peau_ext' (UV + texture 1024) et, sauf pour la peau simple, 'peau_int' (couleur unie, normales inversees).
  * Reproductible : graine fixe par cas. Relancer = memes fichiers.

Lancer :  python build/bancs/noyaux/fillbench_generer.py [--cas motif] [--sortie C:/tmp/fillbench]
"""
import argparse
import json
import os
import sys
import time

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

import trimesh

SOURCE_MOISSON = os.environ.get('FILLBENCH_MOISSON', 'C:/tmp/moissonneuse.glb')
SOURCE_BATEAU = os.environ.get('FILLBENCH_BATEAU', 'C:/tmp/benchy/e6dc04bd64284e7aaeda9876331cbee8.glb')
SOURCE_PIKACHU = os.environ.get('FILLBENCH_PIKACHU', 'C:/tmp/pikachu.glb')
SORTIE = os.environ.get('FILLBENCH_SORTIE', 'C:/tmp/fillbench')
MAX_TROU_RELATIF = 0.10
TAILLES = {'petit': (0.003, 0.010), 'moyen': (0.010, 0.030), 'grand': (0.030, 0.080)}
TEXTURE_PX = 1024
CASES_DIR = 'cases'


# ----------------------------------------------------------------------------------------------------------------------------------------
# Chargement / soudure
# ----------------------------------------------------------------------------------------------------------------------------------------
def charger_glb(chemin):
    """(V, F, uv, image PIL ou None) du premier maillage d'un GLB, sans fusion de sommets."""
    sc = trimesh.load(chemin, force='scene', process=False)
    g = list(sc.geometry.values())[0]
    uv = getattr(g.visual, 'uv', None)
    img = None
    mat = getattr(g.visual, 'material', None)
    if mat is not None:
        img = getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)
    return (np.asarray(g.vertices, dtype=np.float64), np.asarray(g.faces, dtype=np.int64),
            None if uv is None else np.asarray(uv, dtype=np.float64), img)


def souder(V, tol_rel=1e-6):
    """Soudure par position (arbre spatial, tolerance relative a la diagonale). Rend (etiquette par sommet, Vw)."""
    diag = float(np.linalg.norm(V.max(0) - V.min(0)))
    tol = tol_rel * diag
    paires = cKDTree(V).query_pairs(tol, output_type='ndarray')
    n = len(V)
    if len(paires):
        g = coo_matrix((np.ones(len(paires), dtype=np.int8), (paires[:, 0], paires[:, 1])), shape=(n, n))
        _, lab = connected_components(g, directed=False)
    else:
        lab = np.arange(n)
    nw = int(lab.max()) + 1
    cnt = np.bincount(lab, minlength=nw).astype(np.float64)
    Vw = np.stack([np.bincount(lab, weights=V[:, k], minlength=nw) for k in range(3)], axis=1) / cnt[:, None]
    return lab, Vw


def normales_sommets(Vw, Fw):
    fn = np.cross(Vw[Fw[:, 1]] - Vw[Fw[:, 0]], Vw[Fw[:, 2]] - Vw[Fw[:, 0]])      # longueur = 2 x aire : pondere par l'aire
    n = np.zeros_like(Vw)
    for k in range(3):
        for c in range(3):
            n[:, c] += np.bincount(Fw[:, k], weights=fn[:, c], minlength=len(Vw))
    ln = np.linalg.norm(n, axis=1)
    n[ln > 0] /= ln[ln > 0, None]
    return n


class Base:
    """La moissonneuse preparee : exterieur d'origine (UV conservees), topologie soudee, caracteristiques locales."""

    def __init__(self, chemin=SOURCE_MOISSON):
        t0 = time.time()
        V0, F0, uv0, img = charger_glb(chemin)
        lab, Vw = souder(V0)
        Fw = lab[F0]
        ok = (Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])
        self.V0, self.uv0, self.F0, self.Fw = V0, uv0, F0[ok], Fw[ok]
        self.lab, self.Vw = lab, Vw
        self.img = img
        self.profondeur = None
        self.exige = 0.0
        self._caracteriser()
        print('base prete : %d faces, diag %.4f, sens %+d, %.1f s' % (self.nF, self.diag, self.sens, time.time() - t0), flush=True)

    @classmethod
    def depuis_solide(cls, chemin=SOURCE_MOISSON, N=300, ferme_vox=10):
        """Base v2 : peau SIMPLE propre. La moissonneuse est faite de feuilles jumelles quasi confondues (ecart ~1e-4 de la diagonale, normales
        opposees, orientation melangee) : aucune normale fiable. On en tire donc le SOLIDE (voxels, flot depuis l'exterieur), puis sa surface
        (cubes marchants) : fermee, orientee vers l'exterieur, une seule feuille. Texture : aucune (couleur unie)."""
        from scipy.ndimage import binary_dilation, distance_transform_edt, gaussian_filter, label, map_coordinates
        from skimage import measure
        t0 = time.time()
        V, F, _, _ = charger_glb(chemin)
        lo, hi = V.min(0), V.max(0)
        h = float((hi - lo).max()) / (N - 8)
        org = lo - 4 * h
        dims = np.ceil((hi - lo) / h).astype(int) + 8
        m = trimesh.Trimesh(V, F, process=False)
        n_pts = int(m.area / (0.35 * h) ** 2)
        pts, _ = trimesh.sample.sample_surface(m, n_pts, seed=7)
        idx = np.floor((pts - org) / h).astype(int)
        occ = np.zeros(dims, dtype=bool)
        occ[idx[:, 0], idx[:, 1], idx[:, 2]] = True
        occ = binary_dilation(occ, iterations=1)
        # fermeture spherique (rayon ferme_vox) : les feuilles minces deviennent un corps epais, sinon aucune peau interieure ne tient dessous
        proche = distance_transform_edt(~occ) <= ferme_vox
        lab3, _ = label(~proche)
        solide = lab3 != lab3[0, 0, 0]
        solide = distance_transform_edt(solide) > ferme_vox
        solide |= occ
        champ = gaussian_filter(solide.astype(np.float32), 1.0)
        verts, faces, _, _ = measure.marching_cubes(champ, 0.5)
        # on garde les gros morceaux
        from scipy.sparse import coo_matrix as cm
        a = faces
        g = cm((np.ones(len(a) * 3, dtype=np.int8), (np.concatenate([a[:, 0], a[:, 1], a[:, 2]]), np.concatenate([a[:, 1], a[:, 2], a[:, 0]]))),
               shape=(len(verts), len(verts)))
        _, lv = connected_components(g, directed=False)
        taille = np.bincount(lv[faces[:, 0]])
        faces = faces[taille[lv[faces[:, 0]]] >= 2000]
        used = np.unique(faces)
        rem = -np.ones(len(verts), dtype=np.int64)
        rem[used] = np.arange(len(used))
        faces, verts = rem[faces], verts[used]
        edt = distance_transform_edt(solide) * h
        P = verts * h + org
        vol = np.einsum('ij,ij->i', P[faces[:, 0]], np.cross(P[faces[:, 1]], P[faces[:, 2]])).sum() / 6.0
        if vol < 0:
            faces = faces[:, ::-1]                              # enroulement sortant
        self = cls.__new__(cls)
        self.V0 = self.Vw = P
        self.F0 = self.Fw = faces.astype(np.int64)
        self.uv0 = np.stack([(P[:, 0] - lo[0]) / (hi[0] - lo[0]), (P[:, 1] - lo[1]) / (hi[1] - lo[1])], axis=1)
        self.lab = np.arange(len(P))
        self.img = None
        self.profondeur = True
        self.edt, self.org, self.h = edt, org, h
        self.s_int = None
        self.exige = 0.0
        self._caracteriser()
        print('base v2 (solide) prete : %d faces, diag %.4f, voxel %.4f, sens %+d, %.1f s' % (self.nF, self.diag, h, self.sens, time.time() - t0),
              flush=True)
        return self

    def _caracteriser(self):
        V0, Vw = self.V0, self.Vw
        self.diag = float(np.linalg.norm(V0.max(0) - V0.min(0)))
        self.nF = len(self.F0)
        vol = np.einsum('ij,ij->i', Vw[self.Fw[:, 0]], np.cross(Vw[self.Fw[:, 1]], Vw[self.Fw[:, 2]])).sum() / 6.0
        self.sens = 1.0 if vol > 0 else -1.0                 # +1 : normales sortantes
        self.nv = normales_sommets(Vw, self.Fw) * self.sens
        P = Vw[self.Fw]
        self.cent = P.mean(axis=1)
        fn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        ln = np.linalg.norm(fn, axis=1)
        ln[ln == 0] = 1.0
        self.fn = fn / ln[:, None] * self.sens
        m = trimesh.Trimesh(Vw, self.Fw, process=False)
        adj = np.asarray(m.face_adjacency)
        ang = np.asarray(m.face_adjacency_angles)
        self.adj = adj
        vifs = np.unique(adj[ang > np.radians(35 if self.profondeur is not None else 50)].ravel())
        self.tree = cKDTree(self.cent)
        near_sharp = np.zeros(self.nF, dtype=bool)
        if len(vifs):
            d, _ = cKDTree(self.cent[vifs]).query(self.cent)
            near_sharp = d < 0.01 * self.diag
        _, nn = self.tree.query(self.cent, k=20)
        res = np.linalg.norm(self.fn[nn].mean(axis=1), axis=1)
        libre = ~near_sharp
        q1, q2 = np.quantile(res[libre], [0.4, 0.6])
        self.ctx = {'plat': np.nonzero(libre & (res >= q2))[0], 'courbe': np.nonzero(libre & (res <= q1))[0],
                    'arete_vive': np.nonzero(near_sharp)[0]}

    # -- trous -----------------------------------------------------------------------------------------------------------------------
    def region(self, seed, diametre, forme, rng):
        """Indices de faces d'un trou centre sur la face seed. diametre en unites du maillage."""
        r = diametre / 2.0
        s = self.cent[seed]
        n = self.fn[seed]
        a = np.cross(n, rng.normal(size=3))
        a /= np.linalg.norm(a) + 1e-12
        b = np.cross(n, a)
        cand = np.array(self.tree.query_ball_point(s, r * 2.6), dtype=np.int64)
        cand = cand[(self.fn[cand] @ n) > 0.0]
        d = self.cent[cand] - s
        u, v = d @ a, d @ b
        if forme == 'rond':
            dedans = (u * u + v * v) <= r * r
        elif forme == 'allonge':
            dedans = (u / r) ** 2 + (v / (0.35 * r)) ** 2 <= 1.0
        else:                                                   # irregulier : rayon modulé par l'angle
            th = np.arctan2(v, u)
            p1, p2 = rng.uniform(0, 2 * np.pi, 2)
            rr = r * (1 + 0.35 * np.sin(3 * th + p1) + 0.2 * np.sin(5 * th + p2)) / 1.4
            dedans = np.hypot(u, v) <= rr
        sel = cand[dedans]
        if seed not in sel:
            sel = np.append(sel, seed)
        # fermeture : une face avec au moins 2 voisines retirees l'est aussi (pas d'ilot ni de pont d'un sommet : le trou reste un disque)
        masque = np.zeros(self.nF, dtype=bool)
        masque[sel] = True
        for _ in range(4):
            rows = self.adj[masque[self.adj[:, 0]] | masque[self.adj[:, 1]]]
            nb = np.bincount(np.concatenate([rows[:, 0][masque[rows[:, 1]]], rows[:, 1][masque[rows[:, 0]]]]), minlength=self.nF)
            ajout = np.nonzero((nb >= 2) & ~masque)[0]
            ajout = ajout[(self.fn[ajout] @ n) > 0.0]
            if len(ajout) == 0:
                break
            masque[ajout] = True
        sel = np.nonzero(masque)[0]
        # composante connexe contenant la graine
        loc = {int(f): i for i, f in enumerate(sel)}
        pairs = [(loc[int(x)], loc[int(y)]) for x, y in self.adj[np.isin(self.adj[:, 0], sel) & np.isin(self.adj[:, 1], sel)]]
        if pairs:
            p = np.array(pairs)
            g = coo_matrix((np.ones(len(p), dtype=np.int8), (p[:, 0], p[:, 1])), shape=(len(sel), len(sel)))
            _, lab = connected_components(g, directed=False)
            sel = sel[lab == lab[loc[int(seed)]]]
        else:
            sel = np.array([seed])
        return np.unique(sel)

    def nboucles(self, sel):
        """Nombre de pourtours du trou (composantes connexes des aretes entre faces retirees et conservees) : 1 = un disque propre."""
        masque = np.zeros(self.nF, dtype=bool)
        masque[sel] = True
        rows = self.adj[masque[self.adj[:, 0]] != masque[self.adj[:, 1]]]
        if len(rows) == 0:
            return 0
        A, B = self.Fw[rows[:, 0]], self.Fw[rows[:, 1]]
        comm = (A[:, :, None] == B[:, None, :])
        a_ok = comm.any(axis=2)                                   # sommets de A presents dans B
        idx = np.argsort(~a_ok, axis=1, kind='stable')[:, :2]
        u = np.take_along_axis(A, idx[:, :1], axis=1)[:, 0]
        w = np.take_along_axis(A, idx[:, 1:2], axis=1)[:, 0]
        vs, inv = np.unique(np.concatenate([u, w]), return_inverse=True)
        n = len(vs)
        g = coo_matrix((np.ones(len(u), dtype=np.int8), (inv[:len(u)], inv[len(u):])), shape=(n, n))
        return int(connected_components(g, directed=False)[0])

    Vin_courant = None

    def visible_ok(self, sel, seuil=0.8):
        m = np.ones(self.nF, dtype=bool)
        m[sel] = False
        Fe = self.F0[m]
        Vall = np.concatenate([self.V0, self.Vin_courant])
        Fall = np.concatenate([Fe, self.Fw[:, [0, 2, 1]] + len(self.V0)])
        nrm = self.fn[sel].mean(axis=0)
        c = self.cent[sel].mean(axis=0)
        ray = float(np.linalg.norm(self.cent[sel] - c, axis=1).max())
        return visibilite_trou(Vall, Fall, len(Fe) + sel, c, nrm, ray, self.diag) >= seuil

    def planifier(self, rng, n, tailles, formes, contextes, deja=(), diametres=None):
        """n trous disjoints. Rend une liste de dict (faces, centre, rayon, taille, forme, contexte)."""
        out = []
        occupe = [(np.asarray(c), r) for c, r in deja]
        essais = 0
        dernier_ok = 0
        while len(out) < n and essais < 2500:
            essais += 1
            i = len(out)
            ctx = contextes[int(rng.integers(len(contextes)))] if i >= len(contextes) else contextes[i]
            bande = tailles[int(rng.integers(len(tailles)))] if i >= len(tailles) else tailles[i]
            if essais - dernier_ok > 120 and diametres is None:         # cette tranche de taille ne trouve pas de place : on prend plus petit
                bande = ['petit', 'moyen'][int(rng.integers(2))]
            forme = formes[int(rng.integers(len(formes)))]
            pool = self.ctx[ctx]
            seed = int(pool[rng.integers(len(pool))])
            lo, hi = TAILLES[bande] if diametres is None else diametres
            dia_rel = float(np.exp(rng.uniform(np.log(lo), np.log(hi))))
            dia = dia_rel * self.diag
            c0 = self.cent[seed]
            if any(np.linalg.norm(c0 - c) < 1.3 * (r + dia) + 0.01 * self.diag for c, r in occupe):
                continue
            sel = self.region(seed, dia, forme, rng)
            if len(sel) < 2:
                continue
            if self.profondeur is not None and self.exige > 0 and self.s_int is not None and self.s_int[self.Fw[sel]].min() < 0.999 * self.exige:
                continue                                     # mur trop mince : la peau interieure serait collee a l'exterieure sous ce trou
            if diametres is None and self.Vin_courant is not None and self.s_int is not None and not self.visible_ok(sel):
                continue                                     # l'interieur ne se verrait pas de l'exterieur sous ce trou (creux, courbure)
            centre = self.cent[sel].mean(axis=0)
            rayon = float(np.linalg.norm(self.cent[sel] - centre, axis=1).max())
            if any(np.linalg.norm(centre - c) < 1.3 * (r + rayon) + 0.01 * self.diag for c, r in occupe):
                continue
            if diametres is None and self.nboucles(sel) != 1:
                continue
            if diametres is None and 2 * rayon / self.diag > 0.09:
                continue
            if diametres is not None and 2 * rayon / self.diag < 0.14:
                continue
            occupe.append((centre, rayon))
            dernier_ok = essais
            out.append({'faces': sel, 'centre': centre, 'rayon': rayon, 'taille': bande if diametres is None else 'fenetre',
                        'diametre_rel': float(2 * rayon / self.diag), 'forme': forme, 'contexte': ctx})
        if len(out) < n:
            print('  attention : %d trous sur %d demandes' % (len(out), n), flush=True)
        return out

    # -- fabrication -----------------------------------------------------------------------------------------------------------------
    def interieur(self, epaisseur_rel):
        t = epaisseur_rel * self.diag
        self.exige = t
        if self.profondeur is None:
            return self.Vw - self.nv * t
        from scipy.ndimage import map_coordinates
        # decalage par sommet : le plus grand parmi t, .75t, ... dont le point reste DANS le solide avec un degagement >= 0,8 x decalage
        # (sinon mur trop mince : decalage nul = peau interieure collee a l'exterieure, jamais au-dessus)
        s = np.zeros(len(self.Vw))
        fait = np.zeros(len(self.Vw), dtype=bool)
        for k in (1.0, 0.75, 0.5, 0.35, 0.25, 0.15):
            pt = self.Vw - self.nv * (k * t)
            e = map_coordinates(self.edt, ((pt - self.org) / self.h).T, order=1) * 1.0
            ok = (~fait) & (e >= 0.8 * k * t)
            s[ok] = k * t
            fait |= ok
        self.s_int = s
        self.Vin_courant = self.Vw - self.nv * s[:, None]
        return self.Vw - self.nv * s[:, None]

    def colle_rive(self, Vin, trou, rng, fraction):
        """Soude (positions identiques) les sommets interieurs situes sous le bord du trou, sur un arc de 'fraction' du pourtour."""
        sel = trou['faces']
        reste = np.ones(self.nF, dtype=bool)
        reste[sel] = False
        rive = np.intersect1d(np.unique(self.Fw[sel]), np.unique(self.Fw[reste]))
        if len(rive) == 0:
            return 0
        if fraction < 1.0:
            n = self.fn[sel].mean(axis=0)
            n /= np.linalg.norm(n) + 1e-12
            a = np.cross(n, rng.normal(size=3))
            a /= np.linalg.norm(a) + 1e-12
            b = np.cross(n, a)
            d = self.Vw[rive] - trou['centre']
            th = np.mod(np.arctan2(d @ b, d @ a), 2 * np.pi)
            t0 = rng.uniform(0, 2 * np.pi)
            rive = rive[np.mod(th - t0, 2 * np.pi) <= 2 * np.pi * fraction]
        Vin[rive] = self.Vw[rive]
        return int(len(rive))

    def colle_taches(self, Vin, rng, n, exclusions):
        """n taches de peaux collees (aretes a 3-4 faces) loin des trous."""
        arbre = cKDTree(self.Vw)
        fait = 0
        for _ in range(n * 5):
            if fait >= n:
                break
            f = int(rng.integers(self.nF))
            c = self.cent[f]
            if any(np.linalg.norm(c - ce) < 3 * r + 0.02 * self.diag for ce, r in exclusions):
                continue
            rr = rng.uniform(0.004, 0.012) * self.diag
            idx = arbre.query_ball_point(c, rr)
            Vin[idx] = self.Vw[idx]
            fait += 1
        return fait

    def glb(self, chemin, retirees_ext, Vin=None, retirees_int=None):
        """Ecrit le GLB. retirees_ext : indices de faces retirees de la peau exterieure. Rend {'faces_ext': n, 'faces_int': n}."""
        ke = np.ones(self.nF, dtype=bool)
        if len(retirees_ext):
            ke[retirees_ext] = False
        tex = self._texture()
        if tex is not None:
            mat_e = trimesh.visual.material.PBRMaterial(baseColorTexture=tex, doubleSided=True, metallicFactor=0.0)
        else:
            mat_e = trimesh.visual.material.PBRMaterial(baseColorFactor=[230, 140, 40, 255], doubleSided=True, metallicFactor=0.0)
        ext = trimesh.Trimesh(self.V0, self.F0[ke], process=False,
                              visual=trimesh.visual.TextureVisuals(uv=self.uv0, material=mat_e))
        geoms = {'peau_ext': ext}
        nfi = 0
        if Vin is not None:
            ki = np.ones(self.nF, dtype=bool)
            if retirees_int is not None and len(retirees_int):
                ki[retirees_int] = False
            Fin = self.Fw[ki][:, [0, 2, 1]]
            mat_i = trimesh.visual.material.PBRMaterial(baseColorFactor=[150, 150, 150, 255], doubleSided=True, metallicFactor=0.0)
            inter = trimesh.Trimesh(Vin, Fin, process=False,
                                    visual=trimesh.visual.TextureVisuals(uv=np.zeros((len(Vin), 2)), material=mat_i))
            geoms['peau_int'] = inter
            nfi = len(Fin)
        self.derniere = None
        if Vin is not None:
            self.derniere = (np.concatenate([self.V0, Vin]), np.concatenate([self.F0[ke], Fin + len(self.V0)]), int(ke.sum()), ki)
        os.makedirs(os.path.dirname(chemin), exist_ok=True)
        trimesh.Scene(geoms).export(chemin)
        return {'faces_ext': int(ke.sum()), 'faces_int': nfi}

    def _texture(self):
        if getattr(self, '_tex', None) is None:
            im = self.img
            if im is not None and max(im.size) > TEXTURE_PX:
                im = im.resize((TEXTURE_PX, TEXTURE_PX))
            self._tex = im
        return self._tex


def visibilite_trou(V, F, ids, centre, normale, rayon, diag):
    """Part (0..1) des faces 'ids' (peau interieure sous un trou) VISIBLES de l'exterieur, vue le long de -normale (carte de profondeur, tout le maillage)."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'scripts'))
    import bouchage_peau as PE
    d = -np.asarray(normale, dtype=np.float64)
    d /= np.linalg.norm(d)
    dg = max(10 * rayon, 0.03 * diag)
    fid, _, _ = PE.zbuffer(V, F, d, 768, np.asarray(centre, dtype=np.float64), dg)
    vus = np.unique(fid[fid >= 0])
    return float(np.isin(ids, vus).mean()) if len(ids) else 0.0


def _fiche(t):
    return {'centre': [round(float(x), 6) for x in t['centre']], 'rayon': round(t['rayon'], 6), 'diametre_rel': round(t['diametre_rel'], 5),
            'type': 'skin', 'taille': t['taille'], 'forme': t['forme'], 'contexte': t['contexte'], 'n_faces_retirees': int(len(t['faces']))}


# ----------------------------------------------------------------------------------------------------------------------------------------
# Les cas
# ----------------------------------------------------------------------------------------------------------------------------------------
LAISSEES = {}
FORMES = ['rond', 'irregulier', 'allonge']
CONTEXTES = ['plat', 'courbe', 'arete_vive']
BANDES = ['petit', 'moyen', 'grand', 'moyen', 'petit', 'grand']


def cas_liste():
    L = []
    for i, (n, ep) in enumerate([(6, 0.005), (9, 0.01), (12, 0.02)], 1):
        L.append(('peau_double_perce_%d' % i, 'peau_double_perce', dict(n=n, ep=ep, seed=100 + i, colle=False)))
    for i, (n, ep) in enumerate([(7, 0.008), (10, 0.015), (12, 0.02)], 1):
        L.append(('peau_collee_perce_%d' % i, 'peau_collee_perce', dict(n=n, ep=ep, seed=200 + i, colle=True)))
    for i, n in enumerate([6, 10], 1):
        L.append(('bord_ouvert_perce_%d' % i, 'bord_ouvert_perce', dict(n=n, seed=300 + i)))
    L.append(('sains_moissonneuse', 'sains', dict(mode='simple')))
    L.append(('sains_double', 'sains', dict(mode='double', ep=0.015, seed=401)))
    L.append(('sains_collee', 'sains', dict(mode='collee', ep=0.015, seed=402)))
    for i, (n, nf) in enumerate([(4, 2), (6, 3)], 1):
        L.append(('ouvertures_voulues_%d' % i, 'ouvertures_voulues', dict(n=n, nf=nf, ep=0.01, seed=500 + i)))
    return L


def fabriquer(base, nom, famille, p, dossier):
    rng = np.random.default_rng(p.get('seed', 0))
    base.Vin_courant = None
    base.s_int = None
    base.exige = 0.0
    chemin = os.path.join(dossier, CASES_DIR, nom + '.glb')
    fiche = {'fichier': '%s/%s.glb' % (CASES_DIR, nom), 'famille': famille, 'diag': base.diag, 'max_trou_relatif': MAX_TROU_RELATIF,
             'trous': [], 'ouvertures': [], 'attendu_vide': False, 'epaisseur_rel': p.get('ep'), 'colle': False}
    if famille == 'peau_double_perce' or famille == 'peau_collee_perce':
        Vin = base.interieur(p['ep'])
        trous = base.planifier(rng, p['n'], BANDES, FORMES, CONTEXTES)
        col = []
        if p['colle']:
            for k, t in enumerate(trous):
                fr = [1.0, 0.5, 1.0, 0.75][k % 4]
                nb = base.colle_rive(Vin, t, rng, fr)
                col.append((round(fr, 2), nb))
            fiche['taches_collees'] = base.colle_taches(Vin, rng, 20, [(t['centre'], t['rayon']) for t in trous])
            fiche['colle'] = True
        objs = trous
        ret = np.concatenate([t['faces'] for t in trous])
        info = base.glb(chemin, ret, Vin)
        fiche['trous'] = [dict(_fiche(t), colle_rive=(col[k][0] if col else 0.0)) for k, t in enumerate(trous)]
    elif famille == 'bord_ouvert_perce':
        trous = base.planifier(rng, p['n'], BANDES, FORMES, CONTEXTES)
        info = base.glb(chemin, np.concatenate([t['faces'] for t in trous]))
        fiche['trous'] = [dict(_fiche(t), type='bord') for t in trous]
    elif famille == 'sains':
        fiche['attendu_vide'] = True
        if p['mode'] == 'simple':
            info = base.glb(chemin, np.array([], dtype=np.int64))
        else:
            Vin = base.interieur(p['ep'])
            if p['mode'] == 'collee':
                base.colle_taches(Vin, rng, 40, [])
                fiche['colle'] = True
            info = base.glb(chemin, np.array([], dtype=np.int64), Vin)
    elif famille == 'ouvertures_voulues':
        fen = base.planifier(rng, p['nf'], ['grand'], ['rond', 'irregulier'], ['courbe', 'plat'], diametres=(0.15, 0.30))
        Vin = base.interieur(p['ep'])
        petits = base.planifier(rng, p['n'], BANDES, FORMES, CONTEXTES, deja=[(t['centre'], t['rayon']) for t in fen])
        # fenetres : coupees dans les DEUX peaux (vraies ouvertures) ; petits trous : peau exterieure seulement
        rf = np.concatenate([t['faces'] for t in fen])
        rp = np.concatenate([t['faces'] for t in petits])
        info = base.glb(chemin, np.concatenate([rf, rp]), Vin, retirees_int=rf)
        objs = petits
        fiche['trous'] = [_fiche(t) for t in petits]
        fiche['ouvertures'] = [dict(_fiche(t), type='opening') for t in fen]
    fiche.update(info)
    if base.profondeur is not None and base.derniere is not None and fiche['trous'] and famille != 'bord_ouvert_perce':
        Vall, Fall, nfe, ki = base.derniere
        pos = np.cumsum(ki) - 1
        for fi, t in zip(fiche['trous'], objs):
            ids = nfe + pos[t['faces']]
            nrm = base.fn[t['faces']].mean(axis=0)
            fi['visible_int_pct'] = round(100 * visibilite_trou(Vall, Fall, ids, t['centre'], nrm, t['rayon'], base.diag), 1)
            fi['normale'] = [round(float(x), 5) for x in nrm / np.linalg.norm(nrm)]
            LAISSEES[nom + '__%d' % fiche['trous'].index(fi)] = np.asarray(t['faces'], dtype=np.int64)
    return fiche


def reels():
    return {
        'bateau_e6dc04': {
            'fichier': SOURCE_BATEAU, 'famille': 'reels', 'verite_chiffree': False,
            'zones': 'environ 15 taches orange sous la coque (trous de peau : on voit la feuille du dessous)',
            'images': ['C:/tmp/benchy/bas_e6dc04.png', 'C:/tmp/peau/z2_avant.png'],
            'attendu': 'ces taches doivent etre detectees ; hublots et rambardes (ajoures voulus) ne doivent PAS l etre'},
        'pikachu': {
            'fichier': SOURCE_PIKACHU, 'famille': 'reels', 'verite_chiffree': False,
            'zones': 'ouverture du ventre (on voit l interieur)', 'images': ['C:/tmp/benchy/pika_bas.png'],
            'attendu': 'l ouverture du ventre est consideree comme un trou par le user (jugement a l oeil)'},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cas', default='')
    ap.add_argument('--sortie', default=SORTIE)
    ap.add_argument('--v2', action='store_true', help='peau simple propre issue du solide (cases_v2/, verite_v2.json)')
    a = ap.parse_args()
    global CASES_DIR
    if a.v2:
        CASES_DIR = 'cases_v2'
    if not os.path.exists(SOURCE_MOISSON):
        print('source absente :', SOURCE_MOISSON)
        return 1
    os.makedirs(os.path.join(a.sortie, CASES_DIR), exist_ok=True)
    vpath = os.path.join(a.sortie, 'verite_v2.json' if a.v2 else 'verite.json')
    verite = {'version': 1, 'convention': {'taille': 'diametre_trou / diag', 'rayon': 'rayon circonscrit reel (unites du maillage)',
                                           'max_trou_relatif': MAX_TROU_RELATIF, 'tolerance_appariement': '1,5 x rayon (plancher 0,5 % de diag)'},
              'cas': {}}
    if os.path.exists(vpath):
        try:
            verite['cas'] = json.load(open(vpath, encoding='utf-8')).get('cas', {})
        except Exception:
            pass
    base = Base.depuis_solide() if a.v2 else Base()
    for nom, fam, p in cas_liste():
        if a.cas and a.cas not in nom:
            continue
        t0 = time.time()
        verite['cas'][nom] = fabriquer(base, nom, fam, p, a.sortie)
        print('%-26s %2d trous %d ouvertures  ext %d faces  %.1f s' % (nom, len(verite['cas'][nom]['trous']), len(verite['cas'][nom]['ouvertures']),
                                                                       verite['cas'][nom]['faces_ext'], time.time() - t0), flush=True)
        json.dump(verite, open(vpath, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    if a.v2 and LAISSEES:
        np.savez_compressed(os.path.join(a.sortie, 'verite_v2_faces.npz'), **LAISSEES)
    for k, v in reels().items():
        verite['cas'][k] = v
    json.dump(verite, open(vpath, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print('verite :', vpath)
    return 0


if __name__ == '__main__':
    sys.exit(main())
