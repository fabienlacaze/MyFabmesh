"""Cloud port of the desktop mesh quick-edit tools.

Smooth, Decimate, Center, Fix Normals, Fill Holes — all pure trimesh
CPU operations on the GLB. No GPU needed, no Modal class @enter cost.
These can run inside the lightweight mesh_start function (which also
serves the async TRELLIS-2 dispatch).

Most ops return the modified GLB as raw bytes. fill_holes returns a
tuple (bytes, stats_dict) so the client can show a verdict-driven
toast (CLOSED_OK / OPEN_HOLES). Quand il n'y a rien a boucher, il leve une
RuntimeError EXPLIQUEE (diagnostic du maillage ferme) : refus non facture.
The OPS dispatch wraps every other op
as (bytes, None) so the worker has a uniform shape to forward.
"""
import io
import trimesh as _trimesh_probe
assert hasattr(_trimesh_probe.repair, 'fill_holes'), \
    'trimesh.repair.fill_holes missing — pin trimesh>=4.4 in modal_app/app.py'
del _trimesh_probe


def _load_scene(glb_bytes: bytes):
    """Load GLB into a trimesh Scene (always a Scene, never a Trimesh
    directly, so we have one consistent API)."""
    import trimesh
    return trimesh.load(io.BytesIO(glb_bytes), file_type='glb', force='scene')


def _marquer_ia(octets):
    """2026-10-03 (AI Act art. 50) : marque le GLB comme genere par IA (asset.generator + asset.extras).

    POURQUOI : trimesh remplace asset.generator par le sien et jette asset.extras a l'export ; toute
    operation de maillage (Smooth, Triangle count, Watertight, Fix normals...) faisait donc perdre le
    marquage pose a la generation. Repli silencieux si le module manque : jamais de plantage d'une
    operation pour un marquage."""
    try:
        from modal_app._marquage_ia import marquer_glb_octets
        return marquer_glb_octets(octets)
    except Exception:
        return octets


# CARTE DE NORMALES (2026-10-13). La generation pose une carte de normales (normal_bake.py) QUAND L'OPTION « relief pour moteur de jeu »
# est cochee (2026-10-15 : decochee par defaut ; sans elle ces regles ne s'appliquent a rien) : elle decrit le relief du maillage FIN
# par rapport a la forme et aux UV du maillage livre. Apres une operation, elle est :
#   GARDEE  quand la forme et les UV sont intactes, ou deplacees d'un bloc : center, resize (rotation / echelle), fix_normals (le
#           relief suit l'orientation des faces), fill_holes (faces ajoutees, les autres intactes), align_texture et retex_swap
#           (couleur seule), material / material_adjust (facteurs, couleur), apercu (carte gardee a l'octet si elle tient dans
#           max_px, sinon reduite en moyenne de VECTEURS renormalises et encodee SANS PERTE : voir _carte_normales_apercu) ;
#   RETIREE quand la forme ou les UV changent : smooth (le lissage efface un relief que la carte redessinerait), decimate (nouvelles
#           faces et nouveaux UV ; le repli garderait l'ancien materiau sur des UV approchees), subdivide (subdivision de Loop :
#           sommets deplaces, UV non suivis), watertight (nouvelle coque sans UV) ;
#   PERDUE  (jamais fausse) : explode, qui pose sur les eclats un materiau NEUF a couleur seule (carte, metal / rugosite et attribut
#           NORMAL perdus, comme sur le bureau : scripts/explode_mesh_3d.py).
# Toute carte gardee est re-encodee SANS PERTE (acceleration_glb.webp_rapide) : trimesh l'aurait encodee en WebP avec perte.
# Le bureau suit la meme regle (scripts/mesh_tools.py, _export(..., carte_normales=False)).
def _retirer_cartes_normales(scene) -> int:
    """Retire la normalTexture de chaque materiau (voir CARTE DE NORMALES ci-dessus). Ne leve jamais."""
    try:
        from modal_app.normal_bake import retirer_cartes_normales
        return retirer_cartes_normales(scene)
    except Exception:
        n = 0
        for m in _meshes(scene):
            mat = getattr(getattr(m, 'visual', None), 'material', None)
            if getattr(mat, 'normalTexture', None) is not None:
                mat.normalTexture = None
                n += 1
        return n


def _export(scene, carte_normales: bool = True) -> bytes:
    """Serialize scene back to GLB bytes, preserving WebP textures.

    carte_normales=False : l'operation a deforme la geometrie ou refait les UV, la carte de normales est retiree (voir plus haut)."""
    if not carte_normales:
        n = _retirer_cartes_normales(scene)
        if n:
            print(f'[mesh-op] carte de normales retiree ({n} materiau(x)) : forme ou UV modifies', flush=True)
    buf = io.BytesIO()
    from modal_app.acceleration_glb import webp_rapide; webp_rapide(scene)   # couleur 8x plus vite ; carte de normales SANS PERTE
    scene.export(buf, file_type='glb', extension_webp=True)
    return _marquer_ia(buf.getvalue())     # 2026-10-03 (AI Act art. 50) : le derive reste marque


def _meshes(scene):
    """Iterate the trimesh.Trimesh objects inside a Scene."""
    if hasattr(scene, 'geometry'):
        return list(scene.geometry.values())
    return [scene]


def smooth(glb_bytes: bytes, iterations: int = 5, lamb: float = 0.5) -> bytes:
    """Laplacian smoothing (filter_laplacian) on every mesh. The lambda
    factor controls strength — 0.5 matches the desktop default."""
    import trimesh
    scene = _load_scene(glb_bytes)
    for m in _meshes(scene):
        if not hasattr(m, 'vertices'):
            continue
        # 2026-10-03 (constats P4 / defauts 1-2 de la campagne, MEME DEFAUT que le bureau) : sur un maillage
        # texture, les sommets dupliques le long des coutures d'UV n'etaient jamais soudes, donc chaque
        # ilot etait lisse comme une surface ouverte et le maillage dechire. lisser_soude soude par
        # position, lisse, puis reporte la position sur tous les doubles. Le comportement d'origine
        # (contrainte de volume par defaut de trimesh) est conserve ; si elle donne des valeurs non
        # finies (volume nul), on relance sans contrainte, comme le bureau.
        from modal_app.acceleration_glb import lisser_soude
        try:
            lisser_soude(m, iterations, lamb, volume_constraint=True)
        except Exception:
            lisser_soude(m, iterations, lamb, volume_constraint=False)
    return _export(scene, carte_normales=False)     # le relief lisse ne doit pas revenir par la carte de normales


