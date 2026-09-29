"""TRELLIS-2 image-to-3D — cloud version.

Mirrors `scripts/trellis2_native_full_pipeline.py` but as a pure function
that takes a PIL image and returns GLB bytes. The pipeline + o_voxel
post-processor are loaded ONCE in @modal.enter and reused per call.

CAUTION: TRELLIS-2 ships custom CUDA kernels (diffoctreerast, spconv,
mip-gaussian) that compile on first .cuda() call. Memory Snapshots
DON'T capture compiled CUDA state — the kernels recompile at every
cold restore. The cold-start UX depends on whether `pipeline.cuda()`
triggers compilation (~30-60s) or just memcpy (~5-10s). We measure
this on the POC and rollback to Replicate if compilation dominates.

License: MIT (microsoft/TRELLIS.2-4B) → we can redistribute.
"""
import io
import os
import time

# Nombre de faces du DERNIER maillage produit par generate() (2026-09-27) :
# le worker rembourse les tranches « Max triangles » non livrees.
DERNIER_NB_FACES = None

import numpy as np
from PIL import Image, ImageEnhance


# --- NOYAU PARTAGE : DEBUT (image -> TRELLIS-2) ---
# Copie surveillee par build/check-noyaux-partages.mjs. Source :
# scripts/trellis2_native_full_pipeline.py ; copie : modal_app/_mesh.py.
#
# POURQUOI (mesure du 2026-09-26). FabMesh appelle TRELLIS-2 avec
# preprocess_image=False, donc SANS son pretraitement, qui fait deux choses :
# recadrer sur le sujet, et composer l'image sur FOND NOIR (RGB x alpha).
# L'extracteur DINOv3 fait ensuite `image.convert('RGB')` : l'alpha est JETE,
# et ce qui reste sous les zones transparentes redevient visible.
#
# Une image detouree par rembg a du noir sous la transparence : sans effet.
# Mais le detourage web garde le FOND D'ORIGINE sous l'alpha (gris ~200 sur
# l'orc « orc W1 »). Le modele voyait donc le sujet sur un fond gris qu'il n'a
# jamais vu a l'entrainement : sur cinq maillages tires de la meme image, les
# quatre generes a partir de l'image detouree avaient une texture marbree,
# « camouflage » (peau verte en taches sur le torse, cotte de mailles en
# neige blanche) ; le seul propre etait parti de l'image rectifiee, que rembg
# avait recomposee sur noir. Aucune option ne distinguait les deux groupes.


def _crop_to_subject(image, pad_frac=None):
    """Tight SQUARE crop around the alpha subject so it FILLS the frame.

    Audit fix: FabMesh runs the pipeline with preprocess_image=False (TRELLIS's own
    crop is skipped), so a small / off-centre rembg'd subject reached the model
    full-frame and DINOv3 captured little fine detail. This re-introduces the crop:
    bbox of the opaque pixels -> centred square + small margin, transparent-padded if
    it overflows. Returns the cropped RGBA (the pipeline resizes to 1024 itself)."""
    from PIL import Image
    import numpy as np
    if image.mode != 'RGBA':
        return image
    if pad_frac is None:
        pad_frac = float(os.environ.get('FABMESH_TEX_CROP_PAD', '0.08'))
    a = np.asarray(image)[:, :, 3]
    ys, xs = np.where(a > 10)
    if len(xs) == 0:
        return image  # nothing detected -> leave as-is
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    side = int(max(x1 - x0, y1 - y0) * (1.0 + 2.0 * pad_frac))
    if side <= 0:
        return image
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    L, T = cx - side // 2, cy - side // 2
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    src = image.crop((max(L, 0), max(T, 0),
                      min(L + side, image.width), min(T + side, image.height)))
    canvas.paste(src, (max(-L, 0), max(-T, 0)))
    return canvas


def _composite_on_black(image):
    """RGB x alpha, comme la fin de Trellis2ImageTo3DPipeline.preprocess_image.

    L'alpha est conserve (le reste du pipeline s'en sert pour le recadrage) ;
    seules les couleurs des pixels transparents ou semi-transparents sont
    ramenees vers le noir, qui est le fond de la distribution d'entrainement."""
    from PIL import Image
    import numpy as np
    if image.mode != 'RGBA':
        return image
    arr = np.asarray(image).astype(np.float32)
    arr[:, :, :3] *= arr[:, :, 3:4] / 255.0
    return Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), 'RGBA')
def _strip_opaque_alpha(glb_obj):
    """Atlas baseColor en RGB quand le materiau est OPAQUE.

    MESURE DU 2026-09-26. Depuis que l'image d'entree est composee sur fond noir
    (voir plus haut), TRELLIS-2 predit une opacite PARTIELLE sur une partie de
    l'atlas : alpha < 250 sur 16 % de la zone peinte de l'orc « orc W1 »,
    alors qu'il etait a 255 partout avant. Le materiau exporte reste declare
    OPAQUE, et la spec glTF demande alors d'IGNORER l'alpha — three.js le fait.
    Mais un canal alpha incoherent avec le materiau est une donnee trompeuse
    pour tout autre logiciel (import Unreal, visionneuses) : on le retire.
    Les materiaux reellement transparents (alphaMode BLEND ou MASK) ne sont
    pas touches. Rend le nombre d'atlas convertis."""
    geoms = (list(glb_obj.geometry.values())
             if hasattr(glb_obj, 'geometry') else [glb_obj])
    n = 0
    for g in geoms:
        mat = getattr(getattr(g, 'visual', None), 'material', None)
        tex = getattr(mat, 'baseColorTexture', None) if mat is not None else None
        if tex is None or getattr(tex, 'mode', '') != 'RGBA':
            continue
        if str(getattr(mat, 'alphaMode', None) or 'OPAQUE').upper() != 'OPAQUE':
            continue
        mat.baseColorTexture = tex.convert('RGB')
        n += 1
    return n


