# -*- coding: utf-8 -*-
"""Structures internes d'un maillage : double peau, parois minces (proximite et lancer de rayons), coques internes.
numpy + scipy seulement.
"""
import itertools

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree


# --------------------------------------------------------------------------- proximite (double peau / paroi mince)
def evaluer_proximite(ids, C, un, aire, Fw, diag, arbre, t_double=0.002, t_mince=0.01):
    """Pour chaque face de `ids` : existe-t-il une AUTRE face (sans sommet soude en commun), de normale opposee
    (produit scalaire < -0,7), dont le centre est a moins de t x diag le long de la normale de la face et pas trop decalee
    lateralement ? t_double (0,2 % de la diagonale) = deux nappes confondues ; t_mince (1 %) = paroi mince.
    Rend deux tableaux booleens (double, mince) ; mince inclut double."""
    ids = np.asarray(ids, np.int64)
    n = len(ids)
    dbl = np.zeros(n, bool)
    mnc = np.zeros(n, bool)
    if n == 0:
        return dbl, mnc
    arete = np.sqrt(4.0 * aire[ids] / np.sqrt(3.0))
    rayon = np.maximum(2.0 * arete, 1.2 * t_mince * diag)
    listes = arbre.query_ball_point(C[ids], r=rayon)
    lens = np.fromiter((len(l) for l in listes), dtype=np.int64, count=n)
    tot = int(lens.sum())
    if tot == 0:
        return dbl, mnc
    g = np.fromiter(itertools.chain.from_iterable(listes), dtype=np.int64, count=tot)
    prop = np.repeat(np.arange(n), lens)
    f = ids[prop]
    garde = g != f
    g, prop, f = g[garde], prop[garde], f[garde]
    delta = C[g] - C[f]
    dn = np.abs((delta * un[f]).sum(1))
    opp = (un[g] * un[f]).sum(1)
    lat = np.linalg.norm(delta - ((delta * un[f]).sum(1))[:, None] * un[f], axis=1)
    partage = (Fw[g][:, :, None] == Fw[f][:, None, :]).any(axis=(1, 2))
    base = (~partage) & (opp < -0.7) & (lat <= 2.0 * arete[prop] + 0.002 * diag)
    sel = base & (dn <= t_double * diag)
    dbl = np.bincount(prop[sel], minlength=n) > 0
    sel2 = base & (dn <= t_mince * diag)
    mnc = np.bincount(prop[sel2], minlength=n) > 0
    return dbl, mnc


# --------------------------------------------------------------------------- lancer de rayons (blocs de triangles)
def _etaler_bits(x):
    x = x.astype(np.uint64) & np.uint64(0x3FF)
    x = (x | (x << np.uint64(16))) & np.uint64(0x30000FF)
    x = (x | (x << np.uint64(8))) & np.uint64(0x300F00F)
    x = (x | (x << np.uint64(4))) & np.uint64(0x30C30C3)
    x = (x | (x << np.uint64(2))) & np.uint64(0x9249249)
    return x


class Rayons:
    """Plus proche impact d'un rayon sur un maillage : triangles ranges en ordre de Morton, blocs de `bloc` triangles
    avec leur boite ; un rayon teste d'abord toutes les boites (vectorise) puis seulement les triangles des blocs touches."""

    def __init__(self, V, F, bloc=96):
        tri = V[F]
        c = tri.mean(1)
        lo, hi = c.min(0), c.max(0)
        q = np.clip(((c - lo) / np.maximum(hi - lo, 1e-12) * 1023).astype(np.int64), 0, 1023)
        code = _etaler_bits(q[:, 0]) | (_etaler_bits(q[:, 1]) << np.uint64(1)) | (_etaler_bits(q[:, 2]) << np.uint64(2))
        ordre = np.argsort(code, kind='stable')
        self.id = ordre
        tri = tri[ordre]
        self.v0 = tri[:, 0]
        self.e1 = tri[:, 1] - tri[:, 0]
        self.e2 = tri[:, 2] - tri[:, 0]
        n = len(F)
        self.bloc = bloc
        debuts = np.arange(0, n, bloc)
        self.debuts = debuts
        mn = tri.min(1)
        mx = tri.max(1)
        self.bmin = np.minimum.reduceat(mn, debuts)
        self.bmax = np.maximum.reduceat(mx, debuts)
        self.n = n

    def plus_proche(self, o, d, tmax=np.inf, exclure=-1, teps=1e-9):
        """(t, id de face) du plus proche impact avec t > teps, ou (inf, -1)."""
        with np.errstate(divide='ignore', invalid='ignore'):
            inv = 1.0 / d
        t1 = (self.bmin - o) * inv
        t2 = (self.bmax - o) * inv
        t1 = np.where(np.isnan(t1), -np.inf, t1)
        t2 = np.where(np.isnan(t2), np.inf, t2)
        tn = np.minimum(t1, t2).max(1)
        tf = np.maximum(t1, t2).min(1)
        touche = np.nonzero((tf >= np.maximum(tn, 0.0)) & (tn <= tmax))[0]
        if len(touche) == 0:
            return np.inf, -1
        idx = np.concatenate([np.arange(self.debuts[b], min(self.debuts[b] + self.bloc, self.n)) for b in touche])
        v0, e1, e2 = self.v0[idx], self.e1[idx], self.e2[idx]
        p = np.cross(d, e2)
        det = (e1 * p).sum(1)
        ok = np.abs(det) > 1e-14
        idet = np.zeros_like(det)
        idet[ok] = 1.0 / det[ok]
        tv = o - v0
        u = (tv * p).sum(1) * idet
        q = np.cross(tv, e1)
        v = (q * d).sum(1) * idet
        t = (e2 * q).sum(1) * idet
        valide = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > teps) & (t <= tmax)
        if exclure >= 0:
            valide &= self.id[idx] != exclure
        if not valide.any():
            return np.inf, -1
        k = np.argmin(np.where(valide, t, np.inf))
        return float(t[k]), int(self.id[idx[k]])


