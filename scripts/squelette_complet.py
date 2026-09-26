"""SQUELETTE COMPLET d'un rig produit par le rigger IA — generique, sans aucune
connaissance de l'espece (araignee, vache, dragon, humain : meme code).

POURQUOI (2026-09-26). Le rigger IA place ses articulations la ou un membre
plie et s'arrete avant la pointe ; il oublie parfois un membre et ne met
souvent aucun os dans une tete. Aucun de ses reglages n'y change rien
(classes articulation / rignet / vroid, penalite de repetition : mesures au
journal). Mesure sur le rig de production d'une araignee : 0 patte parcourue
jusqu'au bout sur 9, une patte sans os.

METHODE
  1. Les EXTREMITES reelles du maillage : volume voxel (test « sandwich »,
     robuste aux maillages non etanches) ; le tronc est ce qui survit a une
     erosion a 0,3 x l'epaisseur max ; chaque extremite est une branche
     geodesique qui en part (maxima locaux de distance geodesique, branche
     propre >= 90 % du chemin, ecart > 15 voxels aux branches retenues),
     recentree sur la ligne mediane du membre.
  2. NOTE de completude d'un rig : fraction de chaque extremite parcourue par
     ses os. Sert a garder le meilleur de plusieurs tirages de l'IA.
  3. COMPLETION : une chaine de l'IA qui s'arrete avant le bout est prolongee
     (avec l'espacement de l'IA) ; une extremite sans os recoit une chaine,
     rattachee de preference a un os du tronc ; plusieurs chaines nees au meme
     endroit partagent un moyeu (tete : museau, oreilles, cornes) ; un bloc du
     tronc a plus de 1,2 x son epaisseur de tout os (abdomen d'araignee)
     recoit une chaine le long de son axe principal.
  4. GREFFE du squelette dans le GLB TEXTURE, avec des poids d'amorcage, pour
     que l'IA recalcule la peau (`--use_skeleton`).
  5. MODE POINTS (editeur facon AccuRIG) : les extremites detectees sont
     remplacees par les points de l'utilisateur (lignes_vers_points) ; chacun
     doit etre atteint a une demi-longueur d'os pres ; un point du tronc
     (machoire, crane) est relie en droite a l'os qui fait bouger sa zone.

Resultat mesure : araignee 0/11 -> 11/11 extremites completes, vache 1/14 ->
14/14 (portee 0,22 -> 0,99), texture conservee.

Fichier PARTAGE : source scripts/squelette_complet.py, copie identique
modal_app/squelette/squelette_complet.py (build/check-noyaux-partages.mjs).
Dependances : numpy, scipy, trimesh (presentes dans le venv et l'image du
rigger).
"""
import collections
import json
import struct

import numpy as np

RESOLUTION = 220          # voxels sur la plus grande dimension
PORTEE_COMPLETE = 0.9     # au-dela, une extremite est jugee couverte


# =============================================================== GLB minimal
def lire_glb(octets):
    b = bytes(octets)
    if b[:4] != b'glTF':
        raise ValueError('pas un GLB')
    off, js, bn = 12, None, b''
    while off < len(b):
        n, t = struct.unpack_from('<II', b, off)
        c = b[off + 8: off + 8 + n]
        if t == 0x4E4F534A:
            js = json.loads(c)
        elif t == 0x004E4942:
            bn = bytes(c)
        off += 8 + n
    return js, bn


def ecrire_glb(js, blob):
    blob = bytearray(blob)
    while len(blob) % 4:
        blob.append(0)
    js['buffers'][0]['byteLength'] = len(blob)
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    return (struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob))
            + struct.pack('<II', len(jb), 0x4E4F534A) + jb
            + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))