def decimate(glb_bytes: bytes, target_faces: int = 50_000) -> bytes:
    """Quadric edge collapse decimation. target_faces is the desired
    face count for the LARGEST mesh; smaller meshes get proportional
    decimation. Same defaults as the desktop preset 'medium'."""
    # Imports locaux, comme partout ailleurs dans ce module : le haut du
    # fichier ne garde volontairement aucun alias (le trimesh importe la
    # est supprime apres la verification de version).
    import numpy as np
    import trimesh
    scene = _load_scene(glb_bytes)
    meshes = _meshes(scene)
    if not meshes:
        return glb_bytes
    max_faces = max(len(m.faces) for m in meshes if hasattr(m, 'faces'))
    if max_faces <= target_faces:
        # NE PLUS RENVOYER LE MAILLAGE INTACT EN SILENCE. Le worker a deja
        # debite le credit avant d'arriver ici : l'utilisateur payait, se
        # voyait empiler une « nouvelle version » aux octets identiques, et
        # n'avait aucun moyen de comprendre. On leve, l'operation est marquee
        # en echec et le credit rembourse — meme politique que plus bas.
        raise RuntimeError(
            f'cible {target_faces} deja atteinte : le maillage compte '
            f'{max_faces} triangles, rien a reduire')
    # PLUS DE PLANCHER A 0.05 : il bornait silencieusement la reduction a 5 %
    # du maillage d'origine. Viser 4 500 triangles sur un maillage de 489 000
    # donnait en fait ~24 000 — l'utilisateur ne pouvait pas comprendre
    # pourquoi sa cible n'etait pas respectee. Le garde-fou utile est le
    # max(50, ...) par maillage plus bas.
    ratio = min(1.0, target_faces / max_faces)
    reduits = 0
    erreurs = []
    for m in meshes:
        if not hasattr(m, 'faces') or len(m.faces) < 100:
            continue
        avant = len(m.faces)
        try:
            n = max(50, int(avant * ratio))
            # PRESERVATION DE LA TEXTURE — portage du desktop
            # (scripts/mesh_tools.py:143-176). L'ancien commentaire ici
            # affirmait « the desktop accepts the same trade-off » : c'etait
            # FAUX. Le desktop transfere les UV et reconstruit un
            # TextureVisuals ; seul le cloud renvoyait un maillage nu. Or la
            # correspondance de texture est l'exigence n°1 du produit, et
            # l'utilisateur payait pour recevoir un modele gris.
            #
            # fast_simplification et scipy sont tous deux presents dans
            # l'image Modal (voir app.py, .pip_install).
            is_tex = isinstance(getattr(m, 'visual', None), trimesh.visual.TextureVisuals)
            old_uv = (np.asarray(m.visual.uv, dtype=np.float32).copy()
                      if (is_tex and getattr(m.visual, 'uv', None) is not None) else None)
            old_mat = getattr(m.visual, 'material', None) if is_tex else None

            new_uv = None
            points = faces_out = None
            # 2026-09-29 : FORME SEULE par meshoptimizer + depliage + texture RECUITE (acceleration_glb,
            # valide par le user). L'ancienne methode (reduction du maillage texture + UV du plus proche
            # sommet) reste le repli.
            if old_uv is not None:
                try:
                    from modal_app.acceleration_glb import reduire_et_recuire
                    # taille=None : la texture garde sa taille d'origine (constat E-3b, 2026-10-03 ;
                    # avant : ramenee a 2048 sans prevenir)
                    r_new = reduire_et_recuire(m, n, None, log=lambda t: print(t, flush=True))
                    m.vertices = r_new.vertices
                    m.faces = r_new.faces
                    m.visual = r_new.visual
                    reduits += 1
                    continue
                except Exception as e:
                    print(f'[mesh-op] reduction + recuisson impossible ({type(e).__name__}: {e}) : ancienne methode', flush=True)
            if old_uv is not None:
                verts = np.asarray(m.vertices, dtype=np.float32)
                faces = np.asarray(m.faces, dtype=np.int32)
                try:
                    import fast_simplification
                    from scipy.spatial import cKDTree
                    points, faces_out = fast_simplification.simplify(
                        verts, faces, target_reduction=1.0 - max(ratio, 50.0 / max(1, len(faces))))   # plancher de 50 faces (relecture 2026-10-03)
                    if old_uv.shape[0] == verts.shape[0]:
                        # Transfert par plus proche voisin ORIGINAL :
                        # replay_simplification plante (IndexError) sur
                        # certains maillages reels, le KD-tree est robuste.
                        _, nn = cKDTree(verts).query(np.asarray(points, dtype=np.float64))
                        new_uv = old_uv[nn]
                except Exception as e:
                    print(f'[mesh-op] transfert UV impossible ({e}) — repli sans texture', flush=True)
                    new_uv = None

            if new_uv is not None:
                m_new = trimesh.Trimesh(vertices=points, faces=faces_out, process=False)
                m_new.visual = trimesh.visual.TextureVisuals(uv=new_uv, material=old_mat)
                m.vertices = m_new.vertices
                m.faces = m_new.faces
                m.visual = m_new.visual
            else:
                # Pas d'UV exploitable : decimation simple. Le maillage
                # n'avait de toute facon pas de texture a preserver.
                m_new = m.simplify_quadric_decimation(face_count=n)
                m.vertices = m_new.vertices
                m.faces = m_new.faces
            if len(m.faces) < avant:
                reduits += 1
        except Exception as e:
            erreurs.append(f'{type(e).__name__}: {e}')
            print(f'[mesh-op] decimate skipped: {e}', flush=True)
    # ECHOUER PLUTOT QUE DE RENVOYER LE MAILLAGE INTACT. Avant, toute
    # exception etait simplement affichee et la fonction renvoyait la scene
    # telle quelle : l'utilisateur recevait une « nouvelle version » avec le
    # meme nombre de triangles et etait quand meme debite. C'est exactement ce
    # qui se produisait en production, trimesh>=4 exigeant le paquet
    # fast_simplification (absent de l'image Modal) pour
    # simplify_quadric_decimation. En levant ici, l'operation est marquee en
    # echec et le credit est rembourse.
    if reduits == 0:
        raise RuntimeError(
            'decimation impossible ('
            + ('; '.join(erreurs[:2]) if erreurs else 'aucun maillage reduit')
            + ')')
    return _export(scene, carte_normales=False)     # nouvelles faces et nouveaux UV : la carte ne correspond plus


def center(glb_bytes: bytes) -> bytes:
    """Translate every mesh so the joint bounding box sits at the
    origin. Y-axis is brought to bottom=0 (matches desktop / Unreal
    convention where models stand on the ground plane)."""
    import numpy as np
    scene = _load_scene(glb_bytes)
    meshes = _meshes(scene)
    if not meshes:
        return glb_bytes
    all_verts = np.concatenate([m.vertices for m in meshes if hasattr(m, 'vertices')])
    if len(all_verts) == 0:
        return glb_bytes
    cx = (all_verts[:, 0].min() + all_verts[:, 0].max()) / 2.0
    cz = (all_verts[:, 2].min() + all_verts[:, 2].max()) / 2.0
    cy = all_verts[:, 1].min()  # bottom at y=0
    for m in meshes:
        if hasattr(m, 'vertices'):
            m.vertices[:, 0] -= cx
            m.vertices[:, 1] -= cy
            m.vertices[:, 2] -= cz
    return _export(scene)


def fix_normals(glb_bytes: bytes) -> bytes:
    """Recompute vertex normals so lighting looks correct. trimesh
    handles flipping winding order on inverted faces during this."""
    scene = _load_scene(glb_bytes)
    for m in _meshes(scene):
        if not hasattr(m, 'fix_normals'):
            continue
        try:
            m.fix_normals()
        except Exception as e:
            print(f'[mesh-op] fix_normals skipped: {e}', flush=True)
    return _export(scene)


def _charger_sans_traitement(glb_bytes: bytes):
    """Charge le GLB SANS aucun traitement de trimesh (process=False).

    Le chargement par defaut fusionne les sommets identiques et peut les reordonner ; pour boucher des trous on veut les sommets, les UV et
    les faces TELS QUE LE FICHIER LES PORTE : rien n'est supprime, deplace ni reecrit (invariants de modal_app/bouchage_trous.py)."""
    import trimesh
    return trimesh.load(io.BytesIO(glb_bytes), file_type='glb', force='scene', process=False)


def fill_holes(glb_bytes: bytes, min_edges: int = 3, max_edges: int = 1_000_000, skin_repair: bool = False, detect_only: bool = False):
    """Bouche les trous (pourtours d'aretes de bord) dont le nombre d'aretes est dans [min_edges, max_edges]. Rend (glb_bytes, stats).

    BOUCHON LISSE (2026-10-26, noyau modal_app/bouchage_lisse.py = scripts/bouchage_lisse.py, MEME code que le bureau) : la rustine suit la courbure
    du voisinage et prend ses couleurs dans les texels voisins. NON DESTRUCTIF (refonte du 2026-10-21) : aucune face supprimee, aucune UV reecrite,
    aucun sommet deplace. L'ancienne version fusionnait les sommets (merge_vertices), supprimait les « faces cassees » et normalisait les normales :
    mesure sur l'orc de 512 000 faces, 11,9 % des faces supprimees, 38 % des UV reecrites, 204 boucles ouvertes creees (ou refus a 17 % apres 74 a 160 s).

    OPTION skin_repair (defaut False) : cherche aussi les trous de la PEAU exterieure (scripts/bouchage_peau.py), environ une minute sur 500 000 faces.

    Rien a boucher -> RuntimeError EXPLIQUEE (le worker rembourse, le maillage n'est pas touche), avec le diagnostic du maillage ferme :
    faces retournees, aretes a plus de deux faces, miettes flottantes, ou « la matiere manquante n'est pas un trou »."""
    from modal_app.bouchage_lisse import boucher_scene, detecter_peau_scene

    scene = _charger_sans_traitement(glb_bytes)
    if detect_only:
        # DETECTION SEULE des trous de peau (apercu de la fenetre Fill holes) : aucun GLB, aucun credit (le worker ne debite pas cette variante).
        res = detecter_peau_scene(scene, min_edges, max_edges, journal=lambda m: print(f'[mesh-op] fill_holes detect {m}', flush=True))
        return b'', dict(res, detect_only=True)
    res = boucher_scene(scene, min_edges, max_edges, journal=lambda m: print(f'[mesh-op] fill_holes {m}', flush=True), peau=bool(skin_repair))
    if res['refus']:
        code, texte = res['refus']
        print(f'[mesh-op] fill_holes: rien a boucher ({code})', flush=True)
        raise RuntimeError(texte)
    stats = res['stats']
    print(f'[mesh-op] fill_holes: +{stats["holes_filled_delta_faces"]} faces, {stats["holes_filled"]} trous bouches, verdict={stats["verdict"]}', flush=True)
    return _export(scene), stats


