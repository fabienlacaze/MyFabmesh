"""Tests du noyau partage scripts/normal_bake.py (= modal_app/normal_bake.py) : carte de normales cuite du maillage FIN vers le
maillage FINAL leger (2026-10-04).

CPU seulement : aucun GPU, aucun modele, aucun reseau. numpy, scipy, trimesh, PIL ; torch CPU pour un seul test (saute si absent).

LE DECODEUR DE REFERENCE EST PORTE ICI (classe DecodeurDeReference) : getTangentFrame + `mapN.xy *= normalScale` + `normalScale.y = -1`
de GLTFLoader quand le GLB n'a pas d'attribut TANGENT, tels que lus dans src/renderer/lib/three.module.js (r170, chunks
normal_fragment_begin / normalmap_pars_fragment / normal_fragment_maps) et src/renderer/lib/loaders/GLTFLoader.js (useDerivativeTangents).
Les tests decodent la carte cuite avec ce port et la comparent a la normale haute definition connue ANALYTIQUEMENT :
  - Plan             : plan fin bossele (sinusoide) -> plan final de 2 triangles ; ilot droit, en miroir, tourne ; erreur < 3 degres ;
  - SphereIlots      : sphere fine -> icosphere legere, un ilot par face (orientations, miroirs, normales lissees ou plates) ;
                       normales coherentes, aucune inversion ;
  - VertInverse      : une carte au vert inverse est refusee par les memes verifications (le test echoue si le canal vert est inverse) ;
  - Joints / Dilatation : deux ilots adjacents, pas de fuite de la valeur plate au bord, rayon de remplissage EXACT ;
  - Axes             : Z haut -> Y haut comme to_glb (les deux lignes de postprocess.py recopiees), repere faux refuse ;
  - cas limites      : sans UV, fine vide, triangles UV degeneres, normales invalides, texels couverts plusieurs fois, scene
                       multi-geometries, torch contre numpy (memes octets), nombre de fils sans effet, faces fines retournees sans effet ;
  - Export           : GLB relu (PNG et WebP) : normalTexture + NORMAL + materiau intact, carte restituee SANS PERTE ;
  - MutationsDuNoyau : un signe inverse, la transformation d'axes oubliee, k = 1, pas de dilatation... appliques a une COPIE du
                       module : chaque mutation doit faire echouer les tests ci-dessus.

Lancer :  python build/bancs/noyaux/test_normal_bake.py -v            (~ une minute, mutations comprises)
Autre copie du noyau (preuve d'echec sur un mutant) : variable NOYAU_NORMAL_BAKE.
Atlas 8192 (memoire ~ 1 Go) : variable NORMAL_BAKE_LONG=1 ; passer par `bash /c/tmp/lourd.sh` sur la machine du proprietaire.
Numpy 1.26 (celui de Modal) : <python a numpy 1.26> build/bancs/noyaux/test_normal_bake.py -v
"""
import ast
import importlib.util
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import trimesh
from PIL import Image

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SOURCE = os.environ.get('NOYAU_NORMAL_BAKE') or os.path.join(RACINE, 'scripts', 'normal_bake.py')
COPIE = os.path.join(RACINE, 'modal_app', 'normal_bake.py')
ENTRE_MUTANT = bool(os.environ.get('NOYAU_NORMAL_BAKE'))


def lire(chemin, **options):
    with open(chemin, encoding='utf-8', **options) as f:
        return f.read()


def charger(chemin, nom='normal_bake_sous_test'):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


NB = charger(SOURCE)


# =====================================================================================================================
# Reperes et maillages de test
# =====================================================================================================================

def zup_yup(P):
    """(x, y, z) -> (x, z, -y) : la conversion de to_glb (postprocess.py, ligne 313 : vertices_np[:, 1], vertices_np[:, 2] =
    vertices_np[:, 2], -vertices_np[:, 1]) ; l'axe haut Z de la grille TRELLIS devient l'axe haut Y du GLB."""
    P = np.asarray(P, dtype=np.float64)
    return np.stack([P[..., 0], P[..., 2], -P[..., 1]], axis=-1)


def zup_yup_texte_de_to_glb(P):
    """Les deux lignes de to_glb TELLES QUELLES (semantique du tuple : le membre de droite est evalue d'abord)."""
    v = np.array(P, dtype=np.float32, copy=True)
    v[:, 1], v[:, 2] = v[:, 2], -v[:, 1]
    return v


def champ_sinus(amp=0.03, fx=3.0, fy=3.0):
    """Hauteur z = h(x, y) d'un plan bossele et son gradient analytique."""
    def h(x, y):
        return amp * np.sin(2 * np.pi * fx * x) * np.sin(2 * np.pi * fy * y)

    def grad(x, y):
        hx = amp * 2 * np.pi * fx * np.cos(2 * np.pi * fx * x) * np.sin(2 * np.pi * fy * y)
        hy = amp * 2 * np.pi * fy * np.sin(2 * np.pi * fx * x) * np.cos(2 * np.pi * fy * y)
        return hx, hy
    return h, grad


def champ_plan(gx, gy, z0=0.0):
    """Plan incline z = z0 + gx x + gy y (normale constante)."""
    def h(x, y):
        return z0 + gx * x + gy * y

    def grad(x, y):
        return np.full_like(x, gx), np.full_like(x, gy)
    return h, grad


def grille_fine(n, h, x0=0.0, x1=1.0, y0=0.0, y1=1.0, jitter=0.0, bruit_z=0.0, graine=0, retourner=0.0, dtype=np.float32):
    """Maillage fin : grille n x n sur [x0, x1] x [y0, y1], repere Z haut, faces CCW vues de +Z (normale +Z).
    jitter : deplacement aleatoire en x, y (fraction du pas, bords fixes) ; bruit_z : bruit en z ; retourner : part de faces inversees."""
    xs = np.linspace(x0, x1, n)
    ys = np.linspace(y0, y1, n)
    X, Y = np.meshgrid(xs, ys)
    rng = np.random.default_rng(graine)
    if jitter:
        pas = (x1 - x0) / (n - 1)
        X = X + rng.uniform(-1, 1, X.shape) * jitter * pas
        Y = Y + rng.uniform(-1, 1, Y.shape) * jitter * pas
        X[:, 0], X[:, -1], Y[0, :], Y[-1, :] = x0, x1, y0, y1
    Z = h(X, Y)
    if bruit_z:
        Z = Z + rng.normal(0.0, bruit_z, Z.shape)
    V = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1).astype(dtype)
    idx = np.arange(n * n, dtype=np.int32).reshape(n, n)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
    F = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)]).astype(np.int32)
    if retourner:
        flip = rng.random(len(F)) < retourner
        F[flip] = F[flip][:, ::-1]
    return V, F


def fusionner(*maillages):
    """Reunit des maillages (V, F) en un seul."""
    Vs, Fs, d = [], [], 0
    for V, F in maillages:
        Vs.append(V)
        Fs.append(F + d)
        d += len(V)
    return np.concatenate(Vs), np.concatenate(Fs)


def quad_final(x0, x1, y0, y1, z=0.0, uv_de=None):
    """Quad (2 triangles) du maillage FINAL : sommets dans le repere fin (Z haut) puis convertis en Y haut ; uv_de(xn, yn) -> (u, v)
    avec xn, yn dans [0, 1] sur le quad (defaut : u = xn, v = yn, ilot droit)."""
    P = np.array([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], dtype=np.float64)
    xn = np.array([0.0, 1.0, 1.0, 0.0])
    yn = np.array([0.0, 0.0, 1.0, 1.0])
    u, v = (xn, yn) if uv_de is None else uv_de(xn, yn)
    return zup_yup(P), np.array([[0, 1, 2], [0, 2, 3]]), np.stack([u, v], 1)


def maillage_texture(V, F, UV, normales=None, **materiau):
    """Maillage final trimesh : PBR avec baseColor + facteurs, double face (comme to_glb sous le seuil), UV de trimesh (v vers le haut)."""
    reglages = dict(metallicFactor=0.25, roughnessFactor=0.75, doubleSided=True)
    reglages.update(materiau)
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=Image.fromarray(np.full((4, 4, 3), 200, np.uint8)), **reglages)
    m = trimesh.Trimesh(np.asarray(V, np.float64), np.asarray(F), visual=trimesh.visual.TextureVisuals(
        uv=np.asarray(UV, np.float64), material=mat), process=False)
    if normales is not None:
        m.vertex_normals = np.asarray(normales, np.float64)
    return m


