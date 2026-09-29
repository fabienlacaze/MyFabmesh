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
   `glb.export(..., extension_webp=True)`. Etendu le 2026-09-29 aux OUTILS (face fix, re-texture,
   operations de maillage, variantes, affinage...) par `webp_rapide`, qui ne leve jamais. Les
   octets pre-encodes portent une empreinte de l'image : repris seulement si elle n'a pas change.

3. REDUCTION SANS PLIS (dans accelerer_to_glb). La reduction de to_glb
   (cumesh.simplify, approximation GPU par lots) ne verifie pas qu'un triangle se
   retourne. Aux petites cibles, le maillage se replie sur lui-meme : mesure sur un
   husky a 1 000 triangles, 30 % de la surface en triangles retournes — le materiau
   n'etant pas double face, ce sont autant de TROUS au rendu (8 % en qualite ultra,
   2,4 % a 5 000, 0,7 % a 50 000). Sous SEUIL_SANS_PLIS, la fin de la reduction passe
   par fast_simplification (quadriques, MIT) qui REFUSE une contraction qui retourne
   un triangle : 4,2 % a 1 000 (des aretes vives de parties fines, pas des trous),
   rendu sans trou, 0,03 s. Au-dessus, rien ne change. Absent de l'environnement :
   reduction d'origine.
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
_SIMPLIFY_AVANT = 'mesh.simplify(decimation_target'
_SIMPLIFY_APRES = '_reduire_sans_plis(mesh, decimation_target'
SEUIL_SANS_PLIS = 50_000      # faces : au-dessus, la reduction GPU d'origine ne plie pas (0,7 % a 50 000)
PALIER_GPU = 300_000          # jusque-la, reduction GPU (ratio doux) ; fast_simplification ensuite
# NETTOYAGE AVANT REDUCTION (2026-09-29) : le maillage brut du remaillage arrive avec des aretes
# non-manifold (1 012 sur la chevre du user, 5 K faces : 15 % de surface repliee malgre la reduction
# sans plis). Memes operations que la branche sans remaillage de to_glb avant sa reduction.
# MESURE (banc test_reduction.py, chevre 5 K, meme graine) : surface repliee 14,1 % -> 5,4 %, mais 1 290
# aretes de BORD (vrais trous) au lieu de 0 : repair_non_manifold_edges ouvre le maillage. Visuellement
# pas mieux -> DESACTIVE ; la parade retenue est le materiau DOUBLE FACE sous le seuil (voir plus bas).
NETTOYAGE_AVANT_REDUCTION = False
AGRESSIVITE = 7               # fast_simplification `agg` (4 : a peine mieux ; 2 : rate la cible)
_DOUBLE_FACE_AVANT = "doubleSided=True if not remesh else False"
_DOUBLE_FACE_APRES = "doubleSided=True if (not remesh or decimation_target <= SEUIL_SANS_PLIS) else False"
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
        faits = []
        if _INPAINT_AVANT in src:
            src = src.replace(_INPAINT_AVANT, _INPAINT_APRES)
            faits.append("retouches d'atlas accelerees (canaux fusionnes, en parallele)")
        else:
            log("[mesh] retouches d'atlas : texte de to_glb inattendu, version d'origine")
        if src.count(_SIMPLIFY_AVANT) >= 1:
            src = src.replace(_SIMPLIFY_AVANT, _SIMPLIFY_APRES)
            faits.append(f'reduction sans plis sous {SEUIL_SANS_PLIS} faces')
        # MATERIAU DOUBLE FACE sous le seuil (2026-09-29) : a quelques milliers de faces, une partie
        # fine (patte, corne, barbe) garde des triangles retournes ; en simple face ce sont des TROUS
        # au rendu. to_glb met deja double face quand il ne remaille pas. Chevre 5 K du user : aucune
        # arete de bord, les « trous » disparaissent en double face (rendu compare).
        if src.count(_DOUBLE_FACE_AVANT) == 1:
            src = src.replace(_DOUBLE_FACE_AVANT, _DOUBLE_FACE_APRES)
            faits.append(f'double face sous {SEUIL_SANS_PLIS} faces')
        else:
            log("[mesh] reduction sans plis : texte de to_glb inattendu, reduction d'origine")
        if not faits:
            return
        espace = dict(pp.__dict__)
        espace['_reduire_sans_plis'] = lambda m, cible, verbose=False: _reduire_sans_plis(m, cible, verbose, log)
        espace['SEUIL_SANS_PLIS'] = SEUIL_SANS_PLIS
        exec(compile(src, inspect.getsourcefile(pp.to_glb), 'exec'), espace)
        pp.to_glb = espace['to_glb']
        log('[mesh] ' + ' ; '.join(faits))
    except Exception as e:
        log(f"[mesh] to_glb : accelerations ignorees ({type(e).__name__}: {e})")


