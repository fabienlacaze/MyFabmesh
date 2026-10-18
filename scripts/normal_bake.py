"""Carte de normales cuite du maillage FIN vers le maillage FINAL leger (2026-10-04, relu et branche le 2026-10-13).

SOURCE : scripts/normal_bake.py (bureau). COPIE IDENTIQUE : modal_app/normal_bake.py (Modal, qui ne peut pas importer
scripts/). Le garde build/check-noyaux-partages.mjs refuse une construction si les deux fichiers different ; resynchroniser
avec `node build/check-noyaux-partages.mjs --sync`. Ne jamais editer la copie a la main.

POURQUOI. to_glb (o_voxel.postprocess) reduit le maillage fin de TRELLIS.2 (12 a 47 M de faces) a la cible demandee (500 000,
5 000...) et ne cuit que baseColor + metal/rugosite : tout le relief fin est perdu a l'eclairage. Ce module cuit ce relief dans
une carte de normales (glTF `normalTexture`, espace tangent) a partir des sommets du maillage fin. Meshy livre une telle carte
(demande du proprietaire, 04/10 : "on ajoute la carte de normales a l'export").

CONTRAT
  - numpy + scipy (cKDTree, ndimage) ; AUCUN GPU, nvdiffrast, cumesh, kaolin ni cv2 ; PIL et trimesh seulement a l'appel de
    appliquer_carte_normales. Les imports lourds sont faits dans les fonctions (importer le module ne coute rien).
  - bake_normal_map ne MODIFIE jamais les maillages (elle lit `vertex_normals` : trimesh en garde alors le resultat en cache) ;
    appliquer_carte_normales pose la carte sur le(s) materiau(x) existant(s) sans toucher aux autres textures.
  - sommets / faces fins : numpy OU torch (CPU ou GPU) ; les faces sont lues par blocs (jamais de copie complete d'un tenseur
    de 47 M de faces) ; resultat identique octet pour octet quel que soit le type d'entree et le nombre de fils.
  - bake_normal_map rend None (et une ligne de journal qui dit pourquoi) quand il n'y a rien a cuire : maillage final sans UV,
    aucune face fine, aucun texel couvert, ou sommets fins qui ne se superposent pas au maillage final (mauvais repere).
    L'appelant doit donc tester `is not None` avant d'appeler appliquer_carte_normales (qui accepte None et ne fait rien).
  - CHEMINS D'EXPORT (generation bureau et Modal) : ajouter_carte_normales fait cuisson + pose en un appel, lit l'interrupteur
    FABMESH_NORMAL_MAP ("0" : rien n'est fait, la scene reste celle d'avant) et ne leve JAMAIS : au moindre echec, la scene est
    rendue sans carte (et le journal dit pourquoi). La taille de la carte est celle de l'atlas de COULEUR de la scene,
    PLAFONNEE (voir OPTION ET PLAFOND ci-dessous).
  - OUTILS qui deforment la geometrie ou refont les UV apres coup (lissage, reduction, subdivision...) : retirer_cartes_normales.
    Une carte gardee sur une forme qui a change decrirait un relief qui n'est plus la.

OPTION ET PLAFOND (2026-10-15, decision du proprietaire apres l'essai GPU A/B du 15/10)
  - La carte n'est PLUS cuite d'office : c'est une OPTION PAR GENERATION ("relief pour moteur de jeu"), desactivee par defaut.
    Les chemins d'export (modal_app/_mesh.py generate(normal_map=...), scripts/trellis2_native_full_pipeline.py) demandent
    carte_normales_voulue(option) : vrai SEULEMENT si l'option vaut exactement True (booleen strict : ni une chaine, ni 1) ET que
    l'interrupteur d'urgence FABMESH_NORMAL_MAP n'est pas a 0 (il l'emporte sur l'option). Sans option, ajouter_carte_normales
    n'est pas appele : le GLB est celui d'avant, a l'octet. Le BUREAU porte l'option par la variable FABMESH_NORMAL_MAP_OPTION
    ("1" exactement, option_carte_normales) ; le SITE la porte par la requete (champ normal_map du worker, puis de Modal).
  - PLAFOND : la carte ne depasse jamais PLAFOND_DEFAUT (2048) pixels pour son cote le plus long, quel que soit l'atlas de
    couleur (4096 en Quality et Ultra) ; la variable FABMESH_NORMAL_MAP_MAX le change (valeur invalide : 2048). Proportions
    gardees. MESURE (orc, 500 000 faces, atlas 4096, essai du 15/10) : carte 4096 = +22 Mo sur le GLB, 2048 = +6,4 Mo (presque
    aussi nette), 1024 = +1,9 Mo (perd le detail fin). Le plafond tient aussi la memoire du worker du site, qui recoit les GLB
    des outils en base64. MESURE du 18/10 (build/bancs/memoire_worker_glb.mjs, Node/V8, processus neuf) : la route d'un outil du
    site tient ~3,3 fois la taille du GLB en memoire vivante (isolat limite a 128 Mo) : +6,4 Mo de GLB = ~+21 Mo d'isolat, une
    carte 4096 (+22 Mo) en aurait ajoute ~73.

CONVENTIONS (verifiees par build/bancs/noyaux/test_normal_bake.py contre le decodeur de reference de three.js r170 :
getTangentFrame + normalScale.y = -1 que GLTFLoader pose quand le GLB n'a pas d'attribut TANGENT)
  - Repere du maillage final = celui de to_glb APRES sa conversion (axe haut = Y). Les sommets fins sont dans le repere de la
    grille (axe haut = Z) et subissent la MEME transformation (x, y, z) -> (x, z, -y) : hi_axes='zup_to_yup' (defaut) ;
    hi_axes='none' quand ils sont deja dans le repere du maillage final. Rotation propre : l'orientation des faces ne change pas.
  - UV = `visual.uv` de trimesh : origine en BAS a gauche, v vers le haut. trimesh ecrit TEXCOORD_0 = (u, 1 - v) dans le GLB et
    un lecteur glTF lit l'image depuis le HAUT : la rangee r de l'image (0 = haut) correspond a v = 1 - (r + 0,5) / H, la colonne
    c a u = (c + 0,5) / W. Les centres de texel sont rasterises exactement la (bords de triangle INCLUS). C'est la meme
    disposition que l'atlas baseColor de to_glb : la carte se superpose texel a texel a la couleur.
  - Espace tangent glTF ("OpenGL", Y vers le haut) : ROUGE = +X = sens des U croissants ; VERT = +Y = sens des V croissants de
    trimesh = vers le HAUT de l'image (glTF : "+X is right and +Y is up") ; BLEU = la normale. Neutre = (128, 128, 255).
    Encodage (n * 0,5 + 0,5) * 255, arrondi. Une carte au vert inverse decode un relief creux a la place d'un relief bombe.
  - Repere PAR TRIANGLE, comme les lecteurs qui derivent les tangentes (three.js sans attribut TANGENT) : T = derivee de la
    position par rapport a U, orthogonalisee contre la normale LISSEE du texel (les normales de sommet du maillage final
    interpolees puis normalisees : ce que le fragment recoit) ; B = N x T, de signe pris pour que B soit du cote des V croissants
    (l'orientation de l'ilot est MESUREE : un ilot en miroir ne retourne pas le relief). Le repere cuit est orthonormal : c'est
    celui de MikkTSpace, que la norme glTF demande aux lecteurs sans attribut TANGENT (Blender, Unreal).
  - Correspondance texel -> maillage fin : le point le plus PROCHE (distance 3D), exactement comme to_glb choisit le point de la
    surface fine d'ou il echantillonne les COULEURS (bvh.unsigned_distance) : le relief reste aligne sur la couleur. Pas de lancer de
    rayon le long de la normale (il decalerait le relief par rapport a la couleur des qu'une face legere s'ecarte de la surface fine).
  - Normale fine d'un texel = moyenne des AXES de normale des k sommets fins les plus proches de la position 3D du texel,
    chacun oriente du cote de la normale du maillage final. L'axe d'un sommet fin est l'axe propre dominant de la somme des
    tenseurs aire * n n^T de ses faces : il NE DEPEND PAS de l'orientation des faces. C'est necessaire : o_voxel assemble chaque
    quad de la grille duale dans un ordre fixe par axe (flexible_dual_grid_to_mesh), sans regarder le sens de franchissement de
    l'arete, donc une partie des triangles du maillage fin brut est retournee (mesure du 2026-09-30 : sans orientation des
    voisins l'ecart au rendu du maillage complet etait de 12,9 contre 4,2).
  - Remplissage : tout texel vide dans le carre de demi-cote `padding_px` (distance de Chebyshev) d'un texel couvert prend la valeur
    du texel couvert le plus proche ; plus loin, la normale plate. Un texel couvert par plusieurs triangles (bord commun, ilots
    superposes) va au triangle d'indice le plus grand : deterministe.
  - Export : trimesh avec `extension_webp=True` encode toute texture en WebP AVEC PERTE (qualite 80, chrominance sous-echantillonnee) :
    inacceptable pour des normales. appliquer_carte_normales rend donc l'image "sans perte" (WebP lossless force sur l'objet
    image) ; en PNG (extension_webp=False) rien a faire. Un GLB RELU puis re-exporte (outils) : proteger_cartes_normales, ou
    acceleration_glb.webp_rapide qui pre-encode deja la carte sans perte. La carte peut avoir une taille differente de celle de
    l'atlas couleur (Ultra 8K n'agrandit que la couleur : la carte reste a la taille de l'atlas cuit par to_glb).

LIMITES CONNUES
  - Les lecteurs qui derivent les tangentes a l'ecran (three.js sans attribut TANGENT) ne normalisent pas T et B separement : sur un
    ilot dont la densite d'UV differe selon u et selon v (etire, cisaille), le relief decode est affaibli dans la direction la moins
    dense. Les depliages xatlas sont quasi conformes ; ecrire un attribut TANGENT au GLB supprimerait l'ecart (non fait ici).
  - Plus la surface legere s'ecarte de la surface fine, plus le point le plus proche decale le relief (meme biais que la couleur).
  - Un texel plus petit que le pas des sommets fins (atlas 8192 sur un maillage fin pauvre) est un echantillon lisse, pas un detail neuf.
  - Les UV hors de [0, 1] (repetition) ne sont pas repliees : les triangles sont decoupes aux bords de l'atlas.
  - Parties tres fines ou coins concaves : les k sommets les plus proches peuvent venir d'une AUTRE nappe de la surface fine ; une
    nappe parallele (dessous d'une cape) est neutralisee par l'orientation, une nappe perpendiculaire (aisselle) penche la normale.

DUREES MESUREES (2026-10-13, CPU 16 fils, build/bancs/noyaux/banc_normal_bake_durees.py, 500 000 faces finales, atlas 56 % couvert) :
  2 M de sommets fins + atlas 4096 : 6 s, pic 1,5 Go ; 12 M + 4096 : 14 s, pic 2,4 Go ; 12 M + 8192 : 34 s, pic 3,5 Go
  (avant l'accumulation des tenseurs par blocs en parallele ; voir AGENT_LOG pour les mesures apres).

Exemple :
    glb = o_voxel.postprocess.to_glb(...)                       # trimesh.Trimesh (ou Scene), repere Y haut
    carte = bake_normal_map(glb, o_voxel_obj.vertices, o_voxel_obj.faces, 4096)   # (4096, 4096, 3) uint8 ou None
    if carte is not None:
        appliquer_carte_normales(glb, carte)                    # normalTexture + NORMAL exporte
    glb.export(buf, file_type='glb', extension_webp=True)
  ou, dans un chemin d'export qui ne doit jamais echouer pour la carte :
    ajouter_carte_normales(glb, o_voxel_obj.vertices, o_voxel_obj.faces, log=print)   # lit FABMESH_NORMAL_MAP, ne leve jamais
"""
# --- NOYAU PARTAGE : DEBUT (carte de normales) ---
import os
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import numpy as np