# ACCORD DES COULEURS SUR L'IMAGE SOURCE (2026-09-26) — remplace
# l'eclaircissement FIXE. Mesure sur une araignee rouge sombre : atlas final
# 34 % plus clair que l'image (luminance mediane 0,465 contre 0,302) et MOINS
# sature (0,50 contre 0,59) malgre +30 % de saturation ajoutes ; avant
# l'eclaircissement, sa luminance (~0,31) collait deja a l'image. Un gain fixe
# ne peut pas etre juste pour tous les sujets : on mesure l'image et l'atlas,
# et on corrige l'atlas vers l'image. Gains bornes (une image quasi noire ou
# un atlas degenere ne doivent pas produire un extreme).
def _stats_couleur(rgb):
    """(luminance mediane, saturation moyenne) de pixels RGB 0..1, forme (N, 3)."""
    import numpy as np
    lum = 0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2]
    mx, mn = rgb.max(axis=1), rgb.min(axis=1)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    return float(np.median(lum)), float(sat.mean())


def _pixels_sujet(image):
    """Pixels du sujet : alpha > 127 si l'image en a un, hors quasi-noir (le
    fond compose sur noir n'est pas le sujet)."""
    import numpy as np
    a = np.asarray(image.convert('RGBA')).astype(np.float32) / 255.0
    m = a[:, :, 3] > 0.5 if image.mode == 'RGBA' else np.ones(a.shape[:2], bool)
    px = a[:, :, :3][m]
    return px[px.max(axis=1) > 0.04]


def _masque_couverture_uv(geom, largeur, hauteur):
    """Texels REELLEMENT couverts par les triangles UV : le vide de l'atlas est
    noir et ecraserait toute mediane (piege mesure, voir CLAUDE.md)."""
    import numpy as np
    try:
        import cv2
    except ImportError:
        return None      # repli : seuil « non noir » dans l'appelant
    uv = getattr(getattr(geom, 'visual', None), 'uv', None)
    if uv is None or len(uv) == 0:
        return None
    pts = np.stack([uv[:, 0] * (largeur - 1), (1.0 - uv[:, 1]) * (hauteur - 1)], axis=1)
    tri = np.round(pts[np.asarray(geom.faces)]).astype(np.int32)
    m = np.zeros((hauteur, largeur), np.uint8)
    cv2.drawContours(m, list(tri), -1, 1, thickness=-1)   # chaque triangle rempli, union
    return m.astype(bool)


def _courbe_luminance(im, masque, cible):
    """Courbe v -> v**g par canal (LUT) telle que la luminance mediane des
    pixels couverts vaille `cible`. Ne sature jamais : 1 reste 1."""
    import numpy as np
    arr = np.asarray(im).astype(np.float32) / 255.0
    px = arr[masque] if masque is not None else arr.reshape(-1, 3)
    px = px[px.max(axis=1) > 0.04]
    if len(px) > 200_000:
        px = px[np.random.default_rng(0).choice(len(px), 200_000, replace=False)]
    if len(px) < 500:
        return im

    def mediane(g):
        q = px ** g
        return float(np.median(0.2126 * q[:, 0] + 0.7152 * q[:, 1] + 0.0722 * q[:, 2]))
    lo, hi = 0.25, 4.0                  # la mediane DECROIT quand g croit
    for _ in range(30):
        mil = (lo * hi) ** 0.5
        if mediane(mil) > cible:
            lo = mil
        else:
            hi = mil
    g = (lo * hi) ** 0.5
    lut = [int(round(255.0 * (i / 255.0) ** g)) for i in range(256)]
    return im.point(lut * len(im.getbands()))


def _accorder_couleurs_source(glb_obj, image_ref, log=print):
    """Accorde luminance mediane et saturation moyenne de l'atlas baseColor sur
    celles du sujet de `image_ref`. Rend True si au moins un atlas a ete traite."""
    import os
    import numpy as np
    from PIL import Image, ImageEnhance
    if image_ref is None:
        return False
    ref = _pixels_sujet(image_ref)
    if len(ref) < 500:
        return False
    lum_ref, sat_ref = _stats_couleur(ref)
    lo_l, hi_l = 0.75, float(os.environ.get('FABMESH_TEX_ACCORD_MAX', '1.6'))
    geoms = (list(glb_obj.geometry.values())
             if hasattr(glb_obj, 'geometry') else [glb_obj])
    fait = False
    for g in geoms:
        mat = getattr(getattr(g, 'visual', None), 'material', None)
        tex = getattr(mat, 'baseColorTexture', None) if mat is not None else None
        if tex is None:
            continue
        alpha = tex.getchannel('A') if tex.mode == 'RGBA' else None
        rgb = tex.convert('RGB')
        masque = _masque_couverture_uv(g, rgb.width, rgb.height)

        def mesurer(im):
            arr = np.asarray(im).astype(np.float32) / 255.0
            px = arr[masque] if masque is not None else arr.reshape(-1, 3)
            px = px[px.max(axis=1) > 0.04]
            return _stats_couleur(px) if len(px) >= 500 else (None, None)

        lum_a, _ = mesurer(rgb)
        if lum_a is None:
            continue
        g_l = min(hi_l, max(lo_l, lum_ref / max(lum_a, 1e-3)))
        # COURBE et non gain lineaire (2026-09-27) : un gain x1,46 avait brule
        # 5,4 % de l'atlas au blanc (poitrine et casque delaves ; 0,5 % sans
        # gain). Une puissance par canal envoie 0 sur 0 et 1 sur 1 : la mediane
        # atteint la meme cible, les clairs sont comprimes au lieu d'etre ecretes.
        rgb = _courbe_luminance(rgb, masque, lum_a * g_l)
        _, sat_a = mesurer(rgb)
        g_s = min(1.5, max(0.8, sat_ref / max(sat_a, 1e-3)))
        rgb = ImageEnhance.Color(rgb).enhance(g_s)
        lum_f, sat_f = mesurer(rgb)
        if alpha is not None:
            rgb.putalpha(alpha)
        mat.baseColorTexture = rgb
        fait = True
        log(f'couleurs accordees sur la source : luminance {lum_a:.3f}->{lum_f:.3f} '
            f'(image {lum_ref:.3f}, gain x{g_l:.2f}), saturation ->{sat_f:.3f} '
            f'(image {sat_ref:.3f}, gain x{g_s:.2f})')
    return fait