def _reduire_sans_plis(mesh, cible, verbose=False, log=print):
    """Remplace mesh.simplify(cible) dans to_glb (voir 3. en tete du fichier)."""
    cible = int(cible)
    if cible > SEUIL_SANS_PLIS:
        return mesh.simplify(cible, verbose=verbose)
    try:
        import numpy as np
        import torch
        import fast_simplification
    except ImportError:
        return mesh.simplify(cible, verbose=verbose)
    if mesh.num_faces > PALIER_GPU:
        mesh.simplify(PALIER_GPU, verbose=verbose)
    if NETTOYAGE_AVANT_REDUCTION:
        _nettoyer(mesh, log)
    v, f = mesh.read()
    n0 = int(f.shape[0])
    if n0 <= cible:
        return
    try:
        # sommets confondus soudes (coutures) : sinon chaque couture est un bord que
        # fast_simplification ne contracte pas, et la cible n'est pas atteinte
        vn, inv = np.unique(v.detach().cpu().numpy().astype(np.float32), axis=0, return_inverse=True)
        fn = inv.reshape(-1)[f.detach().cpu().numpy().astype(np.int64)]
        fn = fn[(fn[:, 0] != fn[:, 1]) & (fn[:, 1] != fn[:, 2]) & (fn[:, 0] != fn[:, 2])]
        moteur = 'meshoptimizer'
        try:
            v2, f2 = _reduire_meshopt(vn, fn, cible)
        except ImportError:
            moteur = 'fast_simplification'
            v2, f2 = fast_simplification.simplify(vn, fn, target_reduction=1.0 - cible / len(fn), agg=AGRESSIVITE)
    except Exception as e:
        log(f"[tris] reduction sans plis impossible ({type(e).__name__}: {e}) : reduction d'origine")
        return mesh.simplify(cible, verbose=verbose)
    mesh.init(torch.from_numpy(np.ascontiguousarray(v2, dtype=np.float32)).to(v.device),
              torch.from_numpy(np.ascontiguousarray(f2)).to(device=f.device, dtype=f.dtype))
    if NETTOYAGE_AVANT_REDUCTION:
        _nettoyer(mesh, log, orienter=True)
    log(f'[tris] reduction sans plis ({moteur}) : {n0} -> {int(f2.shape[0])} faces (cible {cible})'
        + (' (nettoye avant et apres)' if NETTOYAGE_AVANT_REDUCTION else ''))


def _reduire_meshopt(vn, fn, cible):
    """REDUCTION PAR MESHOPTIMIZER (MIT, 2026-09-29). Juge par le user sur des modeles reels (ane, cabane,
    brut 10 M -> 50 K / 5 K / 1 K) : « ca marche super bien, on remplace ». fast_simplification fragmentait
    aux petites cibles (camion 5 K : 1 470 morceaux, la moitie des triangles en miettes). Forme SEULE ici :
    to_glb deplie et cuit la texture ensuite. Comme gltfpack -si puis -sa : qualite d'abord (erreur 1 %),
    puis sans limite d'erreur, puis « sloppy » si la cible reste hors d'atteinte. ImportError si absent
    (bureau pour l'instant) : l'appelant revient a fast_simplification."""
    import numpy as np
    try:
        import meshoptimizer as mo
    except ImportError:
        return _reduire_meshopt_wasm(vn, fn, cible)
    idx = np.ascontiguousarray(fn.reshape(-1), dtype=np.uint32)
    pos = np.ascontiguousarray(vn, dtype=np.float32)
    dest = np.zeros_like(idx)
    cible_idx = int(cible) * 3
    n = mo.simplify(dest, idx, pos, target_index_count=cible_idx, target_error=0.01)
    if n > cible_idx * 1.1:
        n = mo.simplify(dest, idx, pos, target_index_count=cible_idx, target_error=1.0)
    if n > cible_idx * 1.3:
        n = mo.simplify_sloppy(dest, idx, pos, target_index_count=cible_idx, target_error=1.0)
    f = dest[:n].reshape(-1, 3).astype(np.int64)
    utiles, inv = np.unique(f.reshape(-1), return_inverse=True)
    return pos[utiles], inv.reshape(-1, 3)