def _q2m(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def _locale(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    M = np.eye(4)
    M[:3, :3] = _q2m(n.get('rotation', [0, 0, 0, 1])) @ np.diag(n.get('scale', [1, 1, 1]))
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


def matrices_monde(js):
    noeuds = js['nodes']
    parent = {}
    for i, n in enumerate(noeuds):
        for c in n.get('children', []):
            parent[c] = i
    W = {}

    def w(i):
        if i not in W:
            W[i] = (w(parent[i]) @ _locale(noeuds[i])) if i in parent else _locale(noeuds[i])
        return W[i]
    for i in range(len(noeuds)):
        w(i)
    return W, parent


_TYPES = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
_NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def _accesseur(js, bn, i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    dt = np.dtype(_TYPES[a['componentType']])
    nc = _NCOMP[a['type']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    st = bv.get('byteStride', 0)
    if st and st != dt.itemsize * nc:
        return np.stack([np.frombuffer(bn, dt, nc, o + k * st) for k in range(a['count'])])
    return np.frombuffer(bn, dt, a['count'] * nc, o).reshape(a['count'], nc)


def influence_du_rig(chemin):
    """(sommets monde, joint dominant de chaque sommet) du maillage peau d'un
    rig ; les indices de joints suivent l'ordre de squelette_du_glb. Sert a
    rattacher une nouvelle chaine a l'os qui fait DEJA bouger cette zone."""
    js, bn = lire_glb(open(chemin, 'rb').read())
    W, _ = matrices_monde(js)
    for i, n in enumerate(js['nodes']):
        if 'mesh' not in n or 'skin' not in n:
            continue
        for prim in js['meshes'][n['mesh']]['primitives']:
            at = prim['attributes']
            if 'JOINTS_0' not in at or 'WEIGHTS_0' not in at:
                continue
            V = _accesseur(js, bn, at['POSITION']).astype(np.float64)
            V = (W[i][:3, :3] @ V.T).T + W[i][:3, 3]
            J4 = _accesseur(js, bn, at['JOINTS_0']).astype(np.int64)
            W4 = _accesseur(js, bn, at['WEIGHTS_0']).astype(np.float64)
            return V, J4[np.arange(len(J4)), W4.argmax(axis=1)]
    return None


def squelette_du_glb(chemin):
    """(positions monde (J,3), parents [indice ou -1], noms) du premier skin."""
    js, _ = lire_glb(open(chemin, 'rb').read())
    joints = list(js['skins'][0]['joints'])
    W, parent_noeud = matrices_monde(js)
    ens = set(joints)
    idx = {n: i for i, n in enumerate(joints)}
    parents = []
    for n in joints:
        p = parent_noeud.get(n)
        while p is not None and p not in ens:
            p = parent_noeud.get(p)
        parents.append(idx[p] if p is not None else -1)
    J = np.array([W[n][:3, 3] for n in joints], dtype=np.float64)
    noms = [js['nodes'][n].get('name', f'bone_{i}') for i, n in enumerate(joints)]
    return J, parents, noms


# ============================================================ volume du maillage
def _charger(chemin):
    import trimesh
    sc = trimesh.load(chemin)
    if hasattr(sc, 'to_geometry'):
        return sc.to_geometry()
    return sc.dump(concatenate=True) if hasattr(sc, 'dump') else sc


def volume(chemin, resolution=RESOLUTION):
    """Voxels pleins du maillage. Test « sandwich » : un voxel est interieur si
    la coque l'entoure dans au moins 5 des 6 directions d'axe (fill() de
    trimesh ne remplit rien sur un maillage non etanche, le cas courant)."""
    from scipy import ndimage
    m = _charger(chemin)
    ext = float(np.ptp(np.asarray(m.vertices), axis=0).max())
    vg = m.voxelized(ext / resolution)
    M = np.asarray(vg.transform, dtype=np.float64)
    coque = np.asarray(vg.matrix, dtype=bool)
    compte = np.zeros(coque.shape, np.uint8)
    for ax in range(3):
        compte += np.maximum.accumulate(coque, axis=ax).astype(np.uint8)
        compte += np.flip(np.maximum.accumulate(np.flip(coque, ax), axis=ax), ax).astype(np.uint8)
    plein = coque | (compte >= 5)
    dist = ndimage.distance_transform_edt(plein)
    return {'plein': plein, 'M': M, 'inv': np.linalg.inv(M), 'ext': ext,
            'pas': ext / resolution, 'dist': dist}


def _monde(vol, ijk):
    ijk = np.atleast_2d(np.asarray(ijk, dtype=np.float64))
    return (vol['M'][:3, :3] @ ijk.T).T + vol['M'][:3, 3]


def _voxel(vol, p):
    ijk = np.round(vol['inv'][:3, :3] @ np.asarray(p) + vol['inv'][:3, 3]).astype(int)
    return tuple(np.clip(ijk, 0, np.array(vol['plein'].shape) - 1))


# ================================================================ extremites
_VOIS = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)]


def extremites(vol):
    """Lignes mediane (monde) tronc -> pointe de chaque extremite ; pose aussi
    vol['tronc']. Liste vide si le maillage n'a pas de membre distinct."""
    from scipy import ndimage
    plein, dist = vol['plein'], vol['dist']
    sh = plein.shape
    seuil = max(3.0, 0.3 * float(dist.max()))
    lab, _ = ndimage.label(dist > seuil)
    t = np.bincount(lab.ravel()); t[0] = 0
    tronc = ndimage.binary_dilation(lab == t.argmax(), iterations=int(seuil) + 1) & plein
    vol['tronc'] = tronc
    autour = ndimage.binary_dilation(tronc, iterations=3)
    reste = plein & ~autour
    depart = reste & ndimage.binary_dilation(autour, iterations=1)
    dg = np.full(sh, -1, np.int32)
    pred = {}
    file = collections.deque()
    for v in map(tuple, np.argwhere(depart)):
        dg[v] = 0; pred[v] = None; file.append(v)
    while file:
        u = file.popleft()
        for d in _VOIS:
            v = (u[0] + d[0], u[1] + d[1], u[2] + d[2])
            if 0 <= v[0] < sh[0] and 0 <= v[1] < sh[1] and 0 <= v[2] < sh[2] and reste[v] and dg[v] < 0:
                dg[v] = dg[u] + 1; pred[v] = u; file.append(v)
    from scipy.spatial import cKDTree
    pts_pleins = np.argwhere(plein)
    arbre = cKDTree(pts_pleins)
    # garde pour lignes_vers_points() (editeur de points) : memes chemins
    vol['_geo'] = {'dg': dg, 'pred': pred, 'arbre': arbre, 'pleins': pts_pleins}
    if dg.max() <= 0:
        return []
    maxloc = ndimage.maximum_filter(np.where(dg >= 0, dg, -1), size=5) == dg
    cand = sorted(map(tuple, np.argwhere(maxloc & (dg > 0.25 * dg.max()))), key=lambda v: -dg[v])
    consomme = np.zeros(sh, bool); traces = np.zeros(sh, bool); dtr = None
    chemins = []
    for v in cand:
        if consomme[v]:
            continue
        c = []
        u = v
        while u is not None:
            c.append(u); u = pred[u]
        # un appendice part du TRONC : sa branche propre couvre presque tout
        # son chemin (une bosse greffee a mi-patte n'en couvre qu'une partie)
        propre = next((i for i, w in enumerate(c) if consomme[w]), len(c))
        if propre < 12 or propre < 0.9 * dg[v]:
            continue
        # colle a une branche retenue : une bosse de sa surface (poils)
        if chemins and dtr[v] <= 15:
            continue
        chemins.append(np.array(c[::-1]))
        tr = np.zeros(sh, bool); tr[tuple(np.array(c).T)] = True
        consomme |= ndimage.binary_dilation(tr, iterations=3)
        traces |= tr
        dtr = ndimage.distance_transform_edt(~traces)
    return [_monde(vol, _ligne_mediane(c, dist, arbre, pts_pleins)) for c in chemins]


def lignes_vers_points(vol, points):
    """Lignes tronc -> point pour des points places par l'UTILISATEUR (editeur
    facon AccuRIG). Meme construction que extremites() — chemin geodesique
    depuis le bord du tronc, recentre sur la ligne mediane — mais qui finit
    EXACTEMENT au point. None pour un point du tronc ou de sa bordure (tete
    d'un humanoide, machoire, epaule) : completer() le relie alors a l'os qui
    fait deja bouger la zone."""
    if '_geo' not in vol:
        extremites(vol)
    geo = vol['_geo']
    dg, pred, arbre, pleins = geo['dg'], geo['pred'], geo['arbre'], geo['pleins']
    lignes = []
    for p in points:
        p = np.asarray(p, dtype=np.float64)
        q = vol['inv'][:3, :3] @ p + vol['inv'][:3, 3]
        v = tuple(pleins[arbre.query(q)[1]])
        # moins de 4 voxels depuis le tronc : le point EST a la racine du
        # membre, une ligne de 2 voxels donnerait des os de longueur nulle
        if dg[v] < 4:
            lignes.append(None)
            continue
        c = []
        u = v
        while u is not None:
            c.append(u); u = pred[u]
        P = _monde(vol, _ligne_mediane(np.array(c[::-1]), vol['dist'], arbre, pleins))
        # le chemin s'arrete au voxel plein le plus proche : on le finit au
        # point exact (hors du volume au-dela de 10 % : clic aberrant, ignore)
        ecart = float(np.linalg.norm(p - P[-1]))
        if ecart < vol['pas']:
            P[-1] = p
        elif ecart <= 0.1 * vol['ext']:
            P = np.vstack([P, p])
        lignes.append(P)
    return lignes


def _ligne_mediane(chemin_vox, dist, arbre, pts_pleins):
    """Recentre un chemin voxel (qui longe les bords) sur le centre de section :
    barycentre d'une tranche perpendiculaire a la direction locale."""
    P = chemin_vox.astype(np.float64)
    n = len(P)
    out = np.empty_like(P)
    for i in range(n):
        t = P[min(n - 1, i + 3)] - P[max(0, i - 3)]
        t = t / (np.linalg.norm(t) or 1.0)
        rayon = max(2.0, 2.5 * float(dist[tuple(chemin_vox[i])]) + 2.0)
        idx = arbre.query_ball_point(P[i], rayon)
        if not idx:
            out[i] = P[i]; continue
        q = pts_pleins[idx].astype(np.float64)
        tranche = q[np.abs((q - P[i]) @ t) <= 1.0]
        out[i] = tranche.mean(0) if len(tranche) else P[i]
    lisse = np.array([out[max(0, i - 3):i + 4].mean(0) for i in range(n)])
    lisse[-1] = out[-1]
    return lisse


def _abscisse(P):
    return np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])