def material_adjust(glb_bytes: bytes,
                    brightness: float = 1.0,
                    saturation: float = 1.0,
                    contrast: float = 1.0,
                    emissive: float = 0.0,
                    metallic: float = 0.0,
                    roughness: float = 0.7,
                    hue_shift: float = 0.0) -> bytes:
    """Re-bake the GLB's baseColorTexture with PIL ImageEnhance
    (brightness/saturation/contrast) + optional hue rotation, and
    overwrite the PBR factors. hue_shift is in DEGREES (-180..+180),
    0 = no change. Mirrors scripts/mesh_material_adjust.py."""
    import io
    import trimesh
    from PIL import Image, ImageEnhance

    scene = _load_scene(glb_bytes)
    target_mesh = None
    for m in _meshes(scene):
        if hasattr(m, 'faces'):
            target_mesh = m
            break
    if target_mesh is None:
        print('[mesh-op] material_adjust: no mesh found', flush=True)
        return _export(scene)

    # Pull the source texture: from the GLB's embedded baseColorTexture,
    # or if missing, return the original GLB unchanged with PBR factors
    # overwritten (no texture pipeline if there's nothing to enhance).
    img = None
    try:
        mat = getattr(target_mesh.visual, 'material', None)
        if mat is not None and getattr(mat, 'baseColorTexture', None) is not None:
            img = mat.baseColorTexture.convert('RGB')
    except Exception as e:
        print(f'[mesh-op] material_adjust texture read failed: {e}', flush=True)
    if img is not None:
        try:
            if float(brightness) != 1.0:
                img = ImageEnhance.Brightness(img).enhance(float(brightness))
            if float(saturation) != 1.0:
                img = ImageEnhance.Color(img).enhance(float(saturation))
            if float(contrast) != 1.0:
                img = ImageEnhance.Contrast(img).enhance(float(contrast))
            if float(hue_shift) != 0.0:
                # PIL HSV uses 0-255 for H; 360deg maps to 256 units.
                # We also floor the saturation by abs(hue_shift)/360 *
                # 0.5 * 255 so grey/dark pixels pick up the tint
                # (otherwise only the saturated parts of the texture
                # change colour and the rest stays grey). Same logic
                # as the live shader so preview ≈ save.
                import numpy as _np
                shift_units = int(round((float(hue_shift) / 360.0) * 256.0)) % 256
                sat_floor = int(round(abs(float(hue_shift) / 360.0) * 0.5 * 255))
                hsv = img.convert('HSV')
                arr = _np.array(hsv, dtype=_np.int16)
                arr[..., 0] = (arr[..., 0] + shift_units) % 256
                arr[..., 1] = _np.maximum(arr[..., 1], sat_floor)
                hsv = Image.fromarray(arr.astype(_np.uint8), mode='HSV')
                img = hsv.convert('RGB')
        except Exception as e:
            print(f'[mesh-op] material_adjust enhancer failed: {e}', flush=True)

    try:
        new_mat = trimesh.visual.material.PBRMaterial(
            name='fabmesh_adjusted',
            baseColorTexture=img,
            emissiveTexture=img,
            emissiveFactor=[float(emissive)] * 3,
            metallicFactor=float(metallic),
            roughnessFactor=float(roughness),
            # 2026-10-13 : la carte de normales decrit la FORME, que l'outil ne touche pas : elle suit le nouveau materiau
            normalTexture=getattr(getattr(target_mesh.visual, 'material', None), 'normalTexture', None),
        )
        uv = getattr(target_mesh.visual, 'uv', None)
        target_mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=new_mat)
    except Exception as e:
        print(f'[mesh-op] material_adjust material rebuild failed: {e}', flush=True)

    return _export(scene)


def recolor(glb_bytes: bytes, color: str = '#3b82f6', intensity: float = 1.0, uv_mask_b64: str | None = None) -> bytes:
    """« Recolorier » (25/10, demande du user : les memes boutons que Recolorier de l'image, pour la 3D). La luminance de chaque texel de la
    texture couleur est gardee, la couleur est remplacee ; `intensity` melange avec l'original ; `uv_mask_b64` (PNG en base64, blanc = zone,
    meme repere que le masque de « Re-texture a region ») limite l'effet a une partie. Ne touche ni la forme, ni les UV, ni les autres cartes.
    Noyau : modal_app/recolor_atlas.py (= scripts/recolor_atlas.py, bureau)."""
    import base64
    import io
    from PIL import Image
    from modal_app.recolor_atlas import recolorer_image

    scene = _load_scene(glb_bytes)
    masque_brut = None
    if uv_mask_b64:
        data = uv_mask_b64.split(',', 1)[1] if uv_mask_b64.startswith('data:') else uv_mask_b64
        masque_brut = Image.open(io.BytesIO(base64.b64decode(data))).convert('L')
    vus = set()
    nb = 0
    for m in _meshes(scene):
        mat = getattr(getattr(m, 'visual', None), 'material', None)
        tex = getattr(mat, 'baseColorTexture', None) if mat is not None else None
        if tex is None or id(mat) in vus:
            continue
        vus.add(id(mat))
        masque = masque_brut.resize(tex.size, Image.LANCZOS) if masque_brut is not None else None
        mat.baseColorTexture = recolorer_image(tex, color, float(intensity), masque)
        nb += 1
    if nb == 0:
        raise ValueError('recolor: ce maillage n\'a pas de texture couleur a recolorier')
    print(f'[mesh-op] recolor : {nb} texture(s), couleur {color}, intensite {float(intensity):.2f}'
          + (' (zone)' if masque_brut is not None else ''), flush=True)
    return _export(scene)


def subdivide(glb_bytes: bytes, iterations: int = 1) -> bytes:
    """Loop subdivision — quadruples face count per iteration. Cap to
    1 iteration by default; >1 can balloon memory on dense meshes."""
    scene = _load_scene(glb_bytes)
    for m in _meshes(scene):
        if not hasattr(m, 'subdivide_loop'):
            continue
        try:
            for _ in range(max(1, min(2, int(iterations)))):
                # Skip if subdividing would push past ~2M faces — keeps
                # the GLB under 50 MB and Modal under 30s.
                if hasattr(m, 'faces') and len(m.faces) > 500_000:
                    break
                sub = m.subdivide_loop()
                m.vertices = sub.vertices
                m.faces = sub.faces
        except Exception as e:
            print(f'[mesh-op] subdivide skipped: {e}', flush=True)
    return _export(scene, carte_normales=False)     # Loop deplace les sommets et ne suit pas les UV


def align_texture(glb_bytes: bytes, image_url: str, translate_x: float = 0.0,
                  translate_y: float = 0.0, translate_z: float = 0.0, mesh_scale: float = 1.0,
                  rot_y: float = 0.0, vis_thresh: float = 0.5, frame_fix: bool = True,
                  skip_vflip: bool = True) -> bytes:
    """« Align Texture » — la VRAIE reprojection du bureau (2026-09-28), a la place de
    l'ancien re-export a l'identique facture un credit. Meme chaine que main.js
    mesh:align-texture : pre-transformation facultative (mesh_pre_transform.py), puis
    reprojection de l'image source sur le maillage (texture_project.py, 1024), avec les
    memes variables d'environnement. Les deux scripts sont des COPIES CONFORMES de
    scripts/ (modal_app/texproj/, surveillees par check-noyaux-partages). Le noyau
    numba de texture_project est present dans l'image (dependance de rembg -> pymatting)."""
    import os
    import subprocess
    import sys
    import tempfile
    import urllib.request
    if not image_url:
        raise ValueError('align_texture needs params.image_url')
    ici = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'texproj')
    with tempfile.TemporaryDirectory(prefix='aligntex_') as dossier:
        maillage = os.path.join(dossier, 'maillage.glb')
        image = os.path.join(dossier, 'source.png')
        with open(maillage, 'wb') as f:
            f.write(glb_bytes)
        req = urllib.request.Request(image_url, headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) myfabmesh-cloud/1.0"})
        from modal_app._url_sure import ouvrir_https   # 2026-10-03 (CLOUD-05) : https seulement
        with ouvrir_https(req, timeout=60) as r, open(image, 'wb') as f:
            f.write(r.read())
        travail = maillage
        if (abs(translate_x) > 0.001 or abs(translate_y) > 0.001 or abs(translate_z) > 0.001
                or abs(mesh_scale - 1) > 0.001):
            travail = os.path.join(dossier, 'maillage.aligntemp.glb')
            subprocess.run([sys.executable, os.path.join(ici, 'mesh_pre_transform.py'), maillage, travail,
                            str(translate_x), str(translate_y), str(mesh_scale), str(translate_z)],
                           check=True, timeout=60)
        args = [sys.executable, os.path.join(ici, 'texture_project.py'), travail, image, travail, '1024']
        if abs(rot_y) > 0.01:
            args += ['--rotation-offset', str(rot_y)]
        env = dict(os.environ,
                   FABMESH_TEXPROJ_FRAME_FIX='1' if frame_fix else '0',
                   FABMESH_TEXPROJ_SKIP_BACK_VFLIP='1' if skip_vflip else '0',
                   FABMESH_TEXPROJ_VIS_THRESH=str(vis_thresh))
        r = subprocess.run(args, env=env, timeout=110, capture_output=True, text=True)
        print('[mesh-op] align_texture', (r.stdout or '')[-1500:], flush=True)
        if r.returncode != 0:
            raise RuntimeError(f'texture_project: {(r.stderr or r.stdout or "").strip()[-400:]}')
        with open(travail, 'rb') as f:
            return f.read()


def retex_swap_atlas(glb_bytes: bytes, image_url: str) -> bytes:
    """Quick re-texture — replace the baseColorTexture on every mesh
    with the user-supplied image, fetched from a public URL. This is
    NOT a true UV reprojection (the desktop's texture_project.py does
    real planar projection via Blender); it works best when the new
    image matches the existing UV layout — typically when the new
    image is itself derived from the original front view (Modify,
    Style, Auto Inpaint output → re-bind atlas).

    Caveat surfaced to the user via the modal subtitle: "best with
    images derived from the original front view".
    """
    import urllib.request
    from PIL import Image
    if not image_url:
        return glb_bytes
    try:
        req = urllib.request.Request(image_url, headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) myfabmesh-cloud/1.0"})
        from modal_app._url_sure import ouvrir_https   # 2026-10-03 (CLOUD-05) : https seulement
        with ouvrir_https(req, timeout=30) as r:
            new_tex = Image.open(io.BytesIO(r.read())).convert('RGBA')
    except Exception as e:
        print(f'[mesh-op] retex_swap fetch failed: {e}', flush=True)
        return glb_bytes
    scene = _load_scene(glb_bytes)
    for m in _meshes(scene):
        visual = getattr(m, 'visual', None)
        mat = getattr(visual, 'material', None) if visual else None
        if mat is None or not hasattr(mat, 'baseColorTexture'):
            continue
        try:
            mat.baseColorTexture = new_tex
        except Exception as e:
            print(f'[mesh-op] retex_swap apply failed: {e}', flush=True)
    return _export(scene)


