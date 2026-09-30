"""CARTE DE NORMALES CUITE DEPUIS LE MAILLAGE COMPLET (2026-09-30).

La version legere (~500 K triangles) partage les UV du maillage complet mais perd le relief fin de ses 10 M de triangles. On le remet
dans une carte de normales (espace tangent) : pour chaque pixel de l'atlas de la version legere, on retrouve le point le plus proche
sur la surface du maillage COMPLET (nuage dense d'echantillons + arbre KD) et on en copie l'orientation, exprimee dans le repere
tangent du pixel. Pas de GPU. Le fichier est rendu avec `normalTexture` ajoute au materiau.
"""
import io
import time

import numpy as np

from modal_app import transfert_peau as tp


# convention glTF : le vert de la carte pointe vers le HAUT de l'image ; les UV glTF ont v vers le BAS (regle par mesure, voir banc)
SIGNE_BITANGENTE = -1.0
SIGNE_TANGENTE = 1.0
VOISINS = 1          # nombre de points du maillage complet moyennes par pixel (debruitage)
ECHELLE = 1.0        # force de la carte dans le materiau


def _geometrie(j, b):
    """Positions (n,3), UV (n,2), normales de sommet (n,3) et triangles (m,3) de la premiere primitive."""
    for ni, mi, pi in tp._primitives(j):
        p = j["meshes"][mi]["primitives"][pi]
        P = tp.lire_accessor(j, b, p["attributes"]["POSITION"]).astype(np.float64)
        uv = tp.lire_accessor(j, b, p["attributes"]["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in p["attributes"] else None
        idx = tp.lire_accessor(j, b, p["indices"]).reshape(-1).astype(np.int64)
        return P, uv, idx.reshape(-1, 3)
    raise ValueError("pas de primitive triangles")


def _echantillons(P, F, n, rng):
    """n points repartis sur la surface au prorata des aires ; renvoie (points float32, normales de face float32)."""
    tri = P[F]
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    cr = np.cross(e1, e2)
    aire = np.linalg.norm(cr, axis=1) / 2
    nf = cr / np.maximum(np.linalg.norm(cr, axis=1, keepdims=True), 1e-20)
    cum = np.cumsum(aire)
    i = np.searchsorted(cum, rng.random(n) * cum[-1])
    i = np.minimum(i, len(F) - 1)
    u = rng.random((n, 2))
    m = u.sum(1) > 1
    u[m] = 1 - u[m]
    pts = tri[i, 0] + u[:, :1] * e1[i] + u[:, 1:] * e2[i]
    return pts.astype(np.float32), nf[i].astype(np.float32)


def cuire_normales(glb_plein, glb_leger, taille=4096, echantillons=8_000_000, log=print):
    """Rend les octets du GLB leger avec une carte de normales cuite depuis le maillage complet."""
    from PIL import Image
    from scipy.spatial import cKDTree
    from scipy import ndimage
    t0 = time.time()
    jf, bf = tp.lire_glb(glb_plein)
    jl, bl = tp.lire_glb(glb_leger)
    Pf, _, Ff = _geometrie(jf, bf)
    Pl, UVl, Fl = _geometrie(jl, bl)
    if UVl is None:
        raise ValueError("la version legere n'a pas d'UV")
    rng = np.random.default_rng(7)
    pts, nrm = _echantillons(Pf, Ff, echantillons, rng)
    arbre = cKDTree(pts)
    log(f"[normales] {len(Ff)} triangles complets -> {echantillons} echantillons, arbre KD en {time.time() - t0:.0f} s")

    # normales de sommet lissees de la version legere (repere de base du pixel)
    tri = Pl[Fl]
    cr = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    Nv = np.zeros_like(Pl)
    for k in range(3):
        np.add.at(Nv, Fl[:, k], cr)
    Nv /= np.maximum(np.linalg.norm(Nv, axis=1, keepdims=True), 1e-20)

    # repere tangent par triangle, a partir des derivees des UV (meme principe que le fragment shader de three.js)
    uv = UVl[Fl]                                             # (m,3,2)
    dp1, dp2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    du1, du2 = uv[:, 1, 0] - uv[:, 0, 0], uv[:, 2, 0] - uv[:, 0, 0]
    dv1, dv2 = uv[:, 1, 1] - uv[:, 0, 1], uv[:, 2, 1] - uv[:, 0, 1]
    det = du1 * dv2 - du2 * dv1
    det = np.where(np.abs(det) < 1e-20, 1e-20, det)
    Tt = (dp1 * dv2[:, None] - dp2 * dv1[:, None]) / det[:, None]
    Bt = (dp2 * du1[:, None] - dp1 * du2[:, None]) / det[:, None]

    T = int(taille)
    tp_ = uv * (T - 1)
    # les UV glTF ont l'origine en HAUT a gauche de l'image : v vers le bas ; ici y = v * (T-1) directement
    lo = np.floor(tp_.min(1)).astype(np.int64)
    hi = np.ceil(tp_.max(1)).astype(np.int64)
    taille_bb = (hi - lo + 1).max(1)
    sortie = np.zeros((T, T, 3), np.float32)
    sortie[:, :, 2] = 1.0
    couvert = np.zeros((T, T), bool)
    n_tex = 0
    for K in (4, 8, 16, 32, 64, 128, 256, 512, 4096):
        sel = np.nonzero((taille_bb <= K) & (taille_bb > (K // 2 if K > 4 else 0)))[0]
        pas = max(1, 1_500_000 // (K * K))
        for d in range(0, len(sel), pas):
            s_ = sel[d:d + pas]
            gx, gy = np.meshgrid(np.arange(K), np.arange(K))
            X = lo[s_, 0][:, None] + gx.ravel()[None, :] + 0.5
            Y = lo[s_, 1][:, None] + gy.ravel()[None, :] + 0.5
            a, b, c = tp_[s_, 0], tp_[s_, 1], tp_[s_, 2]
            den = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
            den = np.where(np.abs(den) < 1e-12, 1e-12, den)[:, None]
            l1 = ((b[:, 1] - c[:, 1])[:, None] * (X - c[:, 0][:, None]) + (c[:, 0] - b[:, 0])[:, None] * (Y - c[:, 1][:, None])) / den
            l2 = ((c[:, 1] - a[:, 1])[:, None] * (X - c[:, 0][:, None]) + (a[:, 0] - c[:, 0])[:, None] * (Y - c[:, 1][:, None])) / den
            l3 = 1.0 - l1 - l2
            ok = (l1 >= -0.01) & (l2 >= -0.01) & (l3 >= -0.01) & (X < T) & (Y < T)
            ti, pi = np.nonzero(ok)
            if not len(ti):
                continue
            f = s_[ti]
            L = np.stack([l1[ti, pi], l2[ti, pi], l3[ti, pi]], 1)                 # (q,3)
            pos = np.einsum('ij,ijk->ik', L, Pl[Fl[f]])
            Nb = np.einsum('ij,ijk->ik', L, Nv[Fl[f]])
            Nb /= np.maximum(np.linalg.norm(Nb, axis=1, keepdims=True), 1e-20)
            # repere orthonormal (Gram-Schmidt) du pixel
            Tv = Tt[f] - Nb * np.einsum('ij,ij->i', Tt[f], Nb)[:, None]
            Tv /= np.maximum(np.linalg.norm(Tv, axis=1, keepdims=True), 1e-20)
            Bv = np.cross(Nb, Tv)
            signe = np.sign(np.einsum('ij,ij->i', Bv, Bt[f]))
            signe[signe == 0] = 1
            Bv *= signe[:, None]
            Bv *= SIGNE_BITANGENTE
            Tv = Tv * SIGNE_TANGENTE
            # normale du maillage complet au point le plus proche
            _, k = arbre.query(pos.astype(np.float32), k=VOISINS, workers=-1)
            nf = nrm[k].astype(np.float64)
            if VOISINS > 1:
                nf = nf * np.where(np.einsum('qkc,qc->qk', nf, Nb) < 0, -1.0, 1.0)[:, :, None]      # tous du meme cote avant la moyenne
                nf = nf.mean(1)
                nf /= np.maximum(np.linalg.norm(nf, axis=1, keepdims=True), 1e-20)
            nf *= np.where(np.einsum('ij,ij->i', nf, Nb) < 0, -1.0, 1.0)[:, None]        # meme cote que la normale lissee (faces retournees)
            ts = np.stack([np.einsum('ij,ij->i', nf, Tv), np.einsum('ij,ij->i', nf, Bv), np.einsum('ij,ij->i', nf, Nb)], 1)
            ts /= np.maximum(np.linalg.norm(ts, axis=1, keepdims=True), 1e-20)
            xs, ys = np.clip(X[ti, pi].astype(np.int64), 0, T - 1), np.clip(Y[ti, pi].astype(np.int64), 0, T - 1)
            sortie[ys, xs] = ts
            couvert[ys, xs] = True
            n_tex += len(ti)
    log(f"[normales] {n_tex} pixels calcules ({100 * couvert.mean():.1f} % de l'atlas) en {time.time() - t0:.0f} s")
    # bourrage : les pixels hors des triangles prennent la valeur du plus proche pixel couvert (evite les coutures)
    idx = ndimage.distance_transform_edt(~couvert, return_distances=False, return_indices=True)
    sortie = sortie[idx[0], idx[1]]
    img = ((sortie * 0.5 + 0.5).clip(0, 1) * 255 + 0.5).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, "PNG")

    # ajout au materiau du GLB leger
    jl.setdefault("images", []).append({"mimeType": "image/png"})
    jl.setdefault("textures", []).append({"source": len(jl["images"]) - 1})
    tp._poser_image(jl, bl, len(jl["images"]) - 1, buf.getvalue(), "image/png")
    jl["materials"][0]["normalTexture"] = {"index": len(jl["textures"]) - 1, "scale": ECHELLE}
    bl = tp.compacter(jl, bl)
    log(f"[normales] carte {T}x{T} ajoutee, {time.time() - t0:.0f} s au total")
    return tp.ecrire_glb(jl, bl)
