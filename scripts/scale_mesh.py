"""Apply an orientation (rotation) and a per-axis scale to a mesh, baking them into a new
GLB. Texture/UVs are preserved (only the geometry moves). Args:
<src.glb> <out.glb> <sx> <sy> <sz> [<qx> <qy> <qz> <qw>]  (quaternion = three.js order).
Pure trimesh, no GPU."""
import sys
import trimesh


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


if __name__ == '__main__':
    SRC, OUT = sys.argv[1], sys.argv[2]
    sx = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    sy = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    sz = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
    q = [float(v) for v in sys.argv[6:10]] if len(sys.argv) > 9 else None
    obj, tourne = redimensionner_orienter(trimesh.load(SRC), sx, sy, sz, q)
    obj.export(OUT)
    print(f"DONE scale=({sx:.4f},{sy:.4f},{sz:.4f}) rotation={'oui' if tourne else 'non'} -> {OUT}", flush=True)