__all__ = ["NORMALE_PLATE", "K_DEFAUT", "PADDING_DEFAUT", "AXES_FINS", "RECALAGE_MAX", "INTERRUPTEUR",
           "PLAFOND_ENV", "PLAFOND_DEFAUT", "OPTION_ENV",
           "bake_normal_map", "appliquer_carte_normales", "proteger_cartes_normales", "retirer_cartes_normales",
           "carte_normales_active", "plafond_carte", "borner_taille", "option_carte_normales", "carte_normales_voulue",
           "taille_atlas", "ajouter_carte_normales"]

#: valeur de la carte la ou rien n'est cuit (normale confondue avec celle du maillage) : (128, 128, 255)
NORMALE_PLATE = (128, 128, 255)
#: nombre de sommets fins moyennes par texel
K_DEFAUT = 4
#: largeur (texels) de la bande remplie autour des ilots
PADDING_DEFAUT = 8
#: reperes acceptes pour les sommets fins
AXES_FINS = ("zup_to_yup", "none")
#: refus du recalage : mediane des distances texel -> sommet fin le plus proche, en fraction de la diagonale du maillage fin
RECALAGE_MAX = 0.10
#: variable d'environnement des chemins d'export : "0" (ou false / no / non / off) = pas de carte, export d'avant a l'octet
INTERRUPTEUR = "FABMESH_NORMAL_MAP"
#: variable d'environnement du PLAFOND de la carte (pixels, cote le plus long). Decision du proprietaire (2026-10-15) : 2048.
#: MESURE (orc, 500 000 faces, atlas 4096) : carte 4096 = +22 Mo, 2048 = +6,4 Mo (presque aussi nette), 1024 = +1,9 Mo (perd le detail fin)
PLAFOND_ENV = "FABMESH_NORMAL_MAP_MAX"
#: plafond quand PLAFOND_ENV est absente ou invalide
PLAFOND_DEFAUT = 2048
#: variable qui porte l'OPTION par generation ("relief pour moteur de jeu") jusqu'au processus du BUREAU ("1" exactement) ;
#: le site la porte par la requete (generate(normal_map=True))
OPTION_ENV = "FABMESH_NORMAL_MAP_OPTION"
#: taille de la carte quand la scene n'a pas d'atlas de couleur
TAILLE_REPLI = 2048
#: reglages WebP sans perte appliques a la carte a l'export. MESURE (2026-10-04, carte 4096 x 4096, 56 % couverte, 1 fil) : method 1 /
#: quality 0 = 1,8 s et 3,5 Mo (relief lisse), 2,2 s et 15,1 Mo (relief bruite) ; method 0 = 0,5 s mais 6,0 et 20,3 Mo ; method 2 / quality 75
#: = 3,9 s et 10 s pour 3,4 et 15,4 Mo (la qualite n'achete presque rien en sans perte). Le WebP avec perte (defaut de trimesh) : 0,4 Mo mais
#: jusqu'a 97 degrees d'erreur de normale aux bords des ilots.
WEBP_SANS_PERTE = {"lossless": True, "quality": 0, "method": 1}

#: plafond du nombre de fils quand workers = -1 (mesure du 2026-10-04 : 7,2 fois plus vite avec 8 fils, ~27 Mo de memoire de travail par fil)
FILS_MAX = 16
#: plafond des fils de l'accumulation des tenseurs des sommets fins (2026-10-13 : 12 M de sommets, 6,2 s a 1 fil, 2,8 s a 4, 2,3 s a 8 ;
#: chaque fil garde au plus un bloc de faces et sa fenetre de sommets, ~100 Mo)
FILS_AXES_MAX = 4