def normalize_material(glb_bytes: bytes) -> bytes:
    """Set PBR factors to neutral (roughness=0.7, metallic=0,
    baseColorFactor=white) on every material — cleans up over-glossy
    or color-tinted outputs from TRELLIS-2. Useful before Unreal import."""
    scene = _load_scene(glb_bytes)
    for m in _meshes(scene):
        visual = getattr(m, 'visual', None)
        mat = getattr(visual, 'material', None) if visual else None
        if mat is None:
            continue
        try:
            if hasattr(mat, 'roughnessFactor'):
                mat.roughnessFactor = 0.7
            if hasattr(mat, 'metallicFactor'):
                mat.metallicFactor = 0.0
            if hasattr(mat, 'baseColorFactor'):
                mat.baseColorFactor = [1.0, 1.0, 1.0, 1.0]
        except Exception as e:
            print(f'[mesh-op] material normalize partial: {e}', flush=True)
    return _export(scene)


# Dispatch table for the mesh_start endpoint.
def watertight(glb_bytes: bytes, resolution: int = 128, mode: str = 'seal') -> bytes:
    """mode 'seal' (defaut, 25/10) : AJOUTE une coque fermee a l'INTERIEUR, l'original (geometrie, UV, texture) reste intact.
    mode 'rebuild' : ancien comportement, reconstruction complete (voir ci-dessous)."""
    if str(mode or 'seal').strip().lower() != 'rebuild':
        from modal_app.watertight_seal import ajouter_coque
        scene = _load_scene(glb_bytes)
        coque = ajouter_coque(scene, max(48, min(256, int(resolution))))
        print(f'[mesh-op] watertight (etanche) : coque interieure {0 if coque is None else len(coque.faces)} faces', flush=True)
        return _export(scene)                      # l'original n'est pas deforme : cartes de normales conservees
    return _watertight_rebuild(glb_bytes, resolution)


def _watertight_rebuild(glb_bytes: bytes, resolution: int = 128) -> bytes:
    """Rebuild a CLOSED, watertight shell via voxel remesh + marching cubes.

    Fuses every disconnected body into one solid with no holes (loses the
    texture — re-texture afterwards). Mirror of desktop
    scripts/mesh_tools.watertight."""
    import numpy as np
    import trimesh
    resolution = max(32, min(400, int(resolution)))
    scene = _load_scene(glb_bytes)
    meshes = [m for m in _meshes(scene)
              if hasattr(m, 'vertices') and len(m.vertices)
              and hasattr(m, 'faces') and len(m.faces)]
    if not meshes:
        return _export(scene)
    mesh = trimesh.util.concatenate(
        [trimesh.Trimesh(vertices=np.asarray(m.vertices), faces=np.asarray(m.faces)) for m in meshes])
    # Couleurs de la surface SOURCE (texture echantillonnee par sommet), reportees
    # ensuite sur la nouvelle coque : sans UV, elle sortait grise. Portage du
    # bureau (scripts/mesh_tools.watertight).
    src_xyz, src_rgba = [], []
    for m in meshes:
        try:
            vis = getattr(m, 'visual', None)
            cv = vis.to_color() if (vis is not None and hasattr(vis, 'to_color')) else vis
            vc = np.asarray(getattr(cv, 'vertex_colors', None)) if cv is not None else None
            if vc is not None and vc.ndim == 2 and len(vc) == len(m.vertices) and vc.shape[-1] >= 3:
                src_xyz.append(np.asarray(m.vertices, dtype=np.float64))
                rgba = vc[:, :4] if vc.shape[1] >= 4 else np.column_stack(
                    [vc[:, :3], np.full(len(vc), 255, np.uint8)])
                src_rgba.append(rgba.astype(np.uint8))
        except Exception as e:
            print(f'[mesh-op] watertight colour capture warn: {e}', flush=True)
    diag = float(np.linalg.norm(mesh.bounds[1] - mesh.bounds[0])) or 1.0
    vg = mesh.voxelized(pitch=diag / resolution)
    try:
        vg = vg.fill()
    except Exception as e:
        print(f'[mesh-op] watertight fill warn: {e}', flush=True)
    wt = vg.marching_cubes
    # MAILLAGE « VIDE » (2026-09-27, centipede) : marching_cubes rend la surface
    # en INDICES de voxels (0..resolution), pas dans le repere du maillage. Le
    # resultat mesurait 270 x 58 x 290 au lieu de ~1 : la vue le cadrait hors
    # champ, vignette et apercu vides. Le bureau avait deja ce correctif :
    # recalage sur la boite englobante de la source (voxels cubiques, donc une
    # echelle uniforme + un centrage suffisent).
    try:
        src_lo, src_hi = mesh.bounds
        wt_lo, wt_hi = wt.bounds
        echelle = float(np.median((src_hi - src_lo) / np.maximum(wt_hi - wt_lo, 1e-9)))
        if not np.isfinite(echelle) or echelle <= 0:
            echelle = 1.0
        wt.apply_translation(-(wt_lo + wt_hi) / 2.0)
        wt.apply_scale(echelle)
        wt.apply_translation((src_lo + src_hi) / 2.0)
        print(f'[mesh-op] watertight: recale sur la source (echelle {echelle:.5f})', flush=True)
    except Exception as e:
        print(f'[mesh-op] watertight rescale warn: {e}', flush=True)
    try:
        # moins de lissage a haute resolution : l'escalier y est deja fin
        trimesh.smoothing.filter_laplacian(wt, iterations=1 if resolution >= 192 else 2,
                                           lamb=0.5, volume_constraint=False)
    except Exception:
        pass
    try:
        wt.fix_normals()
    except Exception:
        pass
    if src_xyz:
        try:
            from scipy.spatial import cKDTree
            sx = np.vstack(src_xyz)
            sc = np.vstack(src_rgba)
            _, idx = cKDTree(sx).query(np.asarray(wt.vertices, dtype=np.float64), k=1)
            wt.visual = trimesh.visual.ColorVisuals(wt, vertex_colors=sc[idx])
        except Exception as e:
            print(f'[mesh-op] watertight colour bake warn: {e}', flush=True)
    print(f'[mesh-op] watertight: {len(wt.faces)} faces, watertight={wt.is_watertight} '
          f'(resolution={resolution})', flush=True)
    return _export(trimesh.Scene(wt), carte_normales=False)


# --- NOYAU PARTAGE : DEBUT (redimensionner / orienter) ---
def redimensionner_orienter(obj, sx=1.0, sy=1.0, sz=1.0, q=None):
    """Outil « Resize / dimension » : ROTATION puis ECHELLE, cuites dans la geometrie (UV et
    texture intactes). q = quaternion three.js [x, y, z, w] ; la rotation se fait autour du
    CENTRE de la boite, puis le maillage est repose a la hauteur de son point le plus bas
    d'origine (un crabe couche reste au sol). L'echelle par axe suit, autour de l'origine
    comme avant, sur les axes du MONDE : apres rotation, « Hauteur (Y) » est la hauteur vue
    a l'ecran. obj : trimesh.Scene ou trimesh.Trimesh. Renvoie (objet, rotation_faite) : pour une
    scene, l'objet rendu est une NOUVELLE scene dont les transformations sont cuites dans les
    sommets (2026-09-28 : la rotation restait sur le noeud, matrice dans le GLB, et le rig avec
    points refusait le fichier — « greffe : noeud 1 transforme, non gere »)."""
    import numpy as np
    sx, sy, sz = (max(1e-3, min(float(v), 1000.0)) for v in (sx, sy, sz))
    tourne = False
    if q is not None:
        x, y, z, w = (float(v) for v in q)
        n = (x * x + y * y + z * z + w * w) ** 0.5
        if n > 1e-9 and np.isfinite(n) and 1.0 - abs(w / n) > 1e-7:
            x, y, z, w = x / n, y / n, z / n, w / n
            rot = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
            lo, hi = np.asarray(obj.bounds, dtype=float)
            c = (lo + hi) / 2.0
            M = np.eye(4)
            M[:3, :3] = rot
            M[:3, 3] = c - rot @ c                          # rotation autour du centre
            obj.apply_transform(M)
            T = np.eye(4)
            T[1, 3] = lo[1] - float(obj.bounds[0][1])       # reste pose au sol
            obj.apply_transform(T)
            tourne = True
    obj.apply_transform(np.diag([sx, sy, sz, 1.0]))
    return cuire_transformations(obj), tourne


def cuire_transformations(obj):
    """Scene -> scene equivalente dont chaque noeud est a l'IDENTITE : la transformation monde de
    chaque noeud est appliquee aux sommets (normales et UV suivent). Noms de noeuds et de
    geometries gardes (les parties part_XX d'un maillage segmente en dependent)."""
    import trimesh
    if not isinstance(obj, trimesh.Scene):
        return obj
    plat = trimesh.Scene()
    vus = {}
    for noeud in obj.graph.nodes_geometry:
        T, g = obj.graph[noeud]
        m = obj.geometry[g].copy()
        m.apply_transform(T)
        n = vus.get(g, 0)
        vus[g] = n + 1
        plat.add_geometry(m, node_name=noeud, geom_name=g if n == 0 else f'{g}_{n}')
    return plat