def ilots_par_face(V, F, normales='lisses', miroir=0.0, rotation=True, graine=0, remplissage=0.8):
    """Un ILOT UV par face, depliage isometrique, cellule carree d'une grille : sommets dupliques par face (comme les coutures d'UV
    de TRELLIS). miroir : part d'ilots en miroir ; rotation : orientation aleatoire de chaque ilot dans le plan UV.
    normales : 'lisses' (radiales, centre en 0) ou 'plates' (normale de la face). Rend (V', F', UV, N')."""
    V = np.asarray(V, np.float64)
    nf = len(F)
    n = int(np.ceil(np.sqrt(nf)))
    rng = np.random.default_rng(graine)
    p0, p1, p2 = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    e1, e2 = p1 - p0, p2 - p0
    l1 = np.linalg.norm(e1, axis=1)
    x = e1 / l1[:, None]
    s2 = (e2 * x).sum(1)
    t2 = np.linalg.norm(e2 - s2[:, None] * x, axis=1)
    A = np.zeros((nf, 3, 2))
    A[:, 1, 0] = l1
    A[:, 2, 0] = s2
    A[:, 2, 1] = t2
    A -= A.mean(axis=1, keepdims=True)
    if miroir:
        m = rng.random(nf) < miroir
        A[m, :, 0] *= -1.0
    if rotation:
        phi = rng.uniform(0, 2 * np.pi, nf)
        c, s = np.cos(phi), np.sin(phi)
        A = np.stack([A[:, :, 0] * c[:, None] - A[:, :, 1] * s[:, None], A[:, :, 0] * s[:, None] + A[:, :, 1] * c[:, None]], axis=2)
    echelle = remplissage / n / (2.0 * np.abs(A).max())
    cx = (np.arange(nf) % n + 0.5) / n
    cy = (np.arange(nf) // n + 0.5) / n
    UV = np.stack([cx[:, None] + echelle * A[:, :, 0], cy[:, None] + echelle * A[:, :, 1]], axis=2).reshape(-1, 2)
    Vd = V[F].reshape(-1, 3)
    Fd = np.arange(nf * 3).reshape(nf, 3)
    if normales == 'plates':
        fn = np.cross(e1, e2)
        Nd = np.repeat(fn / np.linalg.norm(fn, axis=1, keepdims=True), 3, axis=0)
    else:
        Nd = Vd / np.linalg.norm(Vd, axis=1, keepdims=True)
    return Vd, Fd, UV, Nd


# =====================================================================================================================
# Decodeur de reference : port de three.js r170
# =====================================================================================================================

def raster_reference(UV, F, H, W):
    """Rasterisation de reference, par force brute, INDEPENDANTE du noyau : (proprietaire (H, W) int, -1 = vide ; barycentriques (H, W, 3)).
    Centre de texel (c + 0,5 ; r + 0,5), v de trimesh = 1 - (r + 0,5) / H (regle glTF : l'image se lit depuis le HAUT), bords inclus,
    triangle d'indice le plus grand gagnant."""
    proprio = np.full((H, W), -1, dtype=np.int64)
    bary = np.zeros((H, W, 3))
    colonnes = (np.arange(W) + 0.5) / W
    rangees = 1.0 - (np.arange(H) + 0.5) / H
    for t, f in enumerate(F):
        (u0, v0), (u1, v1), (u2, v2) = UV[f]
        if not np.isfinite([u0, v0, u1, v1, u2, v2]).all():
            continue
        den = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2)
        if abs(den) < 1e-18:
            continue
        c0, c1 = max(0, int(np.floor(min(u0, u1, u2) * W)) - 2), min(W, int(np.ceil(max(u0, u1, u2) * W)) + 3)
        r0, r1 = max(0, int(np.floor((1.0 - max(v0, v1, v2)) * H)) - 2), min(H, int(np.ceil((1.0 - min(v0, v1, v2)) * H)) + 3)
        if c0 >= c1 or r0 >= r1:
            continue
        U, Vv = np.meshgrid(colonnes[c0:c1], rangees[r0:r1])
        l0 = ((v1 - v2) * (U - u2) + (u2 - u1) * (Vv - v2)) / den
        l1 = ((v2 - v0) * (U - u2) + (u0 - u2) * (Vv - v2)) / den
        l2 = 1.0 - l0 - l1
        m = (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
        proprio[r0:r1, c0:c1][m] = t
        bary[r0:r1, c0:c1][m] = np.stack([l0[m], l1[m], l2[m]], 1)
    return proprio, bary


class DecodeurThreeJs:
    """Port en Python du chemin « carte de normales sans attribut TANGENT » de three.js r170 + GLTFLoader.

    GLSL (normalmap_pars_fragment) :
        mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
            vec3 q0 = dFdx( eye_pos.xyz );  vec3 q1 = dFdy( eye_pos.xyz );
            vec2 st0 = dFdx( uv.st );       vec2 st1 = dFdy( uv.st );
            vec3 N = surf_norm;
            vec3 q1perp = cross( q1, N );   vec3 q0perp = cross( N, q0 );
            vec3 T = q1perp * st0.x + q0perp * st1.x;
            vec3 B = q1perp * st0.y + q0perp * st1.y;
            float det = max( dot( T, T ), dot( B, B ) );
            float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
            return mat3( T * scale, B * scale, N );
        }
    normal_fragment_maps : mapN = texture2D( normalMap, uv ).xyz * 2.0 - 1.0 ; mapN.xy *= normalScale ; normal = normalize( tbn * mapN ).
    GLTFLoader (useDerivativeTangents, pas d'attribut TANGENT) : normalScale.y *= -1.  Les UV lus sont ceux du GLB : v de glTF = 1 - v de trimesh.

    Les derivees d'ecran q0, q1 (position) sont ceux d'un triangle PLAN vu de face : deux vecteurs du plan, d'orientation positive par
    rapport a la normale ; st0, st1 en decoulent par l'application affine des UV. `vue` = (angle, echelle, cisaillement) choisit cette paire :
    le resultat NE DOIT PAS en dependre (test_la_vue_est_sans_effet)."""

    def __init__(self, V, Nv, UV, F):
        self.V = np.asarray(V, np.float64)
        self.Nv = np.asarray(Nv, np.float64)
        self.F = np.asarray(F)
        self.uvg = np.asarray(UV, np.float64).copy()
        self.uvg[:, 1] = 1.0 - self.uvg[:, 1]

    def _derivees(self, t, vue):
        p0, p1, p2 = self.V[self.F[t]]
        e1, e2 = p1 - p0, p2 - p0
        ng = np.cross(e1, e2)
        ng /= np.linalg.norm(ng)
        ex = e1 / np.linalg.norm(e1)
        ey = np.cross(ng, ex)
        angle, echelle, cisaillement = vue
        q0 = echelle * (np.cos(angle) * ex + np.sin(angle) * ey)
        q1 = echelle * (-np.sin(angle) * ex + np.cos(angle) * ey) + cisaillement * q0
        E = np.stack([e1, e2], 1)
        uv0, uv1, uv2 = self.uvg[self.F[t]]
        D = np.stack([uv1 - uv0, uv2 - uv0], 1)
        J = D @ np.linalg.pinv(E)                    # derivee des UV par rapport a la position dans le plan du triangle
        return q0, q1, J @ q0, J @ q1

    @staticmethod
    def tangent_frame(q0, q1, st0, st1, N):
        q1perp = np.cross(q1[None, :], N)
        q0perp = np.cross(N, q0[None, :])
        T = q1perp * st0[0] + q0perp * st1[0]
        B = q1perp * st0[1] + q0perp * st1[1]
        det = np.maximum((T * T).sum(1), (B * B).sum(1))
        scale = np.where(det == 0.0, 0.0, 1.0 / np.sqrt(np.where(det == 0.0, 1.0, det)))
        return T * scale[:, None], B * scale[:, None]

    def reperes(self, t, N, vue=(0.0, 1e-3, 0.0)):
        q0, q1, st0, st1 = self._derivees(t, vue)
        return self.tangent_frame(q0, q1, st0, st1, N)

    def decoder(self, carte, proprio, bary, vue=(0.0, 1e-3, 0.0), inverser_vert_chargeur=False):
        """Normales decodees des texels couverts : (n (m, 3), P (m, 3), (rr, cc), tri). `inverser_vert_chargeur` simule un chargeur
        qui oublierait le normalScale.y = -1."""
        rr, cc = np.nonzero(proprio >= 0)
        tri = proprio[rr, cc]
        bw = bary[rr, cc]
        f = self.F[tri]
        P = np.einsum('ij,ijk->ik', bw, self.V[f])
        N = np.einsum('ij,ijk->ik', bw, self.Nv[f])
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        mapN = carte[rr, cc].astype(np.float64) / 255.0 * 2.0 - 1.0
        mapN[:, 1] *= (1.0 if inverser_vert_chargeur else -1.0)        # normalScale = (1, -1)
        sortie = np.empty_like(N)
        for t in np.unique(tri):
            sel = np.flatnonzero(tri == t)
            T, B = self.reperes(t, N[sel], vue)
            n = T * mapN[sel, 0:1] + B * mapN[sel, 1:2] + N[sel] * mapN[sel, 2:3]
            sortie[sel] = n / np.linalg.norm(n, axis=1, keepdims=True)
        return sortie, P, (rr, cc), tri


def angles_deg(a, b):
    return np.degrees(np.arccos(np.clip((a * b).sum(axis=1), -1.0, 1.0)))


def normale_plan(rr, cc, H, W, grad, boite):
    """Normale haute definition ANALYTIQUE (repere Y haut) du plan fin aux texels (rr, cc) d'un quad dont l'ilot couvre tout [0, 1]^2
    avec u = xn, v = yn (ilot droit) sur la boite fine (x0, x1, y0, y1)."""
    x0, x1, y0, y1 = boite
    u = (cc + 0.5) / W
    v = 1.0 - (rr + 0.5) / H
    hx, hy = grad(x0 + u * (x1 - x0), y0 + v * (y1 - y0))
    n = np.stack([-hx, -hy, np.ones_like(hx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return zup_yup(n)


def silencieux(**kw):
    kw.setdefault('log', None)
    return kw


def bake(scene, Vh, Fh, taille, **kw):
    return NB.bake_normal_map(scene, Vh, Fh, taille, **silencieux(**kw))


# =====================================================================================================================
# Tests du decodeur de reference lui-meme (pour que le test ne soit pas circulaire)
# =====================================================================================================================

class DecodeurDeReference(unittest.TestCase):

    def triangle_isometrique(self, angle_uv=0.7, miroir=False):
        V = np.array([[0.1, 0.2, 0.3], [1.3, 0.1, 0.9], [0.4, 1.4, 0.2]])
        e1, e2 = V[1] - V[0], V[2] - V[0]
        x = e1 / np.linalg.norm(e1)
        s2 = e2 @ x
        t2 = np.linalg.norm(e2 - s2 * x)
        A = np.array([[0.0, 0.0], [np.linalg.norm(e1), 0.0], [s2, t2]]) * 0.2
        if miroir:
            A[:, 0] *= -1
        c, s = np.cos(angle_uv), np.sin(angle_uv)
        UV = A @ np.array([[c, s], [-s, c]]) + 0.4
        return V, UV, np.array([[0, 1, 2]])

    def test_t_suit_u_et_b_suit_v_de_trimesh(self):
        """Pour un ilot isometrique : T est parallele a dP/du, et B (apres normalScale.y = -1) a dP/dv de trimesh, du MEME cote.
        C'est la definition du repere que cuit le noyau : un port faux du decodeur ne peut pas la satisfaire par hasard."""
        for miroir in (False, True):
            for angle in (0.0, 0.7, 2.0, 4.0):
                V, UV, F = self.triangle_isometrique(angle, miroir)
                n = np.cross(V[1] - V[0], V[2] - V[0])
                n /= np.linalg.norm(n)
                dec = DecodeurThreeJs(V, np.tile(n, (3, 1)), UV, F)
                T, B = dec.reperes(0, n[None, :])
                # derivees de la position (v de trimesh)
                du1, dv1 = UV[1] - UV[0]
                du2, dv2 = UV[2] - UV[0]
                det = du1 * dv2 - du2 * dv1
                e1, e2 = V[1] - V[0], V[2] - V[0]
                Pu = (e1 * dv2 - e2 * dv1) / det
                Pv = (e2 * du1 - e1 * du2) / det
                T, B = T[0], -B[0]                       # B_effectif = -B (normalScale.y = -1)
                self.assertGreater(T @ Pu / np.linalg.norm(T) / np.linalg.norm(Pu), 0.999999, (miroir, angle))
                self.assertGreater(B @ Pv / np.linalg.norm(B) / np.linalg.norm(Pv), 0.999999, (miroir, angle))

    def test_la_vue_est_sans_effet(self):
        """Les derivees d'ecran ne servent qu'a orienter le repere : toute paire du plan d'orientation positive donne la meme normale."""
        V, UV, F = self.triangle_isometrique(1.1, False)
        n = np.cross(V[1] - V[0], V[2] - V[0])
        n /= np.linalg.norm(n)
        N = np.tile(n, (3, 1))
        dec = DecodeurThreeJs(V, N, UV, F)
        mapN = np.array([0.3, -0.4, 0.8])
        mapN /= np.linalg.norm(mapN)
        refs = []
        for vue in ((0.0, 1e-3, 0.0), (1.0, 5e-2, 0.0), (2.5, 3.0, 0.7), (-1.2, 1e-5, -0.4)):
            T, B = dec.reperes(0, n[None, :], vue)
            m = mapN * np.array([1.0, -1.0, 1.0])
            r = T[0] * m[0] + B[0] * m[1] + n * m[2]
            refs.append(r / np.linalg.norm(r))
        for r in refs[1:]:
            self.assertLess(np.abs(r - refs[0]).max(), 1e-9)

    def test_le_vert_se_lit_vers_le_haut_de_l_image(self):
        """Verite de terrain independante de tout code de cuisson : sur un plan horizontal vu de dessus (UV droits), un texel dont le vert est
        eleve (+Y) doit incliner la normale vers le HAUT de l'image, c'est-a-dire vers les v croissants de trimesh."""
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        n = np.array([0.0, 1.0, 0.0])
        dec = DecodeurThreeJs(Vq, np.tile(n, (4, 1)), UV, Fq)
        mapN = np.array([0.0, 0.5, 0.8660254])          # vert > 0
        T, B = dec.reperes(0, n[None, :])
        m = mapN * np.array([1.0, -1.0, 1.0])
        r = T[0] * m[0] + B[0] * m[1] + n * m[2]
        # v de trimesh croit avec y (fin) = -Z (final) : la normale doit pencher vers -Z
        self.assertLess(r[2], -0.3)
        self.assertAlmostEqual(r[0], 0.0, places=9)


# =====================================================================================================================
# Plan bossele -> plan final de 2 triangles
# =====================================================================================================================

class Plan(unittest.TestCase):
    N_FIN = 161
    TAILLE = 256
    SEUIL_MOYEN = 3.0        # specification : < 3 degres hors bords (mesure du 2026-10-04 : 1,4 degre, p99 4,1, max 4,4 ; pente max 29 degres)
    MARGE = 6                # texels exclus au bord de l'ilot

    @classmethod
    def setUpClass(cls):
        h, grad = champ_sinus(0.03, 3, 3)
        cls.h, cls.grad = staticmethod(h), staticmethod(grad)
        cls.Vh, cls.Fh = grille_fine(cls.N_FIN, h)

    def cuire(self, uv_de=None, **kw):
        Vq, Fq, UV = quad_final(0, 1, 0, 1, uv_de=uv_de)
        m = maillage_texture(Vq, Fq, UV)
        carte = bake(m, self.Vh, self.Fh, self.TAILLE, **kw)
        self.assertIsNotNone(carte)
        return m, carte

    def erreurs(self, m, carte, vue=(0.0, 1e-3, 0.0), uv_inverse=None):
        proprio, bary = raster_reference(np.asarray(m.visual.uv), np.asarray(m.faces), self.TAILLE, self.TAILLE)
        dec = DecodeurThreeJs(m.vertices, m.vertex_normals, m.visual.uv, m.faces)
        n, P, (rr, cc), _ = dec.decoder(carte, proprio, bary, vue)
        ref = normale_plan(rr, cc, self.TAILLE, self.TAILLE, self.grad, (0, 1, 0, 1))
        if uv_inverse is not None:                       # ilot en miroir / tourne : u, v -> xn, yn
            u = (cc + 0.5) / self.TAILLE
            v = 1.0 - (rr + 0.5) / self.TAILLE
            xn, yn = uv_inverse(u, v)
            hx, hy = self.grad(xn, yn)
            nn = np.stack([-hx, -hy, np.ones_like(hx)], -1)
            ref = zup_yup(nn / np.linalg.norm(nn, axis=-1, keepdims=True))
        dedans = ((rr >= self.MARGE) & (rr < self.TAILLE - self.MARGE) & (cc >= self.MARGE) & (cc < self.TAILLE - self.MARGE))
        return angles_deg(n, ref)[dedans]

    def verifier(self, m, carte, **kw):
        e = self.erreurs(m, carte, **kw)
        self.assertLess(e.mean(), self.SEUIL_MOYEN, 'erreur angulaire moyenne %.2f deg' % e.mean())
        self.assertLess(np.percentile(e, 99), 8.0, 'p99 %.2f deg' % np.percentile(e, 99))
        return e

    def test_plan_bossele_ilot_droit(self):
        m, carte = self.cuire()
        e = self.verifier(m, carte)
        # temoin : sans carte (normale plate) l'erreur est grande, le test discrimine
        plate = np.zeros_like(carte)
        plate[...] = NB.NORMALE_PLATE
        e0 = self.erreurs(m, plate)
        self.assertGreater(e0.mean(), 8.0)
        self.assertLess(e.mean(), 0.25 * e0.mean())

    def test_ilot_en_miroir(self):
        """u decroit quand x croit : l'ilot est en miroir ; le relief ne doit PAS etre retourne."""
        m, carte = self.cuire(uv_de=lambda xn, yn: (1.0 - xn, yn))
        self.verifier(m, carte, uv_inverse=lambda u, v: (1.0 - u, v))

    def test_ilot_tourne_de_90_degres_et_en_miroir_vertical(self):
        m, carte = self.cuire(uv_de=lambda xn, yn: (yn, xn))                   # u = y, v = x : transposition (miroir + rotation)
        self.verifier(m, carte, uv_inverse=lambda u, v: (v, u))
        m, carte = self.cuire(uv_de=lambda xn, yn: (yn, 1.0 - xn))             # rotation de 90 degres
        self.verifier(m, carte, uv_inverse=lambda u, v: (1.0 - v, u))

    def test_deux_triangles_de_lecture_differente(self):
        """Resultat independant de la paire de derivees d'ecran du decodeur (angle, echelle, cisaillement)."""
        m, carte = self.cuire()
        a = self.erreurs(m, carte, vue=(0.0, 1e-3, 0.0)).mean()
        b = self.erreurs(m, carte, vue=(2.2, 7.0, 0.5)).mean()
        self.assertAlmostEqual(a, b, places=6)

    def test_vert_inverse_est_refuse(self):
        """Le test DOIT echouer si le canal vert est inverse : une carte au vert inverse decode un relief creux et depasse le seuil."""
        m, carte = self.cuire()
        self.verifier(m, carte)                                          # temoin : la carte juste passe
        inverse = carte.copy()
        inverse[..., 1] = 255 - inverse[..., 1]
        e = self.erreurs(m, inverse)
        self.assertGreater(e.mean(), self.SEUIL_MOYEN, 'le vert inverse passerait le test (%.2f deg)' % e.mean())
        with self.assertRaises(AssertionError):
            self.verifier(m, inverse)

    def test_rouge_inverse_et_chargeur_sans_flip_sont_refuses(self):
        m, carte = self.cuire()
        rouge = carte.copy()
        rouge[..., 0] = 255 - rouge[..., 0]
        with self.assertRaises(AssertionError):
            self.verifier(m, rouge)
        # un chargeur qui oublierait normalScale.y = -1 decoderait la bonne carte comme une carte au vert inverse
        proprio, bary = raster_reference(np.asarray(m.visual.uv), np.asarray(m.faces), self.TAILLE, self.TAILLE)
        dec = DecodeurThreeJs(m.vertices, m.vertex_normals, m.visual.uv, m.faces)
        n, P, (rr, cc), _ = dec.decoder(carte, proprio, bary, inverser_vert_chargeur=True)
        ref = normale_plan(rr, cc, self.TAILLE, self.TAILLE, self.grad, (0, 1, 0, 1))
        self.assertGreater(angles_deg(n, ref).mean(), self.SEUIL_MOYEN)

    def test_signes_de_la_convention_sans_decodeur(self):
        """Verite de terrain SANS decodeur, par la definition de la convention (glTF : +X droite, +Y haut de l'image, l'image se lit depuis le
        HAUT). Plan z = s y (s > 0, la surface monte avec y = v croissant) : la normale penche vers -y, donc VERT < 128 ; s < 0 : VERT > 128.
        Plan z = s x : ROUGE < 128 pour s > 0. Parabole en y : le HAUT de l'image (rangees petites, v ~ 1) a la pente positive, le bas la negative."""
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        for s_, attendu_vert in ((0.2, '<'), (-0.2, '>')):
            Vh, Fh = grille_fine(33, lambda x, y, s_=s_: s_ * y)
            carte = bake(maillage_texture(Vq, Fq, UV), Vh, Fh, 64)
            vert = int(carte[32, 32, 1])
            self.assertTrue(vert < 118 if attendu_vert == '<' else vert > 138, 'plan z = %.1f y : vert %d' % (s_, vert))
            self.assertTrue(abs(int(carte[32, 32, 0]) - 128) <= 1)               # aucune composante rouge
        for s_, attendu_rouge in ((0.2, '<'), (-0.2, '>')):
            Vh, Fh = grille_fine(33, lambda x, y, s_=s_: s_ * x)
            carte = bake(maillage_texture(Vq, Fq, UV), Vh, Fh, 64)
            rouge = int(carte[32, 32, 0])
            self.assertTrue(rouge < 118 if attendu_rouge == '<' else rouge > 138, 'plan z = %.1f x : rouge %d' % (s_, rouge))
            self.assertTrue(abs(int(carte[32, 32, 1]) - 128) <= 1)
        Vh, Fh = grille_fine(129, lambda x, y: 0.5 * (y - 0.5) ** 2)               # pente = y - 0.5
        carte = bake(maillage_texture(Vq, Fq, UV), Vh, Fh, 128)
        haut, bas = int(carte[int(0.1 * 128), 64, 1]), int(carte[int(0.9 * 128), 64, 1])    # rangee 12 : v ~ 0,9 (pente +0,4) ; rangee 115 : v ~ 0,1
        self.assertLess(haut, 100, 'haut de l image (v ~ 0,9) : vert %d' % haut)
        self.assertGreater(bas, 150, 'bas de l image (v ~ 0,1) : vert %d' % bas)

    def test_resultat_identique_quel_que_soit_le_nombre_de_fils(self):
        m, a = self.cuire(workers=1)
        _, b = self.cuire(workers=4)
        _, c = self.cuire(workers=-1)
        self.assertTrue(np.array_equal(a, b))
        self.assertTrue(np.array_equal(a, c))

    def test_faces_fines_retournees_sans_effet(self):
        """o_voxel assemble ses quads sans regarder le sens de franchissement : une partie des faces du maillage fin brut est retournee.
        La carte ne doit pas en dependre (octet pour octet)."""
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        m = maillage_texture(Vq, Fq, UV)
        Vh, Fh = grille_fine(97, self.h, retourner=0.0)
        Vh2, Fh2 = grille_fine(97, self.h, retourner=0.5, graine=3)
        a = bake(m, Vh, Fh, 128)
        b = bake(m, Vh2, Fh2, 128)
        self.assertGreater(int((Fh != Fh2).any(axis=1).sum()), 5000)          # beaucoup de faces ont bien ete retournees
        self.assertTrue(np.array_equal(a, b))

    def test_k_lisse_le_bruit_d_un_sommet(self):
        """Fine bruitee (z aleatoire par sommet) : la moyenne de k = 4 sommets doit etre nettement meilleure que k = 1 ; le defaut est 4."""
        h, grad = champ_sinus(0.01, 2, 2)
        Vh, Fh = grille_fine(97, h, bruit_z=0.0008, graine=5)
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        m = maillage_texture(Vq, Fq, UV)

        def err(**kw):
            carte = bake(m, Vh, Fh, 128, **kw)
            proprio, bary = raster_reference(np.asarray(m.visual.uv), np.asarray(m.faces), 128, 128)
            dec = DecodeurThreeJs(m.vertices, m.vertex_normals, m.visual.uv, m.faces)
            n, P, (rr, cc), _ = dec.decoder(carte, proprio, bary)
            ref = normale_plan(rr, cc, 128, 128, grad, (0, 1, 0, 1))
            dedans = (rr >= 4) & (rr < 124) & (cc >= 4) & (cc < 124)
            return angles_deg(n, ref)[dedans].mean()
        e_defaut, e_k1, e_k4 = err(), err(k=1), err(k=4)
        self.assertEqual(NB.K_DEFAUT, 4)
        self.assertAlmostEqual(e_defaut, e_k4, places=9)
        self.assertLess(e_defaut, 0.8 * e_k1, 'defaut %.2f deg, k=1 %.2f deg' % (e_defaut, e_k1))


# =====================================================================================================================
# Sphere fine -> icosphere legere, un ilot par face
# =====================================================================================================================

class SphereIlots(unittest.TestCase):
    TAILLE = 512

    @classmethod
    def setUpClass(cls):
        s = trimesh.creation.icosphere(subdivisions=5, radius=1.0)
        cls.Vh = np.asarray(s.vertices, np.float32)
        cls.Fh = np.asarray(s.faces, np.int32)

    def cuire_et_decoder(self, subdiv, normales, miroir, graine=0, vue=(0.0, 1e-3, 0.0), transformer=None, **kw):
        leg = trimesh.creation.icosphere(subdivisions=subdiv, radius=1.0)
        V, F, UV, N = ilots_par_face(np.asarray(leg.vertices), np.asarray(leg.faces), normales, miroir, True, graine)
        m = maillage_texture(V, F, UV, normales=N)
        carte = bake(m, self.Vh, self.Fh, self.TAILLE, hi_axes='zup_to_yup', **kw)
        self.assertIsNotNone(carte)
        proprio, bary = raster_reference(UV, F, self.TAILLE, self.TAILLE)
        dec = DecodeurThreeJs(m.vertices, m.vertex_normals, UV, F)
        n, P, (rr, cc), tri = dec.decoder(carte, proprio, bary, vue)
        ref = P / np.linalg.norm(P, axis=1, keepdims=True)           # sphere centree : la normale haute definition est radiale
        return angles_deg(n, ref), n, ref, carte

    def test_normales_coherentes_sans_inversion(self):
        for subdiv in (1, 2):
            for normales in ('lisses', 'plates'):
                for miroir in (0.0, 0.5):
                    with self.subTest(subdiv=subdiv, normales=normales, miroir=miroir):
                        e, n, ref, _ = self.cuire_et_decoder(subdiv, normales, miroir)
                        dots = (n * ref).sum(1)
                        self.assertGreater(float(dots.min()), 0.9, 'inversion : cos min %.3f' % dots.min())   # aucune normale a plus de 25 deg
                        self.assertLess(e.mean(), 2.5, 'moyenne %.2f deg' % e.mean())
                        self.assertLess(np.percentile(e, 99), 10.0, 'p99 %.2f deg' % np.percentile(e, 99))

    def test_la_carte_porte_un_vrai_relief(self):
        """Faces plates, normales de sommet = celles de la face : la carte doit s'ecarter fortement du plat (sinon le test serait vide)."""
        e_plat = []
        leg = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
        V, F, UV, N = ilots_par_face(np.asarray(leg.vertices), np.asarray(leg.faces), 'plates', 0.0, True, 0)
        m = maillage_texture(V, F, UV, normales=N)
        carte = bake(m, self.Vh, self.Fh, self.TAILLE)
        proprio, bary = raster_reference(UV, F, self.TAILLE, self.TAILLE)
        rr, cc = np.nonzero(proprio >= 0)
        ecart = np.abs(carte[rr, cc].astype(float) - np.array(NB.NORMALE_PLATE)).max(axis=1)
        self.assertGreater(float(np.percentile(ecart, 90)), 10.0)

    def test_signes_et_axes_tous_testes_en_meme_temps(self):
        """Ilots tournes et en miroir, quatre graines : la moyenne reste bonne (un signe inverse sur un seul canal l'enverrait au-dessus de 20 deg)."""
        for graine in range(4):
            with self.subTest(graine=graine):
                e, n, ref, _ = self.cuire_et_decoder(2, 'plates', 0.5, graine=graine)
                self.assertLess(e.mean(), 2.5)

    def test_resultat_independant_de_la_vue_du_decodeur(self):
        a = self.cuire_et_decoder(1, 'lisses', 0.5, vue=(0.0, 1e-3, 0.0))[0].mean()
        b = self.cuire_et_decoder(1, 'lisses', 0.5, vue=(2.0, 4.0, 0.3))[0].mean()
        self.assertAlmostEqual(a, b, places=6)


# =====================================================================================================================
# Joints et dilatation
# =====================================================================================================================

class IlotsConstants(unittest.TestCase):
    """Deux (ou un) ilots rectangulaires dont la carte est CONSTANTE (plan fin incline) : toutes les valeurs attendues sont connues
    au texel pres, sans decodeur ; la valeur plate (128, 128, 255) est donc une fuite visible."""
    TAILLE = 128

    @staticmethod
    def attendu(gx, gy):
        """(r, g, b) de la normale du plan z = gx x + gy y pour un ilot droit (u = xn, v = yn) : T = +X, B = -Z, N = +Y (repere final)."""
        n = np.array([-gx, -gy, 1.0])
        n /= np.linalg.norm(n)
        nf = zup_yup(n)
        ts = np.array([nf[0], -nf[2], nf[1]])
        return np.floor((ts * 0.5 + 0.5) * 255 + 0.5).astype(int)

    def scene_deux_ilots(self, rect_a, rect_b, pente_a=(0.3, 0.0), pente_b=(0.0, -0.5)):
        """Deux patchs fins inclines, deux quads finaux horizontaux ; rect = (u0, u1, v0, v1) du ilot dans l'atlas."""
        ha, _ = champ_plan(*pente_a)
        hb, _ = champ_plan(*pente_b)
        fa = grille_fine(41, ha, 0.0, 1.0, 0.0, 1.0)
        fb = grille_fine(41, hb, 2.0, 3.0, 0.0, 1.0)
        Vh, Fh = fusionner(fa, fb)
        qa = quad_final(0, 1, 0, 1, z=0.5 * (pente_a[0] + pente_a[1]),
                        uv_de=lambda xn, yn: (rect_a[0] + xn * (rect_a[1] - rect_a[0]), rect_a[2] + yn * (rect_a[3] - rect_a[2])))
        qb = quad_final(2, 3, 0, 1, z=0.5 * pente_b[1],
                        uv_de=lambda xn, yn: (rect_b[0] + xn * (rect_b[1] - rect_b[0]), rect_b[2] + yn * (rect_b[3] - rect_b[2])))
        V, F = fusionner((qa[0], qa[1]), (qb[0], qb[1]))
        UV = np.concatenate([qa[2], qb[2]])
        return maillage_texture(V, F, UV), Vh, Fh

    @staticmethod
    def masque_rect(rect, T):
        """Texels dont le centre est dans le rectangle d'ilot (u0, u1, v0, v1) : colonnes u*T, rangees (1 - v)*T."""
        u0, u1, v0, v1 = rect
        cols = np.arange(T) + 0.5
        rows = np.arange(T) + 0.5
        cm = (cols >= u0 * T) & (cols <= u1 * T)
        rm = (rows >= (1 - v1) * T) & (rows <= (1 - v0) * T)
        return rm[:, None] & cm[None, :]

    def test_joints_deux_ilots_adjacents(self):
        T = self.TAILLE
        rect_a = (0.10, 0.40, 0.20, 0.80)
        rect_b = (0.40 + 4.0 / T, 0.80, 0.20, 0.80)               # 4 texels de vide entre les deux ilots : moins que 2 x padding
        m, Vh, Fh = self.scene_deux_ilots(rect_a, rect_b)
        carte = bake(m, Vh, Fh, T, padding_px=8)
        va, vb = self.attendu(0.3, 0.0), self.attendu(0.0, -0.5)
        self.assertGreater(np.abs(va - np.array(NB.NORMALE_PLATE)).max(), 20)
        self.assertGreater(np.abs(vb - np.array(NB.NORMALE_PLATE)).max(), 20)
        ma, mb = self.masque_rect(rect_a, T), self.masque_rect(rect_b, T)
        self.assertGreater(int(ma.sum()), 500)
        for nom, masque, v in (('A', ma, va), ('B', mb, vb)):
            ecart = np.abs(carte[masque].astype(int) - v).max()
            self.assertLessEqual(ecart, 1, 'ilot %s : valeur eloignee de %s de l attendu' % (nom, ecart))
        # le vide entre les deux ilots est rempli, jamais par la valeur plate : chaque texel prend la valeur de l'ilot le plus proche
        r0, r1 = int((1 - 0.8) * T) + 2, int((1 - 0.2) * T) - 2
        entre = carte[r0:r1, int(0.40 * T) + 1:int(rect_b[0] * T)]
        self.assertGreater(entre.shape[1], 2)
        plats = (np.abs(entre.astype(int) - np.array(NB.NORMALE_PLATE)).max(axis=2) <= 1)
        self.assertFalse(plats.any(), 'fuite de la valeur plate dans le joint entre les deux ilots')
        gauche = entre[:, :entre.shape[1] // 2]
        droite = entre[:, (entre.shape[1] + 1) // 2:]
        self.assertLessEqual(np.abs(gauche.astype(int) - va).max(), 1)
        self.assertLessEqual(np.abs(droite.astype(int) - vb).max(), 1)

    def test_aucun_texel_plat_dans_la_zone_de_remplissage(self):
        T = self.TAILLE
        rect_a = (0.30, 0.60, 0.30, 0.60)
        rect_b = (0.80, 0.95, 0.80, 0.95)
        m, Vh, Fh = self.scene_deux_ilots(rect_a, rect_b)
        carte = bake(m, Vh, Fh, T, padding_px=8)
        va, vb = self.attendu(0.3, 0.0), self.attendu(0.0, -0.5)
        from scipy import ndimage
        for rect, v in ((rect_a, va), (rect_b, vb)):
            c = self.masque_rect(rect, T)
            zone = ndimage.binary_dilation(c, structure=np.ones((17, 17), bool))
            attendu_valeur = np.abs(carte[zone].astype(int) - v).max()
            self.assertLessEqual(attendu_valeur, 1, 'texel de la zone de remplissage different de la valeur de l ilot')

    def test_dilatation_rayon_exact_et_loin_plat(self):
        T = self.TAILLE
        rect_a = (0.30, 0.55, 0.30, 0.70)
        rect_b = (0.80, 0.90, 0.80, 0.90)
        from scipy import ndimage
        for p in (0, 1, 3, 8):
            with self.subTest(padding=p):
                m, Vh, Fh = self.scene_deux_ilots(rect_a, rect_b)
                carte = bake(m, Vh, Fh, T, padding_px=p)
                c = self.masque_rect(rect_a, T) | self.masque_rect(rect_b, T)
                zone = ndimage.binary_dilation(c, structure=np.ones((2 * p + 1, 2 * p + 1), bool)) if p else c
                plat = np.all(np.abs(carte.astype(int) - np.array(NB.NORMALE_PLATE)) <= 0, axis=2)
                self.assertTrue(plat[~zone].all(), 'texel non plat hors de la zone de remplissage (rayon %d)' % p)
                self.assertFalse(plat[zone].any(), 'texel plat DANS la zone de remplissage (rayon %d)' % p)

    def test_remplissage_par_defaut(self):
        """Sans argument, le remplissage vaut PADDING_DEFAUT (8) texels : le carre de demi-cote 8 est rempli, au-dela tout est plat."""
        self.assertEqual(NB.PADDING_DEFAUT, 8)
        T = self.TAILLE
        rect_a = (0.30, 0.55, 0.30, 0.70)
        rect_b = (0.80, 0.90, 0.80, 0.90)
        m, Vh, Fh = self.scene_deux_ilots(rect_a, rect_b)
        carte = bake(m, Vh, Fh, T)
        from scipy import ndimage
        c = self.masque_rect(rect_a, T) | self.masque_rect(rect_b, T)
        zone = ndimage.binary_dilation(c, structure=np.ones((17, 17), bool))
        plat = np.all(carte.astype(int) == np.array(NB.NORMALE_PLATE), axis=2)
        self.assertTrue(plat[~zone].all())
        self.assertFalse(plat[zone].any())
        self.assertGreater(int((zone & ~c).sum()), 500)

    def test_remplissage_au_texel_couvert_le_plus_proche(self):
        """Carte NON constante (plan bossele) : chaque texel rempli prend la valeur d'un texel couvert a la distance euclidienne minimale."""
        h, grad = champ_sinus(0.03, 3, 3)
        Vh, Fh = grille_fine(81, h)
        T = 64
        uv_de = lambda xn, yn: (0.25 + 0.5 * xn, 0.25 + 0.5 * yn)
        Vq, Fq, UV = quad_final(0, 1, 0, 1, uv_de=uv_de)
        m = maillage_texture(Vq, Fq, UV)
        sans = bake(m, Vh, Fh, T, padding_px=0)
        avec = bake(m, Vh, Fh, T, padding_px=5)
        couvert = self.masque_rect((0.25, 0.75, 0.25, 0.75), T)
        self.assertTrue(np.array_equal(avec[couvert], sans[couvert]))       # les texels couverts ne sont jamais touches
        rr, cc = np.nonzero(couvert)
        pts = np.stack([rr, cc], 1)
        zone = np.zeros((T, T), bool)
        for r in range(T):
            for c in range(T):
                if couvert[r, c]:
                    continue
                d2 = ((pts - [r, c]) ** 2).sum(1)
                cheb = np.abs(pts - [r, c]).max(1)
                if (cheb <= 5).any():
                    zone[r, c] = True
                    proches = np.flatnonzero(d2 == d2.min())
                    valeurs = {tuple(sans[pts[i, 0], pts[i, 1]]) for i in proches}
                    self.assertIn(tuple(avec[r, c]), valeurs, (r, c))
        self.assertGreater(int(zone.sum()), 100)


# =====================================================================================================================
# Axes : Z haut -> Y haut
# =====================================================================================================================

class Axes(unittest.TestCase):
    TAILLE = 128

    def jeu(self):
        h, grad = champ_sinus(0.03, 2, 2)
        Vh, Fh = grille_fine(97, h)
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        return h, grad, Vh, Fh, maillage_texture(Vq, Fq, UV)

    def test_la_conversion_est_celle_de_to_glb(self):
        P = np.random.default_rng(0).normal(size=(50, 3)).astype(np.float32)
        self.assertTrue(np.allclose(zup_yup(P), zup_yup_texte_de_to_glb(P)))          # le test recopie bien les lignes de to_glb
        _, _, Vh, Fh, m = self.jeu()
        a = bake(m, Vh, Fh, self.TAILLE)                                              # defaut : zup_to_yup
        b = bake(m, zup_yup_texte_de_to_glb(Vh), Fh, self.TAILLE, hi_axes='none')    # sommets deja convertis comme to_glb
        self.assertTrue(np.array_equal(a, b), 'zup_to_yup ne reproduit pas la conversion de to_glb')

    def test_repere_faux_refuse_ou_hors_seuil(self):
        """Sommets fins en Z haut declares dans le repere Y haut : le garde de recalage refuse (rien n'est cuit), jamais une carte fausse."""
        _, _, Vh, Fh, m = self.jeu()
        journal = []
        carte = NB.bake_normal_map(m, Vh, Fh, self.TAILLE, log=journal.append, hi_axes='none')
        self.assertIsNone(carte)
        self.assertTrue(any('REFUS' in l for l in journal), journal)

    def test_defaut_et_valeurs_acceptees(self):
        self.assertEqual(NB.AXES_FINS, ('zup_to_yup', 'none'))
        import inspect
        self.assertEqual(inspect.signature(NB.bake_normal_map).parameters['hi_axes'].default, 'zup_to_yup')
        with self.assertRaises(ValueError):
            NB.bake_normal_map(None, None, None, 8, hi_axes='yup_to_zup', log=None)

    def test_decodage_correct_en_z_haut(self):
        h, grad, Vh, Fh, m = self.jeu()
        carte = bake(m, Vh, Fh, self.TAILLE)
        proprio, bary = raster_reference(np.asarray(m.visual.uv), np.asarray(m.faces), self.TAILLE, self.TAILLE)
        dec = DecodeurThreeJs(m.vertices, m.vertex_normals, m.visual.uv, m.faces)
        n, P, (rr, cc), _ = dec.decoder(carte, proprio, bary)
        ref = normale_plan(rr, cc, self.TAILLE, self.TAILLE, grad, (0, 1, 0, 1))
        dedans = (rr >= 5) & (rr < self.TAILLE - 5) & (cc >= 5) & (cc < self.TAILLE - 5)
        self.assertLess(angles_deg(n, ref)[dedans].mean(), 2.0)


# =====================================================================================================================
# Cas limites
# =====================================================================================================================

class CasLimites(unittest.TestCase):

    def plan(self, n=65, taille=64):
        h, grad = champ_sinus(0.03, 2, 2)
        Vh, Fh = grille_fine(n, h)
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        return maillage_texture(Vq, Fq, UV), Vh, Fh, taille

    def test_maillage_final_sans_uv(self):
        _, Vh, Fh, _ = self.plan()
        sans_uv = trimesh.Trimesh(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], float), np.array([[0, 1, 2]]), process=False)
        avant = sans_uv.visual.kind
        journal = []
        self.assertIsNone(NB.bake_normal_map(sans_uv, Vh, Fh, 64, log=journal.append))
        self.assertTrue(any('sans UV' in l for l in journal), journal)
        self.assertEqual(sans_uv.visual.kind, avant)                                  # scene inchangee
        self.assertEqual(NB.appliquer_carte_normales(sans_uv, None, log=None), 0)
        carte_bidon = np.full((8, 8, 3), 128, np.uint8)
        self.assertEqual(NB.appliquer_carte_normales(sans_uv, carte_bidon, log=None), 0)   # rien a poser sur un maillage sans UV
        self.assertEqual(sans_uv.visual.kind, avant)
        scene = trimesh.Scene(sans_uv)
        self.assertIsNone(NB.bake_normal_map(scene, Vh, Fh, 64, log=None))

    def test_scene_ou_maillage_absent(self):
        _, Vh, Fh, _ = self.plan()
        self.assertIsNone(NB.bake_normal_map(None, Vh, Fh, 64, log=None))
        self.assertIsNone(NB.bake_normal_map(trimesh.Scene(), Vh, Fh, 64, log=None))

    def test_maillage_fin_vide_ou_absent(self):
        m, Vh, Fh, t = self.plan()
        for V, F in ((Vh, Fh[:0]), (Vh[:0], Fh[:0]), (None, Fh), (Vh, None), (np.zeros((0, 3), np.float32), np.zeros((0, 3), np.int32))):
            journal = []
            self.assertIsNone(NB.bake_normal_map(m, V, F, t, log=journal.append))
            self.assertTrue(any('fin' in l for l in journal), journal)
        self.assertEqual(m.visual.material.normalTexture, None)

    def test_aucun_texel_couvert(self):
        h, _ = champ_sinus()
        Vh, Fh = grille_fine(33, h)
        Vq, Fq, UV = quad_final(0, 1, 0, 1, uv_de=lambda xn, yn: (1.5 + xn, 1.5 + yn))     # UV hors de l'atlas
        m = maillage_texture(Vq, Fq, UV)
        journal = []
        self.assertIsNone(NB.bake_normal_map(m, Vh, Fh, 32, log=journal.append))
        self.assertTrue(any('aucun texel couvert' in l for l in journal), journal)

    def test_triangles_uv_degeneres_et_normales_invalides(self):
        h, grad = champ_sinus(0.03, 2, 2)
        Vh, Fh = grille_fine(65, h)
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        propre = bake(maillage_texture(Vq, Fq, UV), Vh, Fh, 64)
        # ajoute : un triangle dont les trois UV sont confondus, un triangle de surface nulle (points alignes), un triangle a UV NaN,
        # et un sommet a normale NaN / nulle
        V = np.concatenate([Vq, zup_yup([[0.2, 0.2, 0], [0.3, 0.2, 0], [0.4, 0.2, 0]]), zup_yup([[0.5, 0.5, 0], [0.6, 0.5, 0], [0.5, 0.6, 0]]),
                            zup_yup([[0.1, 0.1, 0], [0.2, 0.1, 0], [0.1, 0.2, 0]])])
        F = np.concatenate([Fq, [[4, 5, 6], [7, 8, 9], [10, 11, 12]]])
        UV2 = np.concatenate([UV, [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], [[0.7, 0.7], [0.8, 0.7], [0.7, 0.8]],
                              [[np.nan, 0.1], [0.2, 0.1], [0.1, 0.2]]])
        m = maillage_texture(V, F, UV2)
        carte = bake(m, Vh, Fh, 64)
        self.assertIsNotNone(carte)
        self.assertEqual(carte.shape, (64, 64, 3))
        self.assertEqual(carte.dtype, np.uint8)
        # le quad d'origine garde exactement la meme carte, le triangle a points alignes (aire 3D nulle) donne tout de meme une valeur
        masque = (raster_reference(UV, Fq, 64, 64)[0] >= 0)
        masque[np.ix_(np.arange(64), np.arange(64))] &= True
        zone_quad = masque & ~(raster_reference(UV2, F, 64, 64)[0] >= 3)
        self.assertGreater(int(zone_quad.sum()), 3000)
        self.assertTrue(np.array_equal(carte[zone_quad], propre[zone_quad]))
        # normales invalides (NaN, nulle) sur un sommet du quad : repli sur la normale geometrique, aucune exception
        n = np.tile([0.0, 1.0, 0.0], (len(V), 1))
        n[1] = np.nan
        n[2] = 0.0
        m2 = maillage_texture(V, F, UV2, normales=n)
        carte2 = bake(m2, Vh, Fh, 64)
        self.assertIsNotNone(carte2)
        self.assertTrue(np.isfinite(carte2.astype(float)).all())

    def test_texels_couverts_plusieurs_fois(self):
        """Deux quads sur le MEME rectangle d'atlas : le triangle d'indice le plus grand gagne (deterministe)."""
        ha, _ = champ_plan(0.3, 0.0)
        hb, _ = champ_plan(0.0, -0.5)
        Vh, Fh = fusionner(grille_fine(21, ha, 0, 1, 0, 1), grille_fine(21, hb, 2, 3, 0, 1))
        qa = quad_final(0, 1, 0, 1, z=0.15)
        qb = quad_final(2, 3, 0, 1, z=-0.25)
        V, F = fusionner((qa[0], qa[1]), (qb[0], qb[1]))
        UV = np.concatenate([qa[2], qb[2]])
        ensemble = bake(maillage_texture(V, F, UV), Vh, Fh, 32)
        seul_b = bake(maillage_texture(qb[0], qb[1], qb[2]), Vh, Fh, 32)
        self.assertTrue(np.array_equal(ensemble, seul_b))
        autre_ordre = bake(maillage_texture(*[np.concatenate(x) if i != 1 else np.concatenate([qb[1], qa[1] + 4]) for i, x in
                                              enumerate(((qb[0], qa[0]), (qb[1], qa[1]), (qb[2], qa[2])))]), Vh, Fh, 32)
        seul_a = bake(maillage_texture(qa[0], qa[1], qa[2]), Vh, Fh, 32)
        self.assertTrue(np.array_equal(autre_ordre, seul_a))                         # ordre inverse : c'est A qui gagne

    def test_atlas_non_carre_et_taille_en_couple(self):
        m, Vh, Fh, _ = self.plan()
        carte = bake(m, Vh, Fh, (48, 96))
        self.assertEqual(carte.shape, (48, 96, 3))

    def test_arguments_invalides(self):
        m, Vh, Fh, t = self.plan()
        for kw in (dict(k=0), dict(padding_px=-1), dict(hi_axes='x')):
            with self.assertRaises(ValueError):
                NB.bake_normal_map(m, Vh, Fh, t, log=None, **kw)
        for taille in (0, -3, 20000):
            with self.assertRaises(ValueError):
                NB.bake_normal_map(m, Vh, Fh, taille, log=None)
        with self.assertRaises(ValueError):
            NB.bake_normal_map(m, Vh[:, :2], Fh, t, log=None)
        with self.assertRaises(ValueError):
            NB.bake_normal_map(m, Vh, Fh[:, :2], t, log=None)
        with self.assertRaises(ValueError):
            NB.bake_normal_map(m, Vh, Fh + len(Vh), t, log=None)
        with self.assertRaises(ValueError):
            NB.bake_normal_map(m, Vh, Fh - 1, t, log=None)
        with self.assertRaises(ValueError):
            NB.appliquer_carte_normales(m, np.zeros((4, 4), np.uint8), log=None)

    def test_sommets_fins_non_finis_ou_orphelins(self):
        m, Vh, Fh, t = self.plan()
        V2 = Vh.copy()
        V2[5] = np.nan
        V2 = np.concatenate([V2, np.full((10, 3), 7.0, np.float32)])      # 10 sommets orphelins (aucune face)
        a = bake(m, V2, Fh, t)
        self.assertIsNotNone(a)
        b = bake(m, Vh, Fh, t)
        self.assertLess(float(np.abs(a.astype(int) - b.astype(int)).mean()), 1.0)

    def test_journal_en_cas_de_succes(self):
        m, Vh, Fh, t = self.plan()
        journal = []
        stats = {}
        carte = NB.bake_normal_map(m, Vh, Fh, t, log=journal.append, stats=stats)
        self.assertIsNotNone(carte)
        self.assertGreaterEqual(len(journal), 4)
        self.assertTrue(all(l.startswith('[normales]') for l in journal), journal)
        for cle in ('rasterisation', 'axes_fins', 'arbre_kd', 'ombrage', 'remplissage'):
            self.assertIn(cle, stats['phases'])
        self.assertEqual(stats['texels_couverts'], 64 * 64)
        # un journal qui leve ne doit pas faire echouer la cuisson
        def casse(_):
            raise RuntimeError('journal casse')
        self.assertIsNotNone(NB.bake_normal_map(m, Vh, Fh, t, log=casse))

    def test_les_entrees_ne_sont_pas_modifiees(self):
        m, Vh, Fh, t = self.plan()
        V0, F0, v0, f0, uv0 = Vh.copy(), Fh.copy(), np.array(m.vertices), np.array(m.faces), np.array(m.visual.uv)
        bake(m, Vh, Fh, t)
        for a in (Vh, Fh):
            a.flags.writeable = False
        bake(m, Vh, Fh, t)                                                            # entrees en lecture seule acceptees
        self.assertTrue(np.array_equal(Vh, V0) and np.array_equal(Fh, F0))
        self.assertTrue(np.array_equal(m.vertices, v0) and np.array_equal(m.faces, f0) and np.array_equal(m.visual.uv, uv0))
        self.assertIsNone(m.visual.material.normalTexture)                            # la scene n'est modifiee que par appliquer_carte_normales

    def test_torch_et_numpy_donnent_les_memes_octets(self):
        try:
            import torch
        except Exception as e:                       # pragma: no cover
            self.skipTest('torch absent : %s' % e)
        m, Vh, Fh, t = self.plan()
        ref = bake(m, Vh, Fh, t)
        for ftype in (np.int32, np.int64):
            a = bake(m, torch.from_numpy(Vh), torch.from_numpy(Fh.astype(ftype)), t)
            self.assertTrue(np.array_equal(a, ref), 'torch %s' % ftype.__name__)
            b = bake(m, Vh, Fh.astype(ftype), t)
            self.assertTrue(np.array_equal(b, ref), 'numpy %s' % ftype.__name__)
        # sommets en float64 : meme resultat a l'arrondi pres (le noyau convertit lui-meme)
        c = bake(m, torch.from_numpy(Vh.astype(np.float64)), torch.from_numpy(Fh), t)
        self.assertLess(float(np.abs(c.astype(int) - ref.astype(int)).max()), 2.0)

    def test_scene_multi_geometries(self):
        """Deux geometries d'une Scene qui partagent un atlas (regions UV distinctes), relief different : chacune est decodee juste."""
        ha, ga = champ_sinus(0.02, 2, 3)
        hb, gb = champ_sinus(0.02, 3, 2)
        fa = grille_fine(97, ha, 0.0, 1.0, 0.0, 1.0)
        fb = grille_fine(97, hb, 2.0, 3.0, 0.0, 1.0)
        Vh, Fh = fusionner(fa, fb)
        T = 128
        qa = quad_final(0, 1, 0, 1, uv_de=lambda xn, yn: (0.05 + 0.4 * xn, 0.05 + 0.4 * yn))
        qb = quad_final(2, 3, 0, 1, uv_de=lambda xn, yn: (0.55 + 0.4 * xn, 0.55 + 0.4 * yn))
        ma = maillage_texture(qa[0], qa[1], qa[2], normales=np.tile([0.0, 1.0, 0.0], (4, 1)))
        mb = maillage_texture(qb[0], qb[1], qb[2], normales=np.tile([0.0, 1.0, 0.0], (4, 1)))
        scene = trimesh.Scene()
        scene.add_geometry(ma, geom_name='partie_a')
        scene.add_geometry(mb, geom_name='partie_b')
        carte = bake(scene, Vh, Fh, T)
        self.assertIsNotNone(carte)
        for geo, grad, (x0, x1) in ((ma, ga, (0.0, 1.0)), (mb, gb, (2.0, 3.0))):
            uv = np.asarray(geo.visual.uv)
            proprio, bary = raster_reference(uv, np.asarray(geo.faces), T, T)
            dec = DecodeurThreeJs(geo.vertices, geo.vertex_normals, uv, geo.faces)
            n, P, (rr, cc), _ = dec.decoder(carte, proprio, bary)
            u0, u1 = uv[:, 0].min(), uv[:, 0].max()
            v0, v1 = uv[:, 1].min(), uv[:, 1].max()
            xn = ((cc + 0.5) / T - u0) / (u1 - u0)
            yn = ((1.0 - (rr + 0.5) / T) - v0) / (v1 - v0)
            hx, hy = grad(x0 + xn * (x1 - x0), yn)
            ref = zup_yup(np.stack([-hx, -hy, np.ones_like(hx)], -1) / np.linalg.norm(np.stack([-hx, -hy, np.ones_like(hx)], -1), axis=-1, keepdims=True))
            dedans = (rr >= 5) & (rr < T - 5) & (cc >= 5) & (cc < T - 5)
            self.assertLess(angles_deg(n, ref)[dedans].mean(), 3.0)
        # appliquer : les deux materiaux recoivent la carte, les geometries gardent leur nom
        self.assertEqual(NB.appliquer_carte_normales(scene, carte, log=None), 2)
        self.assertEqual(sorted(scene.geometry.keys()), ['partie_a', 'partie_b'])
        for g in scene.geometry.values():
            self.assertIsNotNone(g.visual.material.normalTexture)
        glb = scene.export(file_type='glb')
        j, _ = lire_glb(glb)
        self.assertEqual(len(j['meshes']), 2)
        self.assertTrue(all('normalTexture' in mat for mat in j['materials']))


# =====================================================================================================================
# Application sur le materiau et export GLB
# =====================================================================================================================

def lire_glb(octets):
    """(json, blob binaire) d'un GLB."""
    magie, version, longueur = struct.unpack('<4sII', octets[:12])
    assert magie == b'glTF' and version == 2
    lj, tj = struct.unpack('<I4s', octets[12:20])
    assert tj == b'JSON'
    j = json.loads(octets[20:20 + lj].decode('utf-8'))
    reste = octets[20 + lj:]
    blob = b''
    if len(reste) >= 8:
        lb, tb = struct.unpack('<I4s', reste[:8])
        assert tb == b'BIN\x00'
        blob = reste[8:8 + lb]
    return j, blob


def image_du_glb(j, blob, index_texture):
    tex = j['textures'][index_texture]
    src = tex['source'] if 'source' in tex else tex['extensions']['EXT_texture_webp']['source']
    vue = j['bufferViews'][j['images'][src]['bufferView']]
    return Image.open(io.BytesIO(blob[vue.get('byteOffset', 0):vue.get('byteOffset', 0) + vue['byteLength']])), j['images'][src]['mimeType']


class Export(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        h, grad = champ_sinus(0.03, 3, 3)
        cls.Vh, cls.Fh = grille_fine(129, h)
        cls.carte = None

    def fabriquer(self, **materiau):
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        m = maillage_texture(Vq, Fq, UV, **materiau)
        m.visual.material.metallicRoughnessTexture = Image.fromarray(np.full((4, 4, 3), 90, np.uint8))
        carte = bake(m, self.Vh, self.Fh, 128)
        return m, carte

    def test_le_materiau_existant_est_garde(self):
        m, carte = self.fabriquer()
        mat0 = m.visual.material
        base, mr = mat0.baseColorTexture, mat0.metallicRoughnessTexture
        n = NB.appliquer_carte_normales(m, carte, log=None)
        self.assertEqual(n, 1)
        mat = m.visual.material
        self.assertIs(mat.baseColorTexture, base)
        self.assertIs(mat.metallicRoughnessTexture, mr)
        self.assertEqual((mat.metallicFactor, mat.roughnessFactor, mat.doubleSided), (0.25, 0.75, True))
        self.assertTrue(np.array_equal(np.asarray(mat.normalTexture), carte))
        self.assertEqual(mat.normalTexture.size, (128, 128))

    def test_materiau_simple_converti_et_maillage_sans_materiau(self):
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        carte = np.full((16, 16, 3), NB.NORMALE_PLATE, np.uint8)
        m = trimesh.Trimesh(Vq, Fq, visual=trimesh.visual.TextureVisuals(uv=UV, material=trimesh.visual.material.SimpleMaterial(
            image=Image.fromarray(np.full((4, 4, 3), 50, np.uint8)))), process=False)
        self.assertEqual(NB.appliquer_carte_normales(m, carte, log=None), 1)
        self.assertIsNotNone(m.visual.material.normalTexture)
        self.assertIsNotNone(m.visual.material.baseColorTexture)                       # la couleur est gardee par la conversion
        m2 = trimesh.Trimesh(Vq, Fq, visual=trimesh.visual.TextureVisuals(uv=UV), process=False)
        self.assertEqual(NB.appliquer_carte_normales(m2, carte, log=None), 1)
        self.assertIsNotNone(m2.visual.material.normalTexture)

    def test_export_glb_png_et_webp(self):
        m, carte = self.fabriquer()
        NB.appliquer_carte_normales(m, carte, log=None)
        for webp in (False, True):
            with self.subTest(webp=webp):
                glb = m.export(file_type='glb', extension_webp=webp)
                j, blob = lire_glb(glb)
                mat = j['materials'][0]
                self.assertIn('normalTexture', mat)
                self.assertNotIn('scale', mat['normalTexture'])
                self.assertIn('baseColorTexture', mat['pbrMetallicRoughness'])
                self.assertIn('metallicRoughnessTexture', mat['pbrMetallicRoughness'])
                self.assertTrue(mat.get('doubleSided'))
                attrs = j['meshes'][0]['primitives'][0]['attributes']
                self.assertIn('NORMAL', attrs)                                          # sans NORMAL three.js passerait en ombrage plat
                self.assertIn('TEXCOORD_0', attrs)
                self.assertNotIn('TANGENT', attrs)                                      # tangentes derivees par le lecteur : repere par triangle
                img, mime = image_du_glb(j, blob, mat['normalTexture']['index'])
                self.assertEqual(mime, 'image/webp' if webp else 'image/png')
                relu = np.asarray(img.convert('RGB'))
                self.assertTrue(np.array_equal(relu, carte), 'carte alteree par l export (%s) : ecart max %d' % (
                    mime, int(np.abs(relu.astype(int) - carte.astype(int)).max())))

    def test_sans_perte_est_necessaire(self):
        """Temoin : une image PIL ordinaire, exportee par trimesh en WebP, est ALTEREE (WebP avec perte, qualite 80)."""
        m, carte = self.fabriquer()
        NB.appliquer_carte_normales(m, carte, log=None, sans_perte=False)
        j, blob = lire_glb(m.export(file_type='glb', extension_webp=True))
        img, mime = image_du_glb(j, blob, j['materials'][0]['normalTexture']['index'])
        relu = np.asarray(img.convert('RGB')).astype(int)
        self.assertGreater(int(np.abs(relu - carte.astype(int)).max()), 0)

    def test_relecture_par_trimesh(self):
        m, carte = self.fabriquer()
        NB.appliquer_carte_normales(m, carte, log=None)
        scene = trimesh.load(io.BytesIO(m.export(file_type='glb')), file_type='glb')
        g = list(scene.geometry.values())[0]
        self.assertTrue(np.array_equal(np.asarray(g.visual.material.normalTexture.convert('RGB')), carte))
        self.assertIsNotNone(g.visual.material.baseColorTexture)

    def test_carte_pil_acceptee(self):
        m, carte = self.fabriquer()
        self.assertEqual(NB.appliquer_carte_normales(m, Image.fromarray(carte), log=None), 1)

    def test_normal_exporte_meme_sans_cuisson_prealable(self):
        """Sans attribut NORMAL three.js passe en ombrage plat : la carte posee sur un maillage dont les normales n'avaient jamais ete
        calculees doit tout de meme faire ecrire NORMAL."""
        Vq, Fq, UV = quad_final(0, 1, 0, 1)
        m = maillage_texture(Vq, Fq, UV)
        self.assertNotIn('vertex_normals', m._cache.cache)
        NB.appliquer_carte_normales(m, np.full((8, 8, 3), NB.NORMALE_PLATE, np.uint8), log=None)
        j, _ = lire_glb(m.export(file_type='glb'))
        self.assertIn('NORMAL', j['meshes'][0]['primitives'][0]['attributes'])

    def test_proteger_les_cartes_d_un_glb_relu(self):
        """Un GLB relu par trimesh puis re-exporte en WebP voit sa carte re-encodee AVEC PERTE ; proteger_cartes_normales l'en empeche."""
        m, carte = self.fabriquer()
        NB.appliquer_carte_normales(m, carte, log=None)
        relu = trimesh.load(io.BytesIO(m.export(file_type='glb', extension_webp=True)), file_type='glb')
        j, blob = lire_glb(relu.export(file_type='glb', extension_webp=True))
        img, _ = image_du_glb(j, blob, j['materials'][0]['normalTexture']['index'])
        perte = int(np.abs(np.asarray(img.convert('RGB')).astype(int) - carte.astype(int)).max())
        self.assertGreater(perte, 0, 'temoin : sans protection le re-export devrait alterer la carte')
        self.assertEqual(NB.proteger_cartes_normales(relu), 1)
        self.assertEqual(NB.proteger_cartes_normales(relu), 1)                         # idempotent
        j, blob = lire_glb(relu.export(file_type='glb', extension_webp=True))
        img, _ = image_du_glb(j, blob, j['materials'][0]['normalTexture']['index'])
        self.assertTrue(np.array_equal(np.asarray(img.convert('RGB')), carte))
        # sans carte, ou sans materiau : rien ne leve
        self.assertEqual(NB.proteger_cartes_normales(trimesh.Trimesh()), 0)
        self.assertEqual(NB.proteger_cartes_normales(None), 0)


# =====================================================================================================================
# Blocs et bandes : les memes octets quelle que soit la taille des paquets de travail
# =====================================================================================================================

class BlocsEtBandes(unittest.TestCase):
    """Le noyau traite les triangles, les texels, les faces fines et les lignes d'atlas par paquets (memoire bornee). Les constantes sont
    reduites ici a presque rien : tous les chemins multi-paquets (et le pool de fils, qui exige plusieurs bandes) doivent rendre les MEMES octets."""

    CONSTANTES = {'_BLOC_PAIRES': 7, '_BLOC_TEXELS': 50, '_BLOC_FACES': 100, '_BLOC_OMBRAGE': 700, '_BANDE_REMPLISSAGE': 24}

    def jeu(self):
        h, grad = champ_sinus(0.03, 3, 3)
        Vh, Fh = grille_fine(49, h)
        leg = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
        s = trimesh.creation.icosphere(subdivisions=3, radius=1.0)
        V, F, UV, N = ilots_par_face(np.asarray(leg.vertices), np.asarray(leg.faces), 'plates', 0.5, True, 2)
        return (maillage_texture(V, F, UV, normales=N), np.asarray(s.vertices, np.float32), np.asarray(s.faces, np.int32),
                maillage_texture(*quad_final(0, 1, 0, 1)), Vh, Fh)

    def test_paquets_minuscules_memes_octets(self):
        m, Vs, Fs, mq, Vh, Fh = self.jeu()
        ref_sphere = bake(m, Vs, Fs, 192)
        ref_plan = bake(mq, Vh, Fh, 96)
        anciennes = {k: getattr(NB, k) for k in self.CONSTANTES}
        try:
            for k, v in self.CONSTANTES.items():
                setattr(NB, k, v)
            for workers in (1, 3, -1):
                with self.subTest(workers=workers):
                    self.assertTrue(np.array_equal(bake(m, Vs, Fs, 192, workers=workers), ref_sphere))
                    self.assertTrue(np.array_equal(bake(mq, Vh, Fh, 96, workers=workers), ref_plan))
            stats = {}
            bake(m, Vs, Fs, 192, workers=3, stats=stats)
            self.assertEqual(stats['fils'], 3)                                             # le pool a bien ete utilise
        finally:
            for k, v in anciennes.items():
                setattr(NB, k, v)

    def test_remplissage_aleatoire_par_bandes(self):
        """Ilots rectangulaires aleatoires aux valeurs aleatoires, bandes de 24 rangees : chaque texel rempli prend la valeur d'un texel couvert a la
        distance euclidienne MINIMALE (comme avec une seule bande), la zone est le carre de demi-cote 8, les texels couverts ne bougent pas."""
        from scipy import ndimage
        H, W, p = 260, 70, 8
        ancienne = NB._BANDE_REMPLISSAGE
        try:
            NB._BANDE_REMPLISSAGE = 24
            for graine in range(6):
                with self.subTest(graine=graine):
                    rng = np.random.default_rng(graine)
                    couvert = np.zeros((H, W), bool)
                    for _ in range(14):
                        r0, c0 = int(rng.integers(0, H - 6)), int(rng.integers(0, W - 6))
                        couvert[r0:r0 + int(rng.integers(1, 9)), c0:c0 + int(rng.integers(1, 9))] = True
                    image = np.empty((H, W, 3), np.uint8)
                    image[:] = NB.NORMALE_PLATE
                    image[couvert] = rng.integers(0, 256, (int(couvert.sum()), 3), dtype=np.uint8)
                    avant = image.copy()
                    n = NB._remplir_bords(image, couvert, p)
                    zone = ndimage.binary_dilation(couvert, structure=np.ones((2 * p + 1, 2 * p + 1), bool)) & ~couvert
                    self.assertEqual(n, int(zone.sum()))
                    self.assertTrue(np.array_equal(image[couvert], avant[couvert]))
                    self.assertTrue(np.array_equal(image[~couvert & ~zone], avant[~couvert & ~zone]))        # hors zone : intact
                    cr, cc = np.nonzero(couvert)
                    for r, c in zip(*np.nonzero(zone)):
                        d2 = (cr - r) ** 2 + (cc - c) ** 2
                        proches = np.flatnonzero(d2 == d2.min())
                        self.assertIn(tuple(image[r, c]), {tuple(avant[cr[i], cc[i]]) for i in proches}, (graine, r, c))
        finally:
            NB._BANDE_REMPLISSAGE = ancienne

    def test_remplissage_sur_plusieurs_bandes(self):
        """Atlas haut de 2200 rangees (bandes de 1024) : des ilots a cheval sur les limites de bande (rangees 1024 et 2048) sont remplis
        exactement comme avec une seule bande, et la zone est le carre de demi-cote 8."""
        T = (2200, 96)
        ha, _ = champ_plan(0.3, 0.0)
        Vh, Fh = grille_fine(21, ha)
        Vq, Fq, UV = quad_final(0, 1, 0, 1, uv_de=lambda xn, yn: (0.2 + 0.5 * xn, 1.0 - (1000 + 60 * (1.0 - yn)) / 2200.0))
        Vq2, Fq2, UV2 = quad_final(0, 1, 0, 1, uv_de=lambda xn, yn: (0.2 + 0.5 * xn, 1.0 - (2040 + 60 * (1.0 - yn)) / 2200.0))
        V = np.concatenate([Vq, Vq2])
        F = np.concatenate([Fq, Fq2 + 4])
        m = maillage_texture(V, F, np.concatenate([UV, UV2]))
        carte = bake(m, Vh, Fh, T)
        proprio, _ = raster_reference(np.asarray(m.visual.uv), np.asarray(m.faces), T[0], T[1])
        couvert = proprio >= 0
        self.assertGreater(int(couvert.sum()), 2 * 40 * 55)
        from scipy import ndimage
        zone = ndimage.binary_dilation(couvert, structure=np.ones((17, 17), bool))
        plat = np.all(carte.astype(int) == np.array(NB.NORMALE_PLATE), axis=2)
        self.assertTrue(plat[~zone].all())
        self.assertFalse(plat[zone].any())
        self.assertGreater(int((zone & ~couvert & (np.arange(T[0])[:, None] > 1016) & (np.arange(T[0])[:, None] < 1032)).sum()), 50)
        # une seule bande : memes octets
        ancienne = NB._BANDE_REMPLISSAGE
        try:
            NB._BANDE_REMPLISSAGE = 10 ** 6
            une_bande = bake(m, Vh, Fh, T)
        finally:
            NB._BANDE_REMPLISSAGE = ancienne
        self.assertTrue(np.array_equal(carte, une_bande))


# =====================================================================================================================
# Atlas 8192 (opt-in)
# =====================================================================================================================

@unittest.skipUnless(os.environ.get('NORMAL_BAKE_LONG'), 'NORMAL_BAKE_LONG=1 pour l atlas 8192 (~1 Go de memoire)')
class Atlas8192(unittest.TestCase):

    def test_atlas_8192_creux(self):
        h, grad = champ_sinus(0.03, 3, 3)
        Vh, Fh = grille_fine(129, h)
        Vq, Fq, UV = quad_final(0, 1, 0, 1, uv_de=lambda xn, yn: (0.30 + 0.20 * xn, 0.30 + 0.20 * yn))
        m = maillage_texture(Vq, Fq, UV)
        stats = {}
        carte = NB.bake_normal_map(m, Vh, Fh, 8192, log=None, stats=stats)
        self.assertEqual(carte.shape, (8192, 8192, 3))
        self.assertGreater(stats['texels_couverts'], 1500 * 1500)
        self.assertTrue((carte[0, 0] == NB.NORMALE_PLATE).all())
        print('  atlas 8192 : %.1f s, phases %s' % (stats['duree_s'], {k: round(v, 2) for k, v in stats['phases'].items()}))


# =====================================================================================================================
# Contrat du module
# =====================================================================================================================

@unittest.skipIf(ENTRE_MUTANT, 'contrat verifie sur le module reel seulement')
class ContratDuModule(unittest.TestCase):

    def test_importe_seulement_numpy_au_chargement(self):
        arbre = ast.parse(lire(SOURCE))
        haut = set()
        for n in arbre.body:
            if isinstance(n, ast.Import):
                haut |= {a.name.split('.')[0] for a in n.names}
            elif isinstance(n, ast.ImportFrom):
                haut.add((n.module or '').split('.')[0])
        self.assertEqual(haut, {'os', 'time', 'concurrent', 'types', 'numpy'}, haut)

    def test_imports_paresseux_connus(self):
        arbre = ast.parse(lire(SOURCE))
        modules = set()
        for n in ast.walk(arbre):
            if isinstance(n, ast.Import):
                modules |= {a.name.split('.')[0] for a in n.names}
            elif isinstance(n, ast.ImportFrom):
                modules.add((n.module or '').split('.')[0])
        # numpy + scipy sont obligatoires ; PIL et trimesh servent seulement a poser la carte ; ni cv2, ni torch, ni cumesh, ni nvdiffrast
        self.assertEqual(modules - {'os', 'time', 'concurrent', 'types'}, {'numpy', 'scipy', 'PIL', 'trimesh'}, modules)
        texte = lire(SOURCE)
        for interdit in ('import cv2', 'import torch', 'import cumesh', 'import nvdiffrast', 'import kaolin'):
            self.assertNotIn(interdit, texte)

    def test_api_publique(self):
        self.assertEqual(set(NB.__all__), {'NORMALE_PLATE', 'K_DEFAUT', 'PADDING_DEFAUT', 'AXES_FINS', 'RECALAGE_MAX',
                                           'bake_normal_map', 'appliquer_carte_normales', 'proteger_cartes_normales'})
        import inspect
        p = inspect.signature(NB.bake_normal_map).parameters
        self.assertEqual(list(p)[:4], ['scene', 'hi_vertices', 'hi_faces', 'texture_size'])
        self.assertEqual((p['k'].default, p['padding_px'].default, p['hi_axes'].default), (4, 8, 'zup_to_yup'))
        self.assertEqual(p['k'].kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertIn('log', p)
        self.assertEqual(list(inspect.signature(NB.appliquer_carte_normales).parameters)[:2], ['scene', 'image'])

    def test_marqueurs_du_noyau_partage(self):
        texte = lire(SOURCE, newline='').replace('\r\n', '\n')
        self.assertEqual(texte.count('# --- NOYAU PARTAGE : DEBUT'), 1)
        self.assertEqual(texte.count('# --- NOYAU PARTAGE : FIN ---'), 1)
        self.assertLess(texte.index('# --- NOYAU PARTAGE : DEBUT'), texte.index('# --- NOYAU PARTAGE : FIN ---'))

    def test_les_deux_copies_sont_identiques(self):
        a = lire(os.path.join(RACINE, 'scripts', 'normal_bake.py'), newline='').replace('\r\n', '\n')
        b = lire(COPIE, newline='').replace('\r\n', '\n')
        self.assertEqual(a, b, 'modal_app/normal_bake.py a diverge de scripts/normal_bake.py : node build/check-noyaux-partages.mjs --sync')

    def test_aucune_lettre_accentuee_dans_le_code(self):
        for chemin in (SOURCE, COPIE):
            texte = lire(chemin)
            hors_ascii = sorted({c for c in texte if ord(c) > 127})
            self.assertEqual(hors_ascii, [], chemin)

    def test_pas_d_etat_global_modifiable(self):
        arbre = ast.parse(lire(SOURCE))
        self.assertFalse([n for n in ast.walk(arbre) if isinstance(n, ast.Global)])


# =====================================================================================================================
# Mutations
# =====================================================================================================================

# (nom, [(ancien, nouveau), ...]) : chaque ancien doit apparaitre EXACTEMENT une fois (compte donne en 3e position si > 1)
MUTATIONS = [
    ('canal vert inverse',
     [('(nh * T).sum(axis=1), (nh * B).sum(axis=1), zt]', '(nh * T).sum(axis=1), -(nh * B).sum(axis=1), zt]', 1)]),
    ('canal rouge inverse',
     [('ts = np.stack([(nh * T).sum(axis=1), (nh * B)', 'ts = np.stack([-(nh * T).sum(axis=1), (nh * B)', 1)]),
    ('bitangente non orientee du cote des v croissants (ilots en miroir faux)',
     [('B = B * np.where((B * g["Pv"][tri]).sum(axis=1) < 0, -1.0, 1.0)[:, None]', 'B = B * 1.0', 1)]),
    ('V non retourne (rangee 0 = bas de l image)',
     [('(1.0 - UV[i0, 1]) * H', 'UV[i0, 1] * H', 1), ('(1.0 - UV[i1, 1]) * H', 'UV[i1, 1] * H', 1),
      ('(1.0 - UV[i2, 1]) * H', 'UV[i2, 1] * H', 1)]),
    ('transformation d axes oubliee (hi_axes par defaut = none)',
     [('hi_axes="zup_to_yup", log=print, workers=-1, stats=None):', 'hi_axes="none", log=print, workers=-1, stats=None):', 1)]),
    ('transformation d axes fausse dans l arbre KD',
     [('pts[:, 1] = sel[:, 2]\n        pts[:, 2] = -sel[:, 1]', 'pts[:, 1] = -sel[:, 2]\n        pts[:, 2] = sel[:, 1]', 1)]),
    ('transformation inverse des axes fausse (normales fines)',
     [('return np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1)\n    return v\n\n\ndef _vers_fin',
       'return np.stack([v[:, 0], -v[:, 2], v[:, 1]], axis=1)\n    return v\n\n\ndef _vers_fin', 1)]),
    ('k = 1 par defaut', [('K_DEFAUT = 4', 'K_DEFAUT = 1', 1)]),
    ('pas de dilatation par defaut', [('PADDING_DEFAUT = 8', 'PADDING_DEFAUT = 0', 1)]),
    ('remplissage par la valeur plate au lieu du texel le plus proche',
     [('image[r + rr, cc] = image[idx[0][lo:hi][rr, cc] + a, idx[1][lo:hi][rr, cc]]', 'image[r + rr, cc] = NORMALE_PLATE', 1)]),
    ('rayon de remplissage reduit de moitie',
     [('2 * p + 1', 'p + 1', 2)]),
    ('voisins fins non orientes du cote de la normale finale',
     [('signe = np.where((G * Nr[:, None, :]).sum(axis=2) < 0, np.float32(-1.0), np.float32(1.0))',
       'signe = np.ones(G.shape[:2], np.float32)', 1)]),
    ('garde de recalage desactive', [('RECALAGE_MAX = 0.10', 'RECALAGE_MAX = 1e9', 1)]),
    ('normale du maillage final remplacee par la normale de face (pas la normale lissee)',
     [('N = _unitaires(la * ctx.N[f[:, 0]] + lb * ctx.N[f[:, 1]] + lc * ctx.N[f[:, 2]], g["Nf"][tri])',
       'N = g["Nf"][tri]', 1)]),
    ('tangente non orthogonalisee contre la normale',
     [('T = Pu - (Pu * N).sum(axis=1)[:, None] * N', 'T = Pu * 1.0', 1)]),
    ('export WebP avec perte (qualite 80 de PIL)',
     [('WEBP_SANS_PERTE = {"lossless": True, "quality": 0, "method": 1}', 'WEBP_SANS_PERTE = {"lossless": False, "quality": 80, "method": 4}', 1)]),
    ('carte non posee sur le materiau', [('        materiau.normalTexture = image\n', '        pass\n', 1)]),
    ('bandes de remplissage sans marge (ilots a cheval sur deux bandes)',
     [('a, b = max(0, r - marge), min(H, r + _BANDE_REMPLISSAGE + marge)', 'a, b = r, min(H, r + _BANDE_REMPLISSAGE)', 1)]),
    ('marge des bandes egale au padding (le texel couvert le plus proche peut etre hors bande)',
     [('marge = int(np.ceil(1.4143 * p)) + 1', 'marge = p', 1)]),
    ('normales de sommet non inscrites avant l export', [('        _ = g.vertex_normals\n        n += 1', '        n += 1', 1)]),
]

CLASSES_DES_MUTANTS = ['Plan', 'IlotsConstants', 'Axes', 'Export', 'BlocsEtBandes', 'SphereIlots', 'CasLimites']


@unittest.skipIf(ENTRE_MUTANT, 'les mutations ne se rejouent pas dans un mutant')
class MutationsDuNoyau(unittest.TestCase):
    """Chaque mutation, appliquee a une COPIE du module, doit faire echouer les tests ci-dessus (aucun fichier du depot n'est modifie)."""

    @classmethod
    def setUpClass(cls):
        cls.dossier = tempfile.mkdtemp(prefix='mutations-normal-bake-')
        cls.source = lire(SOURCE, newline='')

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dossier, ignore_errors=True)

    def lancer(self, chemin_module):
        env = dict(os.environ, NOYAU_NORMAL_BAKE=chemin_module, PYTHONUTF8='1')
        cmd = [sys.executable, os.path.abspath(__file__), '-f'] + ['%s' % c for c in CLASSES_DES_MUTANTS]       # -f : s'arrete au premier echec
        return subprocess.run(cmd, cwd=RACINE, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)

    def test_le_noyau_non_mute_passe_les_classes_des_mutants(self):
        """Temoin : sans mutation, la meme commande reussit (sinon l'echec d'une mutation ne prouverait rien)."""
        r = self.lancer(SOURCE)
        self.assertEqual(r.returncode, 0, r.stderr[-3000:])

    def test_chaque_mutation_est_detectee(self):
        non_detectees = []
        for i, (nom, remplacements) in enumerate(MUTATIONS):
            texte = self.source
            for ancien, nouveau, attendu in remplacements:
                n = texte.count(ancien)
                self.assertEqual(n, attendu, 'mutation %r : %d occurrence(s) de %r (specification perimee)' % (nom, n, ancien))
                texte = texte.replace(ancien, nouveau)
            chemin = os.path.join(self.dossier, 'mutant_%02d.py' % i)
            with io.open(chemin, 'w', encoding='utf-8', newline='') as f:
                f.write(texte)
            r = self.lancer(chemin)
            etat = 'detectee' if r.returncode else 'NON DETECTEE'
            print('  mutation %02d %s : %s' % (i + 1, nom, etat))
            if not r.returncode:
                non_detectees.append(nom)
        print('  %d mutations, %d non detectee(s)' % (len(MUTATIONS), len(non_detectees)))
        self.assertEqual(non_detectees, [], 'mutations non detectees : le noyau n est pas couvert sur ces points')


if __name__ == '__main__':
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    unittest.main()
