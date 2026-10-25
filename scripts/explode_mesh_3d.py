"""Fracture a finished GLB into Voronoi shards, exported as ONE GLB whose shards
are named submeshes `part_00`, `part_01`, … at their ORIGINAL positions.

The 3D viewer's live "explode" slider (the same control used for segmented
meshes) blasts the shards outward continuously — no baked stages, no file
swapping. Texture is preserved: each shard keeps the ORIGINAL vertices/UVs and
references the same baked texture (no re-bake); face-colour fallback otherwise.

Shards are thin shells (same triangle budget as the source — no solidify, so the
result stays light and loads fast). The viewer renders the explosion parts
DOUBLE-SIDED so the hollow interior shows the (lit) texture instead of a black
void — a "filled" look with zero extra geometry.

Args: <mesh.glb> <out.glb> [fragments] [fill] [mode : voronoi|slices|wedges|blocks|regions]. Pure geometry (no GPU). Deterministic.
"""
import sys
import numpy as np
import trimesh

SRC, OUT = sys.argv[1], sys.argv[2]
FRAGS = int(sys.argv[3]) if len(sys.argv) > 3 else 24
FRAGS = max(4, min(FRAGS, 200))
RNG = np.random.RandomState(1234)
MODE = sys.argv[5] if len(sys.argv) > 5 else 'voronoi'   # type de decoupe (25/10)

def _etiquettes_decoupe(centroides, k, mode, rng):
    """Etiquette de chaque face selon le TYPE de decoupe (25/10) : voronoi (eclats irreguliers, defaut),
    slices (tranches horizontales a effectif egal), wedges (quartiers autour de l'axe vertical),
    blocks (grille reguliere en 3D), regions (zones compactes de taille voisine, k-moyennes).
    Meme code que scripts/explode_mesh_3d.py (bureau)."""
    import numpy as np
    n = len(centroides)
    k = max(1, min(int(k), n))
    mode = str(mode or 'voronoi').lower()
    def _par_rang(valeurs):
        ordre = np.argsort(valeurs, kind='stable')
        lab = np.empty(n, dtype=np.int64)
        lab[ordre] = (np.arange(n) * k) // n
        return lab
    if mode == 'slices':
        return _par_rang(centroides[:, 1])
    if mode == 'wedges':
        c = centroides - centroides.mean(axis=0)
        return _par_rang(np.arctan2(c[:, 0], c[:, 2]))
    if mode == 'blocks':
        c = max(2, int(round(k ** (1.0 / 3.0))))
        mn, mx = centroides.min(axis=0), centroides.max(axis=0)
        cases = np.clip(((centroides - mn) / np.maximum(mx - mn, 1e-9) * c).astype(np.int64), 0, c - 1)
        return cases[:, 0] + c * (cases[:, 1] + c * cases[:, 2])
    if mode == 'regions':
        try:
            from scipy.cluster.vq import kmeans2
            echant = centroides if n <= 60000 else centroides[rng.choice(n, 60000, replace=False)]
            centres, _ = kmeans2(echant, k, minit='++', seed=1234, iter=10)
            from scipy.spatial import cKDTree
            return cKDTree(centres).query(centroides)[1]
        except Exception:
            pass
    seeds = centroides[rng.choice(n, k, replace=False)]
    try:
        from scipy.spatial import cKDTree
        return cKDTree(seeds).query(centroides)[1]
    except Exception:
        d = np.linalg.norm(centroides[:, None, :] - seeds[None, :, :], axis=2)
        return d.argmin(axis=1)

scene = trimesh.load(SRC)
if isinstance(scene, trimesh.Scene):
    geoms = list(scene.geometry.values())
    mesh = geoms[0] if len(geoms) == 1 else trimesh.util.concatenate(geoms)
else:
    mesh = scene
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
k = min(FRAGS, len(F))
labels = _etiquettes_decoupe(fc_centroids, k, MODE, RNG)

out = trimesh.Scene()
n = 0
for lab in np.unique(labels):
    face_ids = np.where(labels == lab)[0]
    if len(face_ids) == 0:
        continue
    faces_k = F[face_ids]
    uniq, inv = np.unique(faces_k, return_inverse=True)
    shard = trimesh.Trimesh(V[uniq], inv.reshape(-1, 3), process=False)
    if MAT is not None and UV is not None:
        shard.visual = trimesh.visual.TextureVisuals(uv=UV[uniq], material=MAT)
    elif FACE_COLORS is not None:
        shard.visual = trimesh.visual.ColorVisuals(shard, face_colors=FACE_COLORS[face_ids])
    name = f"part_{n:02d}"
    out.add_geometry(shard, node_name=name, geom_name=name)
    n += 1

out.export(OUT)
print(f"DONE {n} shards -> {OUT}", flush=True)