# --- NOYAU PARTAGE : FIN ---


def resize(glb_bytes: bytes, sx: float = 1.0, sy: float = 1.0, sz: float = 1.0, q=None) -> bytes:
    """Orientation (quaternion three.js, optionnel) + echelle par axe, cuites dans la geometrie
    (texture/UV preservees). Miroir de scripts/scale_mesh.py — l'outil Resize / dimension."""
    scene, _ = redimensionner_orienter(_load_scene(glb_bytes), sx, sy, sz, q)
    return _export(scene)


def _etiquettes_decoupe(centroides, k, mode, rng):
    """Etiquette de chaque face selon le TYPE de decoupe (25/10) : voronoi (eclats irreguliers, defaut),
    slices (tranches horizontales a effectif egal), wedges (quartiers autour de l'axe vertical),
    blocks (grille reguliere en 3D), regions (zones compactes de taille voisine, k-moyennes).
    Meme code que scripts/explode_mesh_3d.py (bureau)."""
    import numpy as np
    n = len(centroides)
    k = max(1, min(int(k), n))
    mode = str(mode or 'voronoi').lower()
    def _par_rang(valeurs):
        ordre = np.argsort(valeurs, kind='stable')
        lab = np.empty(n, dtype=np.int64)
        lab[ordre] = (np.arange(n) * k) // n
        return lab
    if mode == 'slices':
        return _par_rang(centroides[:, 1])
    if mode == 'wedges':
        c = centroides - centroides.mean(axis=0)
        return _par_rang(np.arctan2(c[:, 0], c[:, 2]))
    if mode == 'blocks':
        c = max(2, int(round(k ** (1.0 / 3.0))))
        mn, mx = centroides.min(axis=0), centroides.max(axis=0)
        cases = np.clip(((centroides - mn) / np.maximum(mx - mn, 1e-9) * c).astype(np.int64), 0, c - 1)
        return cases[:, 0] + c * (cases[:, 1] + c * cases[:, 2])
    if mode == 'regions':
        try:
            from scipy.cluster.vq import kmeans2
            echant = centroides if n <= 60000 else centroides[rng.choice(n, 60000, replace=False)]
            centres, _ = kmeans2(echant, k, minit='++', seed=1234, iter=10)
            from scipy.spatial import cKDTree
            return cKDTree(centres).query(centroides)[1]
        except Exception:
            pass
    seeds = centroides[rng.choice(n, k, replace=False)]
    try:
        from scipy.spatial import cKDTree
        return cKDTree(seeds).query(centroides)[1]
    except Exception:
        d = np.linalg.norm(centroides[:, None, :] - seeds[None, :, :], axis=2)
        return d.argmin(axis=1)

def explode(glb_bytes: bytes, fragments: int = 24, mode: str = 'voronoi') -> bytes:
    """Fracture the mesh into surface-Voronoi shards, exported as ONE GLB whose
    shards are named submeshes part_00, part_01, … at their ORIGINAL positions —
    so the viewer's live explode slider (same control as segmented meshes) can
    blast them outward with no baked stages. Texture preserved: each shard keeps
    the original vertices/UVs and shares the baked texture (no re-bake); face
    colour fallback otherwise. Mirror of desktop scripts/explode_mesh_3d.py.
    Pure geometry, deterministic (seed 1234)."""
    import numpy as np
    import trimesh
    frags = max(4, min(int(fragments), 200))
    rng = np.random.RandomState(1234)

    scene = _load_scene(glb_bytes)
    geoms = _meshes(scene)
    mesh = geoms[0] if len(geoms) == 1 else trimesh.util.concatenate(geoms)
    mesh = mesh.copy()

    V = np.asarray(mesh.vertices)
    F = np.asarray(mesh.faces)

    # Texture (preferred) or per-face colours (fallback) — carried onto every shard.
    TEX = None; UV = None; FACE_COLORS = None
    try:
        vis = mesh.visual
        if isinstance(vis, trimesh.visual.TextureVisuals) and vis.uv is not None:
            UV = np.asarray(vis.uv)
            m = getattr(vis, 'material', None)
            TEX = getattr(m, 'baseColorTexture', None) or getattr(m, 'image', None)
        if TEX is None:
            fc = getattr(vis, 'face_colors', None)
            if fc is not None and len(fc) == len(F):
                FACE_COLORS = np.asarray(fc)
    except Exception:
        pass
    if TEX is None and FACE_COLORS is None:
        FACE_COLORS = np.tile([170, 170, 175, 255], (len(F), 1)).astype(np.uint8)

    MAT = trimesh.visual.material.PBRMaterial(baseColorTexture=TEX) if TEX is not None else None

    # Fracture: assign each face to its nearest random seed (surface Voronoi).
    fc_centroids = V[F].mean(axis=1)
    k = min(frags, len(F))
    labels = _etiquettes_decoupe(fc_centroids, k, mode, rng)

    out = trimesh.Scene()
    n = 0
    for lab in np.unique(labels):
        face_ids = np.where(labels == lab)[0]
        if len(face_ids) == 0:
            continue
        faces_k = F[face_ids]
        uniq, inv = np.unique(faces_k, return_inverse=True)
        inv = np.asarray(inv).ravel()   # numpy 2.x may return inv with input shape
        shard = trimesh.Trimesh(V[uniq], inv.reshape(-1, 3), process=False)
        if MAT is not None and UV is not None:
            shard.visual = trimesh.visual.TextureVisuals(uv=UV[uniq], material=MAT)
        elif FACE_COLORS is not None:
            shard.visual = trimesh.visual.ColorVisuals(shard, face_colors=FACE_COLORS[face_ids])
        name = f"part_{n:02d}"
        out.add_geometry(shard, node_name=name, geom_name=name)
        n += 1

    return _export(out)


def _logo_filigrane(texte_seul: bool = False):
    """Logo + nom MyFabmesh.AI (RGBA), embarque en base64 (voir _filigrane.py).
    texte_seul : le nom sans le symbole — sur un modele 3D, le carre sombre du
    symbole faisait des taches prises pour un defaut (rendu du 2026-09-28)."""
    import base64
    from PIL import Image
    from modal_app._filigrane import FILIGRANE_PNG_B64
    im = Image.open(io.BytesIO(base64.b64decode(''.join(FILIGRANE_PNG_B64)))).convert('RGBA')
    if texte_seul:
        im = im.crop((int(im.height * 1.17), 0, im.width, im.height))
        im = im.crop(im.getbbox())
    return im