# Triangles EXACTS (2026-09-27, user : « s'il choisit 10 M il en faut 10 M
# +/- 5 % »). Le moteur livre TOUJOURS moins que sa cible : mesure sur 40
# maillages a 500 K, 92,6 % a 99,9 % (mediane 95,7 %). On vise donc la cible
# divisee par 0,9625 (resultat attendu -3,8 % / +3,8 %). Si l'objet est trop
# simple pour atteindre la cible (maillage brut trop petit), le maillage brut
# est subdivise (milieux des aretes, sans T-jonction) puis reduit a la cible
# AVANT le depliage UV et la cuisson : la texture reste juste.
TRIS_FACTEUR = 0.9625
TRIS_TOLERANCE = 0.05


def cible_compensee(cible):
    return int(round(cible / TRIS_FACTEUR))


def compter_faces(glb_obj):
    geoms = list(glb_obj.geometry.values()) if hasattr(glb_obj, 'geometry') else [glb_obj]
    return int(sum(len(getattr(g, 'faces', [])) for g in geoms))


def subdiviser_milieux(vertices, faces):
    """Subdivision au milieu des aretes (1 triangle -> 4), tenseurs torch."""
    import torch
    m = faces.shape[0]
    e = torch.cat([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], 0)
    e = torch.sort(e, dim=1).values
    uniq, inv = torch.unique(e, dim=0, return_inverse=True)
    n = vertices.shape[0]
    v2 = torch.cat([vertices, (vertices[uniq[:, 0]] + vertices[uniq[:, 1]]) * 0.5], 0)
    a, b, c = n + inv[:m], n + inv[m:2 * m], n + inv[2 * m:]
    f0, f1, f2 = faces[:, 0], faces[:, 1], faces[:, 2]
    f = torch.cat([torch.stack([f0, a, c], 1), torch.stack([a, f1, b], 1),
                   torch.stack([c, b, f2], 1), torch.stack([a, b, c], 1)], 0)
    return v2, f.to(faces.dtype)


# Au-dela d'1 M de triangles, le depliage UV du maillage FINAL se fragmente.
# MESURE (generation 10 M / atlas 4096 du 2026-09-27) : 32 % des sommets dans
# 1/64 de l'atlas, le reste en micro-ilots de 1-2 pixels ; au rendu le filtrage
# melange les ilots voisins -> texture mouchetee (« la geometrie est super, la
# texture a un probleme »), et l'export seul a pris 57 min. On deplie et on cuit
# donc un maillage INTERMEDIAIRE (cible / 4^k <= 1 M), puis on le subdivise k
# fois (milieux des aretes : chaque UV reste dans son ilot, la texture reste
# juste) et on plaque les sommets crees sur la surface detaillee d'origine.
PROXY_MAX = 1_000_000


