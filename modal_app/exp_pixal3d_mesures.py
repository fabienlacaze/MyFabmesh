"""MESURES OBJECTIVES d'un GLB (banc Pixal3D, 15/10/2026).

Aucun GPU, aucune dependance de Modal : numpy, scipy, trimesh, cv2, PIL seulement. Trois usages :
  1. dans le conteneur du banc (modal_app/exp_pixal3d.py), juste apres l'export du GLB ;
  2. en local, sur CPU, sur les GLB telecharges :  python modal_app/exp_pixal3d_mesures.py <fichier.glb> [--entree rgba.png --camera cam.json]
  3. par le test build/bancs/noyaux/test_pixal3d_mesures.py (maillages synthetiques).

Pieges du projet appliques ici (CLAUDE.md, section 5) :
  - un GLB TRELLIS / Pixal3D duplique les sommets le long des coutures d'UV : SOUDER PAR POSITION (np.unique sur les coordonnees
    arrondies) avant toute mesure de topologie, sinon le maillage parait en milliers de morceaux ;
  - mesurer un atlas sur toute l'image est faux (le vide est noir) : toutes les statistiques de texture sont restreintes aux texels
    reellement couverts par les triangles d'UV ;
  - normales de faces adjacentes opposees (produit scalaire < -0,5) en % d'aire : detecte les triangles retournes (section 13).

Ne conclut rien sur la qualite visuelle : ce sont des nombres, le jugement est fait ailleurs (comparateur cote a cote).
"""
import io
import json
import math
import struct

import numpy as np

TOL_SOUDURE = 1e-6            # fraction de la diagonale de la boite englobante
PAS_AUTO_COUVERTURE = 4096    # taille maximale de la grille de couverture d'atlas