def _reduire_meshopt_wasm(vn, fn, cible):
    """BUREAU (2026-09-29) : meme reduction par la version WebAssembly de meshoptimizer (scripts/meshopt/),
    executee par l'executable Electron deja signe (FABMESH_NODE, pose par main.js) en mode Node — une
    bibliotheque compilee non signee serait bloquee par Smart App Control. A defaut, `node` du PATH (dev).
    ImportError si rien n'est disponible : l'appelant revient a fast_simplification."""
    import os
    import struct
    import subprocess
    import tempfile
    import numpy as np
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'meshopt', 'meshopt_reduire.mjs')
    if not os.path.exists(script):
        raise ImportError('meshopt_reduire.mjs absent')
    exe = os.environ.get('FABMESH_NODE') or 'node'
    env = dict(os.environ, ELECTRON_RUN_AS_NODE='1')
    pos = np.ascontiguousarray(vn, dtype=np.float32)
    idx = np.ascontiguousarray(fn, dtype=np.uint32)
    with tempfile.TemporaryDirectory(prefix='meshopt_') as d:
        e, s = os.path.join(d, 'in.bin'), os.path.join(d, 'out.bin')
        with open(e, 'wb') as fh:
            fh.write(struct.pack('<ii', len(pos), len(idx)) + pos.tobytes() + idx.tobytes())
        try:
            subprocess.run([exe, script, e, s, str(int(cible))], env=env, check=True, capture_output=True,
                           timeout=600, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except (OSError, subprocess.SubprocessError) as err:
            raise ImportError(f'meshoptimizer wasm indisponible : {err}')
        b = open(s, 'rb').read()
    n = struct.unpack('<i', b[:4])[0]
    f = np.frombuffer(b[4:4 + n * 12], dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    utiles, inv = np.unique(f.reshape(-1), return_inverse=True)
    return pos[utiles], inv.reshape(-1, 3)

def reduire_et_recuire(m, cible, taille=2048, log=print):
    """TRIANGLE COUNT (2026-09-29, user : « l'outil Triangle count doit aussi l'utiliser ») : reduit la FORME
    SEULE par meshoptimizer (forme tres bien conservee, jugee sur ane et cabane 10 M -> 1 K), redeplie (xatlas)
    et RECUIT la couleur depuis le maillage texture d'origine (couleur du point de surface le plus proche).
    Reduire le maillage texture tel quel deplace les coutures d'UV : texture dechiree (essai du jour).
    Rend un trimesh.Trimesh texture ; ImportError si xatlas / scipy / cv2 manquent (l'appelant garde
    l'ancienne methode). Identique bureau / serveur."""
    import numpy as np
    import trimesh
    import xatlas
    import cv2
    from PIL import Image
    from scipy.spatial import cKDTree
    import time
    t0 = time.time()
    tex = m.visual.material.baseColorTexture
    if tex is None:
        raise ImportError('pas de texture de couleur')
    A = np.asarray(tex.convert('RGB'), np.float32)
    H, W = A.shape[:2]
    uv = np.asarray(m.visual.uv, np.float64)
    vn, inv = np.unique(np.asarray(m.vertices, np.float32), axis=0, return_inverse=True)
    fn = inv.reshape(-1)[np.asarray(m.faces)]
    fn = fn[(fn[:, 0] != fn[:, 1]) & (fn[:, 1] != fn[:, 2]) & (fn[:, 0] != fn[:, 2])]
    v2, f2 = _reduire_meshopt(vn, fn, int(cible))
    vmap, idx, uv2 = xatlas.parametrize(np.asarray(v2, np.float32), np.asarray(f2, np.uint32))
    V2 = np.asarray(v2, np.float64)[vmap]
    # nuage colore dense sur la surface d'origine
    n_pts = int(min(3_000_000, max(400_000, taille * taille * 0.6)))
    pts, fi = trimesh.sample.sample_surface(m, n_pts)
    bary = trimesh.triangles.points_to_barycentric(m.triangles[fi], pts)
    uvp = np.einsum('ij,ijk->ik', bary, uv[np.asarray(m.faces)[fi]])
    px = np.clip((uvp[:, 0] % 1.0) * (W - 1), 0, W - 1).astype(np.int64)
    py = np.clip((1.0 - uvp[:, 1] % 1.0) * (H - 1), 0, H - 1).astype(np.int64)
    col = A[py, px]
    arbre = cKDTree(pts)
    # rasterisation vectorisee des triangles dans le nouvel atlas -> position 3D de chaque texel
    T = int(taille)
    tri = uv2[idx] * (T - 1)                                   # (F, 3, 2)
    lo = np.floor(tri.min(1)).astype(np.int64)
    hi = np.ceil(tri.max(1)).astype(np.int64)
    taille_bb = (hi - lo + 1).max(1)
    P, Q = [], []
    for K in (4, 8, 16, 32, 64, 128, 256, 512, 4096):
        sel = np.nonzero((taille_bb <= K) & (taille_bb > (K // 2 if K > 4 else 0)))[0]
        for d in range(0, len(sel), max(1, 2_000_000 // (K * K))):
            s_ = sel[d:d + max(1, 2_000_000 // (K * K))]
            gx, gy = np.meshgrid(np.arange(K), np.arange(K))
            X = lo[s_, 0][:, None] + gx.ravel()[None, :] + 0.5
            Y = lo[s_, 1][:, None] + gy.ravel()[None, :] + 0.5
            a, b, c = tri[s_, 0], tri[s_, 1], tri[s_, 2]
            den = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
            den = np.where(np.abs(den) < 1e-12, 1e-12, den)[:, None]
            l1 = ((b[:, 1] - c[:, 1])[:, None] * (X - c[:, 0][:, None]) + (c[:, 0] - b[:, 0])[:, None] * (Y - c[:, 1][:, None])) / den
            l2 = ((c[:, 1] - a[:, 1])[:, None] * (X - c[:, 0][:, None]) + (a[:, 0] - c[:, 0])[:, None] * (Y - c[:, 1][:, None])) / den
            l3 = 1.0 - l1 - l2
            ok = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
            ti, pi = np.nonzero(ok)
            if not len(ti):
                continue
            fa = idx[s_[ti]]
            L = np.stack([l1[ti, pi], l2[ti, pi], l3[ti, pi]], 1)
            P.append(np.einsum('ij,ijk->ik', L, V2[fa]))
            Q.append(np.stack([X[ti, pi], Y[ti, pi]], 1).astype(np.int64))
    P = np.concatenate(P)
    Q = np.clip(np.concatenate(Q), 0, T - 1)
    _, k = arbre.query(P, k=4, workers=-1)
    out = np.zeros((T, T, 3), np.float32)
    rempli = np.zeros((T, T), np.uint8)
    out[Q[:, 1], Q[:, 0]] = col[k].mean(1)
    rempli[Q[:, 1], Q[:, 0]] = 1
    img = cv2.inpaint(out.clip(0, 255).astype(np.uint8), (1 - rempli) * 255, 3, cv2.INPAINT_TELEA)
    img = np.ascontiguousarray(np.flipud(img))
    ancien = m.visual.material
    mat = trimesh.visual.material.PBRMaterial(
        baseColorTexture=Image.fromarray(img),
        metallicFactor=getattr(ancien, 'metallicFactor', 0.0) or 0.0,
        roughnessFactor=getattr(ancien, 'roughnessFactor', 0.8) or 0.8,
        doubleSided=True)
    r = trimesh.Trimesh(V2, idx, visual=trimesh.visual.TextureVisuals(uv=uv2, material=mat), process=False)
    log(f'[tris] reduction + recuisson : {len(m.faces)} -> {len(idx)} faces, atlas {T} ({time.time() - t0:.1f} s)')
    return r

def _nettoyer(mesh, log=print, orienter=False):
    """Doublons, aretes non-manifold, miettes, petits trous (+ orientation) — operations cumesh."""
    try:
        mesh.remove_duplicate_faces()
        mesh.repair_non_manifold_edges()
        mesh.remove_small_connected_components(1e-5)
        mesh.fill_holes(max_hole_perimeter=3e-2)
        if orienter:
            mesh.unify_face_orientations()
    except Exception as e:
        log(f'[tris] nettoyage ignore ({type(e).__name__}: {e})')


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
            marque = getattr(img, '_fabmesh_webp', None)
            # octets repris SEULEMENT si l'image n'a pas change depuis (empreinte) : un outil qui
            # modifierait la texture sur place apres un pre-encodage exporterait sinon l'ancienne
            octets = marque[1] if (extension_webp and marque and _empreinte(img) == marque[0]) else None
            if octets:
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


def _empreinte(img) -> int:
    import zlib
    return zlib.crc32(img.tobytes()) ^ hash((img.mode, img.size))


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
        tex._fabmesh_webp = (_empreinte(tex), f.getvalue())
    return time.time() - t


def webp_rapide(glb_obj, log=None) -> float:
    """preencoder_couleur SANS jamais lever : a appeler juste avant tout `export(...,
    extension_webp=True)` (outils d'edition, bureau et cloud, 2026-09-29). Au pire, rien n'est
    pre-encode et trimesh encode comme avant."""
    try:
        return preencoder_couleur(glb_obj, log=log or (lambda *_: None))
    except Exception:
        return 0.0