def epaisseurs(rayons, C, un, ids, sens, diag, decalage=1e-6):
    """Distance au plus proche impact depuis le centre de chaque face de `ids`, le long de sens x normale (sens = -1 :
    vers l'interieur d'un maillage bien oriente). Rend (t, id de la face touchee)."""
    t = np.full(len(ids), np.inf)
    g = np.full(len(ids), -1, np.int64)
    for k, f in enumerate(ids):
        d = un[f] * sens
        o = C[f] + d * decalage * diag
        t[k], g[k] = rayons.plus_proche(o, d, exclure=int(f))
    return t, g


# --------------------------------------------------------------------------- coques internes (voxels)
def coques_internes(V, F, aire, etiq_comp, diag, res=96, n_points=2_000_000, graine=0):
    """Echantillonne la surface (points proportionnels a l'aire), l'inscrit dans une grille res^3, remplit l'exterieur
    depuis un coin et rend, par composante connexe de faces, la part de ses points qui touchent l'exterieur.
    Une composante a 0 % est INVISIBLE DE L'EXTERIEUR a cette resolution (coque interieure). Rend aussi la part de la
    boite occupee par du vide enferme."""
    rng = np.random.default_rng(graine)
    cum = np.cumsum(aire)
    tot = cum[-1]
    pts_f = np.searchsorted(cum, rng.random(n_points) * tot)
    pts_f = np.minimum(pts_f, len(F) - 1)
    r1 = np.sqrt(rng.random(n_points))
    r2 = rng.random(n_points)
    a, b, c = V[F[pts_f, 0]], V[F[pts_f, 1]], V[F[pts_f, 2]]
    P = (1 - r1)[:, None] * a + (r1 * (1 - r2))[:, None] * b + (r1 * r2)[:, None] * c
    lo, hi = V.min(0), V.max(0)
    cote = float(np.max(hi - lo)) / res
    ijk = np.floor((P - lo) / cote).astype(np.int64) + 1
    forme = np.maximum(np.ceil((hi - lo) / cote).astype(np.int64) + 3, 4)
    ijk = np.minimum(ijk, forme - 1)
    occ = np.zeros(tuple(forme), bool)
    occ[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    lab, _ = ndimage.label(~occ)
    ext = lab == lab[0, 0, 0]
    contact = ndimage.binary_dilation(ext, structure=np.ones((3, 3, 3), bool)) & occ
    vis = contact[ijk[:, 0], ijk[:, 1], ijk[:, 2]]
    comp_pts = etiq_comp[pts_f]
    nc = int(etiq_comp.max()) + 1
    tot_c = np.bincount(comp_pts, minlength=nc)
    vis_c = np.bincount(comp_pts[vis], minlength=nc)
    aire_c = np.bincount(etiq_comp, weights=aire, minlength=nc)
    enferme = (~occ) & (~ext)
    return {'part_visible_par_comp': vis_c / np.maximum(tot_c, 1), 'aire_comp': aire_c, 'points_comp': tot_c,
            'vide_enferme_pct_boite': 100.0 * float(enferme.sum()) / float(occ.size),
            'occupation_pct_boite': 100.0 * float(occ.sum()) / float(occ.size), 'resolution': res}