def _filigraner(img, echelle: float = 0.2):
    """Logo + nom repetes sur toute l'image, en quinconce, a 55 % d'opacite.
    Une texture est un atlas UV decoupe : un filigrane unique tomberait sur un
    seul ilot, ou dans le vide. Repete, il marque toute la surface.

    PETIT ET HORIZONTAL (2026-09-28, user : « trop grand et trop flou, on croit
    que c'est le mesh qui a un probleme ») : a une demi-largeur de texture, le
    logo se retrouvait en fragments deformes sur le modele, pris pour un defaut ;
    la rotation a 25° adoucissait encore les lettres. `echelle` = largeur du
    logo rapportee a celle de l'image : 0,2 sur une texture, plus sur une image
    vendue, ou il doit rester franc."""
    from PIL import Image
    avait_alpha = img.mode in ('RGBA', 'LA') or 'transparency' in img.info
    base = img.convert('RGBA')
    W, H = base.size
    logo = _logo_filigrane()
    lw = max(64, int(W * echelle))
    lh = max(1, int(logo.height * lw / logo.width))
    tampon = logo.resize((lw, lh), Image.LANCZOS)
    tampon.putalpha(tampon.getchannel('A').point(lambda v: int(v * 0.55)))
    # alpha_composite et non paste(masque) : paste sur un calque vide mettait
    # l'opacite au carre (0,6 x 0,6) et assombrissait les lettres blanches.
    # Le calque deborde d'un tampon de chaque cote (alpha_composite refuse les
    # positions negatives), puis il est recadre.
    px, py = tampon.width, tampon.height
    calque = Image.new('RGBA', (W + 2 * px, H + 2 * py), (0, 0, 0, 0))
    pas_x, pas_y = int(tampon.width * 1.6), int(tampon.height * 3.2)
    for rang, y in enumerate(range(-pas_y // 2, H, pas_y)):
        decal = pas_x // 2 if rang % 2 else 0
        for x in range(-pas_x // 2 + decal, W, pas_x):
            calque.alpha_composite(tampon, (x + px, y + py))
    out = Image.alpha_composite(base, calque.crop((px, py, px + W, py + H)))
    return out if avait_alpha else out.convert('RGB')


# ─── FILIGRANE PROJETE SUR LE MODELE (2026-09-28) ────────────────────────────
# User : « trop grand et trop flou, on croit que c'est le mesh qui a un
# probleme », puis « il n'est pas sur le mesh » (filigrane pose a l'ecran).
# Pose a plat sur l'atlas UV, le logo tombait en fragments deformes : l'atlas
# est un patron decoupe. Ici chaque texel de la texture de couleur retrouve sa
# POSITION 3D (triangles rasterises dans l'espace UV) et le sens de sa face ;
# le logo + nom est projete depuis les 6 directions (projection « en boite »),
# toujours a l'endroit vu de sa direction : sur le modele il se lit comme un
# tampon applique, jamais comme un defaut.

def _lire_accesseur(doc, bin_, idx):
    """Accesseur glTF -> tableau numpy (count, n). None si non lisible (sparse,
    tampon externe)."""
    import numpy as np
    a = doc['accessors'][idx]
    if 'bufferView' not in a or a.get('sparse'):
        return None
    v = doc['bufferViews'][a['bufferView']]
    if v.get('buffer', 0) != 0:
        return None
    comp = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16,
            5125: np.uint32, 5126: np.float32}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}.get(a['type'])
    if n is None:
        return None
    cnt = a['count']
    taille = np.dtype(comp).itemsize * n
    pas = v.get('byteStride') or taille
    debut = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    if pas == taille:
        arr = np.frombuffer(bin_, dtype=comp, count=cnt * n, offset=debut).reshape(cnt, n)
    else:
        brut = np.frombuffer(bin_, dtype=np.uint8, count=(cnt - 1) * pas + taille, offset=debut)
        sel = np.arange(cnt)[:, None] * pas + np.arange(taille)[None, :]
        arr = brut[sel].copy().view(comp).reshape(cnt, n)
    if a.get('normalized') and comp != np.float32:
        arr = arr.astype(np.float64) / float(np.iinfo(comp).max)
    return arr


def _matrices_monde(doc):
    """Matrice monde de chaque noeud de la scene (TRS ou matrix)."""
    import numpy as np

    def locale(n):
        if 'matrix' in n:
            return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
        tx, ty, tz = n.get('translation', [0, 0, 0])
        x, y, z, w = n.get('rotation', [0, 0, 0, 1])
        s = np.array(n.get('scale', [1, 1, 1]), dtype=np.float64)
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        M = np.eye(4)
        M[:3, :3] = R * s[None, :]
        M[:3, 3] = (tx, ty, tz)
        return M

    noeuds = doc.get('nodes', [])
    scenes = doc.get('scenes') or [{'nodes': list(range(len(noeuds)))}]
    racines = scenes[doc.get('scene', 0)].get('nodes', [])
    res, pile = {}, [(i, np.eye(4)) for i in racines]
    while pile:
        i, parent = pile.pop()
        M = parent @ locale(noeuds[i])
        res[i] = M
        pile.extend((c, M) for c in noeuds[i].get('children', []))
    return res


def _rasteriser_uv(P, UV, I, pos_map, axe_map):
    """Rasterise les triangles I dans l'espace UV : pour chaque texel dont le
    centre tombe dans un triangle, sa position 3D (interpolee) et le code de la
    direction dominante de la face (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z).
    Vectorise par paquets de triangles de taille comparable."""
    import numpy as np
    H, W = axe_map.shape
    A, B, C = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
    nrm = np.cross(B - A, C - A)
    axe = np.abs(nrm).argmax(1)
    neg = np.take_along_axis(nrm, axe[:, None], 1)[:, 0] < 0
    code = (axe * 2 + neg).astype(np.int8)
    tx, ty = UV[:, 0] * W, UV[:, 1] * H
    x0, x1, x2 = tx[I[:, 0]], tx[I[:, 1]], tx[I[:, 2]]
    y0, y1, y2 = ty[I[:, 0]], ty[I[:, 1]], ty[I[:, 2]]
    minx = np.floor(np.minimum(np.minimum(x0, x1), x2) - 0.5).astype(np.int64)
    maxx = np.ceil(np.maximum(np.maximum(x0, x1), x2) - 0.5).astype(np.int64)
    miny = np.floor(np.minimum(np.minimum(y0, y1), y2) - 0.5).astype(np.int64)
    maxy = np.ceil(np.maximum(np.maximum(y0, y1), y2) - 0.5).astype(np.int64)
    cote = np.maximum(maxx - minx, maxy - miny) + 1
    den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    valide = np.abs(den) > 1e-12
    bas = 0
    for K in (2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048):
        sel = np.nonzero(valide & (cote > bas) & (cote <= K))[0]
        bas = K
        if not len(sel):
            continue
        dx, dy = np.meshgrid(np.arange(K), np.arange(K))
        dx, dy = dx.ravel(), dy.ravel()
        for paquet in np.array_split(sel, len(sel) * K * K // 2_000_000 + 1):
            if not len(paquet):
                continue
            px = minx[paquet, None] + dx[None, :]
            py = miny[paquet, None] + dy[None, :]
            cx, cy = px + 0.5, py + 0.5
            X0, X1, X2 = x0[paquet, None], x1[paquet, None], x2[paquet, None]
            Y0, Y1, Y2 = y0[paquet, None], y1[paquet, None], y2[paquet, None]
            d = den[paquet, None]
            l0 = ((Y1 - Y2) * (cx - X2) + (X2 - X1) * (cy - Y2)) / d
            l1 = ((Y2 - Y0) * (cx - X2) + (X0 - X2) * (cy - Y2)) / d
            l2 = 1.0 - l0 - l1
            dedans = ((l0 >= -1e-4) & (l1 >= -1e-4) & (l2 >= -1e-4)
                      & (px >= 0) & (px < W) & (py >= 0) & (py < H)
                      & (px <= maxx[paquet, None]) & (py <= maxy[paquet, None]))
            ti, ki = np.nonzero(dedans)
            if not len(ti):
                continue
            tri = paquet[ti]
            pos = (l0[ti, ki, None] * A[tri] + l1[ti, ki, None] * B[tri] + l2[ti, ki, None] * C[tri])
            pos_map[py[ti, ki], px[ti, ki]] = pos
            axe_map[py[ti, ki], px[ti, ki]] = code[tri]


def _carte_positions(doc, bin_, image_idx, W, H):
    """Position 3D (monde) et direction de face de chaque texel de l'image de
    couleur `image_idx`, a la resolution W x H."""
    import numpy as np
    pos_map = np.zeros((H, W, 3), np.float64)
    axe_map = np.full((H, W), -1, np.int8)
    textures, mats = doc.get('textures', []), doc.get('materials', [])
    for ni, M in _matrices_monde(doc).items():
        noeud = doc['nodes'][ni]
        if 'mesh' not in noeud:
            continue
        for prim in doc['meshes'][noeud['mesh']].get('primitives', []):
            if prim.get('mode', 4) != 4 or prim.get('material') is None:
                continue
            bct = ((mats[prim['material']].get('pbrMetallicRoughness') or {}).get('baseColorTexture') or {})
            ti = bct.get('index')
            if ti is None or ti >= len(textures):
                continue
            t = textures[ti]
            sources = {t.get('source')} | {e.get('source') for e in (t.get('extensions') or {}).values() if isinstance(e, dict)}
            att = prim.get('attributes', {})
            uvk = 'TEXCOORD_%d' % bct.get('texCoord', 0)
            if image_idx not in sources or 'POSITION' not in att or uvk not in att:
                continue
            P = _lire_accesseur(doc, bin_, att['POSITION'])
            UV = _lire_accesseur(doc, bin_, att[uvk])
            if P is None or UV is None:
                continue
            P = (np.c_[P.astype(np.float64), np.ones(len(P))] @ M.T)[:, :3]
            if 'indices' in prim:
                I = _lire_accesseur(doc, bin_, prim['indices'])
                if I is None:
                    continue
                I = I.reshape(-1, 3).astype(np.int64)
            else:
                I = np.arange(len(P) - len(P) % 3).reshape(-1, 3)
            _rasteriser_uv(P, UV[:, :2].astype(np.float64), I, pos_map, axe_map)
    return pos_map, axe_map


def _filigraner_3d(img, pos_map, axe_map, taille=0.3, opacite=0.8):
    """Projette le logo + nom sur la texture de couleur d'apres la position 3D
    de chaque texel. `taille` = largeur du logo rapportee a la plus grande
    dimension du modele. None si la carte couvre trop peu de texels."""
    import numpy as np
    from PIL import Image
    couvert = axe_map >= 0
    if couvert.sum() < 500:
        return None
    avait_alpha = img.mode in ('RGBA', 'LA') or 'transparency' in img.info
    base = np.asarray(img.convert('RGBA'), np.float32).copy()
    lignes, cols = np.nonzero(couvert)
    P, code = pos_map[couvert], axe_map[couvert]
    mn, mx = P.min(0), P.max(0)
    S = float((mx - mn).max()) or 1.0
    x, y, z = ((P - (mn + mx) / 2) / S).T
    # (u, v) dans le plan de projection, lu a l'endroit depuis la direction :
    # +X, -X, +Y (vu du dessus), -Y, +Z (devant), -Z (derriere)
    u = np.select([code == 0, code == 1, code == 2, code == 3, code == 4], [-z, z, x, x, x], -x)
    v = np.select([code == 2, code == 3], [z, -z], -y)
    logo = np.asarray(_logo_filigrane(texte_seul=True), np.float32) / 255.0
    LH, LW = logo.shape[:2]
    tw = taille
    th = tw * LH / LW
    pas_x, pas_y = tw * 1.45, th * 3.0
    # un logo centre sur le milieu de chaque face, rangs en quinconce
    vv = v + th / 2
    rang = np.floor(vv / pas_y)
    uu = u + tw / 2 + np.mod(rang, 2) * pas_x / 2
    lx = np.mod(uu, pas_x)
    ly = vv - rang * pas_y
    dans = (lx < tw) & (ly < th)
    if not dans.any():
        return None
    fx = np.clip(lx[dans] / tw * (LW - 1), 0, LW - 1.001)
    fy = np.clip(ly[dans] / th * (LH - 1), 0, LH - 1.001)
    x0, y0 = fx.astype(np.int64), fy.astype(np.int64)
    ax, ay = (fx - x0)[:, None], (fy - y0)[:, None]
    ech = (logo[y0, x0] * (1 - ax) * (1 - ay) + logo[y0, x0 + 1] * ax * (1 - ay)
           + logo[y0 + 1, x0] * (1 - ax) * ay + logo[y0 + 1, x0 + 1] * ax * ay)
    alpha = ech[:, 3:4] * opacite
    r, c = lignes[dans], cols[dans]
    # CONTRASTE (2026-09-28 : sur une maison en pierre blanche, le nom blanc
    # etait invisible, seul le « .AI » rose ressortait) : sur une surface
    # claire, le blanc des lettres devient gris tres fonce ; le rose reste.
    couleur = ech[:, :3] * 255.0
    lum = base[r, c, :3] @ np.array([0.299, 0.587, 0.114], np.float32) / 255.0
    inverser = (ech[:, :3].min(1) > 0.75) & (lum > 0.55)
    couleur[inverser] = (26.0, 26.0, 36.0)
    base[r, c, :3] = base[r, c, :3] * (1 - alpha) + couleur * alpha
    out = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), 'RGBA')
    return out if avait_alpha else out.convert('RGB')