def densifier(glb, vertices, faces, k, log=print):
    """Subdivise k fois le maillage texture `glb` (1 triangle -> 4, UV
    interpoles) puis plaque les sommets crees sur la surface d'origine
    (vertices, faces : maillage brut du moteur, dans SON repere)."""
    import numpy as np
    import torch
    import trimesh
    import cumesh
    g = glb
    if hasattr(glb, 'geometry'):
        geoms = list(glb.geometry.values())
        if len(geoms) != 1:
            raise ValueError(f'{len(geoms)} geometries')
        g = geoms[0]
    dev = 'cuda'
    v = torch.as_tensor(np.asarray(g.vertices), dtype=torch.float32, device=dev)
    uv = torch.as_tensor(np.asarray(g.visual.uv), dtype=torch.float32, device=dev)
    nrm = torch.as_tensor(np.asarray(g.vertex_normals), dtype=torch.float32, device=dev)
    f = torch.as_tensor(np.asarray(g.faces), dtype=torch.int64, device=dev)
    n0 = v.shape[0]
    # Position, UV et normale subdivisees ENSEMBLE ; un sommet duplique sur une
    # couture UV donne deux milieux de meme position (memes extremites).
    a = torch.cat([v, uv, nrm], 1)
    for _ in range(k):
        a, f = subdiviser_milieux(a, f)
    v, uv, nrm = a[:, :3].contiguous(), a[:, 3:5].contiguous(), a[:, 5:].contiguous()
    del a

    # Toute la geometrie se fait sur le maillage SOUDE : un sommet de couture
    # et son double bougent ensemble (sinon fissure), normales sans cassure.
    plan, inv = torch.unique(v, dim=0, return_inverse=True)
    fw = inv[f]
    nw = torch.zeros_like(plan).index_add_(0, inv, nrm)
    nw = torch.nn.functional.normalize(nw, dim=1)
    nouveau = torch.ones(plan.shape[0], dtype=torch.bool, device=dev)
    nouveau[inv[:n0]] = False

    # Surface d'origine dans le repere GLB (to_glb : y, z <- z, -y).
    rv = torch.as_tensor(vertices, device=dev).float()
    rv = torch.stack([rv[:, 0], rv[:, 2], -rv[:, 1]], 1).contiguous()
    rf = torch.as_tensor(faces, device=dev).long()
    ech = rf[::max(1, rf.shape[0] // 200_000)]
    arete = float((rv[ech[:, 0]] - rv[ech[:, 1]]).norm(dim=1).median())
    plafond = 2.0 * arete
    bvh = cumesh.cuBVH(rv, rf.int())
    # Projection le long de la normale LISSEE (rayons dans les deux sens, impact
    # le plus proche) et non « au point le plus proche » : sur une surface
    # bosselee ce dernier replie les triangles (MESURE au banc 10 M : 7,2 % de
    # faces retournees, 1,8 % degenerees, contre 0,9 % / 0 % a la reference).
    p, d = plan[nouveau], nw[nouveau]
    meilleur, dist = p.clone(), torch.full((p.shape[0],), float('inf'), device=dev)
    for sens in (1.0, -1.0):
        hit, fid, prof = bvh.ray_trace(p, d * sens)
        ok = (fid >= 0) & torch.isfinite(prof) & (prof >= 0) & (prof <= plafond) & (prof < dist)
        meilleur = torch.where(ok.unsqueeze(1), hit, meilleur)
        dist = torch.where(ok, prof, dist)
    del bvh, rv, rf
    pos = plan.clone()
    pos[nouveau] = meilleur
    touches = int(torch.isfinite(dist).sum())

    # Garde anti-pli : un triangle qui se retourne ou s'ecrase par rapport au
    # plan, OU qui contredit la normale lissee de ses sommets (pli local : au
    # banc, 2,6 % de faces dans ce cas avec la seule premiere regle, contre
    # 0,9 % a la reference — materiau non double face, donc de petits trous
    # sombres au rendu), remet ses sommets NEUFS a plat ; on recommence
    # jusqu'a n'en plus avoir.
    def normales_faces(q):
        return torch.cross(q[fw[:, 1]] - q[fw[:, 0]], q[fw[:, 2]] - q[fw[:, 0]], dim=1)
    fn0 = normales_faces(plan)
    a0 = fn0.norm(dim=1)
    remis = 0
    for _ in range(12):
        fn1 = normales_faces(pos)
        vl = torch.zeros_like(pos)
        for j in range(3):
            vl.index_add_(0, fw[:, j], fn1)
        vl = torch.nn.functional.normalize(vl, dim=1)
        mauvais = ((fn0 * fn1).sum(1) <= 0) | (fn1.norm(dim=1) < 0.05 * a0)
        mauvais |= (fn1 * (vl[fw[:, 0]] + vl[fw[:, 1]] + vl[fw[:, 2]])).sum(1) <= 0
        mauvais &= a0 > 0
        if not bool(mauvais.any()):
            break
        s_ = torch.unique(fw[mauvais].reshape(-1))
        s_ = s_[nouveau[s_]]
        s_ = s_[(pos[s_] != plan[s_]).any(1)]
        if not s_.numel():
            break
        pos[s_] = plan[s_]
        remis += int(s_.numel())
    log(f'[tris] {touches - remis}/{int(nouveau.sum())} sommets plaques sur la surface '
        f'({remis} remis a plat contre les plis)')

    fn = normales_faces(pos)
    vn = torch.zeros_like(pos)
    for j in range(3):
        vn.index_add_(0, fw[:, j], fn)
    vn = torch.nn.functional.normalize(vn, dim=1)[inv]
    v = pos[inv]
    return trimesh.Trimesh(
        vertices=v.cpu().numpy(), faces=f.cpu().numpy(),
        vertex_normals=vn.cpu().numpy(), process=False,
        visual=trimesh.visual.TextureVisuals(uv=uv.cpu().numpy(), material=g.visual.material))


def exporter_exact(exporter, vertices, faces, cible, log=print):
    """Au-dela de PROXY_MAX : maillage intermediaire texture puis densifie."""
    k = 0
    while cible / 4 ** k > PROXY_MAX:
        k += 1
    if not k:
        return _exporter_cible(exporter, vertices, faces, cible, log)
    inter = int(round(cible / 4 ** k))
    log(f'[tris] cible {cible} : texture cuite sur {inter} faces, subdivisee {k} fois')
    glb = _exporter_cible(exporter, vertices, faces, inter, log)
    try:
        glb = densifier(glb, vertices, faces, k, log)
    except Exception as e:
        log(f'[tris] densification ECHOUEE ({type(e).__name__}: {e}) : export direct')
        return _exporter_cible(exporter, vertices, faces, cible, log)
    n = compter_faces(glb)
    log(f'[tris] cible {cible} -> {n} faces ({n / cible - 1:+.1%})')
    return glb


def _exporter_cible(exporter, vertices, faces, cible, log=print):
    """exporter(vertices, faces, decimation_target, remesh) -> glb_obj.
    1) export normal (remesh) a la cible compensee ; 2) s'il manque plus de
    5 %, maillage brut subdivise puis reduit (remesh=False) ; on garde le plus
    proche de la cible."""
    glb = exporter(vertices, faces, cible_compensee(cible), True)
    n = compter_faces(glb)
    log(f'[tris] cible {cible} -> {n} faces ({n / cible - 1:+.1%})')
    if n >= cible * (1 - TRIS_TOLERANCE):
        return glb
    v, f = vertices, faces
    while f.shape[0] < cible_compensee(cible) * 1.3 and f.shape[0] < 60_000_000:
        v, f = subdiviser_milieux(v, f)
    log(f'[tris] maillage brut insuffisant : subdivise a {f.shape[0]} faces, second export')
    glb2 = exporter(v, f, cible_compensee(cible), False)
    n2 = compter_faces(glb2)
    log(f'[tris] second export : {n2} faces ({n2 / cible - 1:+.1%})')
    return glb2 if abs(n2 - cible) < abs(n - cible) else glb

# --- NOYAU PARTAGE : FIN ---


# RETOUCHES D'ATLAS ACCELEREES (2026-09-29). o_voxel.postprocess.to_glb comble les texels vides de
# l'atlas avec 4 cv2.inpaint successifs : couleur (rayon 3) puis metal, rugosite, alpha (rayon 1),
# un par un. Mesure en 4096 : 7,0 s + 3 x ~2,9 s. Les trois canaux de rayon 1 traites EN UNE FOIS
# (image a 3 canaux) rendent les MEMES octets (verifie) en 3,7 s au lieu de 8,7 s, et tournent en
# meme temps que la couleur (cv2 libere le GIL). Le texte de la fonction est remplace a l'import ;
# s'il a change dans la bibliotheque, rien n'est touche.
_INPAINT_AVANT = """    base_color = cv2.inpaint(base_color, mask_inv, 3, cv2.INPAINT_TELEA)
    metallic = cv2.inpaint(metallic, mask_inv, 1, cv2.INPAINT_TELEA)[..., None]
    roughness = cv2.inpaint(roughness, mask_inv, 1, cv2.INPAINT_TELEA)[..., None]
    alpha = cv2.inpaint(alpha, mask_inv, 1, cv2.INPAINT_TELEA)[..., None]"""
_INPAINT_APRES = """    from concurrent.futures import ThreadPoolExecutor as _Fils
    with _Fils(max_workers=2) as _fils:
        _couleur = _fils.submit(cv2.inpaint, base_color, mask_inv, 3, cv2.INPAINT_TELEA)
        _mra = cv2.inpaint(np.ascontiguousarray(np.dstack([metallic, roughness, alpha])), mask_inv, 1, cv2.INPAINT_TELEA)
        base_color = _couleur.result()
    metallic, roughness, alpha = _mra[..., 0:1], _mra[..., 1:2], _mra[..., 2:3]"""
# (2026-09-29) Limiter TELEA a une bande de 32 px autour des ilots a ete essaye : sur de vrais
# atlas 4K, 100 % des texels vides sont a moins de 32 px d'un ilot (ilots serres) : aucun gain.
_TO_GLB_ACCELERE = False


def accelerer_to_glb(o_voxel_module) -> None:
    global _TO_GLB_ACCELERE
    if _TO_GLB_ACCELERE:
        return
    _TO_GLB_ACCELERE = True
    try:
        import inspect
        import textwrap
        pp = o_voxel_module.postprocess
        src = textwrap.dedent(inspect.getsource(pp.to_glb))
        if _INPAINT_AVANT not in src:
            print("[mesh] retouches d'atlas : texte de to_glb inattendu, version d'origine gardee", flush=True)
            return
        espace = dict(pp.__dict__)
        exec(compile(src.replace(_INPAINT_AVANT, _INPAINT_APRES), inspect.getsourcefile(pp.to_glb), 'exec'), espace)
        pp.to_glb = espace['to_glb']
        print("[mesh] retouches d'atlas accelerees (canaux fusionnes, en parallele)", flush=True)
    except Exception as e:
        print(f"[mesh] retouches d'atlas : acceleration ignoree ({type(e).__name__}: {e})", flush=True)


def prep_image(image: Image.Image) -> Image.Image:
    """Background removal via rembg u2net (Apache 2.0) — same as
    desktop pipeline. Skip if image already has a non-trivial alpha.

    Puis, comme le bureau : recadrage sur le sujet (absent ici jusqu'au
    2026-09-26 — ecart de parite) et composition sur fond noir."""
    needs_rembg = True
    if image.mode == 'RGBA':
        a = np.asarray(image)[:, :, 3]
        if not (a == 255).all():
            needs_rembg = False
    if needs_rembg:
        # meme u2net que rembg, sans son import de 88 s (voir modal_app/_detourage.py)
        from modal_app._detourage import detourer
        image = detourer(image.convert('RGBA'))
    if os.environ.get('FABMESH_TEX_SKIP_CROP') != '1':
        try:
            _avant = image.size
            image = _crop_to_subject(image)
            if image.size != _avant:
                print(f'[mesh] recadrage sur le sujet : {_avant} -> {image.size}', flush=True)
        except Exception as _ce:
            print(f'[mesh] recadrage ignore : {type(_ce).__name__}: {_ce}', flush=True)
    return _composite_on_black(image)


def brighten_baseColor(glb_obj) -> None:
    """REPLI seulement (l'accord sur l'image source n'a rien pu mesurer).

    Etait x1,5 lumiere / x1,3 saturation / x1,1 contraste, « memes
    multiplicateurs que le bureau » — FAUX depuis le 2026-06-27 : l'audit
    texture avait juge ces gains trop forts et le bureau les avait ramenes a
    x1,2 / x1,1 sans contraste ; le cloud n'avait jamais suivi. Aligne."""
    geoms = (list(glb_obj.geometry.values())
             if hasattr(glb_obj, 'geometry') else [glb_obj])
    for m in geoms:
        visual = getattr(m, 'visual', None)
        if not visual: continue
        material = getattr(visual, 'material', None)
        if not material: continue
        tex = getattr(material, 'baseColorTexture', None)
        if not tex: continue
        tex = ImageEnhance.Brightness(tex).enhance(float(os.environ.get('FABMESH_TEX_BRIGHT', '1.2')))
        tex = ImageEnhance.Color(tex).enhance(float(os.environ.get('FABMESH_TEX_SAT', '1.1')))
        material.baseColorTexture = tex



def lisser_atlas(glb_obj, d=9, sigma_color=50, sigma_space=50, passes=1) -> None:
    """Filtre bilateral sur l'atlas baseColor — portage de scripts/texture_smooth.py.

    POURQUOI ICI. L'option « Texture smooth » existait dans l'interface web,
    envoyait bien son drapeau, et AUCUN code serveur ne le lisait : l'audit du
    2026-08-02 l'avait constate et la case avait ete desactivee. Or le script
    bureau n'utilise qu'OpenCV, trimesh et PIL — tous deja dans l'image Modal.
    Il n'y avait donc rien a installer, juste un lecteur a ecrire.

    Le filtre lisse les zones uniformes (le grain moucheté que le rendu interne
    de TRELLIS-2 cuit dans l'atlas) en PRESERVANT les aretes reelles — joints
    de carrosserie, grilles, encadrements. Zero hallucination, contrairement au
    refine SDXL qui invente de l'usure sur une surface lisse.

    Memes parametres par defaut que le bureau (d=9, sigma 50/50, 1 passe).
    """
    import cv2
    geoms = (list(glb_obj.geometry.values())
             if hasattr(glb_obj, 'geometry') else [glb_obj])
    for m in geoms:
        visual = getattr(m, 'visual', None)
        if not visual: continue
        material = getattr(visual, 'material', None)
        if not material: continue
        tex = getattr(material, 'baseColorTexture', None)
        if tex is None: continue
        arr = np.array(tex.convert('RGB'))
        arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        for _ in range(max(1, int(passes))):
            arr = cv2.bilateralFilter(arr, int(d), float(sigma_color), float(sigma_space))
        arr = cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)
        material.baseColorTexture = Image.fromarray(arr)


def corriger_metal_degenere(glb_obj) -> None:
    """Rabat le facteur metallique quand TRELLIS-2 declare TOUT metallique.

    MESURE DU 2026-09-24 sur un orc (peau, cuir, tissu) : la carte
    metal/rugosite portait metal 0.94 et rugosite 0.96 sur 99 % de la
    surface. En PBR un metal n'a AUCUNE composante diffuse — sa couleur vient
    entierement des reflets — donc un personnage organique declare metallique
    rend NOIR quel que soit l'eclairage. Trois correctifs d'eclairage ont ete
    tentes avant de mesurer ; aucun ne pouvait marcher.

    POURQUOI CETTE REGLE NE CASSE PAS UNE EPEE. Elle exige metal ELEVE **et**
    rugosite ELEVEE en meme temps, ce qui est physiquement degenere : un metal
    a rugosite 0.96 ne reflechit presque rien, c'est un trou noir. Un objet
    reellement metallique est metallique et LISSE (rugosite 0.2 a 0.6) — il ne
    declenche donc pas ce garde.

    On ne touche PAS a la texture 4K : `metallicFactor` la multiplie, un seul
    nombre suffit.
    """
    import numpy as np
    geoms = (list(glb_obj.geometry.values())
             if hasattr(glb_obj, 'geometry') else [glb_obj])
    for m in geoms:
        visual = getattr(m, 'visual', None)
        if not visual: continue
        material = getattr(visual, 'material', None)
        if not material: continue
        tex = getattr(material, 'metallicRoughnessTexture', None)
        if tex is None: continue
        a = np.asarray(tex.convert('RGB')).astype(np.float32) / 255.0
        rugosite, metal = a[..., 1], a[..., 2]      # glTF : G rugosite, B metal
        part = float(((metal > 0.8) & (rugosite > 0.85)).mean())
        if part > 0.8:
            material.metallicFactor = 0.05
            print(f'[mesh] metal degenere ({part*100:.0f} % de la surface en '
                  f'metal rugueux) -> metallicFactor rabattu a 0.05', flush=True)


def generate(
    pipeline,                     # Trellis2ImageTo3DPipeline (already on GPU)
    o_voxel_module,               # imported o_voxel module
    front_img: Image.Image,
    back_img: Image.Image = None,  # optional, for multi-view conditioning
    mode: str = '1024',
    seed: int = 42,
    decimation_target: int = 500_000,
    texture_size: int = 2048,
    tex_steps: int = 0,           # 0 = garder le defaut d'environnement
    tris_exact: bool = False,     # « Max triangles » : nombre tenu a +/- 5 %
    smooth: bool = False,         # filtre bilateral sur l'atlas (case « Texture smooth »)
    ultra_hd: bool = False,       # Ultra 8K : atlas couleur x2 AVANT la serialisation (voir plus bas)
) -> bytes:
    """Run TRELLIS-2 inference + GLB export. Returns the GLB bytes
    (caller pushes to R2). When `back_img` is provided, runs the
    multi-view conditioning path (mirror of the desktop fork's
    `scripts/trellis2_native_full_pipeline.py:main()` multi-view
    branch using pipeline.get_cond([front, back])). Otherwise runs
    single-view pipeline.run()."""
    import torch

    t0 = time.time()
    img = prep_image(front_img)
    print(f'[mesh] image prepared in {time.time()-t0:.1f}s size={img.size}', flush=True)
    mv_images = [img]
    if back_img is not None:
        back_prepped = prep_image(back_img)
        mv_images.append(back_prepped)
        print(f'[mesh] multi-view conditioning: 2 images (front + back)', flush=True)

    # Sharpen the texture bake — mirror of the desktop fix (2026-06-22): the
    # native path sampled tex_slat with {} -> pipeline.json defaults (steps=12,
    # guidance_strength=1.0, near-unconditional vs 7.5 for shape), giving a soft
    # bake. Raise steps + guidance (env-overridable). Validated A/B on desktop.
    # PALIERS DE QUALITE ENFIN REELS. Le menu Fast/Balanced/Quality/
    # Ultra 8K est facture 3/4/6/8 credits, mais son nombre de steps
    # (12/24/32) n'arrivait JAMAIS jusqu'ici : la valeur venait d'une
    # variable d'environnement, identique pour TOUS les jobs. Les quatre
    # paliers produisaient donc le meme travail GPU a quatre prix
    # differents (mesure : 373 s contre 420 s entre le palier bas et
    # celui a 8 credits, 13 % d'ecart pour un prix x2,7).
    #
    # tex_steps=0 conserve EXACTEMENT l'ancien comportement : aucune
    # regression si l'appelant ne precise rien.
    _tex_params = {
        'steps': int(tex_steps) if tex_steps and tex_steps > 0
                 else int(os.environ.get('FABMESH_TEX_STEPS', '24')),
        'guidance_strength': float(os.environ.get('FABMESH_TEX_GUIDANCE', '3.0')),
        'guidance_interval': [0.5, 1.0],
        # Audit fixes — see scripts/trellis2_native_full_pipeline.py for the rationale:
        # guidance_rescale 0.0->0.5 (anti color-wash) + rescale_t 3.0->1.5 (steps to detail).
        'guidance_rescale': float(os.environ.get('FABMESH_TEX_RESCALE', '0.5')),
        'rescale_t': float(os.environ.get('FABMESH_TEX_RESCALE_T', '1.5')),
    }
    try:
        if isinstance(getattr(pipeline, 'tex_slat_sampler_params', None), dict):
            pipeline.tex_slat_sampler_params.update(_tex_params)
    except Exception:
        pass
    print(f"[mesh] texture sampler: steps={_tex_params['steps']} "
          f"guidance={_tex_params['guidance_strength']} (sharpened)", flush=True)

    torch.manual_seed(seed)
    t_inf = time.time()
    o_voxel_obj = None
    vues_utilisees = len(mv_images)
    # REPLI MONO-VUE SI LE MULTI-VUES ECHOUE — ajoute le 2026-08-04.
    #
    # Ce chemin n'avait JAMAIS tourne en production : la vue arriere plantait
    # systematiquement en amont (xformers ecrasait les processeurs d'attention
    # de l'IP-Adapter, 0 succes sur 15 tentatives), donc `back_img` etait
    # toujours None. En reparant la vue arriere on l'a reveille, et il a
    # immediatement leve : « The size of tensor a (256) must match the size of
    # tensor b (128) at non-singleton dimension 3 ».
    #
    # Sans filet, cette exception fait echouer la generation ENTIERE — un
    # utilisateur qui demande une vue arriere se retrouverait avec rien du
    # tout, ce qui est pire qu'avant le correctif. On degrade donc vers le
    # mono-vue, qui fonctionne : le maillage sort, TRELLIS devine l'arriere.
    if len(mv_images) > 1 and mode in ('512', '1024'):
      try:
          # Multi-view path — verbatim port of
          # scripts/trellis2_native_full_pipeline.py:210-254 (the same
          # stage chain that runs on the user's desktop). Cascade modes
          # use single-view fallback because their `sample_shape_slat_cascade`
          # has extra constraints we haven't threaded through yet.
          cond_512 = pipeline.get_cond(mv_images, 512)
          cond_1024 = pipeline.get_cond(mv_images, 1024) if mode != '512' else None
          ss_res = {'512': 32, '1024': 64}[mode]
          coords = pipeline.sample_sparse_structure(cond_512, ss_res, 1, {})
          if mode == '512':
              shape_slat = pipeline.sample_shape_slat(
                  cond_512,
                  pipeline.models['shape_slat_flow_model_512'],
                  coords, {})
              tex_slat = pipeline.sample_tex_slat(
                  cond_512,
                  pipeline.models['tex_slat_flow_model_512'],
                  shape_slat, _tex_params)
              res = 512
          else:  # '1024'
              shape_slat = pipeline.sample_shape_slat(
                  cond_1024,
                  pipeline.models['shape_slat_flow_model_1024'],
                  coords, {})
              tex_slat = pipeline.sample_tex_slat(
                  cond_1024,
                  pipeline.models['tex_slat_flow_model_1024'],
                  shape_slat, _tex_params)
              res = 1024
          torch.cuda.empty_cache()
          o_voxel_obj = pipeline.decode_latent(shape_slat, tex_slat, res)
          if isinstance(o_voxel_obj, list):
              o_voxel_obj = o_voxel_obj[0]
      except Exception as e:
        print(f'[mesh] multi-vues ECHOUE, repli mono-vue : {e}', flush=True)
        o_voxel_obj = None
        vues_utilisees = 1
        torch.cuda.empty_cache()
    if o_voxel_obj is None:
        # Single-view path (or cascade fallback) — same as before.
        out = pipeline.run(img, num_samples=1, seed=seed,
                           pipeline_type=mode, preprocess_image=False)
        o_voxel_obj = out[0]
    print(f'[mesh] TRELLIS-2 inference dt={time.time()-t_inf:.1f}s '
          f'mode={mode} views={vues_utilisees}', flush=True)

    t_glb = time.time()
    accelerer_to_glb(o_voxel_module)
    def _exporter(v, f, cible, remesh):
        return o_voxel_module.postprocess.to_glb(
            vertices=v,
            faces=f,
            attr_volume=o_voxel_obj.attrs,
            coords=o_voxel_obj.coords,
            attr_layout=o_voxel_obj.layout,
            voxel_size=o_voxel_obj.voxel_size,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=cible,
            texture_size=texture_size,
            remesh=remesh,
            verbose=False,
        )
    if tris_exact:
        glb_obj = exporter_exact(_exporter, o_voxel_obj.vertices, o_voxel_obj.faces,
                                 decimation_target, log=lambda m: print(m, flush=True))
    else:
        glb_obj = _exporter(o_voxel_obj.vertices, o_voxel_obj.faces, decimation_target, True)
    print(f'[mesh] GLB export dt={time.time()-t_glb:.1f}s', flush=True)
    t_fin = time.time()

    # Couleurs accordees sur l'IMAGE SOURCE (noyau partage) plutot qu'un
    # eclaircissement fixe ; repli sur l'eclaircissement adouci si rien n'a
    # pu etre mesure. FABMESH_TEX_ACCORD=0 retablit l'ancien comportement.
    try:
        accorde = (os.environ.get('FABMESH_TEX_ACCORD', '1') == '1'
                   and _accorder_couleurs_source(
                       glb_obj, img, log=lambda m: print(f'[mesh] {m}', flush=True)))
        if not accorde:
            brighten_baseColor(glb_obj)
    except Exception as e:
        print(f'[mesh] couleurs non ajustees: {e}', flush=True)

    if smooth:
        try:
            lisser_atlas(glb_obj)
            print('[mesh] texture smooth applique', flush=True)
        except Exception as e:
            print(f'[mesh] texture smooth ignore: {e}', flush=True)

    try:
        corriger_metal_degenere(glb_obj)
    except Exception as e:
        print(f'[mesh] correction du metal ignoree: {e}', flush=True)

    try:
        _n = _strip_opaque_alpha(glb_obj)
        if _n:
            print(f'[mesh] alpha retire de {_n} atlas (materiau OPAQUE)', flush=True)
    except Exception as e:
        print(f'[mesh] retrait alpha ignore: {e}', flush=True)

    # Serialize to bytes in-memory (trimesh's .export needs a path OR
    # a writeable file-like; BytesIO works).
    global DERNIER_NB_FACES
    try:
        _g = list(glb_obj.geometry.values()) if hasattr(glb_obj, 'geometry') else [glb_obj]
        DERNIER_NB_FACES = int(sum(len(getattr(x, 'faces', [])) for x in _g))
        print(f'[mesh] faces livrees : {DERNIER_NB_FACES} (cible {decimation_target})', flush=True)
    except Exception:
        DERNIER_NB_FACES = None
    t_couleurs = time.time() - t_fin

    # ULTRA 8K AVANT LA SERIALISATION (2026-09-29). Avant, l'atlas etait agrandi APRES : le GLB
    # (500 K faces, textures WebP) etait serialise, recharge par trimesh, puis reserialise en
    # entier (8K : 39 s dont ~20 s de ce double passage). Meme agrandissement, fait une fois.
    t_8k = 0.0
    if ultra_hd:
        try:
            from modal_app._esrgan import affuter_atlas
            _t = time.time()
            _tailles = []
            for _g in (list(glb_obj.geometry.values()) if hasattr(glb_obj, 'geometry') else [glb_obj]):
                _mat = getattr(getattr(_g, 'visual', None), 'material', None)
                _tex = getattr(_mat, 'baseColorTexture', None) if _mat else None
                if _tex is None or max(_tex.size) * 2 > 8192:
                    continue
                _mat.baseColorTexture = affuter_atlas(_tex, echelle_sortie=2)
                _tailles.append(f"{_tex.size[0]}->{_mat.baseColorTexture.size[0]}")
            t_8k = time.time() - _t
            if _tailles:
                print(f"[mesh] ultra 8K : atlas {', '.join(_tailles)} en {t_8k:.1f}s (avant serialisation)", flush=True)
        except Exception as _e:
            print(f'[mesh] ultra 8K ignore : {_e}', flush=True)

    _t = time.time()
    buf = io.BytesIO()
    glb_obj.export(buf, file_type='glb', extension_webp=True)
    glb_bytes = buf.getvalue()
    print(f'[mesh] finitions : couleurs/metal/alpha {t_couleurs:.1f}s, serialisation {time.time() - _t:.1f}s', flush=True)

    # EU AI Act art. 50 metadata — required by EU Regulation 2024/1689,
    # applicable from 2026-08-02. Marks the GLB as AI-generated. Same
    # patch as scripts/add_ai_metadata.py:patch_glb() on desktop.
    glb_bytes = _patch_ai_act_metadata(glb_bytes)

    print(f'[mesh] TOTAL dt={time.time()-t0:.1f}s bytes={len(glb_bytes)}', flush=True)
    return glb_bytes


def _patch_ai_act_metadata(glb_bytes: bytes) -> bytes:
    """Inject asset.extras.aiGenerated + asset.generator into the JSON
    chunk of a GLB. Returns a new GLB byte string. Compatible with the
    desktop `add_ai_metadata.py` so the cloud output is interchangeable
    with the desktop output."""
    import struct, json
    if len(glb_bytes) < 12 or glb_bytes[:4] != b'glTF':
        return glb_bytes
    version, total_length = struct.unpack('<II', glb_bytes[4:12])
    if version != 2:
        return glb_bytes
    json_chunk_len = struct.unpack('<I', glb_bytes[12:16])[0]
    json_chunk_type = glb_bytes[16:20]
    if json_chunk_type != b'JSON':
        return glb_bytes
    json_blob = glb_bytes[20:20 + json_chunk_len]
    rest = glb_bytes[20 + json_chunk_len:]
    try:
        gltf = json.loads(json_blob.decode('utf-8'))
    except Exception:
        return glb_bytes
    asset = gltf.setdefault('asset', {})
    asset['generator'] = 'FabMesh 1.0.0 (AI-generated)'
    extras = asset.setdefault('extras', {})
    extras['aiGenerated'] = True
    extras['aiSystem'] = 'FabMesh'
    extras['aiActArticle50'] = True
    # Re-serialize JSON, pad to 4-byte boundary.
    new_json = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(new_json) % 4:
        new_json += b' '
    # Rebuild GLB header + chunks.
    new_total = 12 + 8 + len(new_json) + len(rest)
    header = b'glTF' + struct.pack('<II', 2, new_total)
    json_chunk = struct.pack('<I', len(new_json)) + b'JSON' + new_json
    return header + json_chunk + rest