_EPS_PX = 1e-7            # tolerance (texels) d'appartenance d'un centre de texel a un triangle : bords inclus, aucun trou
_AIRE_MIN_PX2 = 1e-6      # triangle UV dont DEUX fois l'aire (texels^2) est sous ce seuil : ignore
_BLOC_PAIRES = 1000000    # paires (triangle, rangee) traitees d'un coup par le rasteriseur
_BLOC_TEXELS = 2000000    # texels produits d'un coup par le rasteriseur
_BLOC_FACES = 1000000     # faces fines lues d'un coup pour les axes de sommet
_FENETRE_MAX = 2000000    # sommets : fenetre d'un bloc de faces au-dela de laquelle le fil ne la copie pas (faces non rangees)
_BLOC_SOMMETS = 1000000   # sommets fins traites d'un coup par l'iteration de la puissance
_BLOC_OMBRAGE = 131072    # texels ombres d'un coup (par fil)
_BANDE_REMPLISSAGE = 1024  # lignes d'atlas traitees d'un coup par le remplissage des bords


def _ligne(log, texte):
    """Journal : jamais une exception (un journal casse ne doit pas faire echouer la cuisson)."""
    if log is None:
        return
    try:
        log(texte)
    except Exception:
        pass


def _est_torch(x):
    return type(x).__module__.split(".")[0] == "torch" and hasattr(x, "detach")


def _numpy(x):
    """Tableau numpy depuis numpy, torch (CPU ou GPU) ou liste ; sans copie quand c'est possible."""
    if _est_torch(x):
        x = x.detach()
        if x.device.type != "cpu":
            x = x.cpu()
        try:
            return x.numpy()
        except TypeError:           # bfloat16 : pas de numpy
            return x.float().numpy()
    return np.asarray(x)


def _taille_texture(texture_size):
    """(H, W) depuis un entier ou un couple (hauteur, largeur)."""
    if isinstance(texture_size, (tuple, list)) and len(texture_size) == 2:
        h, w = int(texture_size[0]), int(texture_size[1])
    else:
        h = w = int(texture_size)
    if h < 1 or w < 1 or h > 16384 or w > 16384:
        raise ValueError("texture_size : entier de 1 a 16384 attendu, recu %r" % (texture_size,))
    return h, w


def _nb_fils(workers, nb_taches):
    """Nombre de fils : workers < 0 ou None = les coeurs visibles, au plus FILS_MAX (un conteneur peut annoncer 64 coeurs pour 8 reels) ;
    un nombre positif est respecte ; jamais plus de fils que de taches."""
    n = min(os.cpu_count() or 1, FILS_MAX) if (workers is None or int(workers) < 0) else max(1, int(workers))
    return max(1, min(n, nb_taches))


def _en_ordre(fonction, elements, fils):
    """Resultats de fonction(e) pour chaque element, DANS L'ORDRE des elements, calcules par `fils` fils ; au plus 2 x fils
    calculs d'avance (memoire bornee : un resultat attend d'etre consomme). fils <= 1 : dans le fil appelant."""
    if fils <= 1:
        for e in elements:
            yield fonction(e)
        return
    from collections import deque
    with ThreadPoolExecutor(max_workers=fils) as pool:
        attente = deque()
        for e in elements:
            attente.append(pool.submit(fonction, e))
            if len(attente) >= 2 * fils:
                yield attente.popleft().result()
        while attente:
            yield attente.popleft().result()


# ---------------------------------------------------------------------------------------------------------------------
# Maillage final : geometries texturees, normales de sommet, reperes par triangle
# ---------------------------------------------------------------------------------------------------------------------

def _elements(scene):
    """[(nom, geometrie)] d'une Scene trimesh, ou [("maillage", objet)] pour un Trimesh seul (ou None)."""
    geometries = getattr(scene, "geometry", None)
    if isinstance(geometries, dict):
        return list(geometries.items())
    return [("maillage", scene)]


def _geometries_texturees(scene, log=None):
    """[(nom, maillage)] des geometries d'une Scene trimesh (ou d'un Trimesh seul) qui ont des faces et des UV par sommet."""
    sortie = []
    for nom, g in _elements(scene):
        sommets = getattr(g, "vertices", None)
        faces = getattr(g, "faces", None)
        if sommets is None or faces is None or len(faces) == 0:
            continue
        uv = getattr(getattr(g, "visual", None), "uv", None)
        if uv is None or len(uv) != len(sommets):
            _ligne(log, "[normales] geometrie %r sans UV par sommet : ignoree" % (nom,))
            continue
        sortie.append((nom, g))
    return sortie


def _normales_signees(V, F):
    """Normales de sommet (somme des produits vectoriels des faces, non normalisees) : repli quand trimesh n'en donne pas."""
    c = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    c[~np.isfinite(c).all(axis=1)] = 0.0
    N = np.zeros_like(V)
    for j in range(3):
        for a in range(3):
            N[:, a] += np.bincount(F[:, j], weights=c[:, a], minlength=len(V))
    return N


def _unitaires(N, repli):
    """N normalise ; les vecteurs nuls ou non finis sont remplaces par `repli` (meme forme, deja unitaire, ou un seul vecteur)."""
    with np.errstate(all="ignore"):
        n = np.sqrt((N * N).sum(axis=1))
        ok = np.isfinite(n) & (n > 1e-12)
        sortie = np.where(ok[:, None], N / np.where(ok, n, 1.0)[:, None], repli)
    return sortie


def _assembler_final(geometries):
    """Concatene les geometries : sommets, UV, normales de sommet (unitaires) et faces (indices decales)."""
    Vs, UVs, Ns, Fs = [], [], [], []
    decalage = 0
    for nom, g in geometries:
        V = np.asarray(g.vertices, dtype=np.float64).reshape(-1, 3)
        F = np.asarray(g.faces, dtype=np.int64).reshape(-1, 3)
        if len(F) and (int(F.min()) < 0 or int(F.max()) >= len(V)):
            raise ValueError("geometrie %r : indice de sommet hors limites" % (nom,))
        UV = np.asarray(g.visual.uv, dtype=np.float64)[:, :2]
        try:
            N = np.asarray(g.vertex_normals, dtype=np.float64).reshape(-1, 3)
        except Exception:
            N = None
        if N is None or N.shape != V.shape:
            N = _normales_signees(V, F)
        else:
            invalides = ~(np.isfinite(N).all(axis=1) & ((N * N).sum(axis=1) > 1e-24))
            if invalides.any():                      # normale absente ou nulle sur certains sommets : celle de leurs faces
                geo = _normales_signees(V, F)
                N = np.where(invalides[:, None], geo, N)
        Vs.append(V)
        UVs.append(UV)
        Ns.append(N)
        Fs.append(F + decalage)
        decalage += len(V)
    V = np.concatenate(Vs)
    N = np.concatenate(Ns)
    return V, np.concatenate(UVs), _unitaires(N, np.array([0.0, 1.0, 0.0])), np.concatenate(Fs)


def _reperes_faces(V, UV, F, H, W):
    """Donnees par triangle du maillage final.

    Rend un dict : Pu, Pv (derivees de la position par rapport a u et a v de trimesh), Nf (normale geometrique unitaire),
    ax..cy (sommets en coordonnees de texel : x = u * W, y = (1 - v) * H, rangee 0 en haut), inv_aire2 (1 / deux fois l'aire en
    texels^2) et valide (triangle rasterisable : fini, aire UV non nulle)."""
    with np.errstate(all="ignore"):
        i0, i1, i2 = F[:, 0], F[:, 1], F[:, 2]
        p0, p1, p2 = V[i0], V[i1], V[i2]
        e1, e2 = p1 - p0, p2 - p0
        du1, dv1 = UV[i1, 0] - UV[i0, 0], UV[i1, 1] - UV[i0, 1]
        du2, dv2 = UV[i2, 0] - UV[i0, 0], UV[i2, 1] - UV[i0, 1]
        det = du1 * dv2 - du2 * dv1
        ax, ay = UV[i0, 0] * W, (1.0 - UV[i0, 1]) * H
        bx, by = UV[i1, 0] * W, (1.0 - UV[i1, 1]) * H
        cx, cy = UV[i2, 0] * W, (1.0 - UV[i2, 1]) * H
        aire2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        valide = (np.isfinite(aire2) & (np.abs(aire2) > _AIRE_MIN_PX2) & np.isfinite(det) & (det != 0.0)
                  & np.isfinite(e1).all(axis=1) & np.isfinite(e2).all(axis=1))
        sur = np.where(valide, det, 1.0)
        Pu = (e1 * dv2[:, None] - e2 * dv1[:, None]) / sur[:, None]
        Pv = (e2 * du1[:, None] - e1 * du2[:, None]) / sur[:, None]
        Pu[~valide] = 0.0
        Pv[~valide] = 0.0
        Nf = _unitaires(np.cross(e1, e2), np.array([0.0, 1.0, 0.0]))
        inv_aire2 = np.where(valide, 1.0 / np.where(valide, aire2, 1.0), 0.0)
    return {"Pu": Pu, "Pv": Pv, "Nf": Nf, "ax": ax, "ay": ay, "bx": bx, "by": by, "cx": cx, "cy": cy,
            "inv_aire2": inv_aire2, "valide": valide}