def _point_a(P, s_cible):
    s = _abscisse(P)
    return np.array([np.interp(s_cible, s, P[:, k]) for k in range(3)])


def _epaisseur(vol, P):
    """Rayon median (monde) du membre le long de sa ligne mediane."""
    return float(np.median([vol['dist'][_voxel(vol, p)] for p in P[::4]])) * vol['pas']


# ==================================================================== note
def portee(P, J, rayon):
    """Fraction de la longueur de l'extremite P atteinte par des os proches."""
    s = _abscisse(P)
    if s[-1] <= 0 or len(J) == 0:
        return 0.0
    d = np.linalg.norm(np.asarray(J)[:, None, :] - P[None, :, :], axis=2)
    proches = d.min(axis=1) < rayon
    if not proches.any():
        return 0.0
    return float(s[d[proches].argmin(axis=1)].max() / s[-1])


def noter(vol, lignes, J):
    lignes = [P for P in lignes if P is not None]   # points du tronc : sans ligne
    if not lignes:
        return {'portees': [], 'portee_moy': 1.0, 'complets': 0, 'rates': 0, 'n': 0}
    p = [portee(P, J, 0.03 * vol['ext']) for P in lignes]
    return {'portees': [round(x, 3) for x in p], 'portee_moy': round(float(np.mean(p)), 3),
            'complets': int(sum(x >= 0.85 for x in p)), 'rates': int(sum(x < 0.3 for x in p)),
            'n': len(p)}


