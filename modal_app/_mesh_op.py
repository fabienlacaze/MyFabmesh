"""Cloud port of the desktop mesh quick-edit tools.

Smooth, Decimate, Center, Fix Normals, Fill Holes — all pure trimesh
CPU operations on the GLB. No GPU needed, no Modal class @enter cost.
These can run inside the lightweight mesh_start function (which also
serves the async TRELLIS-2 dispatch).

Most ops return the modified GLB as raw bytes. fill_holes returns a
tuple (bytes, stats_dict) so the client can show a verdict-driven
toast (CLOSED_OK / OPEN_HOLES / WINDING_INCONSISTENT /
NONMANIFOLD_OR_DOUBLE_SKINNED). The OPS dispatch wraps every other op
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


def _export(scene) -> bytes:
    """Serialize scene back to GLB bytes, preserving WebP textures."""
    buf = io.BytesIO()
    from modal_app.acceleration_glb import webp_rapide; webp_rapide(scene)   # texture couleur 8x plus vite, meme qualite
    scene.export(buf, file_type='glb', extension_webp=True)
    return buf.getvalue()


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
        trimesh.smoothing.filter_laplacian(m, lamb=float(lamb),
                                            iterations=int(iterations))
    return _export(scene)


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
                    r_new = reduire_et_recuire(m, n, 2048, log=lambda t: print(t, flush=True))
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
                        verts, faces, target_reduction=1.0 - ratio)
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
    return _export(scene)


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


def _boucles_de_bord(m):
    """Reconstruit les boucles de bord (trous) d'un maillage.

    Renvoie une liste de listes d'indices de sommets, chaque liste etant
    un cycle ferme. Les aretes de bord sont celles utilisees par UNE
    SEULE face ; on les chaine par sommet partage.

    Sert au filtrage min/max de fill_holes : trimesh.repair.fill_holes
    bouche TOUT, sans notion de taille, alors que l'interface propose
    deux curseurs et colorie l'apercu en vert/gris/rouge selon eux.
    """
    import numpy as np
    if not hasattr(m, 'edges') or len(m.edges) == 0:
        return []
    e = np.sort(m.edges, axis=1)
    uniq, counts = np.unique(e, axis=0, return_counts=True)
    bords = uniq[counts == 1]
    if len(bords) == 0:
        return []

    # Adjacence sommet -> sommets voisins par une arete de bord.
    voisins = {}
    for a, b in bords:
        voisins.setdefault(int(a), []).append(int(b))
        voisins.setdefault(int(b), []).append(int(a))

    vus = set()
    boucles = []
    for depart in list(voisins):
        if depart in vus:
            continue
        boucle = [depart]
        vus.add(depart)
        courant, precedent = depart, None
        while True:
            suivants = [v for v in voisins.get(courant, []) if v != precedent and v not in vus]
            if not suivants:
                # Boucle fermee si on peut revenir au depart.
                if depart in voisins.get(courant, []) and len(boucle) >= 3:
                    boucles.append(boucle)
                break
            precedent, courant = courant, suivants[0]
            boucle.append(courant)
            vus.add(courant)
            if len(boucle) > 200_000:      # garde-fou anti-boucle infinie
                break
    return boucles


def _remplir_boucles_filtrees(m, min_edges, max_edges):
    """Bouche UNIQUEMENT les trous dont le nombre d'aretes est dans
    [min_edges, max_edges], par eventail depuis le premier sommet.

    Renvoie (remplis, trop_petits, trop_grands). Les UV ne sont pas
    etendus : les faces ajoutees heritent du materiau mais pas d'une
    coordonnee de texture propre — meme compromis que trimesh.
    """
    import numpy as np
    boucles = _boucles_de_bord(m)
    if not boucles:
        return 0, 0, 0
    remplis = petits = grands = 0
    nouvelles = []
    for b in boucles:
        n = len(b)
        if n < min_edges:
            petits += 1
            continue
        if n > max_edges:
            grands += 1
            continue
        for i in range(1, n - 1):
            nouvelles.append([b[0], b[i], b[i + 1]])
        remplis += 1
    if nouvelles:
        m.faces = np.vstack([np.asarray(m.faces), np.asarray(nouvelles, dtype=np.int64)])
        try: m._cache.clear()
        except Exception: pass
    return remplis, petits, grands


def _count_boundary_edges(m):
    """Return (boundary_edges, nonmanifold_edges) using a sorted-edges
    unique tally. boundary = edges used by exactly 1 triangle;
    nonmanifold = edges used by >2 triangles (e.g. T-junctions, double
    skin, fan-style stitching)."""
    import numpy as np
    if not hasattr(m, 'edges') or len(m.edges) == 0:
        return 0, 0
    e = np.sort(m.edges, axis=1)
    _, _, counts = np.unique(e, axis=0, return_inverse=True, return_counts=True)
    return int((counts == 1).sum()), int((counts > 2).sum())


def _split_tjunctions(m, tol):
    """Detect T-junctions on boundary edges and split the offending
    edge so the two halves can pair with neighbouring triangles. A
    T-junction is a vertex that lies (within tol) on another boundary
    edge but isn't an endpoint of that edge.

    Cheap approach: build a KDTree over boundary vertex positions, for
    each boundary edge query the tree for points inside its segment
    bounding box, classify hits by point-to-segment distance.

    Returns the number of splits performed. This is a NO-OP on textured
    meshes (UV-aware splitter would need to interpolate UVs at the
    new vertex — out of scope for v1) and on very large meshes.
    """
    import numpy as np
    from scipy.spatial import cKDTree

    if not hasattr(m, 'edges') or len(m.edges) == 0:
        return 0
    e_sorted = np.sort(m.edges, axis=1)
    uniq, inv, counts = np.unique(e_sorted, axis=0, return_inverse=True, return_counts=True)
    bmask = (counts == 1)
    if not bmask.any():
        return 0
    boundary_edges = uniq[bmask]  # (B, 2) vertex index pairs

    boundary_verts = np.unique(boundary_edges.ravel())
    if len(boundary_verts) == 0:
        return 0
    verts = m.vertices[boundary_verts]                  # (V, 3)
    pos2idx = {v: i for i, v in enumerate(boundary_verts.tolist())}
    tree = cKDTree(verts)

    splits = 0
    # For each boundary edge, find points close to the segment (not the
    # endpoints) within tol and split. We don't actually split the edge
    # in-place — trimesh would require re-meshing. Instead we record
    # "phantom" vertex pairs that the merge_vertices in the caller can
    # use on the next pass. Practically: bump the boundary vertex onto
    # the edge by a tiny offset so the next merge_vertices catches it.
    # This trades exactness for safety — no faces are modified.
    bumps = {}  # idx in m.vertices -> new position
    tol_sq = float(tol) ** 2
    for a, b in boundary_edges.tolist():
        pa = m.vertices[a]; pb = m.vertices[b]
        ab = pb - pa
        ab_len_sq = float(np.dot(ab, ab))
        if ab_len_sq < tol_sq * 0.01:
            continue
        midpoint = (pa + pb) * 0.5
        radius = float(np.sqrt(ab_len_sq)) * 0.5 + tol
        # Candidates near the edge's midpoint within radius+tol.
        cand_idx = tree.query_ball_point(midpoint, r=radius)
        for ci in cand_idx:
            v_world_idx = int(boundary_verts[ci])
            if v_world_idx == a or v_world_idx == b:
                continue
            p = m.vertices[v_world_idx]
            ap = p - pa
            t = float(np.dot(ap, ab) / ab_len_sq)
            if t <= 1e-3 or t >= 1.0 - 1e-3:
                continue
            proj = pa + t * ab
            d2 = float(np.dot(p - proj, p - proj))
            if d2 < tol_sq:
                bumps[v_world_idx] = proj
                splits += 1
    if bumps:
        for vi, new_pos in bumps.items():
            m.vertices[vi] = new_pos
        # Snap each bumped vertex onto its target → next merge_vertices
        # collapses the pair, the edge becomes a true boundary.
    return splits


def _aggregate_diag(per_mesh):
    """Decide the single verdict reported to the user from per-mesh
    stats. Priority order — most actionable first:
      WINDING_INCONSISTENT > NONMANIFOLD_OR_DOUBLE_SKINNED > OPEN_HOLES > CLOSED_OK
    """
    if not per_mesh:
        return 'CLOSED_OK'
    has_winding = any(d.get('winding_inconsistent') for d in per_mesh)
    has_double = any(d.get('double_skin') or d.get('nonmanifold_edges_final', 0) > 0 for d in per_mesh)
    has_open = any(d.get('boundary_edges_final', 0) > 0 for d in per_mesh)
    if has_winding:
        return 'WINDING_INCONSISTENT'
    if has_double:
        return 'NONMANIFOLD_OR_DOUBLE_SKINNED'
    if has_open:
        return 'OPEN_HOLES'
    return 'CLOSED_OK'


def fill_holes(glb_bytes: bytes, min_edges: int = 3, max_edges: int = 1_000_000):
    """Diagnostic-first hole filling. Returns (glb_bytes, stats_dict).

    Pipeline per mesh:
      0. Strip degenerate faces + unreferenced verts (mirror cloud client)
      1. Count baseline boundary + non-manifold + winding state
      2. merge_vertices with tol = clamp(bbDiag * 1e-4, 1e-7, bbDiag*1e-2)
      3. T-junction split (gated on size + non-textured to stay safe in v1)
      4. fix_winding + fill_holes(use_fan=True)
      5. Recount + aggregate verdict

    The 4-verdict vocabulary lets the client show ONE actionable toast
    instead of "0 boundary edges found" when the real problem is
    inverted normals or double-skinning.
    """
    import numpy as np
    import trimesh

    scene = _load_scene(glb_bytes)
    per_mesh = []
    total_dfaces = 0

    # GARDE 1 — DES VRAIS TROUS D'ABORD (2026-09-29). Sur un maillage texture, chaque couture d'UV
    # duplique ses sommets : vue par trimesh, c'est une arete de BORD. La suite du pipeline prenait
    # ces coutures pour des trous et SUPPRIMAIT les faces qui les bordent (« broken faces ») :
    # chevre du user, 5 194 faces, 9 204 « bords » (des coutures), 3 448 faces supprimees, maillage
    # detruit. On compte donc les bords sur une copie SOUDEE PAR POSITION : zero = maillage ferme,
    # rien a boucher -> inchange et non facture (meme politique que le filtre min/max ci-dessous).
    maillages = [m for m in _meshes(scene) if hasattr(m, 'faces') and len(m.faces)]
    faces_avant_total = sum(int(len(m.faces)) for m in maillages)
    vrais_bords = 0
    for m in maillages:
        V = np.asarray(m.vertices, dtype=np.float64)
        F = np.asarray(m.faces, dtype=np.int64)
        pas = max(float(np.ptp(V, axis=0).max()) * 1e-5, 1e-12)
        _, inv = np.unique(np.round(V / pas).astype(np.int64), axis=0, return_inverse=True)
        Fw = inv.reshape(-1)[F]
        Fw = Fw[(Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])]
        aretes = np.sort(np.concatenate([Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]]), axis=1)
        _, n = np.unique(aretes, axis=0, return_counts=True)
        vrais_bords += int((n == 1).sum())
    if maillages and vrais_bords == 0:
        print('[mesh-op] fill_holes: maillage ferme (0 bord une fois soude), rien a boucher', flush=True)
        raise RuntimeError(
            'aucun trou a boucher : le maillage est ferme. Les zones qui paraissent percees sont des '
            'triangles retournes (parties fines) — le maillage est inchange.')

    for m in _meshes(scene):
        if not hasattr(m, 'faces'):
            continue
        diag = {'name': getattr(m, 'metadata', {}).get('name', 'mesh')}

        # Step 0 — clean degenerates so boundary counts aren't polluted.
        try:
            m.update_faces(m.nondegenerate_faces())
            m.remove_unreferenced_vertices()
            try: m._cache.clear()
            except Exception: pass
        except Exception as e:
            print(f'[mesh-op] fill_holes clean step warn: {e}', flush=True)

        # Auto-tol from bounding box diagonal — bumped 1e-4 → 1e-3 so
        # TRELLIS meshes with sub-mm vertex gaps actually weld together
        # before fill_holes runs. The previous 1e-4 left visible holes
        # uncounted (boundary edges not detected because the gap was
        # below merge tolerance but still rendered as a hole).
        try:
            bb_diag = float(np.linalg.norm(m.bounds[1] - m.bounds[0])) or 1.0
        except Exception:
            bb_diag = 1.0
        tol = float(np.clip(bb_diag * 1e-3, 1e-6, bb_diag * 1e-2))
        diag['bb_diag'] = round(bb_diag, 6)
        diag['tol'] = round(tol, 9)

        faces_before = int(len(m.faces))
        be_before, nm_before = _count_boundary_edges(m)
        try:
            winding_inconsistent = not bool(getattr(m, 'is_winding_consistent', True))
        except Exception:
            winding_inconsistent = False
        try:
            watertight_before = bool(getattr(m, 'is_watertight', False))
        except Exception:
            watertight_before = False
        diag.update({
            'faces_before': faces_before,
            'boundary_edges_before': be_before,
            'nonmanifold_edges_before': nm_before,
            'winding_inconsistent': winding_inconsistent,
            'watertight_before': watertight_before,
        })

        # Step 2 — aggressive position-only merge.
        try:
            digits = max(1, int(round(-np.log10(tol))))
            m.merge_vertices(merge_tex=True, merge_norm=True, digits_vertex=digits)
        except TypeError:
            try: m.merge_vertices(merge_tex=True, merge_norm=True)
            except Exception as e: print(f'[mesh-op] merge_vertices fallback warn: {e}', flush=True)
        try: m._cache.clear()
        except Exception: pass
        be_after_merge, _ = _count_boundary_edges(m)
        diag['boundary_edges_after_merge'] = be_after_merge

        # Step 3 — T-junction split (gated).
        is_textured = isinstance(getattr(m, 'visual', None), trimesh.visual.TextureVisuals)
        if be_after_merge <= 200_000 and not is_textured:
            try:
                splits = _split_tjunctions(m, tol)
                diag['tjunction_splits'] = int(splits)
                if splits:
                    try: m.merge_vertices(merge_tex=True, merge_norm=True,
                                           digits_vertex=max(1, int(round(-np.log10(tol)))))
                    except TypeError: m.merge_vertices(merge_tex=True, merge_norm=True)
                    try: m._cache.clear()
                    except Exception: pass
            except Exception as e:
                print(f'[mesh-op] tjunction split warn: {e}', flush=True)
                diag['tjunction_splits'] = 0
        else:
            diag['tjunction_splits'] = 0
            diag['tjunc_skipped_reason'] = ('TEXTURED' if is_textured else 'TOO_LARGE')
        be_after_tjunc, nm_after_tjunc = _count_boundary_edges(m)
        diag['boundary_edges_after_tjunc'] = be_after_tjunc

        # Step 4 — re-orient + clean + fill, ITERATED with non-manifold
        # cleanup interleaved. TRELLIS meshes are often non-manifold AND
        # have winding-inconsistent triangles AND have small open holes
        # all at once. Cycle through the repairs until either watertight
        # or stable (no more improvement).
        def _clean_nonmanifold(mesh):
            try:
                # Drop duplicate faces (collapse double-skin layers).
                mesh.update_faces(mesh.unique_faces())
            except Exception: pass
            try:
                # Drop "broken" faces — those incident to non-manifold edges
                # that can't be salvaged. Aggressive but the alternative
                # is leaving holes that fill_holes can't close.
                broken = trimesh.repair.broken_faces(mesh)
                if broken is not None and len(broken) > 0:
                    keep = np.ones(len(mesh.faces), dtype=bool)
                    keep[np.asarray(broken)] = False
                    mesh.update_faces(keep)
                    print(f'[mesh-op] dropped {int((~keep).sum())} broken faces', flush=True)
            except Exception as e:
                print(f'[mesh-op] broken_faces warn: {e}', flush=True)
            try: mesh.remove_unreferenced_vertices()
            except Exception: pass
            try: mesh._cache.clear()
            except Exception: pass

        last_be = be_after_tjunc
        for pass_i in range(4):
            try: trimesh.repair.fix_winding(m)
            except Exception as e: print(f'[mesh-op] fix_winding pass{pass_i} warn: {e}', flush=True)
            try: m._cache.clear()
            except Exception: pass
            # Clean non-manifold *between* passes so fill_holes can see
            # legitimate boundaries instead of being blocked by the
            # double-skin/non-manifold mess.
            _clean_nonmanifold(m)
            # FILTRAGE PAR TAILLE. L'interface propose deux curseurs
            # (min/max aretes) et colorie l'apercu en vert/gris/rouge
            # selon eux — mais le cloud les JETAIT et bouchait tout.
            # L'apercu contredisait donc le resultat.
            #
            # Repli deliberement conservateur : aux valeurs par defaut
            # (min<=3 et max tres grand), on garde EXACTEMENT le chemin
            # trimesh d'origine. Le filtrage maison ne s'active que si
            # l'utilisateur a vraiment bouge un curseur, pour ne pas
            # risquer de regression sur le cas courant.
            filtre_actif = (min_edges > 3) or (max_edges < 1_000_000)
            fait = False
            if filtre_actif:
                try:
                    r, p, g = _remplir_boucles_filtrees(m, min_edges, max_edges)
                    diag['filled_loops'] = diag.get('filled_loops', 0) + r
                    diag['skipped_too_small'] = diag.get('skipped_too_small', 0) + p
                    diag['skipped_too_big'] = diag.get('skipped_too_big', 0) + g
                    fait = True
                    # ARRET IMMEDIAT si le filtre n'a RIEN a boucher.
                    # Sans ca, les 4 passes continuaient a nettoyer un
                    # maillage qu'on a decide de ne pas reparer : le
                    # nettoyage non-manifold supprimait des faces a chaque
                    # tour et le maillage ressortait PIRE qu'a l'entree
                    # (27 -> 62 aretes de bord sur le test). Un outil qui
                    # abime le maillage est pire qu'un curseur ignore.
                    if r == 0:
                        print(f'[mesh-op] fill_holes: aucun trou dans '
                              f'[{min_edges},{max_edges}] — arret sans modifier',
                              flush=True)
                        break
                except Exception as e:
                    print(f'[mesh-op] filtrage min/max echoue ({e}) — repli trimesh', flush=True)
            if not fait:
                try:
                    trimesh.repair.fill_holes(m, use_fan=True)
                except TypeError:
                    try: trimesh.repair.fill_holes(m)
                    except Exception as e: print(f'[mesh-op] fill_holes pass{pass_i} skipped: {e}', flush=True)
                except Exception as e:
                    print(f'[mesh-op] fill_holes pass{pass_i} skipped: {e}', flush=True)
            try: m._cache.clear()
            except Exception: pass
            try:
                if bool(getattr(m, 'is_watertight', False)):
                    break
            except Exception:
                pass
            try:
                be_now, _ = _count_boundary_edges(m)
            except Exception:
                be_now = last_be
            if be_now >= last_be and pass_i >= 1:
                break  # no progress, stop trying
            last_be = be_now
        # Final fix_normals — flips remaining backward-facing triangles.
        try:
            m.fix_normals()
            m._cache.clear()
        except Exception as e:
            print(f'[mesh-op] fix_normals final warn: {e}', flush=True)

        be_final, nm_final = _count_boundary_edges(m)
        faces_after = int(len(m.faces))
        dfaces = max(0, faces_after - faces_before)
        total_dfaces += dfaces
        try: watertight_after = bool(getattr(m, 'is_watertight', False))
        except Exception: watertight_after = (be_final == 0)
        # Double-skin heuristic: lots of non-manifold edges but no
        # boundary → two layers of triangles stitched together.
        double_skin = (nm_final > max(50, int(faces_after * 0.05))) and be_final == 0
        diag.update({
            'faces_after': faces_after,
            'holes_filled_delta_faces': dfaces,
            'boundary_edges_final': be_final,
            'nonmanifold_edges_final': nm_final,
            'watertight_after': watertight_after,
            'double_skin': double_skin,
        })
        per_mesh.append(diag)
        print(f'[mesh-op] fill_holes mesh={diag["name"]} '
              f'be:{be_before}→{be_final} nm:{nm_before}→{nm_final} '
              f'Δfaces={dfaces} verdict-input={diag}', flush=True)

    stats = {
        'verdict': _aggregate_diag(per_mesh),
        'holes_filled_delta_faces': total_dfaces,
        'meshes': per_mesh,
    }

    # GARDE 2 — BOUCHER N'ENLEVE PAS DE MATIERE (2026-09-29). Le nettoyage non-manifold supprime des
    # faces avant de boucher ; s'il en retire plus de 5 %, le resultat est abime (chevre : 5 194 ->
    # ~1 750 faces). Annule : maillage inchange, non facture.
    faces_apres_total = sum(int(len(m.faces)) for m in _meshes(scene) if hasattr(m, 'faces'))
    if faces_avant_total and faces_apres_total < 0.95 * faces_avant_total:
        perte = 100 * (1 - faces_apres_total / faces_avant_total)
        print(f'[mesh-op] fill_holes: {perte:.0f} % des faces perdues, resultat refuse', flush=True)
        raise RuntimeError(
            f'le bouchage aurait supprime {perte:.0f} % des faces du maillage : annule, le maillage '
            'est inchange.')

    # GARANTIE : SI RIEN N'A ETE BOUCHE, RIEN NE CHANGE.
    #
    # Le pipeline nettoie AVANT de remplir (faces degenerees, fusion de
    # sommets, decoupe des T-jonctions, non-manifold). Quand le filtre
    # min/max ecarte tous les trous, ce nettoyage reste applique sans que
    # le remplissage ne repare derriere : le maillage ressortait ABIME
    # (mesure : 1191 -> 1164 faces, 27 -> 46 aretes de bord).
    #
    # On renvoie donc les octets d'ORIGINE. L'utilisateur qui restreint
    # la plage obtient « aucun trou dans cet intervalle », pas un
    # maillage degrade.
    filtre_actif = (min_edges > 3) or (max_edges < 1_000_000)
    if filtre_actif:
        boucles_remplies = sum(int(d.get('filled_loops', 0) or 0) for d in per_mesh)
        if boucles_remplies == 0:
            # ON LEVE plutot que de renvoyer un maillage intact contre un
            # credit, meme politique que decimate() : le worker debite
            # AVANT l'appel, et une operation qui ne change rien ne doit
            # pas etre facturee. L'utilisateur elargit la plage et
            # relance. Le message porte le diagnostic.
            print(f'[mesh-op] fill_holes: aucun trou entre {min_edges} et '
                  f'{max_edges} aretes', flush=True)
            raise RuntimeError(
                f'aucun trou entre {min_edges} et {max_edges} aretes — '
                'elargis la plage. Le maillage est inchange.')

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
        )
        uv = getattr(target_mesh.visual, 'uv', None)
        target_mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=new_mat)
    except Exception as e:
        print(f'[mesh-op] material_adjust material rebuild failed: {e}', flush=True)

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
    return _export(scene)


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
        with urllib.request.urlopen(req, timeout=60) as r, open(image, 'wb') as f:
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
        with urllib.request.urlopen(req, timeout=30) as r:
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
def watertight(glb_bytes: bytes, resolution: int = 128) -> bytes:
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
    return _export(trimesh.Scene(wt))


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


def explode(glb_bytes: bytes, fragments: int = 24) -> bytes:
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
    seed_idx = rng.choice(len(F), k, replace=False)
    seeds = fc_centroids[seed_idx]
    try:
        from scipy.spatial import cKDTree
        labels = cKDTree(seeds).query(fc_centroids)[1]
    except Exception:
        d = np.linalg.norm(fc_centroids[:, None, :] - seeds[None, :, :], axis=2)
        labels = d.argmin(axis=1)

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


def _textures_apercu(glb_bytes: bytes, max_px: int, filigrane: bool, couleur_px: int = 2048) -> bytes:
    """Reduit TOUTES les images embarquees a max_px et filigrane les textures de
    couleur, en reecrivant le GLB a la main : ni la geometrie, ni la peau, ni
    les animations ne passent par un reexport (trimesh les perdrait). Chaque
    image garde son format (PNG, JPEG, WebP) : les extensions qui le declarent
    (EXT_texture_webp) restent justes."""
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
    # ou de rugosite filigranee donnerait des reliefs parasites).
    couleur = set()
    for mat in doc.get('materials', []):
        idx = ((mat.get('pbrMetallicRoughness') or {}).get('baseColorTexture') or {}).get('index')
        if idx is None or idx >= len(textures):
            continue
        t = textures[idx]
        for src in [t.get('source')] + [e.get('source') for e in (t.get('extensions') or {}).values() if isinstance(e, dict)]:
            if src is not None:
                couleur.add(src)
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
    'material_adjust': material_adjust,  # 6-slider PBR tweak (mirror of scripts/mesh_material_adjust.py)
    'retex_swap':      retex_swap_atlas,
    'resize':          resize,     # orientation + per-axis scale (manual Resize/dimension tool)
    'explode':         explode,    # Voronoi fracture -> part_XX submeshes (explode slider)
    'apercu':          apercu,     # copie de demonstration filigranee (Marketplace, fiches payantes)
}


def run(op_type: str, glb_bytes: bytes, params: dict | None = None):
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
        return watertight(glb_bytes, resolution=int(p.get('resolution', 128))), None
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
    if op_type == 'explode':
        return explode(glb_bytes, fragments=int(p.get('fragments', 24))), None
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
        )
    return OPS[op_type](glb_bytes), None