# ---------------------------------------------------------------------------------------------------------------------
# Rasterisation des triangles dans l'espace UV (balayage par rangees, vectorise)
# ---------------------------------------------------------------------------------------------------------------------

def _poser_max(proprietaire, lin, tri):
    """proprietaire[lin] = max(proprietaire[lin], tri), deterministe meme quand `lin` contient des doublons."""
    while lin.size:
        garde = tri > proprietaire[lin]
        if not garde.any():
            return
        lin = lin[garde]
        tri = tri[garde]
        proprietaire[lin] = tri


def _rasteriser(g, H, W):
    """Carte (H * W,) int32 du triangle proprietaire de chaque texel (-1 = vide).

    Un texel appartient a un triangle quand son CENTRE (c + 0,5 ; r + 0,5) est dedans, bords compris. Pour chaque paire
    (triangle, rangee) on calcule l'intervalle exact du triangle sur la droite y = r + 0,5, puis les texels de cet intervalle :
    aucun candidat inutile, quelle que soit la taille des triangles."""
    proprietaire = np.full(H * W, -1, dtype=np.int32)
    valide = g["valide"]
    if not valide.any():
        return proprietaire
    with np.errstate(all="ignore"):
        ax, ay, bx, by, cx, cy = (np.where(valide, g[c], 0.0) for c in ("ax", "ay", "bx", "by", "cx", "cy"))
        ymin = np.minimum(np.minimum(ay, by), cy)
        ymax = np.maximum(np.maximum(ay, by), cy)
        r0 = np.clip(np.ceil(ymin - 0.5 - _EPS_PX), 0, H).astype(np.int64)
        r1 = np.clip(np.floor(ymax - 0.5 + _EPS_PX), -1, H - 1).astype(np.int64)
        nr = np.where(valide, np.maximum(r1 - r0 + 1, 0), 0)
        fid = np.flatnonzero(nr > 0)
        if fid.size == 0:
            return proprietaire
        nrf = nr[fid]
        cum = np.cumsum(nrf)
        i, n = 0, len(fid)
        while i < n:
            base = int(cum[i - 1]) if i else 0
            j = min(max(int(np.searchsorted(cum, base + _BLOC_PAIRES, side="right")), i + 1), n)
            f = fid[i:j]
            cnt = nrf[i:j]
            tot = int(cnt.sum())
            loc = np.repeat(np.arange(j - i), cnt)
            fa = f[loc]                                          # triangle de chaque paire
            row = r0[fa] + (np.arange(tot) - np.repeat(np.cumsum(cnt) - cnt, cnt))
            yc = row + 0.5
            x0, y0, x1, y1, x2, y2 = ax[fa], ay[fa], bx[fa], by[fa], cx[fa], cy[fa]
            xl = np.full(tot, np.inf)
            xr = np.full(tot, -np.inf)
            for xa, ya, xb, yb in ((x0, y0, x1, y1), (x1, y1, x2, y2), (x2, y2, x0, y0)):
                dy = yb - ya
                horizontale = dy == 0.0
                t = (yc - ya) / np.where(horizontale, 1.0, dy)
                ok = (~horizontale) & (t >= -1e-9) & (t <= 1.0 + 1e-9)
                x = xa + t * (xb - xa)
                xl = np.where(ok, np.minimum(xl, x), xl)
                xr = np.where(ok, np.maximum(xr, x), xr)
            touche = np.isfinite(xl) & np.isfinite(xr)
            c0 = np.clip(np.ceil(np.where(touche, xl, 0.0) - 0.5 - _EPS_PX), 0, W).astype(np.int64)
            c1 = np.clip(np.floor(np.where(touche, xr, -1.0) - 0.5 + _EPS_PX), -1, W - 1).astype(np.int64)
            cn = np.where(touche, np.maximum(c1 - c0 + 1, 0), 0)
            cs = np.cumsum(cn)
            k0 = 0
            while k0 < tot:
                base = int(cs[k0 - 1]) if k0 else 0
                k1 = min(max(int(np.searchsorted(cs, base + _BLOC_TEXELS, side="right")), k0 + 1), tot)
                c = cn[k0:k1]
                m = int(c.sum())
                if m:
                    pr = np.repeat(np.arange(k0, k1), c)
                    col = c0[pr] + (np.arange(m) - np.repeat(np.cumsum(c) - c, c))
                    _poser_max(proprietaire, row[pr] * W + col, fa[pr].astype(np.int32))
                k0 = k1
            i = j
    return proprietaire


# ---------------------------------------------------------------------------------------------------------------------
# Maillage fin : axes de normale des sommets, arbre KD
# ---------------------------------------------------------------------------------------------------------------------

def _tenseurs_bloc(V, F, d):
    """Faces fines [d, d + _BLOC_FACES[ : (bas, haut, sommes) ou `sommes` (6, haut - bas) float64 = pour chaque sommet de la
    fenetre [bas, haut[, la somme sur ses faces du bloc des 6 composantes de aire * n n^T (xx, yy, zz, xy, xz, yz ; c c^T / |c|
    avec c = produit vectoriel des deux aretes). Une face degeneree ou non finie ne compte pas. Quand la fenetre depasse
    _FENETRE_MAX (faces non rangees par voxel), `sommes` est None et le 4e element porte (coins, composantes) pour une
    accumulation sans copie de la fenetre. Ne modifie aucun etat partage : appelable depuis plusieurs fils."""
    f = np.ascontiguousarray(_numpy(F[d:d + _BLOC_FACES]), dtype=np.intp)
    if f.size == 0:
        return 0, 0, None, None
    with np.errstate(all="ignore"):
        p0 = V[f[:, 0]]
        c = np.cross(V[f[:, 1]] - p0, V[f[:, 2]] - p0)
        long = np.sqrt((c * c).sum(axis=1))
        ok = np.isfinite(long) & (long > 0)
        if not ok.all():
            c[~ok] = 0.0
            long = np.where(ok, long, 1.0)
        inv = (1.0 / long).astype(c.dtype, copy=False)
        cx, cy, cz = c[:, 0], c[:, 1], c[:, 2]
        cxi, cyi, czi = cx * inv, cy * inv, cz * inv
        composantes = (cxi * cx, cyi * cy, czi * cz, cxi * cy, cxi * cz, cyi * cz)
    bas = int(f.min())
    haut = int(f.max()) + 1
    coins = [f[:, j] - bas for j in range(3)]
    if haut - bas > _FENETRE_MAX:
        return bas, haut, None, (coins, composantes)
    return bas, haut, _sommer(coins, composantes, haut - bas), None


def _somme_coins(coins, w, n):
    """(n,) float64 : pour chaque sommet de la fenetre, somme du poids `w` de ses faces sur les trois coins (ordre fixe)."""
    s = np.bincount(coins[0], weights=w, minlength=n)
    s += np.bincount(coins[1], weights=w, minlength=n)
    s += np.bincount(coins[2], weights=w, minlength=n)
    return s