# ----------------------------------------------------------------------------------------------- utilitaires
def _j(o):
    """numpy -> types JSON."""
    if isinstance(o, dict):
        return {str(k): _j(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_j(v) for v in o]
    if isinstance(o, np.ndarray):
        return _j(o.tolist())
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        v = float(o)
        return v if math.isfinite(v) else None
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    return o


def entete_glb(octets):
    """Premier chunk (JSON) d'un GLB : version, generateur, extensions, images, materiaux (aucune texture decodee)."""
    if len(octets) < 20 or octets[:4] != b"glTF":
        return {"erreur": "pas un GLB"}
    version, longueur = struct.unpack("<II", octets[4:12])
    taille_json, type_json = struct.unpack("<II", octets[12:20])
    if type_json != 0x4E4F534A:
        return {"erreur": "premier chunk non JSON"}
    j = json.loads(octets[20:20 + taille_json].decode("utf-8"))
    return {
        "version_glb": version,
        "longueur_declaree": longueur,
        "generateur": (j.get("asset") or {}).get("generator"),
        "extensions_utilisees": j.get("extensionsUsed", []),
        "extensions_requises": j.get("extensionsRequired", []),
        "images": [{"mimeType": i.get("mimeType"), "name": i.get("name")} for i in j.get("images", [])],
        "n_noeuds": len(j.get("nodes", [])), "n_maillages": len(j.get("meshes", [])),
        "n_materiaux": len(j.get("materials", [])), "n_textures": len(j.get("textures", [])),
        "double_face": [bool(m.get("doubleSided", False)) for m in j.get("materials", [])],
        "mode_alpha": [m.get("alphaMode", "OPAQUE") for m in j.get("materials", [])],
    }


# ----------------------------------------------------------------------------------------------- soudure + topologie
def souder(vertices, faces, tol_rel=TOL_SOUDURE):
    """(sommets soudes, faces soudees, diagonale) : soudure PAR POSITION (arrondi a tol_rel x diagonale de la boite)."""
    v = np.asarray(vertices, dtype=np.float64)
    f = np.asarray(faces, dtype=np.int64)
    mn = v.min(axis=0)
    diag = float(np.linalg.norm(v.max(axis=0) - mn))
    pas = max(diag * tol_rel, 1e-12)
    q = np.round((v - mn) / pas).astype(np.int64)
    if int(q.max()) < (1 << 21):                    # trois coordonnees tiennent dans 63 bits : clef entiere unique (rapide)
        cle = (q[:, 0] << 42) | (q[:, 1] << 21) | q[:, 2]
        _, premier, inverse = np.unique(cle, return_index=True, return_inverse=True)
    else:
        _, premier, inverse = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inverse = np.asarray(inverse).reshape(-1)
    return v[premier], inverse[f], diag


def topologie(v, f, souder_avant=True):
    """Topologie d'un maillage (soude par position sauf souder_avant=False : sert au test qui montre le piege des coutures)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    v = np.asarray(v, dtype=np.float64)
    f = np.asarray(f, dtype=np.int64)
    n_sommets_fichier = int(len(v))
    n_faces_fichier = int(len(f))
    if souder_avant:
        v, f, diag = souder(v, f)
    else:
        diag = float(np.linalg.norm(v.max(axis=0) - v.min(axis=0)))
    ok = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 2] != f[:, 0])
    n_degenerees = int((~ok).sum())
    f = f[ok]
    nv, nf = int(len(v)), int(len(f))
    res = {"sommets_fichier": n_sommets_fichier, "faces_fichier": n_faces_fichier, "sommets_soudes": nv, "faces_utiles": nf,
           "faces_degenerees_apres_soudure": n_degenerees, "diagonale": diag}
    if nf == 0:
        return res
    aretes = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]], axis=0)
    aretes.sort(axis=1)
    cle = aretes[:, 0] * nv + aretes[:, 1]
    uniques, compte = np.unique(cle, return_counts=True)
    a = uniques // nv
    b = uniques % nv
    longueurs = np.linalg.norm(v[a] - v[b], axis=1)
    bord = compte == 1
    non_var = compte > 2
    res.update({
        "aretes": int(len(uniques)),
        "aretes_de_bord": int(bord.sum()),
        "aretes_non_manifold": int(non_var.sum()),
        "longueur_bord_rel_diag": float(longueurs[bord].sum() / diag) if diag > 0 else None,
        "euler": int(nv - len(uniques) + nf),
        "arete_mediane_rel_diag": float(np.median(longueurs) / diag) if diag > 0 else None,
        "arete_p99_rel_diag": float(np.percentile(longueurs, 99) / diag) if diag > 0 else None,
        "arete_max_rel_diag": float(longueurs.max() / diag) if diag > 0 else None,
        "arete_max_abs": float(longueurs.max()),
        "aretes_sup_5pct_diag": int((longueurs > 0.05 * diag).sum()) if diag > 0 else None,
    })
    # composantes (par aretes) ; faces par composante
    g = coo_matrix((np.ones(len(a), dtype=np.int8), (a, b)), shape=(nv, nv))
    n_comp_total, etiq = connected_components(g, directed=False)
    faces_par_comp = np.bincount(etiq[f[:, 0]], minlength=n_comp_total)
    faces_par_comp = faces_par_comp[faces_par_comp > 0]
    tri = np.sort(faces_par_comp)[::-1]
    res.update({
        "composantes": int(len(tri)),
        "plus_grande_composante_part_faces": float(tri[0] / nf),
        "composantes_5_plus_grandes_faces": [int(x) for x in tri[:5]],
        "composantes_moins_de_100_faces": int((tri < 100).sum()),
        "part_faces_dans_composantes_moins_de_100": float(tri[tri < 100].sum() / nf),
        "composantes_moins_de_1pct_faces": int((tri < 0.01 * nf).sum()),
    })
    # boucles de bord (trous + contour exterieur) : composantes du graphe forme par les seules aretes de bord
    if bord.any():
        ab, bb = a[bord], b[bord]
        gb = coo_matrix((np.ones(len(ab), dtype=np.int8), (ab, bb)), shape=(nv, nv))
        _, etiq_b = connected_components(gb, directed=False)
        sommets_bord = np.unique(np.concatenate([ab, bb]))
        res["boucles_de_bord"] = int(len(np.unique(etiq_b[sommets_bord])))
    else:
        res["boucles_de_bord"] = 0
    # aire et normales
    p0, p1, p2 = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    n = np.cross(p1 - p0, p2 - p0)
    aire2 = np.linalg.norm(n, axis=1)
    aire = aire2 / 2.0
    res["aire_totale"] = float(aire.sum())
    res["faces_aire_quasi_nulle"] = int((aire < 1e-12 * diag * diag).sum()) if diag > 0 else None
    bonnes = aire2 > 0
    n[bonnes] = n[bonnes] / aire2[bonnes, None]
    res["pct_aire_normales_opposees"] = _pct_aire_opposee(f, cle, nv, n, aire)
    return res


def _pct_aire_opposee(f, cle_aretes, nv, normales, aire):
    """Part d'aire (en %) des faces ayant une voisine de normale opposee (produit scalaire < -0,5) ; aretes a exactement 2 faces.
    cle_aretes : clef de chaque demi-arete, dans l'ordre [aretes 0-1 de toutes les faces, puis 1-2, puis 2-0]."""
    nf = len(f)
    ids = np.tile(np.arange(nf), 3)                      # la demi-arete k appartient a la face k % nf
    ordre = np.argsort(cle_aretes, kind="stable")
    ks, fs = cle_aretes[ordre], ids[ordre]
    # indices i tels que ks[i] == ks[i+1] et differents de leurs voisins : exactement deux faces sur l'arete
    egal_suiv = ks[:-1] == ks[1:]
    debut = np.ones(len(ks) - 1, dtype=bool)
    fin = np.ones(len(ks) - 1, dtype=bool)
    if len(ks) > 2:
        debut[1:] = ks[1:-1] != ks[:-2]
        fin[:-1] = ks[2:] != ks[1:-1]
    paire = egal_suiv & debut & fin
    i = np.nonzero(paire)[0]
    if len(i) == 0:
        return 0.0
    fa, fb = fs[i], fs[i + 1]
    d = (normales[fa] * normales[fb]).sum(axis=1)
    mauvais = d < -0.5
    if not mauvais.any():
        return 0.0
    marque = np.zeros(nf, dtype=bool)
    marque[fa[mauvais]] = True
    marque[fb[mauvais]] = True
    return float(100.0 * aire[marque].sum() / aire.sum())


# ----------------------------------------------------------------------------------------------- atlas UV
def couverture_atlas(uv, faces, taille=PAS_AUTO_COUVERTURE):
    """Masque binaire (taille x taille) des texels couverts par un triangle d'UV, et la part couverte."""
    import cv2
    s = int(taille)
    uv = np.asarray(uv, dtype=np.float64)
    f = np.asarray(faces, dtype=np.int64)
    tri = uv[f]                                              # (F, 3, 2)
    x = tri[..., 0] * s
    y = (1.0 - tri[..., 1]) * s
    pts = np.round(np.stack([x, y], axis=-1) * 16.0).astype(np.int32)   # 16 sous-pixels (shift = 4)
    masque = np.zeros((s, s), dtype=np.uint8)
    for t in pts:
        cv2.fillConvexPoly(masque, t, 255, lineType=cv2.LINE_8, shift=4)
    return masque > 0


def stats_texture(base_couleur, metal_rugosite, couvert):
    """Statistiques restreintes aux texels couverts. base_couleur / metal_rugosite : images PIL ou None."""
    import cv2
    res = {}
    if base_couleur is not None:
        a = np.asarray(base_couleur.convert("RGBA"))
        h, w = a.shape[:2]
        m = couvert
        if m.shape != (h, w):
            m = cv2.resize(m.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0
        res["taille_base_couleur"] = [int(w), int(h)]
        res["texels_couverts_base_couleur"] = int(m.sum())
        if m.any():
            rgb = a[..., :3].astype(np.float32)
            lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
            lc = lum[m]
            mx, mn = rgb.max(axis=2), rgb.min(axis=2)
            sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0.0)
            res.update({
                "luminance_moyenne": float(lc.mean()), "luminance_ecart_type": float(lc.std()),
                "luminance_p5": float(np.percentile(lc, 5)), "luminance_p50": float(np.percentile(lc, 50)),
                "luminance_p95": float(np.percentile(lc, 95)),
                "saturation_moyenne": float(sat[m].mean()),
                "rgb_moyen": [float(rgb[..., k][m].mean()) for k in range(3)],
                "part_texels_quasi_noirs": float((lc < 20).mean()), "part_texels_quasi_blancs": float((lc > 235).mean()),
                "alpha_moyen": float(a[..., 3][m].mean()),
            })
            # nettete : gradient moyen de la luminance sur les texels couverts (a taille d'atlas egale seulement)
            gx = cv2.Sobel(lum.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)
            gy = cv2.Sobel(lum.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
            g = np.sqrt(gx * gx + gy * gy)
            res["gradient_luminance_moyen"] = float(g[m].mean())
    if metal_rugosite is not None:
        b = np.asarray(metal_rugosite.convert("RGB")).astype(np.float32) / 255.0
        h, w = b.shape[:2]
        m = couvert
        if m.shape != (h, w):
            m = cv2.resize(m.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0
        if m.any():
            rug, met = b[..., 1][m], b[..., 2][m]                 # glTF : G = rugosite, B = metal
            res.update({
                "taille_metal_rugosite": [int(w), int(h)],
                "metal_moyen": float(met.mean()), "rugosite_moyenne": float(rug.mean()),
                "part_metal_sup_80pct": float((met > 0.8).mean()),
                "part_metal_et_rugosite_sup_80pct": float(((met > 0.8) & (rug > 0.8)).mean()),   # regle de corriger_metal_degenere
            })
    return res


# ----------------------------------------------------------------------------------------------- alignement avec l'entree
def masque_entree(entree_rgba, taille=512):
    """Masque binaire de l'entree tel que le modele la voit : meme recadrage que Pixal3DImageTo3DPipeline.preprocess_image
    (reduction a 1024, alpha > 0,8 x 255, carre centre x 1,1) puis redimensionnement a `taille` (image_size des extracteurs)."""
    from PIL import Image
    im = entree_rgba if isinstance(entree_rgba, Image.Image) else Image.open(entree_rgba)
    im = im.convert("RGBA")
    mx = max(im.size)
    s = min(1, 1024 / mx)
    if s < 1:
        im = im.resize((int(im.width * s), int(im.height * s)), Image.Resampling.LANCZOS)
    a = np.array(im)[:, :, 3]
    pts = np.argwhere(a > 0.8 * 255)
    bbox = (np.min(pts[:, 1]), np.min(pts[:, 0]), np.max(pts[:, 1]), np.max(pts[:, 0]))
    centre = ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
    cote = int(max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 1.1)
    boite = (centre[0] - cote // 2, centre[1] - cote // 2, centre[0] + cote // 2, centre[1] + cote // 2)
    rec = im.crop(boite)
    al = Image.fromarray(np.array(rec)[:, :, 3]).resize((taille, taille), Image.Resampling.LANCZOS)
    return np.array(al) > 127


# repere du GLB (x', y', z') -> repere "monde" du projecteur de Pixal3D (x_w, y_w = profondeur, z_w = haut), camera en (0, -d, 0).
# Derive de inference.py : to_glb range (a, b, c) en (a, c, -b), puis la rotation d'export donne (-a, b, -c) ; le projecteur (ProjGrid)
# lit le maillage natif (a, b, c) comme (a, -c, b). D'ou x_w = -x', y_w = z', z_w = y'. Les trois autres candidats servent a verifier la derivation.
CANDIDATS_REPERE = {
    "primaire (-x', z', y')": lambda p: np.stack([-p[:, 0], p[:, 2], p[:, 1]], axis=1),
    "miroir x (x', z', y')": lambda p: np.stack([p[:, 0], p[:, 2], p[:, 1]], axis=1),
    "face/dos (-x', -z', y')": lambda p: np.stack([-p[:, 0], -p[:, 2], p[:, 1]], axis=1),
    "face/dos + miroir (x', -z', y')": lambda p: np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1),
}


def silhouette_projetee(pts_monde, faces, camera, taille=512):
    """Masque de la silhouette obtenue en projetant tous les triangles avec la camera de Pixal3D (sensor 32 mm, distance, fov)."""
    import cv2
    d = float(camera["distance"])
    sc = float(camera.get("mesh_scale", 1.0))
    fov = float(camera["camera_angle_x"])
    f_pix = (16.0 / math.tan(fov / 2.0)) * taille / 32.0
    p = np.asarray(pts_monde, dtype=np.float64) / sc
    prof = p[:, 1] + d
    ok_s = prof > 1e-6
    prof_s = np.where(ok_s, prof, 1.0)
    u = f_pix * p[:, 0] / prof_s + taille / 2.0
    v = -f_pix * p[:, 2] / prof_s + taille / 2.0
    pts2 = np.stack([u, v], axis=1)
    fa = np.asarray(faces, dtype=np.int64)
    garde = ok_s[fa].all(axis=1)
    tri = np.round(pts2[fa[garde]] * 16.0).astype(np.int32)
    masque = np.zeros((taille, taille), dtype=np.uint8)
    for t in tri:
        cv2.fillConvexPoly(masque, t, 255, lineType=cv2.LINE_8, shift=4)
    return masque > 0


def alignement(vertices_glb, faces, camera, masque_in, taille=512):
    """IoU de la silhouette projetee et du masque d'entree, pour chaque repere candidat ; retient le meilleur."""
    res = {"camera": {k: camera[k] for k in ("camera_angle_x", "distance", "mesh_scale") if k in camera}, "candidats": {}}
    meilleur = None
    for nom, conv in CANDIDATS_REPERE.items():
        m = silhouette_projetee(conv(np.asarray(vertices_glb, dtype=np.float64)), faces, camera, taille)
        inter = float((m & masque_in).sum())
        union = float((m | masque_in).sum())
        iou = inter / union if union > 0 else 0.0
        c = {"iou": iou, "precision": inter / max(float(m.sum()), 1.0), "rappel": inter / max(float(masque_in.sum()), 1.0)}
        res["candidats"][nom] = c
        if meilleur is None or iou > meilleur[1]:
            meilleur = (nom, iou, c, m)
    nom0 = next(iter(CANDIDATS_REPERE))
    res.update({"repere_retenu": meilleur[0], "iou": meilleur[1], "precision": meilleur[2]["precision"], "rappel": meilleur[2]["rappel"],
                "iou_repere_primaire": res["candidats"][nom0]["iou"], "derivation_confirmee": meilleur[0] == nom0,
                "part_pixels_entree": float(masque_in.mean()), "part_pixels_projetes": float(meilleur[3].mean())})
    ys, xs = np.nonzero(masque_in)
    yp, xp = np.nonzero(meilleur[3])
    if len(ys) and len(yp):
        res["boite_entree"] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        res["boite_projetee"] = [int(xp.min()), int(yp.min()), int(xp.max()), int(yp.max())]
    return res


# ----------------------------------------------------------------------------------------------- orientation (sans camera)
def silhouette_orthographique(vertices_glb, faces, signe_x, masque_cible, taille=512):
    """Silhouette orthographique (u = signe_x * x', v = -y') dont la boite est ajustee UNIFORMEMENT a celle de `masque_cible`.
    Ne suppose aucune camera : applicable a n'importe quel moteur (TRELLIS.2 compris)."""
    import cv2
    V = np.asarray(vertices_glb, dtype=np.float64)
    F = np.asarray(faces, dtype=np.int64)
    ys, xs = np.nonzero(masque_cible)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    u = signe_x * V[:, 0]
    v = -V[:, 1]
    etendue_u, etendue_v = max(u.max() - u.min(), 1e-12), max(v.max() - v.min(), 1e-12)
    echelle = min((x1 - x0) / etendue_u, (y1 - y0) / etendue_v)
    px = (u - (u.min() + u.max()) / 2.0) * echelle + (x0 + x1) / 2.0
    py = (v - (v.min() + v.max()) / 2.0) * echelle + (y0 + y1) / 2.0
    pts = np.round(np.stack([px, py], axis=1)[F] * 16.0).astype(np.int32)
    m = np.zeros((taille, taille), np.uint8)
    for t in pts:
        cv2.fillConvexPoly(m, t, 255, lineType=cv2.LINE_8, shift=4)
    return m > 0


ECHELLES_ORIENTATION = (0.94, 0.97, 1.0, 1.03, 1.06)       # mise a l'echelle relative essayee autour du centre de la silhouette
DECALAGE_ORIENTATION = 12                                  # translation entiere maximale essayee (pixels, image 512 x 512)


def iou_optimise(a, b, echelles=ECHELLES_ORIENTATION, decalage_max=DECALAGE_ORIENTATION):
    """Meilleur IoU de la silhouette `a` (booleen) contre le masque `b` apres une mise a l'echelle (autour du centre de la boite de `a`) et une translation entiere
    (|dx|, |dy| <= decalage_max, correlation croisee par cv2.matchTemplate : intersection pour TOUS les decalages d'un coup). Tolere la perspective et un cadrage approximatif
    sans effacer l'asymetrie qui distingue un cote de l'autre."""
    import cv2
    ys, xs = np.nonzero(a)
    if len(xs) == 0 or not b.any():
        return 0.0
    cx, cy = (xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0
    n = int(decalage_max)
    b_pad = np.pad(b.astype(np.float32), n)
    somme_b = float(b.sum())
    meilleur = 0.0
    au8 = a.astype(np.uint8)
    for e in echelles:
        m = np.array([[e, 0.0, cx - e * cx], [0.0, e, cy - e * cy]], np.float32)
        mise = cv2.warpAffine(au8, m, (a.shape[1], a.shape[0]), flags=cv2.INTER_NEAREST)
        inter = cv2.matchTemplate(b_pad, mise.astype(np.float32), cv2.TM_CCORR)             # (2n+1) x (2n+1) : intersection pour chaque decalage
        union = float(mise.sum()) + somme_b - inter
        meilleur = max(meilleur, float((inter / np.maximum(union, 1e-9)).max()))
    return meilleur


def orientation(vertices_glb, faces, masque_in, seuil_ecart=0.02):
    """Vers quel cote regarde le GLB ? Compare le masque d'entree a la silhouette orthographique ajustee (boite, puis echelle et decalage : `iou_optimise`) dans les deux sens du
    miroir. « -Z » : image a droite = -x' (le modele est vu de face depuis -Z) ; « +Z » : image a droite = +x'. Le repere glTF place d'habitude l'avant sur +Z.
    Rend aussi les deux IoU (fidelite de silhouette sous la MEME regle pour tous les moteurs)."""
    i_moins = iou_optimise(silhouette_orthographique(vertices_glb, faces, -1.0, masque_in), masque_in)
    i_plus = iou_optimise(silhouette_orthographique(vertices_glb, faces, +1.0, masque_in), masque_in)
    ecart = abs(i_moins - i_plus)
    regarde = "indetermine" if ecart < seuil_ecart else ("-Z" if i_moins > i_plus else "+Z")
    return {"regarde": regarde, "iou_droite_moins_x": i_moins, "iou_droite_plus_x": i_plus, "ecart": ecart, "iou_silhouette_ajustee": max(i_moins, i_plus)}


def _iou(a, b):
    inter = float((a & b).sum())
    union = float((a | b).sum())
    return inter / union if union > 0 else 0.0


# ----------------------------------------------------------------------------------------------- point d'entree
def mesurer_glb(source, entree_rgba=None, camera=None, taille_couverture=PAS_AUTO_COUVERTURE):
    """Mesures d'un GLB (chemin ou octets). entree_rgba (chemin ou PIL) + camera (dict camera_angle_x, distance, mesh_scale) :
    ajoute l'alignement de la silhouette avec l'entree (specifique a Pixal3D)."""
    import trimesh
    if isinstance(source, (bytes, bytearray)):
        octets = bytes(source)
    else:
        with open(source, "rb") as fh:
            octets = fh.read()
    res = {"octets": len(octets), "entete": entete_glb(octets)}
    scene = trimesh.load(io.BytesIO(octets), file_type="glb", force="scene")
    geoms = [g for g in scene.dump(concatenate=False) if hasattr(g, "faces")]
    res["n_geometries"] = len(geoms)
    if not geoms:
        res["erreur"] = "aucun maillage dans le GLB"
        return _j(res)
    V = np.concatenate([np.asarray(g.vertices, dtype=np.float64) for g in geoms])
    decal = np.cumsum([0] + [len(g.vertices) for g in geoms[:-1]])
    F = np.concatenate([np.asarray(g.faces, dtype=np.int64) + d for g, d in zip(geoms, decal)])
    mn, mx = V.min(axis=0), V.max(axis=0)
    res["bornes"] = {"min": mn, "max": mx, "etendue": mx - mn, "centre": (mn + mx) / 2.0}
    res["topologie"] = topologie(V, F)
    g0 = geoms[0]
    uv = getattr(g0.visual, "uv", None)
    mat = getattr(g0.visual, "material", None)
    base = getattr(mat, "baseColorTexture", None) or getattr(mat, "image", None)
    mr = getattr(mat, "metallicRoughnessTexture", None)
    res["materiau"] = {
        "metallicFactor": getattr(mat, "metallicFactor", None), "roughnessFactor": getattr(mat, "roughnessFactor", None),
        "baseColorFactor": getattr(mat, "baseColorFactor", None), "alphaMode": getattr(mat, "alphaMode", None),
        "doubleSided": getattr(mat, "doubleSided", None),
        "taille_base_couleur": list(base.size) if base is not None else None,
        "taille_metal_rugosite": list(mr.size) if mr is not None else None,
    }
    if uv is not None and len(uv) == len(g0.vertices):
        uv = np.asarray(uv, dtype=np.float64)
        taille = int(min(max(base.size) if base is not None else taille_couverture, taille_couverture))
        couvert = couverture_atlas(uv, np.asarray(g0.faces), taille)
        res["atlas"] = {
            "uv_min": uv.min(axis=0), "uv_max": uv.max(axis=0), "taille_grille_couverture": taille,
            "couverture": float(couvert.mean()),
            "uv_hors_0_1": bool((uv.min() < -1e-6) or (uv.max() > 1 + 1e-6)),
        }
        res["texture"] = stats_texture(base, mr, couvert)
    else:
        res["atlas"] = {"erreur": "pas d'UV"}
    if entree_rgba is not None:
        try:
            masque = masque_entree(entree_rgba)
            res["orientation"] = orientation(V, F, masque)
            if camera is not None:
                res["alignement_entree"] = alignement(V, F, camera, masque)
        except Exception as e:                       # les mesures liees a l'entree ne doivent jamais faire perdre les autres
            res["alignement_entree"] = {"erreur": repr(e)[:300]}
    return _j(res)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Mesures objectives d'un GLB (CPU)")
    ap.add_argument("glb")
    ap.add_argument("--entree", help="PNG RGBA d'entree (alignement de silhouette)")
    ap.add_argument("--camera", help="JSON {camera_angle_x, distance, mesh_scale}")
    a = ap.parse_args()
    cam = json.load(open(a.camera, encoding="utf-8")) if a.camera else None
    print(json.dumps(mesurer_glb(a.glb, a.entree, cam), indent=1, ensure_ascii=False))