def _images_de_texture(textures, idx) -> set:
    """Indices des images d'une texture glTF : `source` du coeur ET sources des
    extensions (EXT_texture_webp...). Ensemble vide si l'indice est absent."""
    if idx is None or idx >= len(textures):
        return set()
    t = textures[idx]
    return {src for src in [t.get('source')] + [e.get('source') for e in (t.get('extensions') or {}).values() if isinstance(e, dict)]
            if src is not None}


# CARTE DE NORMALES DE L'APERCU (2026-10-14, revue de la branche carte-normales). La copie de demonstration traitait la carte comme
# une image quelconque : reduction LANCZOS des OCTETS (la moyenne de normales unitaires est plus courte : decodee telle quelle, elle
# aplatit le relief, et LANCZOS deborde aux bords des ilots), puis WebP AVEC PERTE qualite 82 (mesure de la revue, carte 512 sans
# aucune reduction : 1,1 degre d'ecart moyen, 14 degres aux bords des ilots, pour un relief moyen de 7,5 degres). Desormais :
#   - carte qui tient deja dans max_px : octets d'ORIGINE, au bit pres ;
#   - sinon : moyenne des VECTEURS (filtre boite, aucun lobe negatif) puis renormalisation, encodee SANS PERTE (WebP lossless, ou PNG).
#   Une carte JPEG reduite devient PNG (mimeType mis a jour : la texture la reference par `source`, le coeur glTF accepte le PNG).
_WEBP_SANS_PERTE_APERCU = {'lossless': True, 'quality': 0, 'method': 1}   # = acceleration_glb.WEBP_NORMALES


def _reduire_carte_normales(img, cible: int):
    """Carte de normales (image PIL) ramenee dans cible x cible (proportions gardees, comme thumbnail) SANS fausser les normales :
    chaque canal decode en [-1, 1] est moyenne par un filtre boite (aire des texels), chaque normale est RENORMALISEE puis re-encodee
    comme normal_bake ((n * 0,5 + 0,5) * 255, arrondi) ; un vecteur nul redevient la normale plate (128, 128, 255). L'alpha
    eventuel est moyenne a part. Rend None si la carte tient deja dans cible x cible (rien a faire)."""
    import numpy as np
    from PIL import Image
    W, H = img.size
    if W <= cible and H <= cible:
        return None
    if W >= H:
        w, h = cible, max(1, int(round(H * cible / float(W))))
    else:
        w, h = max(1, int(round(W * cible / float(H)))), cible
    rgb = np.asarray(img.convert('RGB'))
    canaux = []
    for c in range(3):                     # canal par canal : un seul plan flottant a la fois (carte 4096 : ~130 Mo, pas 600)
        plan = Image.fromarray(rgb[..., c].astype(np.float32) / 127.5 - 1.0)
        canaux.append(np.asarray(plan.resize((w, h), Image.BOX), dtype=np.float64))
    n = np.stack(canaux, axis=-1)
    longueur = np.sqrt((n * n).sum(axis=-1, keepdims=True))
    ok = np.isfinite(longueur) & (longueur > 1e-6)
    n = np.where(ok, n / np.where(ok, longueur, 1.0), np.array([0.0, 0.0, 1.0]))
    octets = np.clip(np.floor((n * 0.5 + 0.5) * 255.0 + 0.5), 0, 255).astype(np.uint8)
    if 'A' in img.getbands():
        a = Image.fromarray(np.asarray(img.getchannel('A')).astype(np.float32)).resize((w, h), Image.BOX)
        alpha = np.clip(np.floor(np.asarray(a, dtype=np.float64) + 0.5), 0, 255).astype(np.uint8)
        return Image.fromarray(np.dstack([octets, alpha]))
    return Image.fromarray(octets)


def _carte_normales_apercu(img, fmt: str, cible: int):
    """(octets, mimeType ou None) de la carte de normales de l'apercu, ou None quand ses octets d'origine sont gardes tels quels
    (carte deja dans cible x cible). Jamais de filigrane (il dessinerait un faux relief) ni d'encodage avec perte."""
    petite = _reduire_carte_normales(img, cible)
    if petite is None:
        return None
    sortie = io.BytesIO()
    if fmt == 'WEBP':
        try:
            from modal_app.acceleration_glb import WEBP_NORMALES as reglages
        except Exception:
            reglages = _WEBP_SANS_PERTE_APERCU
        petite.save(sortie, 'WEBP', **reglages)
        return sortie.getvalue(), None
    petite.save(sortie, 'PNG', optimize=True)
    return sortie.getvalue(), (None if fmt == 'PNG' else 'image/png')


def _textures_apercu(glb_bytes: bytes, max_px: int, filigrane: bool, couleur_px: int = 2048) -> bytes:
    """Reduit TOUTES les images embarquees a max_px et filigrane les textures de
    couleur, en reecrivant le GLB a la main : ni la geometrie, ni la peau, ni
    les animations ne passent par un reexport (trimesh les perdrait). Chaque
    image garde son format (PNG, JPEG, WebP) : les extensions qui le declarent
    (EXT_texture_webp) restent justes. Les cartes de normales ne perdent rien :
    voir CARTE DE NORMALES DE L'APERCU (une carte JPEG reduite devient PNG)."""
    import json
    import struct
    from PIL import Image
    magic, _version, _long = struct.unpack_from('<III', glb_bytes, 0)
    if magic != 0x46546C67:
        raise ValueError('not a GLB file')
    doc, bin_, off = None, b'', 12
    while off + 8 <= len(glb_bytes):
        clen, ctype = struct.unpack_from('<II', glb_bytes, off)
        off += 8
        if ctype == 0x4E4F534A:
            doc = json.loads(glb_bytes[off:off + clen])
        elif ctype == 0x004E4942:
            bin_ = glb_bytes[off:off + clen]
        off += clen
    if doc is None:
        raise ValueError('GLB without JSON chunk')
    vues = doc.get('bufferViews', [])
    textures = doc.get('textures', [])
    # Images de COULEUR : seules a recevoir le filigrane (une carte de normales
    # ou de rugosite filigranee donnerait des reliefs parasites). Cartes de
    # NORMALES : jamais alterees (voir CARTE DE NORMALES DE L'APERCU) ; une image
    # a la fois couleur et carte (fichier aberrant) reste traitee en couleur.
    couleur, normales = set(), set()
    for mat in doc.get('materials', []):
        couleur |= _images_de_texture(textures, ((mat.get('pbrMetallicRoughness') or {}).get('baseColorTexture') or {}).get('index'))
        normales |= _images_de_texture(textures, (mat.get('normalTexture') or {}).get('index'))
    nouvelles = {}
    for ii, im in enumerate(doc.get('images', [])):
        bv = im.get('bufferView')
        if bv is None or bv >= len(vues):
            continue                      # image externe ou data URI : absente des GLB du produit
        v = vues[bv]
        debut = v.get('byteOffset', 0)
        try:
            img = Image.open(io.BytesIO(bin_[debut:debut + v['byteLength']]))
            img.load()
        except Exception:
            continue                      # format non lisible (KTX2…) : laisse tel quel
        fmt = (img.format or 'PNG').upper()
        if ii in normales and ii not in couleur:
            carte = _carte_normales_apercu(img, fmt, max_px)
            if carte is not None:
                nouvelles[bv], mime = carte
                if mime:
                    im['mimeType'] = mime
            continue                      # carte deja assez petite : octets d'origine
        # Couleur a 2048 (le filigrane projete y reste net), autres cartes a max_px.
        cible = couleur_px if ii in couleur else max_px
        img.thumbnail((cible, cible), Image.LANCZOS)
        if filigrane and ii in couleur:
            projete = None
            try:
                pos_map, axe_map = _carte_positions(doc, bin_, ii, img.size[0], img.size[1])
                projete = _filigraner_3d(img, pos_map, axe_map)
            except Exception as e:
                print(f'[apercu] projection impossible ({e}) — filigrane a plat', flush=True)
            img = projete if projete is not None else _filigraner(img)
        sortie = io.BytesIO()
        if fmt == 'JPEG':
            img.convert('RGB').save(sortie, 'JPEG', quality=82)
        elif fmt == 'WEBP':
            img.save(sortie, 'WEBP', quality=82)
        else:
            img.save(sortie, 'PNG', optimize=True)
        nouvelles[bv] = sortie.getvalue()
    # BIN reconstruit : chaque vue du tampon 0 recopiee dans l'ordre, alignee
    # sur 4 octets ; les accesseurs, relatifs a leur vue, restent valides.
    morceaux, pos = [], 0
    for i, v in enumerate(vues):
        if v.get('buffer', 0) != 0:
            continue
        donnees = nouvelles.get(i)
        if donnees is None:
            debut = v.get('byteOffset', 0)
            donnees = bin_[debut:debut + v['byteLength']]
        bourre = (-pos) % 4
        if bourre:
            morceaux.append(b'\0' * bourre)
            pos += bourre
        v['byteOffset'] = pos
        v['byteLength'] = len(donnees)
        morceaux.append(donnees)
        pos += len(donnees)
    nouveau_bin = b''.join(morceaux)
    nouveau_bin += b'\0' * ((-len(nouveau_bin)) % 4)
    if doc.get('buffers'):
        doc['buffers'][0]['byteLength'] = len(nouveau_bin)
    js = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(nouveau_bin)
    return (struct.pack('<III', 0x46546C67, 2, total)
            + struct.pack('<II', len(js), 0x4E4F534A) + js
            + struct.pack('<II', len(nouveau_bin), 0x004E4942) + nouveau_bin)


