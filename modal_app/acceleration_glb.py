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

1 bis. REMPLISSAGE PAR LE BORD LE PLUS PROCHE (2026-10-03, constat E-1 / essai T4 de l'analyse du
   03/10). Les texels vides de l'atlas ne prennent plus l'inpainting TELEA mais la valeur du texel COUVERT
   le plus proche (cv2.distanceTransformWithLabels : prolongement du bord de l'ilot). Mesure sur trois
   sujets reels (build/bancs/texture/essai6_remplissage.py) : texels couverts IDENTIQUES octet pour octet,
   couture mip2 meilleure (alien 4,39 contre 4,65 ; chevalier 5,20 contre 5,66 ; bus 3,07 contre 3,30),
   4,2 a 9,3 s gagnees selon la taille. Si le remplissage leve une exception, repli sur le TELEA fusionne
   d'avant (REMPLISSAGE_ATLAS = "telea" force aussi l'ancien comportement).

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

4. DALLE DE SOL ET SOCLE (2026-10-03, audit de fidelite ; fonctions en fin de fichier : masque_dalle_sol, retirer_dalle_sol,
   retirer_dalle_cumesh, retrait_dalle_actif). Sur le GLB de l'orc du proprietaire (512 301 faces) 64 % de l'AIRE et 37 % des
   triangles servent a une feuille de sol de +/- 0,5 (le cube de TRELLIS ; 82 K faces, 2 mm d'epaisseur, a 8 % de la hauteur) et
   a un rocher dessous. Le depliage UV repartit l'atlas au prorata de l'aire de surface (il ne sait pas ce qui est corps) : le
   corps n'en garde que 35 % (flou au zoom) et le rig traine la dalle. Un sanglier : feuille de 271 K faces (81 % de l'aire,
   0,1 mm d'epaisseur) a 0 %. Sur 36 maillages reels (l'orc + 35 paires du compte R2) ce sont les SEULS qui en portent une.
   SIGNATURE : une bande de faces quasi horizontales (|n| >= 0,9), epaisse de 2 % de la hauteur au plus, dans le tiers inferieur,
   faite de composantes connexes GROSSES (sommets soudes par position : les coutures d'UV dupliquent les sommets), dont l'aire
   d'UNE face vaut au moins 3 fois la silhouette (vue de dessus, remplie) du corps qui est au-dessus. Mesure : orc 14,1 ; sanglier
   23,8 ; le plus fort refus 0,70 (un abri) ; sans cette exigence un abri perdrait 29 % de son aire, un camion 6 %.
   Alors la coupe passe 0,25 % de la hauteur au-dessus de la feuille (la « ligne des pieds ») : tout ce qui est dessous part
   (feuille, rocher du dessous), RIEN au-dessus ne part jamais. Un socle plein plus epais que la fenetre a deux feuilles : la plus
   haute qui deborde le corps donne la ligne. Au-dela de 15 % de la hauteur, seule la feuille a deux faces part (ce qui est
   dessous pourrait etre le corps). RESIDU ASSUME : le rocher qui est au-dessus de la feuille reste (orc : 5 % des faces, 2 % de
   l'aire), car rien ne distingue un rocher de bottes evasees ou d'un ourlet de robe par la seule geometrie.
   PISTE ECARTEE (consigne : ligne des pieds par la chute de la section de silhouette, socle = faces dessous hors de l'empreinte du
   corps dilatee, SANS feuille) : mesuree sur les memes 36 maillages, elle ampute de 0,4 a 4 % de leur aire 7 maillages SANS
   dalle (oie, canards, trois humains, un abri : pieds, bottes, soubassement) et ne retire que 49 % de l'aire de l'orc (contre 64 %). Banc : build/bancs/fidelite/dalle_sol_campagne.py.
   Fonctions pures (numpy ; scipy et cv2 si presents), 0,3 s pour 500 K faces, 2,3 s et 0,9 Go de pic pour 5 M. L'APPELANT choisit
   les types (TYPES_CONCERNES : un batiment ou un vehicule a de vrais planchers). Apres le retrait la peau reste OUVERTE sous les
   pieds : aucune semelle n'est rebouchee (invisible de dessus ; avec conserver_socle=True la jonction feuille / rocher reste
   ouverte aussi).
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
# 2026-10-03 (constat E-1) : remplissage par le bord le plus proche. Les quatre lignes ci-dessus sont
# remplacees par un seul appel au module ; _INPAINT_APRES (TELEA fusionne) reste le repli.
_INPAINT_APRES_PROCHE = """    base_color, metallic, roughness, alpha = _remplir_atlas(mask_inv, base_color, metallic, roughness, alpha)
    metallic, roughness, alpha = metallic[..., None], roughness[..., None], alpha[..., None]"""
REMPLISSAGE_ATLAS = 'proche'   # 'proche' (bord le plus proche) ou 'telea' (comportement d'avant le 2026-10-03)
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
            if REMPLISSAGE_ATLAS == 'proche':
                src = src.replace(_INPAINT_AVANT, _INPAINT_APRES_PROCHE)
                faits.append("retouches d'atlas : prolongement du bord le plus proche")
            else:
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
        espace['_remplir_atlas'] = lambda *a: _remplir_atlas(*a, log=log)
        espace['SEUIL_SANS_PLIS'] = SEUIL_SANS_PLIS
        exec(compile(src, inspect.getsourcefile(pp.to_glb), 'exec'), espace)
        pp.to_glb = espace['to_glb']
        log('[mesh] ' + ' ; '.join(faits))
    except Exception as e:
        log(f"[mesh] to_glb : accelerations ignorees ({type(e).__name__}: {e})")


def remplir_bord_proche(masque_vide, *images):
    """Prolonge chaque texel VIDE (masque_vide != 0) par la valeur du texel COUVERT le plus proche.
    Constat E-1 (2026-10-03) : remplace cv2.inpaint TELEA sur les atlas de to_glb. Les texels couverts ne
    sont JAMAIS ecrits (copie, puis affectation aux seuls texels vides). Les etiquettes de
    cv2.distanceTransformWithLabels sont calculees UNE fois pour toutes les images (H x W ou H x W x C,
    uint8). Atlas sans aucun texel couvert ou sans vide : images rendues telles quelles."""
    import cv2
    import numpy as np
    vide = np.ascontiguousarray(masque_vide != 0, dtype=np.uint8)
    couvert = np.flatnonzero(vide.reshape(-1) == 0)
    a_remplir = np.flatnonzero(vide.reshape(-1) != 0)
    if len(couvert) == 0 or len(a_remplir) == 0:
        return [np.ascontiguousarray(np.array(im, copy=True)) for im in images]
    _, etiquettes = cv2.distanceTransformWithLabels(vide, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    # l'etiquette k (a partir de 1) designe le k-ieme texel couvert dans l'ordre de balayage
    lab = etiquettes.reshape(-1)
    # Garde (relecture independante, 2026-10-03) : cette hypothese de numerotation est VERIFIEE a chaque appel (echantillon de ~4 000 texels couverts, premier et dernier compris).
    # Si une autre version d'OpenCV (image Modal) la changeait, on leve : _remplir_atlas retombe alors sur TELEA au lieu de copier des couleurs fausses.
    pas = max(1, len(couvert) // 4096)
    echantillon = np.unique(np.concatenate([np.arange(0, len(couvert), pas), [len(couvert) - 1]])).astype(np.int64)
    if not np.array_equal(lab[couvert[echantillon]].astype(np.int64), echantillon + 1):
        raise ValueError('numerotation inattendue des etiquettes de cv2.distanceTransformWithLabels')
    source = couvert[lab[a_remplir].astype(np.int64) - 1]
    sortie = []
    for im in images:
        o = np.ascontiguousarray(np.array(im, copy=True))
        plat = o.reshape(o.shape[0] * o.shape[1], -1)
        plat[a_remplir] = plat[source]
        sortie.append(o)
    return sortie


def _remplir_atlas(mask_inv, base_color, metallic, roughness, alpha, log=print):
    """Appel injecte dans to_glb (voir _INPAINT_APRES_PROCHE) : rend couleur, metal, rugosite, alpha en
    H x W (le texte injecte rajoute l'axe de canal). Toute exception -> TELEA fusionne d'avant."""
    import numpy as np
    try:
        m2 = [np.asarray(x).reshape(x.shape[0], x.shape[1]) for x in (metallic, roughness, alpha)]
        c, a, b, d = remplir_bord_proche(mask_inv, base_color, *m2)
        return c, a, b, d
    except Exception as e:
        log(f"[mesh] remplissage au bord le plus proche ignore ({type(e).__name__}: {e}) : TELEA")
        import cv2
        m2 = [np.asarray(x).reshape(x.shape[0], x.shape[1]) for x in (metallic, roughness, alpha)]
        c = cv2.inpaint(base_color, mask_inv, 3, cv2.INPAINT_TELEA)
        mra = cv2.inpaint(np.ascontiguousarray(np.dstack(m2)), mask_inv, 1, cv2.INPAINT_TELEA)
        return c, mra[..., 0], mra[..., 1], mra[..., 2]


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

def reduire_et_recuire(m, cible, taille=None, log=print):
    """TRIANGLE COUNT (2026-09-29, user : « l'outil Triangle count doit aussi l'utiliser ») : reduit la FORME
    SEULE par meshoptimizer (forme tres bien conservee, jugee sur ane et cabane 10 M -> 1 K), redeplie (xatlas)
    et RECUIT la couleur depuis le maillage texture d'origine (couleur du point de surface le plus proche).
    Reduire le maillage texture tel quel deplace les coutures d'UV : texture dechiree (essai du jour).
    Rend un trimesh.Trimesh texture ; ImportError si xatlas / scipy / cv2 manquent (l'appelant garde
    l'ancienne methode). Identique bureau / serveur.

    2026-10-03 (constat E-3b, campagne des outils 3D) : `taille=None` (defaut) CONSERVE la taille de la
    texture d'origine (plafond 8192, plancher 256). Avant, les appelants passaient 2048 : une texture de
    4096 ou 8192 etait ramenee a 2048 SANS prevenir. Un entier explicite reste respecte."""
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
    if taille is None:
        taille = int(min(8192, max(256, max(H, W))))
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
    out = np.zeros((T, T, 3), np.float32)
    rempli = np.zeros((T, T), np.uint8)
    # par tranches (2026-10-03, E-3b) : a 8192 il y a des dizaines de millions de points ; la requete
    # d'un seul bloc (k 4 voisins + col[k]) pesait plusieurs Go. Meme resultat, pic memoire borne.
    for d in range(0, len(P), 2_000_000):
        _, k = arbre.query(P[d:d + 2_000_000], k=4, workers=-1)
        q = Q[d:d + 2_000_000]
        out[q[:, 1], q[:, 0]] = col[k].mean(1)
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

def lisser_soude(g, iterations, lamb, volume_constraint=False):
    """LISSAGE LAPLACIEN SUR LA TOPOLOGIE SOUDEE PAR POSITION (2026-10-03, constats P4 et defauts 1-2 de la
    campagne des outils 3D). Un maillage texture TRELLIS duplique ses sommets le long des coutures d'UV :
    `merge_vertices` ne les soude pas (UV differents), donc `filter_laplacian` lisse chaque ilot comme une
    surface OUVERTE, deplace les deux cotes d'une couture de facon differente et DECHIRE le maillage (mesure :
    33 composantes -> 3 279, aretes de bord 0 -> 19 379). Ici : soudure par position, lissage du maillage
    soude, puis report de la position lissee sur TOUS les doubles (les coutures restent fermees, les UV
    ne bougent pas). Modifie g.vertices sur place ; leve si le resultat n'est pas fini. Rend le nombre
    de sommets soudes."""
    import numpy as np
    import trimesh
    V = np.asarray(g.vertices, dtype=np.float64)
    F = np.asarray(g.faces)
    etendue = float(np.linalg.norm(V.max(0) - V.min(0)))
    if not np.isfinite(etendue) or etendue <= 0:
        etendue = 1.0
    q = np.round(V / (etendue * 1e-7)).astype(np.int64)
    _, premier, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    soude = trimesh.Trimesh(V[premier], inv[F], process=False)
    trimesh.smoothing.filter_laplacian(soude, iterations=int(iterations), lamb=float(lamb),
                                       volume_constraint=volume_constraint)
    nouveaux = np.asarray(soude.vertices)[inv]
    if not np.isfinite(nouveaux).all():
        raise ValueError('smooth produced NaN')
    g.vertices = nouveaux
    return int(len(premier))


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


# ======================================================================================================
# 4. RETRAIT DE LA DALLE DE SOL ET DU SOCLE (2026-10-03, audit de fidelite) -- voir l'en-tete du fichier
# ======================================================================================================
# Fonctions PURES (numpy ; scipy et cv2 les accelerent quand ils sont la, repli numpy pur pour les composantes connexes
# et la silhouette) : elles
# ne chargent aucun modele et ne touchent ni au GPU ni au reseau. L'appelant decide de leur emploi
# (`type_concerne`) : un batiment, un vehicule ou une arme a legitimement des planchers et des dalles.

import contextlib as _contextlib
import threading as _threading

TYPES_CONCERNES = ('character', 'creature', 'animal')     # types d'actif vivants (index2.js : np-asset-type)

# Reglages (fractions de la hauteur totale T sauf mention contraire). Calibres le 2026-10-03 sur l'orc du
# proprietaire, un sanglier et 36 autres maillages reels : voir build/bancs/fidelite/dalle_sol_campagne.py.
REGLAGES_DALLE = {
    'faces_min': 300,            # sous ce nombre de faces : rien n'est tente
    'cos_horizontal': 0.9,       # |n_haut| >= 0,9 : face « quasi horizontale » (26 degres)
    'fenetre': 0.02,             # epaisseur de la fenetre de recherche de la dalle (2 % de T)
    'bande_demi': 0.01,          # demi-largeur de la bande de selection autour de la hauteur de la dalle
    'hauteur_max': 0.35,         # la dalle est dans le tiers inferieur : centre de fenetre sous 35 % de T
    'part_min': 0.04,            # la fenetre porte au moins 4 % de l'aire totale en faces horizontales
    'composante_min': 0.01,      # une composante de la dalle pese au moins 1 % de l'aire totale (ou 20 % de la plus grosse)
    'ratio_min': 3.0,            # aire d'UNE face de la dalle / aire de la silhouette du corps vue de dessus
    'dessus_min': 0.10,          # au moins 10 % des faces au-dessus de la ligne de coupe (il y a un corps)
    'marge_coupe': 0.0025,       # la coupe passe 0,25 % de T au-dessus du sommet de la dalle (bruit de surface)
    'profondeur_socle_max': 0.15,   # le socle retire ne descend pas sous 15 % de T (au-dela : feuille seule)
    'conserve_min': 0.03,        # garde-fou : jamais moins de 3 % des faces gardees
}
NB_CASES_HAUTEUR = 1000


def type_concerne(type_actif) -> bool:
    """Vrai si le type d'actif (identifiant de l'interface : « character », « creature », « animal ») est
    un type vivant pour lequel le retrait de la dalle de sol est pertinent."""
    return str(type_actif or '').strip().lower() in TYPES_CONCERNES


def _verifier_entrees(sommets, faces, axe_haut):
    import numpy as np
    V = np.asarray(sommets)
    F = np.asarray(faces)
    if V.size == 0:
        V = V.reshape(0, 3)
    if F.size == 0:
        F = F.reshape(0, 3)
    if V.ndim != 2 or V.shape[1] != 3:
        raise ValueError('sommets : tableau (n, 3) attendu, recu %s' % (V.shape,))
    if F.ndim != 2 or F.shape[1] != 3:
        raise ValueError('faces : tableau (m, 3) attendu, recu %s' % (F.shape,))
    if axe_haut not in (0, 1, 2):
        raise ValueError('axe_haut doit valoir 0, 1 ou 2 (recu %r)' % (axe_haut,))
    if F.size and not np.issubdtype(F.dtype, np.integer):
        raise ValueError('faces : indices entiers attendus')
    if F.size and (int(F.min()) < 0 or int(F.max()) >= len(V)):
        raise ValueError('faces : indice de sommet hors limites')
    return V, F


def _geometrie_faces(V, F, axe, bloc=1_000_000):
    """(centres (m,3) float64, composante « haut » de la normale unitaire (m,), aires (m,)) -- par blocs."""
    import numpy as np
    m = len(F)
    centres = np.empty((m, 3), np.float64)
    nh = np.zeros(m, np.float64)
    aires = np.empty(m, np.float64)
    for d in range(0, m, bloc):
        P = V[F[d:d + bloc]].astype(np.float64)
        centres[d:d + bloc] = P.mean(axis=1)
        cr = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        n2 = np.sqrt((cr * cr).sum(axis=1))
        aires[d:d + bloc] = 0.5 * n2
        np.divide(cr[:, axe], n2, out=nh[d:d + bloc], where=n2 > 0)
    return centres, nh, aires


def _percentile_pondere(valeurs, poids, q):
    import numpy as np
    o = np.argsort(valeurs, kind='stable')
    cum = np.cumsum(poids[o])
    k = int(np.searchsorted(cum, q * cum[-1]))
    return float(valeurs[o][min(k, len(o) - 1)])


def _etiquettes_numpy(a, b, n):
    """Composantes connexes d'un graphe (aretes a[i]-b[i], n noeuds) en numpy pur : etiquette minimale par
    accrochage des racines et saut de pointeurs. Repli de scipy.sparse.csgraph (meme resultat a la numerotation pres)."""
    import numpy as np
    lab = np.arange(n, dtype=np.int64)
    while True:
        la, lb = lab[a], lab[b]
        diff = la != lb
        if not diff.any():
            return lab
        la, lb = la[diff], lb[diff]
        m = np.minimum(la, lb)
        np.minimum.at(lab, la, m)
        np.minimum.at(lab, lb, m)
        while True:
            suivant = lab[lab]
            if np.array_equal(suivant, lab):
                break
            lab = suivant


def _composantes_faces(V, Fs, etendue):
    """Etiquette (une par face de Fs) de la composante connexe, les sommets confondus en POSITION etant soudes
    d'abord : un maillage texture duplique ses sommets le long des coutures d'UV (piege documente), sans la soudure
    chaque ilot d'UV serait une composante a part."""
    import numpy as np
    n = len(Fs)
    if n == 0:
        return np.zeros(0, np.int64)
    pts = V[Fs.reshape(-1)].astype(np.float64)
    tol = max(float(etendue) * 1e-6, 1e-12)
    q = np.round((pts - pts.min(axis=0)) / tol).astype(np.int64)
    cle = (q[:, 0] << 42) | (q[:, 1] << 21) | q[:, 2]            # chaque axe < 2**21 : cle exacte sur 63 bits
    _, inv = np.unique(cle, return_inverse=True)
    W = inv.reshape(n, 3).astype(np.int64)
    nb = int(W.max()) + 1
    a = np.concatenate([W[:, 0], W[:, 1], W[:, 2]])
    b = np.concatenate([W[:, 1], W[:, 2], W[:, 0]])
    try:
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import connected_components
        g = coo_matrix((np.ones(len(a), np.int8), (a, b)), shape=(nb, nb))
        _, lab = connected_components(g, directed=False)
    except ImportError:
        lab = _etiquettes_numpy(a, b, nb)
    return lab[W[:, 0]]


def _fermer_remplir_numpy(img):
    """Repli sans cv2 : fermeture 3 x 3 (dilatation puis erosion, bords neutres comme cv2) et remplissage des trous par
    inondation 4-connexe depuis le bord. `img` (G, G) 0/1 ; rend un tableau bool (G + 2, G + 2) : vrai = interieur de la forme."""
    import numpy as np

    def decale(a, dy, dx, bord):
        h, w = a.shape
        return np.pad(a, 1, constant_values=bord)[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
    a = img.astype(bool)
    d = a.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            d |= decale(a, dy, dx, False)
    e = d.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            e &= decale(d, dy, dx, True)
    fond = ~np.pad(e, 1)
    ext = np.zeros_like(fond)
    ext[0, :] = ext[-1, :] = ext[:, 0] = ext[:, -1] = True
    ext &= fond
    while True:
        suite = ext.copy()
        suite[1:, :] |= ext[:-1, :]
        suite[:-1, :] |= ext[1:, :]
        suite[:, 1:] |= ext[:, :-1]
        suite[:, :-1] |= ext[:, 1:]
        suite &= fond
        if np.array_equal(suite, ext):
            return ~ext
        ext = suite


def _aire_silhouette(x, y, moteur='auto'):
    """Aire de la silhouette REMPLIE d'un nuage de points (x, y) : grille adaptee a la densite, fermeture 3 x 3,
    remplissage des trous par inondation depuis le bord (la peau d'un corps vue de dessus est un anneau creux).
    cv2 si present (moteur 'auto' ou 'cv2'), sinon numpy pur (meme resultat, verifie par le test)."""
    import numpy as np
    n = len(x)
    if n == 0:
        return 0.0
    G = int(np.clip(np.sqrt(n / 4.0), 8, 128))
    x0, x1, y0, y1 = float(x.min()), float(x.max()), float(y.min()), float(y.max())
    cote = max(x1 - x0, y1 - y0, 1e-12)
    cell = cote / G
    ix = np.minimum(((x - x0) / cell).astype(np.int64), G - 1)
    iy = np.minimum(((y - y0) / cell).astype(np.int64), G - 1)
    img = np.zeros((G, G), np.uint8)
    img[iy, ix] = 1
    cv2 = None
    if moteur != 'numpy':
        try:
            import cv2
        except ImportError:
            cv2 = None
    if cv2 is None:
        return float(_fermer_remplir_numpy(img).sum()) * cell * cell
    img = cv2.morphologyEx(img, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    pad = (np.pad(img, 1) * 255).astype(np.uint8)
    masque = np.zeros((pad.shape[0] + 2, pad.shape[1] + 2), np.uint8)
    cv2.floodFill(pad, masque, (0, 0), 128)
    return float((pad != 128).sum()) * cell * cell


def _pts_silhouette(V, F, centres, idx, axes, maxi=1_200_000):
    """Centres + sommets des faces idx (sous-echantillon regulier au-dela de `maxi` points)."""
    import numpy as np
    pas = max(1, (4 * len(idx)) // maxi)
    sel = idx[::pas]
    x = np.concatenate([centres[sel, axes[0]]] + [V[F[sel, j], axes[0]].astype(np.float64) for j in range(3)])
    y = np.concatenate([centres[sel, axes[1]]] + [V[F[sel, j], axes[1]].astype(np.float64) for j in range(3)])
    return x, y


def _rebord_dalle(centres, h, axes, est_dalle, h_bas, h_sommet, T, etendue):
    """Faces de la bande de la dalle (n'importe quelle normale : tranche de la feuille) situees HORS de l'empreinte du
    reste du maillage (corps, rocher) : le rebord libre de la feuille. Rend un masque bool (m,)."""
    import numpy as np
    bande = (h >= h_bas - 0.0015 * T) & (h <= h_sommet + 0.0015 * T)
    reste = np.flatnonzero(~bande)
    if len(reste) == 0:
        return np.zeros(len(h), bool)
    ctr = centres[reste[::max(1, len(reste) // 400_000)]][:, axes]
    lo, hi = np.percentile(ctr, 0.1, axis=0), np.percentile(ctr, 99.9, axis=0)
    marge = 0.02 * etendue
    hors = ((centres[:, axes[0]] < lo[0] - marge) | (centres[:, axes[0]] > hi[0] + marge)
            | (centres[:, axes[1]] < lo[1] - marge) | (centres[:, axes[1]] > hi[1] + marge))
    return bande & hors & ~est_dalle


def _fenetres_candidates(ah, A, K, nb, r, maxi=4):
    """Les fenetres de K cases (K/nb de la hauteur) les plus chargees en aire horizontale, sans recouvrement, centrees
    sous `hauteur_max` et portant au moins `part_min` de l'aire totale. Rend [(case de debut, part de l'aire)]."""
    import numpy as np
    cs = np.concatenate([[0.0], np.cumsum(ah)])
    fen = cs[K:] - cs[:-K]
    centres_fen = (np.arange(len(fen)) + K / 2.0) / nb
    fen = np.where(centres_fen <= r['hauteur_max'], fen, -1.0)
    res = []
    for _ in range(maxi):
        k0 = int(np.argmax(fen))
        if fen[k0] < r['part_min'] * A:
            break
        res.append((k0, float(fen[k0] / A)))
        fen[max(0, k0 - K):k0 + K + 1] = -1.0
    return res


def _evaluer_candidat(k0, part, K, nb, g, r):
    """Une fenetre candidate : la dalle (composantes connexes de faces horizontales), la ligne de coupe, et le rapport entre
    l'aire d'UNE face de la dalle et la silhouette du corps au-dessus. Rend (info, D) ; info['accepte'] dit si c'est une dalle."""
    import numpy as np
    h, horiz, nh, aires, T, A = g['h'], g['horiz'], g['nh'], g['aires'], g['T'], g['A']
    c = {'hauteur_fenetre': float((k0 + K / 2.0) / nb), 'part_horizontale': float(part), 'accepte': False}
    dans = horiz & (g['case'] >= k0) & (g['case'] < k0 + K)
    if not dans.any():
        c['raison'] = 'fenetre vide'
        return c, None
    hm = float(np.average(h[dans], weights=aires[dans]))
    idx = np.flatnonzero(horiz & (np.abs(h - hm) <= r['bande_demi'] * T))
    if len(idx) == 0:                         # deux nappes aux deux bords de la fenetre : la moyenne tombe entre elles
        c['raison'] = 'aucune face horizontale autour de la hauteur moyenne'
        return c, None
    lab = _composantes_faces(g['V'], g['F'][idx], g['etendue'])
    aire_c = np.bincount(lab, weights=aires[idx])
    gros = aire_c >= max(r['composante_min'] * A, 0.2 * float(aire_c.max()))
    D = idx[gros[lab]]
    if len(D) == 0 or float(aires[D].sum()) < r['part_min'] * A * 0.5:
        c['raison'] = 'aucune composante horizontale assez grosse'
        return c, None
    a_haut = float(aires[D][nh[D] > 0].sum())
    a_bas = float(aires[D][nh[D] < 0].sum())
    hd = h[D]
    h_sommet = _percentile_pondere(hd, aires[D], 0.99)
    h_bas = _percentile_pondere(hd, aires[D], 0.01)
    coupe = h_sommet + r['marge_coupe'] * T                    # la « ligne des pieds » : rien n'est retire au-dessus
    Vd = g['V'][np.unique(g['F'][D].reshape(-1))]
    axes = g['axes']
    c.update(hauteur=float(g['hmin'] + hm), fraction=float(hm / T), epaisseur=float(h_sommet - h_bas),
             faces=int(len(D)), composantes=int(gros.sum()), aire_pct=float(100 * aires[D].sum() / A),
             aire_une_face=max(a_haut, a_bas), double_face=bool(min(a_haut, a_bas) >= 0.2 * max(a_haut, a_bas, 1e-300)),
             etendue=[float(np.ptp(Vd[:, axes[0]])), float(np.ptp(Vd[:, axes[1]]))],
             coupe=float(coupe), coupe_fraction=float(coupe / T), h_bas=float(h_bas), h_sommet=float(h_sommet))
    au = np.flatnonzero(h > coupe)
    if len(au) < max(r['dessus_min'] * len(g['F']), 50):
        c['raison'] = 'presque rien au-dessus de la dalle (%d faces)' % len(au)
        return c, D
    x, y = _pts_silhouette(g['V'], g['F'], g['centres'], au, axes)
    sil = _aire_silhouette(x, y)
    ratio = c['aire_une_face'] / max(sil, 1e-300)
    pa, pb = np.percentile(x, [0.5, 99.5]), np.percentile(y, [0.5, 99.5])
    c.update(ratio_empreinte=float(ratio),
             empreinte_corps={'axes': list(axes), 'etendue': [float(pa[1] - pa[0]), float(pb[1] - pb[0])],
                              'minimum': [float(pa[0]), float(pb[0])], 'maximum': [float(pa[1]), float(pb[1])],
                              'aire_silhouette': float(sil), 'faces_au_dessus': int(len(au))})
    if ratio < r['ratio_min']:
        c['raison'] = 'la bande horizontale ne deborde pas du corps (rapport %.2f < %.1f)' % (ratio, r['ratio_min'])
        return c, D
    c['accepte'] = True
    return c, D


def _analyser_dalle(V, F, axe, conserver_socle, r):
    """Coeur : (retire (m,) bool ou None, info dict). `info` est toujours renseigne (diagnostic compris)."""
    import time
    import numpy as np
    t0 = time.time()
    m = len(F)
    info = {'faces': int(m), 'axe_haut': int(axe), 'conserver_socle': bool(conserver_socle)}

    def non(raison):
        info['decision'] = 'inchange'
        info['raison'] = raison
        info['duree_s'] = round(time.time() - t0, 3)
        return None, info

    if m < r['faces_min']:
        return non('maillage trop petit (%d faces)' % m)
    marque = np.zeros(len(V), bool)
    marque[F.reshape(-1)] = True
    Vu = V[marque]
    if not np.isfinite(Vu).all():
        return non('sommets non finis')
    hmin, hmax = float(Vu[:, axe].min()), float(Vu[:, axe].max())
    T = hmax - hmin
    etendue = float((Vu.max(axis=0) - Vu.min(axis=0)).max())
    del Vu
    if not T > 0:
        return non('hauteur nulle')
    axes = [i for i in range(3) if i != axe]
    centres, nh, aires = _geometrie_faces(V, F, axe)
    A = float(aires.sum())
    if not A > 0:
        return non('aire nulle')
    info.update(hauteur_totale=T, hauteur_min=hmin, aire_totale=A)
    h = centres[:, axe] - hmin
    horiz = np.abs(nh) >= r['cos_horizontal']

    # --- 1. les bandes horizontales les plus chargees dans le tiers inferieur (une dalle, ou le dessus et le dessous d'un socle plein)
    nb = NB_CASES_HAUTEUR
    case = np.clip((h / T * nb).astype(np.int64), 0, nb - 1)
    ah = np.bincount(case[horiz], weights=aires[horiz], minlength=nb)
    K = max(2, int(round(r['fenetre'] * nb)))
    fenetres = _fenetres_candidates(ah, A, K, nb, r)
    if not fenetres:
        cs = np.concatenate([[0.0], np.cumsum(ah)])
        fen = cs[K:] - cs[:-K]
        ok = (np.arange(len(fen)) + K / 2.0) / nb <= r['hauteur_max']
        part = float(fen[ok].max() / A) if ok.any() else 0.0
        info['part_horizontale'] = part
        return non('aucune bande horizontale assez chargee (%.1f %% de l\'aire)' % (100 * part))
    info['part_horizontale'] = fenetres[0][1]

    # --- 2. chaque bande : une dalle si elle DEBORDE largement la silhouette du corps qui est au-dessus
    g = dict(V=V, F=F, centres=centres, nh=nh, aires=aires, h=h, horiz=horiz, case=case, T=T, A=A, hmin=hmin,
             etendue=etendue, axes=axes)
    candidats, bandes = [], []
    for k0, part in fenetres:
        c, D = _evaluer_candidat(k0, part, K, nb, g, r)
        candidats.append(c)
        bandes.append(D)
    info['candidats'] = candidats
    acceptes = [i for i, c in enumerate(candidats) if c['accepte']]
    if not acceptes:
        principal = candidats[0]
        return non(principal.get('raison', 'aucune dalle'))

    # --- 3. choix de la ligne des pieds
    criteres = ['plan_mince']
    limite = r['profondeur_socle_max'] * T
    if conserver_socle:
        # la feuille la plus basse, a DEUX faces (une feuille mince) ; un dessus de socle plein n'est pas touche
        doubles = [i for i in acceptes if candidats[i]['double_face']]
        if not doubles:
            return non('aucune dalle a deux faces : socle probable, conserve (conserver_socle)')
        choix = min(doubles, key=lambda i: candidats[i]['coupe'])
        mode = 'dalle_seule'
        criteres.append('socle_conserve')
    else:
        dans_limite = [i for i in acceptes if candidats[i]['coupe'] <= limite]
        if dans_limite:
            choix = max(dans_limite, key=lambda i: candidats[i]['coupe'])    # la plus haute : un socle plein a un dessus ET un dessous
            mode = 'socle_retire'
        else:
            doubles = [i for i in acceptes if candidats[i]['double_face']]
            if not doubles:
                return non('feuille a une seule face trop haute : ce qui est dessous pourrait etre le corps')
            choix = min(doubles, key=lambda i: candidats[i]['coupe'])
            mode = 'dalle_seule'
            criteres.append('socle_trop_profond')   # la feuille est trop haute : ce qui est dessous pourrait etre le corps
    dalle = candidats[choix]
    coupe = dalle['coupe']

    # --- 4. ce qui part
    est_dalle = np.zeros(m, bool)
    for i in acceptes:
        if candidats[i]['coupe'] <= coupe:
            est_dalle[bandes[i]] = True
    rebord = _rebord_dalle(centres, h, axes, est_dalle, dalle['h_bas'], dalle['h_sommet'], T, etendue)
    if mode == 'socle_retire':
        sous = h < coupe                         # tout ce qui est sous la ligne des pieds : feuille, rocher, socle
        retire = sous
        socle = int(np.count_nonzero(sous & ~est_dalle & ~rebord))
        if socle >= max(50, int(0.002 * m)):
            criteres.append('socle_epais')
        info['socle'] = {'profondeur': float(coupe), 'faces': socle}
    else:
        est_dalle = np.zeros(m, bool)
        est_dalle[bandes[choix]] = True          # une seule feuille : la tranche libre se calcule sur elle
        rebord = _rebord_dalle(centres, h, axes, est_dalle, dalle['h_bas'], dalle['h_sommet'], T, etendue)
        retire = est_dalle | rebord
        if rebord.any():
            criteres.append('rebord')
    nb_retire = int(retire.sum())
    if nb_retire == 0:
        return non('rien a retirer')
    if m - nb_retire < max(100, r['conserve_min'] * m):
        return non('retrait excessif refuse (%d faces gardees sur %d)' % (m - nb_retire, m))
    a_ret = float(aires[retire].sum())
    dalle_pub = {k: v for k, v in dalle.items() if k not in ('empreinte_corps', 'accepte', 'coupe', 'coupe_fraction', 'h_bas', 'h_sommet')}
    info['dalle'] = dalle_pub
    info['empreinte_corps'] = dalle['empreinte_corps']
    info.update(decision='retire', mode=mode, criteres=criteres, faces_retirees=nb_retire,
                faces_retirees_pct=float(100 * nb_retire / m), aire_retiree=a_ret, aire_retiree_pct=float(100 * a_ret / A),
                ligne_pieds={'hauteur': float(hmin + coupe), 'fraction': float(coupe / T)},
                duree_s=round(time.time() - t0, 3))
    return retire, info


def analyser_dalle_sol(sommets, faces, axe_haut=1, conserver_socle=False, **reglages):
    """Comme masque_dalle_sol mais rend (garder, info) avec `info` TOUJOURS renseigne (decision, raison du refus,
    mesures intermediaires : part horizontale de la fenetre, rapport d'empreinte...). Sert au banc de calibrage."""
    import numpy as np
    r = _reglages(reglages)
    V, F = _verifier_entrees(sommets, faces, axe_haut)
    retire, info = _analyser_dalle(V, F, axe_haut, conserver_socle, r)
    if retire is None:
        return np.ones(len(F), bool), info
    return ~retire, info


def _reglages(reglages):
    inconnus = set(reglages) - set(REGLAGES_DALLE)
    if inconnus:
        raise TypeError('reglages inconnus : %s' % sorted(inconnus))
    r = dict(REGLAGES_DALLE)
    r.update(reglages)
    return r


def masque_dalle_sol(sommets, faces, axe_haut=1, conserver_socle=False, diagnostic=None, **reglages):
    """Retrait de la dalle de sol et du socle d'un maillage de personnage / creature / animal.

    Rend (garder, rapport) : `garder` = tableau bool par face (True = on garde) ; `rapport` = dict JSON-isable
    (nombre de faces et aire retirees, hauteur de la « ligne des pieds », empreinte du corps, criteres declenches)
    ou {} quand RIEN n'est retire (garder est alors tout vrai : le maillage reste a l'identique).

    CONSERVATEUR : il faut une feuille mince quasi horizontale, dans le tiers inferieur, qui deborde au moins
    3 fois la silhouette du corps vue de dessus. Alors la coupe passe juste au-dessus de la feuille (ligne des
    pieds) et tout ce qui est SOUS elle (feuille, rocher, socle) part ; rien n'est jamais retire au-dessus. Un
    socle plein plus epais que la fenetre a deux feuilles (dessus et dessous) : la plus haute qui deborde le corps
    donne la ligne, le socle entier part. Une base PETITE (moins de 3 fois la silhouette), un siege, une robe
    evasee, un disque en hauteur, un champ de petites dalles : rien ne part.
    `axe_haut` : 0, 1 ou 2 (1 = GLB / glTF, 2 = repere des sommets de cumesh avant to_glb).
    `conserver_socle=True` : seule la feuille (et son rebord) part, le socle reste (usage futur de l'interface).
    `diagnostic` : dict optionnel rempli avec le detail de l'analyse, retrait ou non."""
    garder, info = analyser_dalle_sol(sommets, faces, axe_haut, conserver_socle, **reglages)
    if diagnostic is not None:
        diagnostic.update(info)
    if info.get('decision') != 'retire':
        return garder, {}
    rapport = {k: v for k, v in info.items() if k not in ('decision', 'raison', 'candidats')}
    rapport['faces_total'] = rapport.pop('faces')
    return garder, rapport


def _sous_maillage(g, garder):
    """Nouveau trimesh.Trimesh limite aux faces `garder` : sommets inutiles retires, UV / couleurs / attributs suivent, le
    MATERIAU (textures) est PARTAGE avec `g` (rien n'est copie). Les normales de sommet sont CONSERVEES telles quelles : trimesh
    les recalcule sinon, sommet par sommet, ce qui durcit toutes les coutures d'UV (mesure sur l'orc : 75 % des sommets sont des
    doubles de couture, leurs normales passent de identiques a 0,69 d'ecart moyen). Visuel inconnu : repli sur la copie de trimesh."""
    import numpy as np
    import trimesh
    vis = g.visual
    kind = getattr(vis, 'kind', None)
    if kind not in ('texture', 'vertex', 'face', None):
        nouveau = g.copy()
        nouveau.update_faces(garder)
        nouveau.remove_unreferenced_vertices()
        return nouveau
    V = np.asarray(g.vertices)
    Fk = np.asarray(g.faces)[garder]
    utiles, inv = np.unique(Fk.reshape(-1), return_inverse=True)
    kw = {'vertices': V[utiles], 'faces': inv.reshape(-1, 3), 'process': False}
    try:
        kw['vertex_normals'] = np.asarray(g.vertex_normals)[utiles]
    except Exception:
        pass
    if kind == 'texture' and getattr(vis, 'uv', None) is not None:
        kw['visual'] = trimesh.visual.TextureVisuals(uv=np.asarray(vis.uv)[utiles], material=vis.material)
    elif kind == 'vertex':
        kw['visual'] = trimesh.visual.ColorVisuals(vertex_colors=np.asarray(vis.vertex_colors)[utiles])
    elif kind == 'face':
        kw['visual'] = trimesh.visual.ColorVisuals(face_colors=np.asarray(vis.face_colors)[garder])
    nouveau = trimesh.Trimesh(**kw)
    for nom, val in dict(getattr(g, 'vertex_attributes', None) or {}).items():
        nouveau.vertex_attributes[nom] = np.asarray(val)[utiles]
    for nom, val in dict(getattr(g, 'face_attributes', None) or {}).items():
        nouveau.face_attributes[nom] = np.asarray(val)[garder]
    nouveau.metadata = dict(getattr(g, 'metadata', None) or {})
    nouveau.name = getattr(g, 'name', None)
    return nouveau


def retirer_dalle_sol(maillage, axe_haut=1, conserver_socle=False, **reglages):
    """Version trimesh de masque_dalle_sol : rend (maillage, rapport). `maillage` : trimesh.Trimesh ou trimesh.Scene
    (transformations des noeuds appliquees pour l'analyse, repere monde). Rien a retirer : le MEME objet et {}.
    Le maillage d'entree n'est jamais modifie ; le resultat est un NOUVEAU maillage (UV et normales de sommet conservees,
    textures partagees avec l'entree : ne pas modifier une texture en croyant l'autre intacte)."""
    import numpy as np
    import trimesh
    if isinstance(maillage, trimesh.Scene):
        return _retirer_scene(maillage, axe_haut, conserver_socle, **reglages)
    garder, rapport = masque_dalle_sol(np.asarray(maillage.vertices), np.asarray(maillage.faces), axe_haut,
                                       conserver_socle, **reglages)
    if not rapport:
        return maillage, {}
    return _sous_maillage(maillage, garder), rapport


def _retirer_scene(scene, axe_haut, conserver_socle, **reglages):
    import numpy as np
    noeuds = []
    vus = set()
    for nom_noeud in scene.graph.nodes_geometry:
        T, nom_geo = scene.graph[nom_noeud]
        g = scene.geometry.get(nom_geo)
        if g is None or not hasattr(g, 'faces') or len(g.faces) == 0:
            continue
        if nom_geo in vus:
            return scene, {}                      # geometrie instanciee plusieurs fois : non prise en charge, rien n'est touche
        vus.add(nom_geo)
        noeuds.append((nom_geo, g, np.asarray(T, np.float64)))
    if not noeuds:
        return scene, {}
    Vs, Fs, borne = [], [], [0]
    deca = 0
    for _, g, T in noeuds:
        v = np.asarray(g.vertices, np.float64) @ T[:3, :3].T + T[:3, 3]
        Vs.append(v)
        Fs.append(np.asarray(g.faces, np.int64) + deca)
        deca += len(v)
        borne.append(borne[-1] + len(g.faces))
    garder, rapport = masque_dalle_sol(np.concatenate(Vs), np.concatenate(Fs), axe_haut, conserver_socle, **reglages)
    if not rapport:
        return scene, {}
    nouvelle = scene.copy()
    for (nom_geo, g, _), a, b in zip(noeuds, borne[:-1], borne[1:]):
        gk = garder[a:b]
        if gk.all():
            continue
        if not gk.any():
            nouvelle.delete_geometry(nom_geo)
        else:
            nouvelle.geometry[nom_geo] = _sous_maillage(nouvelle.geometry[nom_geo], gk)
    return nouvelle, rapport


# ---- Branchement AVANT le depliage UV de o_voxel.postprocess.to_glb (la seule position qui redonne de l'atlas
# au corps : le depliage repartit l'atlas selon l'aire de surface, la dalle et le socle en prennent 65 %).
# Dans to_glb, `mesh` est un cumesh.CuMesh dans le repere des sommets de TRELLIS (Z vers le haut : to_glb ne
# permute y et z qu'a la FIN) : axe_haut=2. Le crochet enveloppe CuMesh.uv_unwrap, qu'appellent les deux branches
# de to_glb (avec et sans remaillage) : aucun texte de to_glb a rechercher, donc rien a casser si la bibliotheque change.

def _en_numpy(x):
    import numpy as np
    return x.detach().cpu().numpy() if hasattr(x, 'detach') else np.asarray(x)


def retirer_dalle_cumesh(mesh, axe_haut=2, conserver_socle=False, log=print, **reglages):
    """Retire la dalle de sol d'un cumesh.CuMesh : lecture `mesh.read()`, reinitialisation `mesh.init()` avec les
    seules faces gardees (meme schema que _reduire_sans_plis). Rend le rapport ({} si rien n'est retire).
    NE LEVE JAMAIS : au pire le maillage reste tel quel et la raison est journalisee."""
    try:
        import numpy as np
        v, f = mesh.read()
        vn = _en_numpy(v)
        f_np = _en_numpy(f)
        fn = f_np.astype(np.int64)
        garder, rapport = masque_dalle_sol(vn, fn, axe_haut, conserver_socle, **reglages)
        if not rapport:
            return {}
        utiles, inv = np.unique(fn[garder].reshape(-1), return_inverse=True)
        v2 = np.ascontiguousarray(vn[utiles])
        f2 = np.ascontiguousarray(inv.reshape(-1, 3).astype(f_np.dtype))
        if hasattr(v, 'detach'):
            import torch
            mesh.init(torch.from_numpy(v2).to(device=v.device, dtype=v.dtype),
                      torch.from_numpy(f2).to(device=f.device, dtype=f.dtype))
        else:
            mesh.init(v2, f2)
        log("[mesh] dalle de sol retiree : %d faces (%.1f %%), %.1f %% de l'aire, ligne des pieds a %.1f %% de la hauteur (%s)"
            % (rapport['faces_retirees'], rapport['faces_retirees_pct'], rapport['aire_retiree_pct'],
               100 * rapport['ligne_pieds']['fraction'], '+'.join(rapport['criteres'])))
        return rapport
    except Exception as e:
        log("[mesh] dalle de sol : retrait ignore (%s: %s)" % (type(e).__name__, e))
        return {}


class _EtatRetrait(_threading.local):
    actif = False
    conserver_socle = False
    axe_haut = 2
    log = None
    reglages = None
    rapports = None


_ETAT_RETRAIT = _EtatRetrait()


def _avant_depliage(mesh):
    e = _ETAT_RETRAIT
    if not e.actif or getattr(mesh, '_dalle_traitee', False):
        return
    try:
        mesh._dalle_traitee = True            # une seule passe par maillage, meme si le depliage est rejoue
    except Exception:
        pass
    rapport = retirer_dalle_cumesh(mesh, e.axe_haut, e.conserver_socle, e.log or print, **(e.reglages or {}))
    if rapport and e.rapports is not None:
        e.rapports.append(rapport)


def installer_retrait_dalle(cumesh_module=None, log=print) -> bool:
    """Enveloppe (une fois) cumesh.CuMesh.uv_unwrap : tant qu'un `retrait_dalle_actif` est ouvert dans le fil courant,
    la dalle est retiree juste avant le depliage. Hors contexte le crochet ne fait rien. Rend False (journal) si cumesh
    est absent ou refuse l'enveloppe."""
    try:
        if cumesh_module is None:
            import cumesh as cumesh_module
        cls = cumesh_module.CuMesh
        if getattr(cls, '_fabmesh_retrait_dalle', False):
            return True
        original = cls.uv_unwrap

        def uv_unwrap(self, *args, **kwargs):
            _avant_depliage(self)
            return original(self, *args, **kwargs)
        uv_unwrap.__wrapped__ = original
        cls.uv_unwrap = uv_unwrap
        cls._fabmesh_retrait_dalle = True
        return True
    except Exception as e:
        log("[mesh] dalle de sol : crochet du depliage impossible (%s: %s)" % (type(e).__name__, e))
        return False


@_contextlib.contextmanager
def retrait_dalle_actif(actif=True, conserver_socle=False, axe_haut=2, log=print, cumesh_module=None, **reglages):
    """Contexte d'une generation : `with retrait_dalle_actif(type_concerne(type_actif), log=log) as rapports: ...to_glb...`.
    Hors de ce contexte (ou actif=False), to_glb se comporte exactement comme avant. `rapports` : liste des rapports
    (un par maillage depliee dans le contexte). L'etat est propre au fil et remis a zero a la sortie, meme sur exception."""
    if not actif:
        yield []
        return
    e = _ETAT_RETRAIT
    ancien = (e.actif, e.conserver_socle, e.axe_haut, e.log, e.reglages, e.rapports)
    rapports = []
    installe = installer_retrait_dalle(cumesh_module, log)
    e.actif, e.conserver_socle, e.axe_haut, e.log, e.reglages, e.rapports = installe, conserver_socle, axe_haut, log, reglages, rapports
    try:
        yield rapports
    finally:
        e.actif, e.conserver_socle, e.axe_haut, e.log, e.reglages, e.rapports = ancien
