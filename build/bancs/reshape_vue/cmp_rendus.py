"""Parite des deux rendus a plat sur le MEME maillage et les MEMES angles :
 - le site (three.js, dans le navigateur, capture par l'essai navigateur) ;
 - le bureau (pyrender, scripts/mesh_inpaint.py rendre).
Mesure : IoU des silhouettes (pixels non blancs), ecart moyen de couleur sur l'intersection, demi-largeur de la fenetre.
Compare aussi la vue de face du NOUVEAU site a celle de l'ANCIEN code (a l'octet de pixel pres).
Ecrit un montage par vue : site | bureau | difference."""
import json
import os
import sys
import tempfile

import numpy as np
from PIL import Image

MONT = os.environ.get('R3D_SORTIE', 'C:/tmp/trellis_cloud/montages/').rstrip('/') + '/'
RACINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
import mesh_inpaint as mi  # noqa: E402

MAILLAGE = os.environ.get('R3D_MAILLAGE', 'C:/tmp/trellis_cloud/glb/orc_A2_sans_socle.glb')
res = json.load(open(MONT + 'reshape3d_site_resultat.json', encoding='utf-8'))


def charge(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.int16)


def masque(a):
    return a.sum(2) < 740


def comparer(nom, fichier_site, yaw, pitch, rapport):
    web = charge(fichier_site)
    tmp = os.path.join(tempfile.gettempdir(), 'r3d_py_%s.png' % nom)
    mi.rendre(MAILLAGE, tmp, web.shape[0], yaw, pitch)
    py = charge(tmp)
    vue = {}
    if os.path.exists(tmp + '.vue.json'):
        vue = json.load(open(tmp + '.vue.json', encoding='utf-8'))
    mw, mp = masque(web), masque(py)
    inter, union = (mw & mp).sum(), (mw | mp).sum()
    iou = float(inter) / max(1, int(union))
    ecart = float(np.abs(web - py)[mw & mp].mean()) if inter else None
    h, w = web.shape[:2]
    diff = np.zeros((h, w, 3), np.uint8)
    diff[mw & ~mp] = (255, 0, 0)       # seulement dans le site
    diff[mp & ~mw] = (0, 0, 255)       # seulement dans le bureau
    diff[mw & mp] = (200, 200, 200)
    Image.fromarray(np.concatenate([web.astype(np.uint8), py.astype(np.uint8), diff], axis=1)).resize((w * 3 // 2, h // 2)).save(MONT + 'reshape3d_parite_%s.png' % nom)
    rapport.append({'vue': nom, 'yaw': yaw, 'pitch': pitch, 'xmag_bureau': vue.get('xmag', 0.6), 'IoU': round(iou, 4),
                    'ecart_couleur_moyen': None if ecart is None else round(ecart, 2), 'pixels_site': int(mw.sum()), 'pixels_bureau': int(mp.sum())})


rapport = []
# vues rapides rendues a l'etape 2
for r in res.get('rendus', []):
    if r.get('vue') and r.get('upload'):
        comparer(r['nom'], r['upload'][0]['fichier'], r['vue'][0], r['vue'][1], rapport)
# vue prise a la souris
if res.get('vueOrbite') and res.get('etape2_orbite_rendu'):
    comparer('orbite', res['etape2_orbite_rendu'][0]['fichier'], res['vueOrbite'][0], res['vueOrbite'][1], rapport)
# vue de face : nouveau site (yaw 0 / pitch 0) contre ancien code
ancien = json.load(open(MONT + 'reshape3d_site_ancien_resultat.json', encoding='utf-8')) if os.path.exists(MONT + 'reshape3d_site_ancien_resultat.json') else None
if ancien and ancien.get('uploads') and res.get('face_rendu'):
    a = charge(ancien['uploads'][0]['fichier'])
    b = charge(res['face_rendu'][0]['fichier'])
    rapport.append({'vue': 'face (nouveau site) contre ancien code', 'memes_dimensions': a.shape == b.shape,
                    'pixels_differents': int((np.abs(a - b).max(2) > 0).sum()) if a.shape == b.shape else None,
                    'octets_identiques': open(ancien['uploads'][0]['fichier'], 'rb').read() == open(res['face_rendu'][0]['fichier'], 'rb').read()})
    # et le bureau (pyrender) sur la face
    comparer('face', res['face_rendu'][0]['fichier'], 0, 0, rapport)
print(json.dumps(rapport, indent=1, ensure_ascii=False))
json.dump(rapport, open(MONT + 'reshape3d_parite.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
