"""Accelerations de la construction d'un GLB TRELLIS-2 (2026-09-29).

MEME FICHIER dans scripts/ (bureau) et modal_app/ (cloud), surveille par
build/check-noyaux-partages.mjs. Aucune dependance au-dela de ce que les deux
environnements ont deja (numpy, opencv, Pillow, trimesh, o_voxel).

1. RETOUCHES D'ATLAS (accelerer_to_glb). o_voxel.postprocess.to_glb comble les
   texels vides de l'atlas avec 4 cv2.inpaint successifs : couleur (rayon 3) puis
   metal, rugosite, alpha (rayon 1), un par un. Mesure en 4096 : 7,0 s + 3 x ~2,9 s.
   Les trois canaux de rayon 1 traites EN UNE FOIS (image a 3 canaux) rendent les
   MEMES octets (verifie) en 3,7 s au lieu de 8,7 s, et tournent en meme temps que
   la couleur (cv2 libere le GIL). Le texte de la fonction est remplace a l'import ;
   s'il a change dans la bibliotheque, rien n'est touche. A appeler AVANT tout
   `from o_voxel.postprocess import to_glb` (sinon le nom local garde l'ancienne).
   Essaye et ecarte : limiter TELEA a une bande de 32 px autour des ilots — sur de
   vrais atlas 4K, 100 % des texels vides sont a moins de 32 px d'un ilot.

2. TEXTURE COULEUR ENCODEE PLUS VITE (preencoder_couleur). trimesh encode les
   textures en WebP avec les reglages par defaut de Pillow (qualite 80, method 4) :
   95 % de la serialisation du GLB. Mesure sur l'atlas 8K d'un vrai maillage :
   18,7 s, 3,5 Mo, 44,02 dB ; method=2 + qualite 90 : 2,2 s, 6,0 Mo, 44,34 dB — meme
   qualite (un peu meilleure), 8x plus vite, fichier plus lourd (+12 % pour le GLB).
   La texture couleur est encodee ici et trimesh reprend ces octets tels quels (son
   _append_image est enveloppe, garde de signature) ; metal/rugosite garde le
   reglage d'origine (petite et deja rapide). A appeler juste avant
   `glb.export(..., extension_webp=True)`.
"""

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
_TO_GLB_ACCELERE = False

WEBP_COULEUR = {'method': 2, 'quality': 90}


def accelerer_to_glb(o_voxel_module, log=print) -> None:
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
            log("[mesh] retouches d'atlas : texte de to_glb inattendu, version d'origine gardee")
            return
        espace = dict(pp.__dict__)
        exec(compile(src.replace(_INPAINT_AVANT, _INPAINT_APRES), inspect.getsourcefile(pp.to_glb), 'exec'), espace)
        pp.to_glb = espace['to_glb']
        log("[mesh] retouches d'atlas accelerees (canaux fusionnes, en parallele)")
    except Exception as e:
        log(f"[mesh] retouches d'atlas : acceleration ignoree ({type(e).__name__}: {e})")


def _envelopper_append_image(log=print) -> bool:
    try:
        import inspect
        import trimesh.exchange.gltf as G
        if getattr(G, '_fabmesh_webp', False):
            return True
        orig = G._append_image
        if list(inspect.signature(orig).parameters) != ['img', 'tree', 'buffer_items', 'extension_webp']:
            log("[mesh] webp : trimesh inattendu, encodage d'origine")
            return False

        def _append_image(img, tree, buffer_items, extension_webp):
            octets = getattr(img, '_fabmesh_webp', None)
            if extension_webp and octets:
                index = G._buffer_append(buffer_items, octets)
                tree['images'].append({'bufferView': index, 'mimeType': 'image/webp'})
                return len(tree['images']) - 1
            return orig(img, tree, buffer_items, extension_webp)
        G._append_image = _append_image
        G._fabmesh_webp = True
        return True
    except Exception as e:
        log(f'[mesh] webp : enveloppe ignoree ({type(e).__name__}: {e})')
        return False


def preencoder_couleur(glb_obj, log=print) -> float:
    """Encode la texture couleur (WEBP_COULEUR) et la marque pour trimesh. Rend la duree."""
    import io
    import time
    if not _envelopper_append_image(log):
        return 0.0
    t = time.time()
    for g in (list(glb_obj.geometry.values()) if hasattr(glb_obj, 'geometry') else [glb_obj]):
        mat = getattr(getattr(g, 'visual', None), 'material', None)
        tex = getattr(mat, 'baseColorTexture', None) if mat else None
        if tex is None:
            continue
        f = io.BytesIO()
        tex.save(f, format='WEBP', **WEBP_COULEUR)
        tex._fabmesh_webp = f.getvalue()
    return time.time() - t
