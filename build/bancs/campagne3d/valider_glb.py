"""Mesures d'un GLB produit par un outil 3D : sommets, faces, texture (taille, luminance, part de pixels noirs), metal / rugosite, boite, valeurs non finies.
Usage : python valider_glb.py <fichier.glb>   -> une ligne JSON sur la sortie standard."""
import json, os, sys
import numpy as np
import trimesh
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

chemin = sys.argv[1]
r = {'fichier': os.path.basename(chemin), 'taille_mo': round(os.path.getsize(chemin) / 1048576, 1)}
try:
    sc = trimesh.load(chemin, force='scene', process=False)
    geoms = list(sc.geometry.values())
    r['geometries'] = len(geoms)
    V = sum(len(g.vertices) for g in geoms); F = sum(len(g.faces) for g in geoms)
    r['sommets'] = int(V); r['faces'] = int(F)
    allv = np.vstack([np.asarray(g.vertices) for g in geoms]) if geoms else np.zeros((0, 3))
    r['non_fini'] = int((~np.isfinite(allv)).sum())
    if len(allv):
        r['boite'] = [round(float(x), 3) for x in (allv.max(0) - allv.min(0))]
    g = max(geoms, key=lambda x: len(x.faces)) if geoms else None
    if g is not None:
        mat = getattr(g.visual, 'material', None)
        r['uv'] = bool(getattr(g.visual, 'uv', None) is not None and len(getattr(g.visual, 'uv', [])) > 0)
        for nom, attr in (('couleur', 'baseColorTexture'), ('metal_rugosite', 'metallicRoughnessTexture'), ('normale', 'normalTexture'), ('emissive', 'emissiveTexture')):
            im = getattr(mat, attr, None) if mat is not None else None
            if im is not None:
                r['tex_' + nom] = list(im.size)
        im = getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)
        if im is not None:
            a = np.asarray(im.convert('RGB').resize((1024, 1024), Image.BOX)).astype(np.float32)
            lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
            r['lum_moy'] = round(float(lum.mean()), 1); r['part_noir_pct'] = round(float((lum < 12).mean() * 100), 1); r['ecart_type'] = round(float(lum.std()), 1)
        mr = getattr(mat, 'metallicRoughnessTexture', None) if mat is not None else None
        if mr is not None:
            m = np.asarray(mr.convert('RGB').resize((256, 256), Image.BOX)).astype(np.float32)
            r['rugosite_moy'] = round(float(m[..., 1].mean() / 255), 2); r['metal_moy'] = round(float(m[..., 2].mean() / 255), 2)
        r['metal_facteur'] = getattr(mat, 'metallicFactor', None)
except Exception as e:  # noqa
    r['erreur'] = repr(e)[:200]
print(json.dumps(r, ensure_ascii=False))