def cle_de_note(n):
    """Tri : plus d'extremites completes, moins de ratees, plus de portee."""
    return (n['complets'], -n['rates'], n['portee_moy'])


# ============================================================== completion
def completer(vol, lignes, J, parents, noms, influence=None, pointes=None):
    """Complete le squelette de l'IA. Rend (J, parents, noms, rapport) ; les
    len(J_ia) premiers joints sont ceux de l'IA, inchanges. `influence` =
    influence_du_rig(rig de l'IA) : les nouvelles chaines se rattachent a l'os
    qui fait deja bouger la zone ou elles naissent.

    `pointes` (editeur de points) : les points de l'utilisateur, alignes sur
    `lignes` (lignes_vers_points). Chacun doit etre ATTEINT, a une demi-
    longueur d'os pres — et non plus a 90 % de la longueur du membre, seuil
    de la detection automatique qui laissait un bout de pied sans os. Un point
    sans ligne (tronc) est relie en droite a l'os qui fait bouger sa zone."""
    from scipy import ndimage
    J = [np.asarray(p, dtype=np.float64) for p in J]
    parents, noms = list(parents), list(noms)
    n_ia = len(J)
    ext = vol['ext']
    longueurs = [np.linalg.norm(J[j] - J[p]) for j, p in enumerate(parents) if p >= 0]
    pas_global = float(np.median(longueurs)) if longueurs else 0.1 * ext
    tronc_large = ndimage.binary_dilation(vol['tronc'], iterations=2)

    def dans_tronc(p):
        return bool(tronc_large[_voxel(vol, p)])

    arbre_inf = None
    if influence is not None:
        from scipy.spatial import cKDTree
        arbre_inf = cKDTree(influence[0])

    def parent_pour(point):
        """L'os qui fait DEJA bouger la zone (peau calculee par l'IA) : un pagne
        suit le bassin, une tete suit le cou. Mesure sur un barbare : la regle
        « os du tronc le plus proche » accrochait le pagne au GENOU (chez un
        humanoide les cuisses epaisses font partie du tronc). Repli sans peau :
        os le plus proche, de preference dans le tronc."""
        if arbre_inf is not None:
            idx = arbre_inf.query_ball_point(point, 0.04 * ext)
            if idx:
                dom = influence[1][idx]
                dom = dom[dom < n_ia]
                if len(dom):
                    return int(np.bincount(dom).argmax())
        d = np.linalg.norm(np.array(J) - point, axis=1)
        tronc_j = [j for j in range(len(J)) if dans_tronc(J[j])]
        return int(min(tronc_j, key=lambda j: d[j])) if tronc_j else int(np.argmin(d))

    rapport = []
    nouvelles = []
    avec_ligne = [(a_i, P) for a_i, P in enumerate(lignes) if P is not None]
    for a_i, P in sorted(avec_ligne, key=lambda t: -_abscisse(t[1])[-1]):
        s = _abscisse(P); L = float(s[-1])
        d = np.linalg.norm(np.array(J)[:, None, :] - P[None, :, :], axis=2)
        rayon = max(0.03 * ext, 1.5 * _epaisseur(vol, P))
        proches = np.where(d.min(axis=1) < rayon)[0]
        if len(proches):
            s_j = s[d[proches].argmin(axis=1)]
            k = int(np.argmax(s_j)); dernier = int(proches[k]); s_max = float(s_j[k])
        else:
            s_j, dernier, s_max = np.array([]), None, 0.0
        p_ia = s_max / L if L > 0 else 1.0
        # espacement des os de l'IA le long de ce membre
        st = np.sort(s_j)
        pas = float(np.median(np.diff(st))) if len(st) > 1 else pas_global
        pas = max(pas, 0.02 * ext)
        if pointes is None:
            complet = p_ia >= PORTEE_COMPLETE
        else:
            complet = dernier is not None and (L - s_max) <= 0.5 * pas
        if complet:
            rapport.append({'extremite': a_i, 'portee_ia': round(p_ia, 2), 'action': 'complete', 'os': 0})
            continue
        if dernier is not None and p_ia >= 0.15:
            # PROLONGER la chaine de l'IA, avec son propre espacement
            n_new = max(1, int(round((L - s_max) / pas)))
            p = dernier
            for q in range(1, n_new + 1):
                J.append(_point_a(P, s_max + q * (L - s_max) / n_new))
                parents.append(p); noms.append(f'fin_{a_i}_{q}')
                p = len(J) - 1
            rapport.append({'extremite': a_i, 'portee_ia': round(p_ia, 2), 'action': 'prolongee', 'os': n_new})
        else:
            nouvelles.append((a_i, P))
            rapport.append({'extremite': a_i, 'portee_ia': round(p_ia, 2), 'action': 'nouvelle', 'os': 0})

    # NOUVELLES CHAINES : moyeu commun quand plusieurs naissent au meme endroit
    groupes = []
    for a_i, P in nouvelles:
        for g in groupes:
            if np.linalg.norm(g['attache'] - P[0]) < 0.08 * ext:
                g['membres'].append((a_i, P))
                g['attache'] = np.mean([m[1][0] for m in g['membres']], axis=0)
                break
        else:
            groupes.append({'attache': P[0].copy(), 'membres': [(a_i, P)]})
    for g in groupes:
        parent = parent_pour(g['attache'])
        if len(g['membres']) > 1:
            J.append(g['attache'].copy()); parents.append(parent); noms.append(f'moyeu_{len(J)}')
            parent = len(J) - 1
        for a_i, P in g['membres']:
            L = float(_abscisse(P)[-1])
            n_new = max(2, int(round(L / pas_global)))
            p = parent
            debut = 0 if len(g['membres']) == 1 else 1
            for q in range(debut, n_new + 1):
                J.append(_point_a(P, q * L / n_new)); parents.append(p); noms.append(f'membre_{a_i}_{q}')
                p = len(J) - 1
            for r in rapport:
                if r.get('extremite') == a_i:
                    r['os'] = n_new + 1 - debut

    # POINTS DU TRONC (editeur) : machoire, sommet du crane, oreille collee a
    # la tete... Aucun chemin de membre n'y mene : on les relie EN DROITE a
    # l'os qui fait bouger leur zone. Rayon de recherche a l'echelle de
    # l'epaisseur locale : le point est au CENTRE du volume, une tete fait
    # ~9 cm de rayon quand 0,04 x la hauteur n'en fait que 7 — sans cela
    # aucun sommet trouve et repli sur l'os le plus proche (le cou).
    if pointes is not None:
        for a_i, (P, pt) in enumerate(zip(lignes, pointes)):
            if P is not None:
                continue
            pt = np.asarray(pt, dtype=np.float64)
            # deja un os sur le point (ex. bout de tete pose par l'IA)
            if float(np.linalg.norm(np.array(J) - pt, axis=1).min()) <= 0.5 * pas_global:
                rapport.append({'point': a_i, 'action': 'atteint', 'os': 0})
                continue
            par = None
            if arbre_inf is not None:
                r_loc = max(0.04 * ext, 1.5 * float(vol['dist'][_voxel(vol, pt)]) * vol['pas'])
                idx = arbre_inf.query_ball_point(pt, r_loc)
                if idx:
                    dom = influence[1][idx]
                    dom = dom[dom < n_ia]
                    if len(dom):
                        par = int(np.bincount(dom).argmax())
            if par is None:
                par = int(np.argmin(np.linalg.norm(np.array(J) - pt, axis=1)))
            depart = np.array(J[par])
            n_new = max(1, int(round(float(np.linalg.norm(pt - depart)) / pas_global)))
            p = par
            for q in range(1, n_new + 1):
                J.append(depart + (pt - depart) * q / n_new); parents.append(p); noms.append(f'point_{a_i}_{q}')
                p = len(J) - 1
            rapport.append({'point': a_i, 'action': 'relie', 'os': n_new})

    # TRONC SANS OS : un bloc du coeur a plus de 1,2 x l'epaisseur de tout os
    # (a 0,5 x, le ventre d'une vache — a ~1 rayon de sa colonne qui longe le
    # dos — recevait une seconde colonne vertebrale).
    dist = vol['dist']
    coeur = vol['tronc'] & (dist > 0.5 * float(dist.max()))
    n_coeur = max(1, int(coeur.sum()))
    rayon_tronc = float(dist.max()) * vol['pas']
    zones = []
    for _ in range(4):
        pts = _monde(vol, np.argwhere(coeur)) if coeur.any() else np.zeros((0, 3))
        if len(pts) == 0:
            break
        Jarr = np.array(J)
        A = np.array([Jarr[p] for j, p in enumerate(parents) if p >= 0])
        B = np.array([Jarr[j] for j, p in enumerate(parents) if p >= 0])
        dmin = np.full(len(pts), np.inf)
        for k0 in range(0, len(A), 64):
            a, b = A[k0:k0 + 64], B[k0:k0 + 64]
            ab = b - a
            t = np.clip(((pts[:, None, :] - a[None]) * ab[None]).sum(-1)
                        / np.maximum((ab * ab).sum(-1), 1e-12)[None], 0, 1)
            proj = a[None] + t[..., None] * ab[None]
            dmin = np.minimum(dmin, np.linalg.norm(pts[:, None, :] - proj, axis=2).min(axis=1))
        loin = dmin > 1.2 * rayon_tronc
        if loin.sum() < 0.05 * n_coeur:
            break
        # le BLOC entier du coeur qui contient le plus de voxels « loin » (sa
        # calotte seule, plus large que longue, donnait un axe en travers)
        ijk = np.argwhere(coeur)
        lab_c, _ = ndimage.label(coeur)
        blocs = lab_c[tuple(ijk[loin].T)]
        bloc = int(np.bincount(blocs).argmax())
        zone = _monde(vol, np.argwhere(lab_c == bloc))
        coeur = coeur & (lab_c != bloc)
        if len(zone) < 0.05 * n_coeur or (zones and len(zone) < 0.3 * zones[0]):
            break
        centre = zone.mean(0)
        parent = parent_pour(centre)
        _, _, vt = np.linalg.svd(zone - centre, full_matrices=False)
        proj = (zone - centre) @ vt[0]
        e1, e2 = centre + proj.min() * vt[0], centre + proj.max() * vt[0]
        if np.linalg.norm(e1 - J[parent]) > np.linalg.norm(e2 - J[parent]):
            e1, e2 = e2, e1
        for nom_p, p in (('debut', e1), ('centre', centre), ('bout', e2)):
            J.append(p); parents.append(parent); noms.append(f'tronc_{len(zones)}_{nom_p}')
            parent = len(J) - 1
        zones.append(len(zone))
    if zones:
        rapport.append({'tronc': len(zones), 'os': 3 * len(zones)})
    return np.array(J), parents, noms, rapport