def _sommer(coins, composantes, n):
    """(6, n) float64 : les six composantes sommees par sommet (voir _somme_coins)."""
    sommes = np.empty((6, n), dtype=np.float64)
    for k, w in enumerate(composantes):
        sommes[k] = _somme_coins(coins, w, n)
    return sommes


def _axe_dominant(acc, a, b):
    """Axes unitaires (b - a, 3) float32 des sommets [a, b[ : 4 applications de la matrice depuis la colonne de plus grande diagonale
    (iteration de la puissance) ; (0, 0, 0) pour un sommet sans face."""
    xx, yy, zz, xy, xz, yz = acc[:, a:b]
    kx = (xx >= yy) & (xx >= zz)
    ky = (~kx) & (yy >= zz)
    vx = np.where(kx, xx, np.where(ky, xy, xz))
    vy = np.where(kx, xy, np.where(ky, yy, yz))
    vz = np.where(kx, xz, np.where(ky, yz, zz))
    del kx, ky
    for etape in range(4):
        nrm = np.sqrt(vx * vx + vy * vy + vz * vz)
        nrm = np.where(nrm > 0, nrm, np.float32(1.0))
        vx, vy, vz = vx / nrm, vy / nrm, vz / nrm
        if etape == 3:
            break
        vx, vy, vz = (xx * vx + xy * vy + xz * vz), (xy * vx + yy * vy + yz * vz), (xz * vx + yz * vy + zz * vz)
    return np.stack([vx, vy, vz], axis=1).astype(np.float32, copy=False)


def _axes_fins(V, F, fils=1):
    """Axe de normale unitaire de chaque sommet fin, INDEPENDANT de l'orientation des faces.

    Somme, par sommet, des tenseurs aire * n n^T de ses faces (6 composantes), puis l'axe propre dominant (iteration de la
    puissance). Rend (axes (n, 3) float32, utilises (n,) bool : sommet porte par au moins une face non degeneree). Faces lues par
    blocs de _BLOC_FACES, calcules par `fils` fils ; chaque bloc n'accumule que la FENETRE d'indices de sommets qu'il emploie (les
    faces d'o_voxel sont rangees par voxel : une fenetre etroite). Les sommes de chaque bloc sont ajoutees dans l'ORDRE des blocs :
    le resultat ne depend pas du nombre de fils."""
    n = len(V)
    acc = np.zeros((6, n), dtype=np.float32)
    nf = int(F.shape[0])
    debuts = list(range(0, nf, _BLOC_FACES))
    for bas, haut, sommes, differe in _en_ordre(lambda d: _tenseurs_bloc(V, F, d), debuts, max(1, min(int(fils), len(debuts)))):
        if differe is not None:                                   # fenetre trop large : composante par composante, sans copie
            coins, composantes = differe
            for k, w in enumerate(composantes):
                acc[k, bas:haut] += _somme_coins(coins, w, haut - bas)
        elif sommes is not None:
            acc[:, bas:haut] += sommes
    valides = (acc[0] + acc[1] + acc[2]) > 0
    axes = np.empty((n, 3), dtype=np.float32)
    tranches = [(a, min(a + _BLOC_SOMMETS, n)) for a in range(0, n, _BLOC_SOMMETS)]

    def tranche(ab):
        axes[ab[0]:ab[1]] = _axe_dominant(acc, ab[0], ab[1])     # tranches disjointes : aucun conflit entre fils
        return ab
    for _ in _en_ordre(tranche, tranches, max(1, min(int(fils), len(tranches)))):
        pass
    del acc
    return axes, valides


def _vers_final(v, mode):
    """(m, 3) du repere fin vers le repere du maillage final : (x, y, z) -> (x, z, -y) pour 'zup_to_yup' (celui de to_glb)."""
    if mode == "zup_to_yup":
        return np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1)
    return v


def _vers_fin(v, mode):
    """Inverse de _vers_final : (X, Y, Z) -> (X, -Z, Y)."""
    if mode == "zup_to_yup":
        return np.stack([v[:, 0], -v[:, 2], v[:, 1]], axis=1)
    return v


def _arbre_fins(V, retenus, mode):
    """cKDTree des sommets fins retenus, DEJA dans le repere du maillage final (une seule copie float64)."""
    from scipy.spatial import cKDTree
    sel = V if retenus is None else V[retenus]
    pts = np.empty((len(sel), 3), dtype=np.float64)
    if mode == "zup_to_yup":
        pts[:, 0] = sel[:, 0]
        pts[:, 1] = sel[:, 2]
        pts[:, 2] = -sel[:, 1]
    else:
        pts[:] = sel
    return cKDTree(pts, leafsize=16, compact_nodes=False, balanced_tree=False, copy_data=False)


# ---------------------------------------------------------------------------------------------------------------------
# Ombrage : une normale en espace tangent par texel couvert
# ---------------------------------------------------------------------------------------------------------------------

def _ombrer(ti, ctx):
    """(valeurs (m, 3) uint8, nb de replis, echantillon d'ecarts en degres, echantillon de distances) pour les texels `ti`
    (indices lineaires, tous couverts). Ne modifie aucun etat partage : appelable depuis plusieurs fils."""
    g, W = ctx.g, ctx.W
    tri = ctx.proprietaire[ti].astype(np.int64)
    rang = ti // W
    xc = (ti - rang * W) + 0.5
    yc = rang + 0.5
    ia = g["inv_aire2"][tri]
    ax, ay, bx, by, cx, cy = (g[c][tri] for c in ("ax", "ay", "bx", "by", "cx", "cy"))
    la = ((bx - xc) * (cy - yc) - (by - yc) * (cx - xc)) * ia
    lb = ((cx - xc) * (ay - yc) - (cy - yc) * (ax - xc)) * ia
    lc = 1.0 - la - lb
    f = ctx.F[tri]
    la, lb, lc = la[:, None], lb[:, None], lc[:, None]
    P = la * ctx.V[f[:, 0]] + lb * ctx.V[f[:, 1]] + lc * ctx.V[f[:, 2]]
    N = _unitaires(la * ctx.N[f[:, 0]] + lb * ctx.N[f[:, 1]] + lc * ctx.N[f[:, 2]], g["Nf"][tri])

    # repere du texel : T = dP/du orthogonalise contre N ; B = N x T, du cote des v croissants
    Pu = g["Pu"][tri]
    T = Pu - (Pu * N).sum(axis=1)[:, None] * N
    tn = np.sqrt((T * T).sum(axis=1))
    mauvais = ~(tn > 1e-9 * np.sqrt((Pu * Pu).sum(axis=1)) + 1e-300)
    if mauvais.any():                                          # tangente nulle ou colineaire a N : une perpendiculaire quelconque
        axe = np.where(np.abs(N[:, 0:1]) < 0.6, np.array([[1.0, 0.0, 0.0]]), np.array([[0.0, 1.0, 0.0]]))
        T = np.where(mauvais[:, None], np.cross(N, axe), T)
        tn = np.sqrt((T * T).sum(axis=1))
    T = T / tn[:, None]
    B = np.cross(N, T)
    B = B * np.where((B * g["Pv"][tri]).sum(axis=1) < 0, -1.0, 1.0)[:, None]

    # normale fine : axes des k sommets fins les plus proches, orientes du cote de N, moyennes
    dist, nn = ctx.arbre.query(P, k=ctx.k, workers=1)
    if ctx.k == 1:
        nn = nn[:, None]
        dist = dist[:, None]
    G = ctx.axes[nn]                                           # (m, k, 3) float32, repere fin
    Nr = _vers_fin(N, ctx.mode).astype(np.float32)
    signe = np.where((G * Nr[:, None, :]).sum(axis=2) < 0, np.float32(-1.0), np.float32(1.0))
    S = _vers_final((G * signe[:, :, None]).sum(axis=1).astype(np.float64), ctx.mode)
    ln = np.sqrt((S * S).sum(axis=1))
    bon = ln > 1e-12
    nh = np.where(bon[:, None], S / np.where(bon, ln, 1.0)[:, None], N)
    zt = (nh * N).sum(axis=1)
    repli = (~bon) | (zt <= 0.0)
    if repli.any():
        nh = np.where(repli[:, None], N, nh)
        zt = np.where(repli, 1.0, zt)
    ts = np.stack([(nh * T).sum(axis=1), (nh * B).sum(axis=1), zt], axis=1)
    ts /= np.sqrt((ts * ts).sum(axis=1))[:, None]
    mal = ~np.isfinite(ts).all(axis=1)
    if mal.any():
        ts[mal] = (0.0, 0.0, 1.0)
        repli = repli | mal
    valeurs = np.clip(np.floor((ts * 0.5 + 0.5) * 255.0 + 0.5), 0, 255).astype(np.uint8)
    return valeurs, int(repli.sum()), np.degrees(np.arccos(np.clip(ts[::16, 2], -1.0, 1.0))), dist[::16, 0]


