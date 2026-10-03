"""Repere les articulations (spheres magenta) d'une capture de l'editeur « Skeleton points » : rend les centres en fractions du cadre (x, y de 0 a 1).
Usage : python blobs.py <capture.png> [min_pixels]  -> JSON : [{x, y, n}, ...] tries de haut en bas."""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

im = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
mn = int(sys.argv[2]) if len(sys.argv) > 2 else 6
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mask = (r > 170) & (b > 170) & (g < 130) & (np.abs(r - b) < 70)
lab, n = ndimage.label(mask)
out = []
for i in range(1, n + 1):
    ys, xs = np.where(lab == i)
    if len(ys) < mn: continue
    out.append({'x': round(float(xs.mean() / im.shape[1]), 4), 'y': round(float(ys.mean() / im.shape[0]), 4), 'n': int(len(ys))})
out.sort(key=lambda d: d['y'])
print(json.dumps(out))
