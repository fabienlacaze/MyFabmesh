"""Chaine du bureau hors IA sur le VRAI orc (495 000 faces, texture 4K) : rendre (pyrender) -> masque sur la zone VUE -> repeinte
simulee -> preparer -> assembler (piece synthetique). Mesure : le reste du corps revient dans son repere d'origine, ou se
trouve la zone retiree (la coupe se fait sur toute la profondeur), ou se pose la piece, duree.
usage : python chaine_orc.py <yaw> <pitch> <u_frac> <v_frac> <rayon_px> [maillage.glb]
  (u_frac, v_frac : position du centre du masque dans l'image du rendu, 0..1)"""
import json
import os
import sys
import tempfile
import time
import types

import numpy as np
from PIL import Image, ImageDraw

RACINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
sys.path.insert(0, os.path.join(RACINE, 'build', 'bancs', 'noyaux'))
import mesh_inpaint as mi  # noqa: E402
from _maillages import sphere_texturee  # noqa: E402
import trimesh  # noqa: E402
from scipy.spatial import cKDTree  # noqa: E402

yaw, pitch = float(sys.argv[1]), float(sys.argv[2])
uf, vf, rayon = float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5])
MAILLAGE = sys.argv[6] if len(sys.argv) > 6 else 'C:/tmp/trellis_cloud/glb/orc_A2_sans_socle.glb'
S = 512
d = tempfile.mkdtemp(prefix='orc_chaine_')
t0 = time.time()

# 1. rendre
vue = os.path.join(d, 'vue.png')
mi.rendre(MAILLAGE, vue, S, yaw, pitch)
vj = vue + '.vue.json'
neutre = (yaw == 0 and pitch == 0)
xm = json.load(open(vj, encoding='utf-8'))['xmag'] if not neutre else 0.6
print(f'rendre : {time.time() - t0:.1f} s, demi-largeur {xm}')

# 2. masque sur la zone voulue, repeinte simulee
cx, cy = uf * S, vf * S
masque = os.path.join(d, 'masque.png')
im = Image.new('L', (S, S), 0)
ImageDraw.Draw(im).ellipse([cx - rayon, cy - rayon, cx + rayon, cy + rayon], fill=255)
im.save(masque)
repeint = os.path.join(d, 'repeint.png')
a = Image.open(vue).convert('RGB')
ImageDraw.Draw(a).ellipse([cx - rayon * 0.8, cy - rayon * 0.8, cx + rayon * 0.8, cy + rayon * 0.8], fill=(40, 90, 220))
a.save(repeint)

faux = types.ModuleType('lucida_matte')


def matte(entree, sortie):
    arr = np.asarray(Image.open(entree).convert('RGB'))
    Image.fromarray(np.dstack([arr, ((arr < 250).any(2) * 255).astype(np.uint8)])).save(sortie)


faux.matte = matte
sys.modules['lucida_matte'] = faux

# 3. preparer
piece_png = os.path.join(d, 'piece.png')
cadre = os.path.join(d, 'cadre.json')
t1 = time.time()
mi.preparer(repeint, masque, piece_png, cadre, vue, vj if not neutre else None)
print(f'preparer : {time.time() - t1:.1f} s')
c = json.load(open(cadre, encoding='utf-8'))
print('cadre :', {k: (np.round(v, 3).tolist() if isinstance(v, list) else v) for k, v in c.items()})

# 4. piece synthetique + assembler
piece_glb = os.path.join(d, 'piece.glb')
p = sphere_texturee(subdivisions=3, taille_texture=256, graine=5)
trimesh.Scene([p]).export(piece_glb)
sortie = os.path.join(d, 'sortie.glb')
t2 = time.time()
mi.assembler(MAILLAGE, masque, cadre, piece_glb, sortie)
print(f'assembler : {time.time() - t2:.1f} s ; total {time.time() - t0:.1f} s')

# 5. mesures
orig = trimesh.load(MAILLAGE, force='scene').to_geometry()
sc = trimesh.load(sortie, force='scene')
corps = next(g for n, g in sc.geometry.items() if 'corps' in n)
pz = next(g for n, g in sc.geometry.items() if 'zone' in n)
ov = np.asarray(orig.vertices)
dist, _ = cKDTree(ov).query(np.asarray(corps.vertices))
print(f'faces : origine {len(orig.faces)} -> corps {len(corps.faces)} (retirees ~{len(orig.faces) - len(corps.faces)})')
print(f'sommets du corps absents de l origine (>1e-5) : {(dist > 1e-5).sum()} sur {len(corps.vertices)} ; ecart max {dist.max():.2e}')
# faces retirees : leurs centres, dans le repere d'origine, par profondeur selon l'axe de la camera
R = mi.matrice_vue(yaw, pitch)[:3, :3]
ctr_o = orig.triangles_center
tree_c = cKDTree(np.asarray(corps.triangles_center))
dc, _ = tree_c.query(ctr_o)
retirees = dc > 1e-6
ctr_r = ctr_o[retirees]
prof = (ctr_r @ R.T)[:, 2]          # profondeur dans le repere de la vue : + = cote camera
print(f'faces retirees : {retirees.sum()} ; profondeur (axe de vue) min {prof.min():.3f} max {prof.max():.3f} ; '
      f'cote camera {(prof > 0).sum()} / cote oppose {(prof <= 0).sum()}')
zb = ctr_r.mean(0)
print('centre des faces retirees (repere origine) :', np.round(zb, 3).tolist())
print('centre de la piece (repere origine)       :', np.round(np.asarray(pz.vertices).mean(0), 3).tolist())
print('boite origine :', np.round(orig.bounds, 3).tolist())
print('boite sortie  :', np.round(trimesh.util.concatenate([corps, pz]).bounds, 3).tolist())
print('dossier', d)