# ---------------------------------------------------------------------------------------------------------------------
# Remplissage des bords des ilots
# ---------------------------------------------------------------------------------------------------------------------

def _remplir_bords(image, couvert, padding):
    """Texel vide dans le carre de demi-cote `padding` d'un texel couvert : valeur du texel couvert le plus proche.

    `image` (H, W, 3) uint8 modifiee sur place ; `couvert` (H, W) bool. Par bandes de lignes (avec une marge qui rend le resultat
    independant de la taille des bandes) pour borner la memoire a 8192 x 8192. Rend le nombre de texels remplis."""
    from scipy import ndimage
    H = couvert.shape[0]
    p = int(padding)
    marge = int(np.ceil(1.4143 * p)) + 1             # le texel couvert le plus proche d'un texel de la zone est a moins de p * racine(2)
    rempli = 0
    for r in range(0, H, _BANDE_REMPLISSAGE):
        a, b = max(0, r - marge), min(H, r + _BANDE_REMPLISSAGE + marge)
        cv = couvert[a:b]
        if not cv.any() or cv.all():
            continue
        lo = r - a
        hi = lo + min(_BANDE_REMPLISSAGE, H - r)
        z = ndimage.maximum_filter1d(cv.view(np.uint8), 2 * p + 1, axis=0, mode="constant")
        z = ndimage.maximum_filter1d(z, 2 * p + 1, axis=1, mode="constant")
        rr, cc = np.nonzero((z[lo:hi] != 0) & ~cv[lo:hi])
        if rr.size == 0:
            continue
        idx = ndimage.distance_transform_edt(~cv, return_distances=False, return_indices=True)
        image[r + rr, cc] = image[idx[0][lo:hi][rr, cc] + a, idx[1][lo:hi][rr, cc]]
        rempli += int(rr.size)
    return rempli


# ---------------------------------------------------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------------------------------------------------