# =================================================================== greffe
def greffer(chemin_maillage, J, parents, noms, sortie):
    """Greffe le squelette dans le GLB TEXTURE (UV et materiaux intacts), avec
    des poids d'amorcage : chaque sommet sur son joint le plus proche, et 60
    sommets forces pour tout joint sans sommet — sinon trim_skeleton() du
    rigger elague les os dont le sous-arbre ne porte aucun poids."""
    from scipy.spatial import cKDTree
    js, bn = lire_glb(open(chemin_maillage, 'rb').read())
    J = np.asarray(J, dtype=np.float64)
    blob = bytearray(bn)

    def pousser(arr, ctype, atype, cible=None, norm=False):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        brut = np.ascontiguousarray(arr).tobytes()
        blob.extend(brut)
        js['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(brut),
                                  **({'target': cible} if cible else {})})
        a = {'bufferView': len(js['bufferViews']) - 1, 'componentType': ctype,
             'count': int(len(arr)), 'type': atype}
        if norm:
            a['normalized'] = True
        js['accessors'].append(a)
        return len(js['accessors']) - 1

    maillages = [i for i, n in enumerate(js['nodes']) if 'mesh' in n]
    if len(js.get('meshes', [])) != 1 or len(js['meshes'][0]['primitives']) != 1 or len(maillages) != 1:
        raise ValueError('greffe : un seul maillage a une seule primitive attendu')
    for i, n in enumerate(js['nodes']):
        if any(k in n for k in ('matrix', 'translation', 'rotation', 'scale')):
            raise ValueError(f'greffe : noeud {i} transforme, non gere')
    prim = js['meshes'][0]['primitives'][0]
    acc = js['accessors'][prim['attributes']['POSITION']]
    bv = js['bufferViews'][acc['bufferView']]
    V = np.frombuffer(bn, np.float32, acc['count'] * 3,
                      bv.get('byteOffset', 0) + acc.get('byteOffset', 0)).reshape(-1, 3).astype(np.float64)
    _, proche = cKDTree(J).query(V, k=1)
    J4 = np.zeros((len(V), 4), np.uint16); J4[:, 0] = proche
    occ = collections.Counter(proche.tolist())
    arbre_v = cKDTree(V)
    for k in range(len(J)):
        if occ.get(k, 0) == 0:
            _, idx = arbre_v.query(J[k], k=min(60, len(V)))
            J4[idx, 0] = k
    W4 = np.zeros((len(V), 4), np.uint8); W4[:, 0] = 255
    prim['attributes']['JOINTS_0'] = pousser(J4, 5123, 'VEC4', 34962)
    prim['attributes']['WEIGHTS_0'] = pousser(W4, 5121, 'VEC4', 34962, norm=True)
    premier = len(js['nodes'])
    enfants = collections.defaultdict(list)
    for j, p in enumerate(parents):
        if p >= 0:
            enfants[p].append(j)
    for j in range(len(J)):
        p = parents[j]
        t = J[j] - (J[p] if p >= 0 else 0.0)
        n = {'name': noms[j], 'translation': [float(x) for x in t]}
        if enfants[j]:
            n['children'] = [premier + c for c in enfants[j]]
        js['nodes'].append(n)
    armature = len(js['nodes'])
    js['nodes'].append({'name': 'Armature', 'children': [premier + j for j in range(len(J)) if parents[j] < 0]})
    js['scenes'][js.get('scene', 0)]['nodes'].append(armature)
    ibm = np.stack([np.eye(4) for _ in range(len(J))])
    ibm[:, :3, 3] = -J
    a_ibm = pousser(ibm.transpose(0, 2, 1).reshape(len(J), 16).astype(np.float32), 5126, 'MAT4')
    racine = next(j for j in range(len(J)) if parents[j] < 0)
    js['skins'] = [{'joints': [premier + j for j in range(len(J))], 'inverseBindMatrices': a_ibm,
                    'skeleton': premier + racine}]
    js['nodes'][maillages[0]]['skin'] = 0
    with open(sortie, 'wb') as f:
        f.write(ecrire_glb(js, blob))


def ajouter_extras(chemin_glb, donnees):
    """Range le compte rendu (extremites, notes) dans extras.fabmesh_squelette
    du GLB final : l'editeur de points pourra les relire."""
    js, bn = lire_glb(open(chemin_glb, 'rb').read())
    js.setdefault('extras', {})['fabmesh_squelette'] = donnees
    with open(chemin_glb, 'wb') as f:
        f.write(ecrire_glb(js, bn))
