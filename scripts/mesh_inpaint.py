"""Auto inpaint 3D : regenerer la FORME d'une zone d'un maillage (2026-09-28).

Demande user : « un outil comme auto inpaint, mais pour les mesh ». Chaine :
  1. vue de face ORTHOGRAPHIQUE du maillage + masque de la zone (detection
     CLIPSeg ou pinceau) : fenetre « Reshape a region » ;
  2. la zone est repeinte avec le prompt (SDXL, /mask_inpaint) : main.js ;
  3. `preparer` : on isole la zone repeinte (hors masque -> blanc), detourage
     Lucida -> image RGBA de la NOUVELLE piece + son cadre dans le repere du
     maillage ;
  4. la piece passe en image -> 3D (moteur habituel) : main.js ;
  5. `assembler` : on coupe les faces du maillage sous le masque (toute la
     profondeur), on recale la piece dans ce cadre, on MELANGE la jointure
     (geometrie : l'ouverture de la piece est tiree sur le bord du trou ;
     texture : les couleurs se fondent vers celles du corps) et on assemble.

Correspondance pixels <-> maillage : le rendu de face (face_inpaint_atlas.py,
pyrender) est orthographique, camera sur +Z, demi-largeur XMAG = 0,6 : le pixel
(px, py) d'une image de cote S vaut x = px/S*1,2 - 0,6, y = 0,6 - py/S*1,2.

Usage :
  python mesh_inpaint.py rendre <maillage.glb> <vue.png> [taille]
  python mesh_inpaint.py masque-uv <maillage.glb> <masque_uv.png> <masque_face.png> <faces.npy> [taille]
  python mesh_inpaint.py preparer <rendu_repeint.png> <masque.png> <piece.png> <cadre.json>
  python mesh_inpaint.py assembler <maillage.glb> <masque.png> <cadre.json> <piece.glb> <sortie.glb> [faces.npy]
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image, ImageFilter

XMAG = 0.6            # demi-largeur de la camera orthographique du rendu de face
BANDE = 0.045         # largeur du melange, en unites du modele


def log(m):
    print(f'[mesh-inpaint] {m}', flush=True)


def _masque(chemin, taille):
    m = Image.open(chemin).convert('L').resize((taille, taille), Image.NEAREST)
    return np.asarray(m) > 127


# ----------------------------------------------------------------------- rendre
def rendre(maillage, sortie, taille=1024):
    """Vue de face A PLAT (couleurs de la texture, sans eclairage) sur fond
    BLANC, meme camera que le rendu de la fenetre : c'est elle que la retouche
    IA repeint. Le rendu de la fenetre est eclaire et tres sombre (moyenne
    51/36/28 mesuree sur la fourmi) : repeint tel quel, la piece sortait
    sombre. NB pyrender : bg_color en FLOTTANTS, [1, 1, 1, 1] en entiers est
    lu 1/255 (fond noir)."""
    import pyrender
    import trimesh
    sc = trimesh.load(maillage, force='scene')
    ps = pyrender.Scene(bg_color=[1.0, 1.0, 1.0, 1.0], ambient_light=[1.0, 1.0, 1.0])
    for g in sc.geometry.values():
        ps.add(pyrender.Mesh.from_trimesh(g, smooth=False))
    cam = pyrender.OrthographicCamera(xmag=XMAG, ymag=XMAG, znear=0.01, zfar=100)
    pose = np.eye(4)
    pose[2, 3] = 2.0
    ps.add(cam, pose=pose)
    r = pyrender.OffscreenRenderer(int(taille), int(taille))
    try:
        col, _ = r.render(ps, flags=pyrender.RenderFlags.FLAT)
    finally:
        r.delete()
    Image.fromarray(col).save(sortie)
    log(f'vue de face a plat : {sortie}')


# -------------------------------------------------------------------- masque-uv
def masque_uv(maillage, uv_png, sortie_masque, sortie_faces, taille=1024):
    """Variante MANUELLE (« comme Draw mask », 2026-09-28) : la zone est peinte
    sur le modele 3D, dans la texture (visionneuse 3D). On en tire :
      - les faces PEINTES (centre UV dans le blanc) ;
      - leur extension a TOUTE L'EPAISSEUR de la partie : faces dont la
        projection de face tombe sous la zone peinte ET reliees a elle (on ne
        coupe pas un autre membre situe derriere) ;
      - le masque de face (projection de la selection) pour la retouche IA."""
    import trimesh
    from PIL import ImageDraw
    base = _charger(maillage)
    uv = base.visual.uv
    m = np.asarray(Image.open(uv_png).convert('L'))
    H, W = m.shape
    cuv = uv[base.faces].mean(axis=1)
    x = np.clip((cuv[:, 0] % 1.0) * (W - 1), 0, W - 1).astype(int)
    y = np.clip((1 - (cuv[:, 1] % 1.0)) * (H - 1), 0, H - 1).astype(int)
    peintes = m[y, x] > 127
    if not peintes.any():
        raise SystemExit('rien de peint sur le modele')
    S = int(taille)
    tri = base.triangles[:, :, :2]
    px = (tri[:, :, 0] + XMAG) / (2 * XMAG) * S
    py = (XMAG - tri[:, :, 1]) / (2 * XMAG) * S

    def raster(sel):
        img = Image.new('L', (S, S), 0)
        d = ImageDraw.Draw(img)
        for i in np.where(sel)[0]:
            d.polygon([(px[i, k], py[i, k]) for k in range(3)], fill=255)
        return np.asarray(img) > 127

    zone = raster(peintes)
    c = base.triangles_center
    cx = np.clip(((c[:, 0] + XMAG) / (2 * XMAG) * S).astype(int), 0, S - 1)
    cy = np.clip(((XMAG - c[:, 1]) / (2 * XMAG) * S).astype(int), 0, S - 1)
    candidates = zone[cy, cx] | peintes
    # extension par voisinage, limitee aux candidates (pas de saut vers un autre membre)
    w = _soude(base)
    adj = w.face_adjacency
    garde = adj[candidates[adj[:, 0]] & candidates[adj[:, 1]]]
    lab = trimesh.graph.connected_component_labels(garde, node_count=len(base.faces))
    retenues = np.isin(lab, np.unique(lab[peintes])) & candidates
    np.save(sortie_faces, np.where(retenues)[0])
    masque = Image.fromarray((raster(retenues) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))
    masque.save(sortie_masque)
    log(f'zone peinte : {int(peintes.sum())} faces, etendue a {int(retenues.sum())} (toute l epaisseur)')


# --------------------------------------------------------------------- preparer
def preparer(repeint, masque, sortie_piece, sortie_cadre):
    img = Image.open(repeint).convert('RGB')
    S = img.size[0]
    m = _masque(masque, S)
    if not m.any():
        raise SystemExit('masque vide : aucune zone a regenerer')
    ys, xs = np.where(m)
    marge = int(0.04 * S)
    x0, x1 = max(0, xs.min() - marge), min(S, xs.max() + marge + 1)
    y0, y1 = max(0, ys.min() - marge), min(S, ys.max() + marge + 1)
    # hors du masque (elargi) -> blanc : le detourage ne garde que la nouvelle
    # piece, pas le corps voisin compris dans le cadre
    large = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(25))) > 127
    a = np.asarray(img).copy()
    a[~large] = 255
    crop = Image.fromarray(a[y0:y1, x0:x1])
    tmp = sortie_piece + '.crop.png'
    crop.save(tmp)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import lucida_matte
        lucida_matte.matte(tmp, sortie_piece)
    except Exception as e:                      # repli : detourage classique
        log(f'Lucida indisponible ({e}), repli u2net')
        from rembg import remove, new_session
        Image.fromarray(np.array(remove(crop.convert('RGBA'), session=new_session('u2net')))).save(sortie_piece)
    alpha = np.asarray(Image.open(sortie_piece).convert('RGBA'))[:, :, 3] > 127
    if not alpha.any():
        raise SystemExit('detourage vide : la zone repeinte ne contient pas de sujet')
    ay, ax = np.where(alpha)
    # cadre de la piece dans le repere du maillage
    px0, px1 = x0 + ax.min(), x0 + ax.max() + 1
    py0, py1 = y0 + ay.min(), y0 + ay.max() + 1
    cadre = {
        'x': [px0 / S * 2 * XMAG - XMAG, px1 / S * 2 * XMAG - XMAG],
        'y': [XMAG - py1 / S * 2 * XMAG, XMAG - py0 / S * 2 * XMAG],
        'taille_rendu': S,
    }
    with open(sortie_cadre, 'w', encoding='utf-8') as f:
        json.dump(cadre, f)
    try:
        os.remove(tmp)
    except OSError:
        pass
    log(f'piece isolee : {sortie_piece} ; cadre x {np.round(cadre["x"], 3)} y {np.round(cadre["y"], 3)}')


# -------------------------------------------------------------------- assembler
def _charger(p):
    import trimesh
    sc = trimesh.load(p, force='scene')
    return sc.to_geometry() if hasattr(sc, 'to_geometry') else sc.dump(concatenate=True)


def _soude(m):
    w = m.copy()
    w.merge_vertices(merge_tex=True, merge_norm=True)     # coutures UV = faux bords
    return w


def _bords(m):
    w = _soude(m)
    uniq, compte = np.unique(w.edges_sorted, axis=0, return_counts=True)
    return w.vertices[np.unique(uniq[compte == 1])]


def _texture(m):
    mat = m.visual.material
    img = getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)
    return np.asarray(img.convert('RGB')).astype(np.float32)


def _echantillonner(tex, uv):
    h, w = tex.shape[:2]
    x = np.clip((uv[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(int)
    y = np.clip((1 - (uv[:, 1] % 1.0)) * (h - 1), 0, h - 1).astype(int)
    return tex[y, x]


def assembler(maillage, masque, cadre_json, piece_glb, sortie, faces_npy=None):
    import trimesh
    from scipy.spatial import cKDTree
    t0 = time.time()
    with open(cadre_json, encoding='utf-8') as f:
        cadre = json.load(f)
    S = int(cadre.get('taille_rendu', 1024))
    base = _charger(maillage)
    m = _masque(masque, S)
    # 1. COUPE : faces dont le centre tombe dans le masque, sur toute la profondeur
    c = base.triangles_center
    px = np.clip(((c[:, 0] + XMAG) / (2 * XMAG) * S).astype(int), 0, S - 1)
    py = np.clip(((XMAG - c[:, 1]) / (2 * XMAG) * S).astype(int), 0, S - 1)
    dedans = m[py, px]
    if faces_npy:                           # zone peinte en 3D (variante manuelle)
        dedans = np.zeros(len(base.faces), bool)
        dedans[np.load(faces_npy)] = True
    if not dedans.any():
        raise SystemExit('aucune face sous le masque')
    retiree = base.submesh([np.where(dedans)[0]], append=True)
    reste = base.submesh([np.where(~dedans)[0]], append=True)
    trou = _bords(reste)
    bb_r = retiree.bounds
    trou = trou[np.all((trou >= bb_r[0] - 0.02) & (trou <= bb_r[1] + 0.02), axis=1)]
    # MORCEAUX ORPHELINS : petites composantes qui touchent la zone retiree —
    # detachees par la coupe (doigt, bout d'antenne) ou debris de generation
    # qui n'etaient accroches qu'a elle (mesure : 18 fragments au bout des
    # antennes de la fourmi, deja separes dans le maillage d'origine). Les
    # pieces separees d'origine eloignees de la zone restent.
    w = _soude(reste)
    lab = trimesh.graph.connected_component_labels(w.face_adjacency, node_count=len(w.faces))
    tailles = np.bincount(lab)
    arbre_trou = cKDTree(trou) if len(trou) else None
    arbre_retiree = cKDTree(retiree.vertices)
    jeter = np.zeros(len(tailles), bool)
    for k in np.where(tailles < 0.05 * tailles.max())[0]:
        sommets = w.vertices[np.unique(w.faces[lab == k])]
        if arbre_retiree.query(sommets)[0].min() < 0.03:
            jeter[k] = True
    if jeter.any():
        reste = reste.submesh([np.where(~jeter[lab])[0]], append=True)
        log(f'morceaux detaches par la coupe retires : {int(jeter.sum())}')
        # le bord du trou se relit sans eux (leurs bords faussaient le recalage)
        trou = _bords(reste)
        trou = trou[np.all((trou >= bb_r[0] - 0.02) & (trou <= bb_r[1] + 0.02), axis=1)]
        arbre_trou = cKDTree(trou) if len(trou) else None
    log(f'coupe : {int(dedans.sum())} faces retirees, bord du trou {len(trou)} points')

    # 2. RECALAGE : la piece occupe le cadre de la zone repeinte ; en profondeur,
    #    elle se centre sur ce qui a ete retire
    piece = _charger(piece_glb)
    pb = piece.bounds
    sx = (cadre['x'][1] - cadre['x'][0]) / max(1e-6, pb[1][0] - pb[0][0])
    sy = (cadre['y'][1] - cadre['y'][0]) / max(1e-6, pb[1][1] - pb[0][1])
    echelle = (sx + sy) / 2
    piece.apply_translation(-(pb[0] + pb[1]) / 2)
    piece.apply_scale(echelle)
    piece.apply_translation([(cadre['x'][0] + cadre['x'][1]) / 2, (cadre['y'][0] + cadre['y'][1]) / 2,
                             (bb_r[0][2] + bb_r[1][2]) / 2])
    # PROFONDEUR : l'image de face ne la donne pas. La tranche de la piece a la
    # hauteur du bord du trou doit tomber sur ce bord (sinon elle flotte devant
    # ou derriere, et le melange n'accroche pas).
    if len(trou):
        v = piece.vertices
        tranche = (v[:, 1] >= trou[:, 1].min() - 0.02) & (v[:, 1] <= trou[:, 1].max() + 0.02)
        if tranche.sum() < 20:
            tranche = v[:, 1] <= v[:, 1].min() + 0.15 * (v[:, 1].max() - v[:, 1].min())
        dz = float(trou[:, 2].mean() - v[tranche, 2].mean())
        piece.apply_translation([0, 0, dz])
    log(f'piece recalee : echelle {echelle:.3f}')

    # 3. MELANGE DE GEOMETRIE : les points de la piece proches du trou y sont
    #    tires ; le deplacement s'estompe sur la bande
    if arbre_trou is not None:
        # Une piece GENEREE est fermee (pas d'ouverture propre, contrairement a
        # une piece decoupee) : on tire vers le bord du trou ses points proches,
        # d'autant plus qu'ils en sont pres (smoothstep sur la bande).
        pts = piece.vertices
        d_trou, i_trou = arbre_trou.query(pts)
        t = np.clip(1 - d_trou / BANDE, 0, 1)
        poids = t * t * (3 - 2 * t)
        depl = (trou[i_trou] - pts) * poids[:, None]
        piece.vertices = pts + depl
        poids_tex = t
        log(f'geometrie : {int((np.linalg.norm(depl, axis=1) > 1e-5).sum())} sommets rapproches du trou')

        # 4. MELANGE DE TEXTURE, en espace UV de la piece
        try:
            tex_b = _texture(reste)
            tex_p = _texture(piece)
            _, j = cKDTree(reste.vertices).query(trou)
            coul_trou = _echantillonner(tex_b, reste.visual.uv[j])
            H, W = tex_p.shape[:2]
            uv = piece.visual.uv
            faces = piece.faces
            touche = np.where(poids_tex[faces].max(axis=1) > 0)[0]
            for f in touche:
                a_, b_, c_ = faces[f]
                P = np.array([[uv[k, 0] * (W - 1), (1 - uv[k, 1]) * (H - 1)] for k in (a_, b_, c_)])
                x0, y0 = np.floor(P.min(0)).astype(int)
                x1, y1 = np.ceil(P.max(0)).astype(int)
                if x1 - x0 > 64 or y1 - y0 > 64:
                    continue
                xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
                q = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], 1)
                T = np.array([P[1] - P[0], P[2] - P[0]]).T
                if abs(np.linalg.det(T)) < 1e-9:
                    continue
                l12 = np.linalg.solve(T, (q - P[0]).T).T
                bary = np.column_stack([1 - l12.sum(1), l12])
                ok = np.all(bary >= -1e-3, axis=1)
                if not ok.any():
                    continue
                bary = bary[ok]
                pos = bary @ piece.vertices[[a_, b_, c_]]
                wgt = bary @ poids_tex[[a_, b_, c_]]
                _, k = arbre_trou.query(pos)
                qx = np.clip(q[ok, 0].astype(int), 0, W - 1)
                qy = np.clip(q[ok, 1].astype(int), 0, H - 1)
                tex_p[qy, qx] = (1 - wgt[:, None]) * tex_p[qy, qx] + wgt[:, None] * coul_trou[k]
            piece.visual.material.baseColorTexture = Image.fromarray(np.clip(tex_p, 0, 255).astype(np.uint8))
            log(f'texture : {len(touche)} triangles fondus')
        except Exception as e:
            log(f'melange de texture ignore ({e})')

    # 5. ASSEMBLAGE : un GLB, deux maillages, chacun sa texture
    scene = trimesh.Scene()
    scene.add_geometry(reste, geom_name='corps')
    scene.add_geometry(piece, geom_name='zone_regeneree')
    scene.export(sortie)
    log(f'ecrit {sortie} ({time.time() - t0:.1f} s)')


if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in ('rendre', 'masque-uv', 'preparer', 'assembler'):
        print(__doc__)
        sys.exit(2)
    if sys.argv[1] == 'rendre':
        rendre(*sys.argv[2:5])
    elif sys.argv[1] == 'masque-uv':
        masque_uv(*sys.argv[2:7])
    elif sys.argv[1] == 'preparer':
        preparer(*sys.argv[2:6])
    else:
        assembler(*sys.argv[2:8])