def bake_normal_map(scene, hi_vertices, hi_faces, texture_size, *, k=K_DEFAUT, padding_px=PADDING_DEFAUT,
                    hi_axes="zup_to_yup", log=print, workers=-1, stats=None):
    """Cuit la carte de normales (espace tangent glTF) du maillage fin vers le maillage final de `scene`.

      scene         : trimesh.Scene (ou Trimesh) du maillage FINAL leger, avec UV (sortie de to_glb). Toutes ses geometries
                      texturees sont cuites dans la MEME image (elles partagent l'atlas) ; pour des atlas distincts, appeler
                      une fois par geometrie avec une scene d'une seule geometrie. Les transformations de noeud sont ignorees :
                      les sommets fins doivent etre dans le repere LOCAL des geometries.
      hi_vertices   : (N, 3) sommets du maillage fin, numpy ou torch (GPU accepte), dans le repere `hi_axes`.
      hi_faces      : (M, 3) indices de faces fines (numpy ou torch ; int32 ou int64) ; l'ORIENTATION des faces est sans effet.
      texture_size  : cote de la carte en texels (entier, jusqu'a 16384 ; 8192 teste), ou couple (hauteur, largeur).
      k             : sommets fins moyennes par texel (4 : lisse le bruit d'un seul sommet sans effacer le relief).
      padding_px    : demi-cote du remplissage autour des ilots (0 : aucun).
      hi_axes       : 'zup_to_yup' (defaut) = repere de la grille TRELLIS (Z haut), converti comme to_glb ; 'none'.
      log           : appelable recevant des chaines (print par defaut ; None pour se taire).
      workers       : fils de l'ombrage (-1 = tous les coeurs ; 1 = sans fil). Le resultat ne depend pas de ce nombre.
      stats         : dict facultatif rempli de mesures (duree par phase, texels couverts, replis, ecart moyen...).

    Rend un tableau uint8 (H, W, 3) (rangee 0 = haut de l'image) ou None quand il n'y a rien a cuire (la raison est journalisee) ;
    la scene n'est pas modifiee : voir appliquer_carte_normales."""
    t0 = time.perf_counter()
    phases = {}
    if stats is None:
        stats = {}
    stats.update({"phases": phases, "repli": 0})
    if hi_axes not in AXES_FINS:
        raise ValueError("hi_axes : %s attendu, recu %r" % (" ou ".join(repr(a) for a in AXES_FINS), hi_axes))
    k = int(k)
    if k < 1:
        raise ValueError("k : entier >= 1 attendu, recu %r" % (k,))
    padding = int(padding_px)
    if padding < 0:
        raise ValueError("padding_px : entier >= 0 attendu, recu %r" % (padding_px,))
    H, W = _taille_texture(texture_size)

    # maillage fin : validation (sans copie)
    if hi_vertices is None or hi_faces is None:
        _ligne(log, "[normales] maillage fin absent : rien a cuire")
        return None
    if not _est_torch(hi_faces):
        hi_faces = np.asarray(hi_faces)
    V = _numpy(hi_vertices)
    if V.size == 0 or hi_faces.shape[0] == 0:
        _ligne(log, "[normales] maillage fin vide : rien a cuire")
        return None
    if V.ndim != 2 or V.shape[1] != 3:
        raise ValueError("hi_vertices : forme (N, 3) attendue, recu %s" % (tuple(V.shape),))
    if V.dtype != np.float32 and V.dtype != np.float64:
        V = V.astype(np.float32)
    if len(hi_faces.shape) != 2 or hi_faces.shape[1] != 3:
        raise ValueError("hi_faces : forme (M, 3) attendue, recu %s" % (tuple(hi_faces.shape),))
    fmin, fmax = int(hi_faces.min()), int(hi_faces.max())
    if fmin < 0 or fmax >= len(V):
        raise ValueError("hi_faces : indice de sommet hors limites (%d a %d pour %d sommets)" % (fmin, fmax, len(V)))
    nb_fines = int(hi_faces.shape[0])

    # maillage final : geometries texturees
    t = time.perf_counter()
    geoms = _geometries_texturees(scene, log)
    if not geoms:
        _ligne(log, "[normales] maillage final sans UV exploitable (ou sans face) : aucune carte cuite, scene inchangee")
        return None
    Vf, UVf, Nsom, Ff = _assembler_final(geoms)
    g = _reperes_faces(Vf, UVf, Ff, H, W)
    nb_finales = len(Ff)
    phases["preparation"] = time.perf_counter() - t
    _ligne(log, "[normales] %d faces finales (%d geometrie(s)), %d sommets fins, %d faces fines, atlas %dx%d, k=%d, remplissage %d px"
           % (nb_finales, len(geoms), len(V), nb_fines, W, H, k, padding))

    # 1. rasterisation UV : proprietaire de chaque texel
    t = time.perf_counter()
    proprietaire = _rasteriser(g, H, W)
    couvert = (proprietaire >= 0).reshape(H, W)
    nb_couverts = int(couvert.sum())
    phases["rasterisation"] = time.perf_counter() - t
    stats.update({"faces_finales": nb_finales, "sommets_fins": len(V), "faces_fines": nb_fines, "texels_couverts": nb_couverts,
                  "part_atlas": nb_couverts / float(H * W), "triangles_ignores": int((~g["valide"]).sum())})
    _ligne(log, "[normales] rasterisation UV : %d texels couverts (%.1f %% de l'atlas, %d triangle(s) UV ignores) en %.1f s"
           % (nb_couverts, 100.0 * nb_couverts / (H * W), stats["triangles_ignores"], phases["rasterisation"]))
    if nb_couverts == 0:
        _ligne(log, "[normales] aucun texel couvert (UV hors de l'atlas ou triangles degeneres) : aucune carte cuite")
        return None

    # 2. maillage fin : axes de normale des sommets, arbre KD dans le repere du maillage final
    t = time.perf_counter()
    fils_axes = min(_nb_fils(workers, -(-nb_fines // _BLOC_FACES)), FILS_AXES_MAX)
    axes, utilises = _axes_fins(V, hi_faces, fils_axes)
    with np.errstate(invalid="ignore"):
        utilises &= np.isfinite(V).all(axis=1)
    phases["axes_fins"] = time.perf_counter() - t
    retenus = None if utilises.all() else np.flatnonzero(utilises)
    if retenus is not None:
        if retenus.size == 0:
            _ligne(log, "[normales] aucun sommet fin utilisable : aucune carte cuite")
            return None
        axes = axes[retenus]
    t = time.perf_counter()
    arbre = _arbre_fins(V, retenus, hi_axes)
    phases["arbre_kd"] = time.perf_counter() - t
    pts_utiles = int(arbre.n)
    k = min(k, pts_utiles)
    etendue = np.asarray(arbre.maxes) - np.asarray(arbre.mins)
    diagonale = float(np.sqrt((etendue * etendue).sum())) or 1.0

    # 3. ombrage : une normale en espace tangent par texel couvert, par bandes de lignes (en parallele)
    t = time.perf_counter()
    image = np.empty((H, W, 3), dtype=np.uint8)
    image[:] = NORMALE_PLATE
    ctx = SimpleNamespace(g=g, W=W, F=Ff, V=Vf, N=Nsom, proprietaire=proprietaire, arbre=arbre, axes=axes, k=k, mode=hi_axes)
    lignes = max(1, _BLOC_OMBRAGE // W)
    bandes = [(r, min(r + lignes, H)) for r in range(0, H, lignes)]
    bandes = [b for b in bandes if couvert[b[0]:b[1]].any()]

    def travail(b):
        loc = np.flatnonzero(couvert[b[0]:b[1]])
        ti = loc + b[0] * W
        return b, loc, _ombrer(ti, ctx)

    angles, distances, replis = [], [], 0

    def ranger(resultat):
        nonlocal replis
        b, loc, (valeurs, nb_repli, ang, dist) = resultat
        bande = image[b[0]:b[1]].reshape(-1, 3)
        bande[loc] = valeurs
        angles.append(ang)
        distances.append(dist)
        replis += nb_repli

    premier = travail(bandes[0])                               # controle du recalage sur la premiere bande, avant le reste
    mediane = float(np.median(premier[2][3]))
    if mediane > RECALAGE_MAX * diagonale:
        _ligne(log, "[normales] REFUS : distance mediane texel -> sommet fin le plus proche = %.4g (%.0f %% de la diagonale du "
                    "maillage fin, limite %.0f %%) : les sommets fins ne se superposent pas au maillage final (repere ? "
                    "hi_axes=%r) ; aucune carte cuite" % (mediane, 100.0 * mediane / diagonale, 100.0 * RECALAGE_MAX, hi_axes))
        stats["refus"] = "recalage"
        return None
    ranger(premier)
    suite = bandes[1:]
    nfils = _nb_fils(workers, len(suite))
    for resultat in _en_ordre(travail, suite, nfils):
        ranger(resultat)
    phases["ombrage"] = time.perf_counter() - t
    stats["repli"] = replis
    stats["fils"] = nfils
    stats["fils_axes"] = fils_axes
    stats["ecart_moyen_deg"] = float(np.concatenate(angles).mean())
    stats["distance_mediane_rel"] = float(np.median(np.concatenate(distances))) / diagonale
    _ligne(log, "[normales] ombrage : %d texels en %.1f s (%d fil(s) ; arbre KD %d points : axes %.1f s (%d fil(s)) + construction "
                "%.1f s ; repli sur la normale plate : %d ; ecart moyen normale fine / normale du maillage final %.1f deg ; distance "
                "mediane au sommet fin %.2g %% de la diagonale)"
           % (nb_couverts, phases["ombrage"], nfils, pts_utiles, phases["axes_fins"], fils_axes, phases["arbre_kd"], replis,
              stats["ecart_moyen_deg"], 100.0 * stats["distance_mediane_rel"]))

    # 4. bords des ilots
    t = time.perf_counter()
    if padding > 0:
        stats["texels_remplis"] = _remplir_bords(image, couvert, padding)
    phases["remplissage"] = time.perf_counter() - t
    stats["duree_s"] = time.perf_counter() - t0
    _ligne(log, "[normales] remplissage des bords : %d texels en %.1f s ; carte %dx%d en %.1f s au total"
           % (stats.get("texels_remplis", 0), phases["remplissage"], W, H, stats["duree_s"]))
    return image


def _forcer_sans_perte(image):
    """Fait encoder `image` (PIL) sans perte quand trimesh l'exporte en WebP (voir CONVENTIONS, Export).

    trimesh appelle `image.save(fichier, format='WEBP')` ; l'attribut pose sur l'OBJET ajoute les reglages sans perte a cet
    appel. Une copie de l'image (convert, copy...) perd l'attribut : poser la carte en DERNIER."""
    if getattr(image, "_normal_bake_sans_perte", False):
        return image
    sauver = image.save

    def save(fp, format=None, **options):
        if str(format or getattr(image, "format", None) or "").upper() == "WEBP":
            for cle, valeur in WEBP_SANS_PERTE.items():
                options[cle] = valeur
        return sauver(fp, format=format, **options)

    image.save = save
    image._normal_bake_sans_perte = True
    return image


def appliquer_carte_normales(scene, image, log=print, sans_perte=True):
    """Pose `image` (uint8 (H, W, 3) ou image PIL) comme `normalTexture` de chaque geometrie texturee de `scene`.

    Le materiau existant est GARDE (couleur, metal/rugosite, double face...) : seul `normalTexture` est ecrit (un materiau
    SimpleMaterial est converti en PBR, un maillage sans materiau en recoit un). Les normales de sommet sont aussi inscrites dans le
    cache de trimesh pour que l'export ecrive NORMAL : sans attribut NORMAL, three.js passe en ombrage plat et la carte (cuite sur les
    normales LISSEES) serait fausse. `sans_perte` : voir _forcer_sans_perte. `image` None : rien n'est fait.
    TOUT OU RIEN : les materiaux sont prepares avant la premiere ecriture ; une exception laisse la scene intacte.
    Rend le nombre de geometries modifiees."""
    if image is None:
        _ligne(log, "[normales] aucune carte a poser")
        return 0
    from PIL import Image
    if not isinstance(image, Image.Image):
        image = np.ascontiguousarray(image)
        if image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
            raise ValueError("image : tableau uint8 (H, W, 3) ou image PIL attendu")
        image = Image.fromarray(image)
    if sans_perte:
        _forcer_sans_perte(image)
    from trimesh.visual.material import PBRMaterial
    a_poser = []
    for nom, g in _geometries_texturees(scene, log):
        visuel = g.visual
        materiau = getattr(visuel, "material", None)
        if materiau is None:
            materiau = PBRMaterial()
        elif not hasattr(materiau, "normalTexture"):
            materiau = materiau.to_pbr()
        _ = g.vertex_normals
        a_poser.append((visuel, materiau))
    for visuel, materiau in a_poser:
        materiau.normalTexture = image
        visuel.material = materiau
    n = len(a_poser)
    _ligne(log, "[normales] carte de normales posee sur %d geometrie(s)" % n)
    return n


def proteger_cartes_normales(scene):
    """Rend SANS PERTE l'export WebP de chaque `normalTexture` de `scene` (Scene ou Trimesh) ; rend le nombre d'images protegees.

    Pour un GLB RELU avec trimesh puis re-exporte (operations qui ne changent pas la geometrie : recolorier, re-texturer...) : l'image
    relue est une image PIL ordinaire que trimesh re-encoderait en WebP avec perte. Une copie d'image perd la protection : a appeler
    juste avant l'export. Ne leve jamais."""
    n = 0
    try:
        for _, g in _elements(scene):
            image = getattr(getattr(getattr(g, "visual", None), "material", None), "normalTexture", None)
            if image is not None and hasattr(image, "save"):
                _forcer_sans_perte(image)
                n += 1
    except Exception:
        pass
    return n


def retirer_cartes_normales(scene):
    """Retire la `normalTexture` de chaque materiau de `scene` (Scene ou Trimesh) ; rend le nombre de cartes retirees.

    Pour les OUTILS qui deforment la geometrie ou refont les UV (lissage, reduction, subdivision, remaillage...) : la carte cuite
    decrit le relief de la forme d'ORIGINE dans le repere de ses UV ; gardee, elle redessinerait un relief efface ou le plaquerait au
    mauvais endroit. Les autres textures et facteurs du materiau ne bougent pas. Ne leve jamais."""
    n = 0
    try:
        for _, g in _elements(scene):
            materiau = getattr(getattr(g, "visual", None), "material", None)
            if materiau is not None and getattr(materiau, "normalTexture", None) is not None:
                materiau.normalTexture = None
                n += 1
    except Exception:
        pass
    return n


def carte_normales_active(environ=None):
    """False si l'interrupteur FABMESH_NORMAL_MAP vaut 0 / false / no / non / off (casse ignoree) ; True sinon (defaut : active)."""
    env = os.environ if environ is None else environ
    return str(env.get(INTERRUPTEUR, "1")).strip().lower() not in ("0", "false", "no", "non", "off")


def plafond_carte(environ=None):
    """Plafond de la carte en pixels de cote (variable PLAFOND_ENV, defaut PLAFOND_DEFAUT).

    Valeur absente, non numerique, inferieure a 1 ou superieure a 16384 : le defaut (jamais une exception, jamais un plafond
    absurde qui rouvrirait la memoire du worker)."""
    env = os.environ if environ is None else environ
    try:
        n = int(str(env.get(PLAFOND_ENV, "")).strip())
    except ValueError:
        return PLAFOND_DEFAUT
    return n if 1 <= n <= 16384 else PLAFOND_DEFAUT


def borner_taille(taille, plafond=None):
    """(hauteur, largeur) de `taille` (entier ou couple) ramenee sous `plafond` pixels pour son cote le plus long, proportions
    gardees (un atlas 4096 x 2048 plafonne a 2048 donne 2048 x 1024). `plafond` None : plafond_carte(). Une taille qui tient
    deja est rendue telle quelle. Jamais plus grande que la taille demandee."""
    h, w = _taille_texture(taille)
    p = plafond_carte() if plafond is None else int(plafond)
    if p < 1:
        raise ValueError("plafond : entier >= 1 attendu, recu %r" % (plafond,))
    plus_long = max(h, w)
    if plus_long <= p:
        return h, w
    f = p / float(plus_long)
    return max(1, min(p, int(round(h * f)))), max(1, min(p, int(round(w * f))))


def option_carte_normales(environ=None):
    """True si le BUREAU a demande la carte pour cette generation : OPTION_ENV vaut exactement "1" (espaces ignores).
    Toute autre valeur, ou l'absence de la variable : False (l'option est desactivee par defaut)."""
    env = os.environ if environ is None else environ
    return str(env.get(OPTION_ENV, "")).strip() == "1"


def carte_normales_voulue(option, environ=None):
    """La carte de normales doit-elle etre cuite pour CETTE generation ?

    OUI seulement si `option` vaut exactement True (booleen strict : la chaine "true", 1 ou un objet quelconque ne comptent pas)
    ET que l'interrupteur d'urgence (FABMESH_NORMAL_MAP=0) n'est pas coupe : l'interrupteur l'emporte sur l'option.
    Sans option : jamais, donc le GLB d'avant a l'octet."""
    return option is True and carte_normales_active(environ)


def taille_atlas(scene):
    """(hauteur, largeur) de la premiere `baseColorTexture` des geometries texturees de `scene`, ou None s'il n'y en a pas."""
    try:
        for _, g in _geometries_texturees(scene):
            image = getattr(getattr(g.visual, "material", None), "baseColorTexture", None)
            taille = getattr(image, "size", None)
            if taille and int(taille[0]) > 0 and int(taille[1]) > 0:
                return int(taille[1]), int(taille[0])
    except Exception:
        pass
    return None


def ajouter_carte_normales(scene, hi_vertices, hi_faces, texture_size=None, *, log=print, plafond=None, **options):
    """Cuisson + pose en un appel, pour les CHEMINS D'EXPORT (generation bureau et Modal). NE LEVE JAMAIS.

      texture_size : None = taille de l'atlas de COULEUR de la scene (taille_atlas), repli TAILLE_REPLI ; sinon comme bake_normal_map.
      plafond      : None = plafond_carte() (FABMESH_NORMAL_MAP_MAX, defaut 2048) ; la carte ne depasse JAMAIS ce cote, que la
                     taille vienne de l'atlas ou d'un texture_size explicite (un banc d'essai passe un plafond plus haut).
      options      : transmis a bake_normal_map (k, padding_px, hi_axes, workers).
    Ne decide PAS si la carte est voulue (option par generation) : l'appelant teste carte_normales_voulue(option) avant.
    Interrupteur FABMESH_NORMAL_MAP=0 : rien n'est fait (scene inchangee, aucune ligne de journal). Au moindre echec (exception,
    rien a cuire, recalage refuse), la scene reste SANS carte. Rend un dict de mesures : 'posee' (bool), 'raison' (quand la carte
    n'est pas posee), 'duree_s', 'taille' (H, W), plus celles de bake_normal_map."""
    t0 = time.perf_counter()
    stats = {"posee": False}
    if not carte_normales_active():
        stats["raison"] = "desactivee (%s=0)" % INTERRUPTEUR
        return stats
    try:
        taille = texture_size if texture_size else (taille_atlas(scene) or TAILLE_REPLI)
        demandee = _taille_texture(taille)
        limite = plafond_carte() if plafond is None else int(plafond)
        taille = borner_taille(demandee, limite)
        stats["taille"] = taille
        if taille != demandee:
            stats["plafonnee"] = True
            _ligne(log, "[normales] carte plafonnee a %dx%d (atlas %dx%d, plafond %d)"
                   % (taille[1], taille[0], demandee[1], demandee[0], limite))
        carte = bake_normal_map(scene, hi_vertices, hi_faces, taille, log=log, stats=stats, **options)
        if carte is None:
            stats["raison"] = "refus du recalage" if stats.get("refus") == "recalage" else "rien a cuire"
        else:
            stats["posee"] = appliquer_carte_normales(scene, carte, log=log) > 0
            if not stats["posee"]:
                stats["raison"] = "aucune geometrie texturee"
    except Exception as e:
        stats["posee"] = False
        stats["raison"] = "erreur %s: %s" % (type(e).__name__, e)
        _ligne(log, "[normales] carte de normales ABANDONNEE (%s) : export sans carte" % stats["raison"])
    stats["duree_s"] = time.perf_counter() - t0
    if stats["posee"]:
        h, w = stats["taille"]
        _ligne(log, "[normales] carte de normales %dx%d posee en %.1f s" % (w, h, stats["duree_s"]))
    elif "erreur" not in stats.get("raison", ""):
        _ligne(log, "[normales] pas de carte de normales (%s)" % stats.get("raison", "?"))
    return stats
# --- NOYAU PARTAGE : FIN ---
