import os, trimesh
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
M = os.environ['APPDATA'] + '/myfabmesh-ai/meshes'
glb = M + '/chevalier_medieval_trellis2_native_1790901989157.glb'
os.makedirs('out', exist_ok=True)


def export(jpg, out):
    sc = trimesh.load(glb, force='scene', process=False)
    m = list(sc.geometry.values())[0]
    mat = m.visual.material
    img = Image.open(jpg)
    img.load()
    mat.baseColorTexture = img
    sc.export(out)
    print(out, os.path.getsize(out) // 1024 // 1024, 'Mo', img.size, img.format)


export('proj6_chev/atlas_avant_8k.jpg', 'site3d/chevalier_avant.glb')
export('proj6_chev/atlas_apres_8k.jpg', 'site3d/chevalier_apres.glb')
export('proj6_chev/atlas_apres_8k.jpg', 'out/chevalier_medieval_projete.glb')