def _image_apercu(data: bytes, max_px: int, filigrane: bool) -> bytes:
    """Apercu d'une IMAGE payante : reduite a max_px et filigranee. PNG si elle
    a de la transparence (detourage), JPEG sinon."""
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    img.load()
    alpha = 'A' in img.getbands() or 'transparency' in img.info
    img = img.convert('RGBA' if alpha else 'RGB')
    img.thumbnail((max_px, max_px), Image.LANCZOS)
    if filigrane:
        img = _filigraner(img, echelle=0.35)
    sortie = io.BytesIO()
    if alpha:
        img.save(sortie, 'PNG', optimize=True)
    else:
        img.convert('RGB').save(sortie, 'JPEG', quality=85)
    return sortie.getvalue()


def apercu(glb_bytes: bytes, max_px: int = 1024, faces: int = 0, filigrane: bool = True) -> bytes:
    """COPIE DE DEMONSTRATION d'une fiche payante de la Marketplace (2026-09-27,
    user : « que les gens puissent voir avant d'acheter », principe de
    Sketchfab : la vraie 3D, mais pas le fichier vendu). Textures reduites a
    max_px et filigranees (logo + nom) ; maillage statique allege a `faces`
    triangles si demande (0 = geometrie intacte : rigs et animations, qu'un
    reexport casserait). Une IMAGE (pas l'en-tete glTF) est reduite et
    filigranee de la meme facon."""
    if glb_bytes[:4] != b'glTF':
        return _image_apercu(glb_bytes, max(64, min(int(max_px), 2048)), filigrane)
    if faces:
        try:
            glb_bytes = decimate(glb_bytes, target_faces=faces)
        except Exception:
            pass                          # deja sous la cible, ou echec : geometrie d'origine
    return _textures_apercu(glb_bytes, max(64, min(int(max_px), 2048)), filigrane)


OPS = {
    'smooth':          smooth,
    'decimate':        decimate,
    'watertight':      watertight,
    'center':          center,
    'fix_normals':     fix_normals,
    'fill_holes':      fill_holes,
    'subdivide':       subdivide,
    'align_texture':   align_texture,
    'material':        normalize_material,
    'recolor':         recolor,    # recolorier la texture (tout / une zone UV) en gardant la lumiere (25/10)
    'material_adjust': material_adjust,  # 6-slider PBR tweak (mirror of scripts/mesh_material_adjust.py)
    'retex_swap':      retex_swap_atlas,
    'resize':          resize,     # orientation + per-axis scale (manual Resize/dimension tool)
    'explode':         explode,    # Voronoi fracture -> part_XX submeshes (explode slider)
    'symmetrize':      None,       # symetrie par un plan (outil manuel « Symmetrize mesh »), voir modal_app/_symetrie.py
    'apercu':          apercu,     # copie de demonstration filigranee (Marketplace, fiches payantes)
}


def run(op_type: str, glb_bytes: bytes, params: dict | None = None):
    """Point d'entree unique. 2026-10-03 (AI Act art. 50) : le resultat est marque une derniere fois ici,
    pour les operations qui n'exportent pas par `_export` (align_texture rend le fichier de
    texture_project.py, apercu rend aussi des images). Idempotent : une sortie deja marquee est inchangee."""
    sortie, stats = _executer(op_type, glb_bytes, params)
    return _marquer_ia(sortie), stats


def _executer(op_type: str, glb_bytes: bytes, params: dict | None = None):
    """Single entry point — the worker passes op_type + GLB bytes +
    params, we route to the right helper above and return a
    (bytes, stats|None) tuple. fill_holes populates stats with a
    verdict + per-mesh diagnostic; every other op returns stats=None.
    Unknown ops raise ValueError."""
    if op_type not in OPS:
        raise ValueError(f'unknown mesh op: {op_type}')
    p = params or {}
    if op_type == 'smooth':
        return smooth(glb_bytes, iterations=int(p.get('iterations', 5)),
                                  lamb=float(p.get('lamb', 0.5))), None
    if op_type == 'decimate':
        return decimate(glb_bytes, target_faces=int(p.get('target_faces', 50_000))), None
    if op_type == 'subdivide':
        return subdivide(glb_bytes, iterations=int(p.get('iterations', 1))), None
    if op_type == 'watertight':
        return watertight(glb_bytes, resolution=int(p.get('resolution', 128)), mode=str(p.get('mode') or 'seal')), None
    if op_type == 'retex_swap':
        return retex_swap_atlas(glb_bytes, str(p.get('image_url') or '')), None
    if op_type == 'align_texture':
        return align_texture(glb_bytes, str(p.get('image_url') or ''),
                             translate_x=float(p.get('translate_x', 0) or 0),
                             translate_y=float(p.get('translate_y', 0) or 0),
                             translate_z=float(p.get('translate_z', 0) or 0),
                             mesh_scale=float(p.get('mesh_scale', 1) or 1),
                             rot_y=float(p.get('rot_y', 0) or 0),
                             vis_thresh=float(p.get('vis_thresh', 0.5) or 0.5),
                             frame_fix=bool(p.get('frame_fix', True)),
                             skip_vflip=bool(p.get('skip_vflip', True))), None
    if op_type == 'recolor':
        return recolor(glb_bytes, color=str(p.get('color', '#3b82f6')), intensity=float(p.get('intensity', 1.0)),
                       uv_mask_b64=p.get('uv_mask') or None), None
    if op_type == 'material_adjust':
        return material_adjust(glb_bytes,
            brightness=float(p.get('brightness', 1.0)),
            saturation=float(p.get('saturation', 1.0)),
            contrast=float(p.get('contrast', 1.0)),
            emissive=float(p.get('emissive', 0.0)),
            metallic=float(p.get('metallic', 0.0)),
            roughness=float(p.get('roughness', 0.7)),
            hue_shift=float(p.get('hue_shift', 0.0))), None
    if op_type == 'resize':
        q = [p.get(k) for k in ('qx', 'qy', 'qz', 'qw')]
        return resize(glb_bytes,
                      sx=float(p.get('sx', 1.0)),
                      sy=float(p.get('sy', 1.0)),
                      sz=float(p.get('sz', 1.0)),
                      q=[float(v) for v in q] if all(v is not None for v in q) else None), None
    if op_type == 'symmetrize':
        from modal_app._symetrie import symetriser
        sortie, st = symetriser(glb_bytes, p)
        return sortie, st
    if op_type == 'explode':
        return explode(glb_bytes, fragments=int(p.get('fragments', 24)), mode=str(p.get('mode', 'voronoi'))), None
    if op_type == 'apercu':
        return apercu(glb_bytes, max_px=int(p.get('max_px', 1024)),
                      faces=int(p.get('faces', 0)),
                      filigrane=bool(p.get('filigrane', True))), None
    if op_type == 'fill_holes':
        # Les deux curseurs de l'interface sont enfin TRANSMIS. Ils
        # etaient jetes cote client (« take no params on the Modal
        # side ») alors que l'apercu coloriait les trous selon eux :
        # l'utilisateur voyait du gris et du rouge, puis recevait un
        # maillage ou TOUT avait ete bouche.
        return fill_holes(
            glb_bytes,
            min_edges=int(p.get('min_hole_size', 3) or 3),
            max_edges=int(p.get('max_hole_size', 1_000_000) or 1_000_000),
            skin_repair=bool(p.get('skin_repair', False)),
            detect_only=bool(p.get('detect_only', False)),
        )
    return OPS[op_type](glb_bytes), None
