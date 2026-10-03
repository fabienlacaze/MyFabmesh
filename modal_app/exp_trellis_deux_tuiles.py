"""ESSAI (03/10/2026) : etape haute resolution de TRELLIS decoupee en DEUX tuiles, devant / derriere (axe de moindre etendue des jetons),
avec un recouvrement LARGE (la moitie de la profondeur) et un poids en smoothstep dans la zone commune. Les predictions du flot sont moyennees
a CHAQUE appel (forme, puis texture). Deux variantes : coupe fixe ; coupe qui SAUTE d'un pas a l'autre (+-10 % de la profondeur, derivee du pas
de temps donc identique pour les appels positif et negatif du guidage) pour que les raccords ne se figent pas.
Meme image, graine et structure basse resolution que la comparaison 1536 / 1792 (bruit de depart identique a celui de cmp_G1792_T1).
Lancer : PYTHONUTF8=1 python -m modal run modal_app/exp_trellis_deux_tuiles.py   -> C:/tmp/trellis_cloud/glb/cmp_G1792_D2*.glb"""
import io
import os
import time

import modal

from modal_app.app import mesh_image

app = modal.App("myfabmesh-exp-deux-tuiles", image=mesh_image)
SORTIE = "C:/tmp/trellis_cloud"


@app.function(gpu="L40S", timeout=3000, secrets=[modal.Secret.from_name("huggingface", required_keys=["HF_TOKEN"])])
def generer(png: bytes, configs: list, seed: int = 7) -> dict:
    import gc
    import sys
    sys.path.insert(0, "/opt/trellis2_local")
    os.environ.setdefault("TRELLIS2_USE_KAOLIN_RASTER", "1")
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    import torch
    import torch.nn as nn
    from PIL import Image
    from huggingface_hub import snapshot_download

    root = snapshot_download("microsoft/TRELLIS.2-4B", allow_patterns=["pipeline.json"])
    pj = os.path.join(root, "pipeline.json")
    s = open(pj, encoding="utf-8").read()
    if "briaai/RMBG-2.0" in s:
        open(pj, "w", encoding="utf-8").write(s.replace("briaai/RMBG-2.0", "ZhengPeng7/BiRefNet"))
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    from trellis2.pipelines import rembg as rm
    from trellis2.modules.sparse import SparseTensor
    orig = rm.BiRefNet
    rm.BiRefNet = type("X", (), {"__init__": lambda self, *a, **k: None})
    try:
        pipe = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
    finally:
        rm.BiRefNet = orig
    pipe.rembg_model = None
    pipe.low_vram = False        # tout reste sur la carte : sinon les flots restent sur le CPU
    pipe.cuda()
    import o_voxel
    from modal_app._mesh import prep_image

    # CORRECTIF TABLE DE HACHAGE (cause des triangles etires a 2048) : o_voxel.convert.flexible_dual_grid._init_hashmap calcule
    # VOL = grid[0] * grid[1] * grid[2] sur des TENSEURS int32 : deborde des la grille 1626 (2048 -> 0). Le type de cle retombe alors
    # sur uint32 alors que x * H * D depasse 2^32 : les cles se replient (a 2048, x et x + 1024 donnent la meme cle) et les voisins
    # sont recherches au mauvais endroit. Calcul en entiers Python : uint64 des que le volume depasse 2^32.
    import sys as _sys
    _fdg = _sys.modules["o_voxel.convert.flexible_dual_grid"]

    def _init_hashmap_corrige(grid_size, capacity, device):
        vol = int(grid_size[0].item()) * int(grid_size[1].item()) * int(grid_size[2].item())
        dt = torch.uint32 if vol < 2 ** 32 else torch.uint64
        keys = torch.full((capacity,), torch.iinfo(dt).max, dtype=dt, device=device)
        vals = torch.empty((capacity,), dtype=torch.uint32, device=device)
        return keys, vals
    if os.environ.get("EXP_SANS_CORRECTIF") != "1":
        _fdg._init_hashmap = _init_hashmap_corrige
        print("correctif de la table de hachage installe", flush=True)

    class DeuxTuiles(nn.Module):
        """Enveloppe d'un flot creux : deux tuiles le long de `axe`, recouvrement `rec` (part de l'etendue), poids smoothstep."""
        def __init__(self, m, axe, lo, hi, rec, saut):
            super().__init__()
            self.m, self.axe, self.lo, self.hi, self.rec, self.saut = m, axe, lo, hi, rec, saut
            self.in_channels = m.in_channels
            self.appels = 0

        def forward(self, x, t, cond, concat_cond=None, **kw):
            c = x.coords[:, 1 + self.axe].float()
            etendue = self.hi - self.lo + 1.0
            mid = self.lo + etendue / 2
            if self.saut:
                g = torch.Generator().manual_seed(int(round(float(t.flatten()[0]) * 1000)) + 12345)
                mid = mid + (torch.rand(1, generator=g).item() - 0.5) * 0.2 * etendue
            ho = self.rec * etendue / 2
            s = ((c - (mid - ho)) / (2 * ho)).clamp(0, 1)
            s = s * s * (3 - 2 * s)
            acc = torch.zeros(x.feats.shape[0], self.m.out_channels, device=x.feats.device)
            ws = torch.zeros(x.feats.shape[0], 1, device=x.feats.device)
            for poids, masque in ((1 - s, c <= mid + ho), (s, c >= mid - ho)):
                idx = torch.nonzero(masque & (poids > 0)).squeeze(1)
                if idx.numel() == 0:
                    continue
                sub = SparseTensor(feats=x.feats[idx], coords=x.coords[idx])
                k2 = dict(kw)
                if concat_cond is not None:
                    k2["concat_cond"] = SparseTensor(feats=concat_cond.feats[idx], coords=concat_cond.coords[idx])
                out = self.m(sub, t, cond, **k2)
                acc[idx] += out.feats.float() * poids[idx][:, None]
                ws[idx] += poids[idx][:, None]
                self.appels += 1
            return x.replace(acc / ws.clamp(min=1e-6))

        def to(self, *a, **k):
            return self

    img = prep_image(Image.open(io.BytesIO(png)))
    t0 = time.time()
    lat = {}
    with torch.no_grad():
        torch.manual_seed(seed)
        c512, c1024 = pipe.get_cond([img], 512), pipe.get_cond([img], 1024)
        coords = pipe.sample_sparse_structure(c512, 32, 1, {})
        sp = pipe.shape_slat_sampler_params
        noise = SparseTensor(feats=torch.randn(coords.shape[0], pipe.models["shape_slat_flow_model_512"].in_channels).cuda(), coords=coords)
        slat = pipe.shape_slat_sampler.sample(pipe.models["shape_slat_flow_model_512"], noise, **c512, **sp, verbose=False).samples
        n = pipe.shape_slat_normalization
        std = torch.tensor(n["std"])[None].cuda(); mean = torch.tensor(n["mean"])[None].cuda()
        slat = slat * std + mean
        hr = pipe.models["shape_slat_decoder"].upsample(slat, upsample_times=4)
        fm = pipe.models["shape_slat_flow_model_1024"]
        tex_m = pipe.models["tex_slat_flow_model_1024"]
        tn = pipe.tex_slat_normalization
        for cfg in configs:
            g, nom = cfg["g"], cfg["nom"]
            t1 = time.time()
            try:
                q = torch.cat([hr[:, :1], ((hr[:, 1:] + 0.5) / 512 * (g // 16)).int()], dim=1)
                hc = q.unique(dim=0)
                torch.manual_seed(seed + 1)
                if cfg["mode"] == "d2":
                    co = hc[:, 1:]
                    ext = co.max(0).values - co.min(0).values + 1
                    axe = int(ext.argmin())
                    lo, hi = float(co[:, axe].min()), float(co[:, axe].max())
                    print("axe de profondeur", axe, "etendues", ext.tolist(), "bornes", lo, hi, flush=True)
                    tf = DeuxTuiles(fm, axe, lo, hi, cfg.get("rec", 0.5), cfg.get("saut", False))
                    tt = DeuxTuiles(tex_m, axe, lo, hi, cfg.get("rec", 0.5), cfg.get("saut", False))
                else:
                    tf, tt = fm, tex_m
                noise = SparseTensor(feats=torch.randn(hc.shape[0], fm.in_channels).cuda(), coords=hc)
                sh = pipe.shape_slat_sampler.sample(tf, noise, **c1024, **sp, verbose=False).samples * std + mean
                shn = (sh - mean) / std
                nz = shn.replace(feats=torch.randn(shn.coords.shape[0], tex_m.in_channels - shn.feats.shape[1]).cuda())
                tp = dict(pipe.tex_slat_sampler_params); tp.update(steps=32, guidance_strength=3.0, guidance_rescale=0.5, rescale_t=1.5)
                tex = pipe.tex_slat_sampler.sample(tt, nz, concat_cond=shn, **c1024, **tp, verbose=False).samples
                tex = tex * torch.tensor(tn["std"])[None].cuda() + torch.tensor(tn["mean"])[None].cuda()
                lat[nom] = (g, sh, tex, int(hc.shape[0]))
                print("echantillonne", nom, g, hc.shape[0], "jetons en", round(time.time() - t1, 1), "s", flush=True)
            except Exception as e:
                print("ECHEC echantillonnage", nom, repr(e)[:300], flush=True)
                gc.collect(); torch.cuda.empty_cache()
    for k in list(pipe.models):
        if "flow" in k:
            pipe.models[k].cpu()
    del hr, slat
    gc.collect(); torch.cuda.empty_cache()

    sortie = {}
    for nom, (g, sh, tex, nt) in lat.items():
        try:
            with torch.no_grad():
                ov = pipe.decode_latent(sh, tex, g)[0]
            v = ov.vertices
            print("DECODAGE", nom, "min", [round(float(x), 3) for x in v.min(0).values], "max", [round(float(x), 3) for x in v.max(0).values], flush=True)
            for remesh in (True, False):
                glb = o_voxel.postprocess.to_glb(vertices=ov.vertices, faces=ov.faces, attr_volume=ov.attrs, coords=ov.coords, attr_layout=ov.layout,
                                                 voxel_size=ov.voxel_size, aabb=[[-0.5] * 3, [0.5] * 3], decimation_target=500_000, texture_size=4096, remesh=remesh, verbose=False)
                bornes = [[round(float(x), 3) for x in r] for r in glb.bounds]
                print("EXPORT", nom, "remesh", remesh, "bornes", bornes, flush=True)
                b = io.BytesIO()
                glb.export(b, file_type="glb")
                sortie[nom + ("" if remesh else "_r0")] = {"glb": b.getvalue(), "jetons": nt}
                del glb
                gc.collect(); torch.cuda.empty_cache()
                if max(abs(x) for r in bornes for x in r) < 5:      # sain : inutile d'exporter aussi sans remaillage
                    break
        except Exception as e:
            print("ECHEC export", nom, repr(e)[:300], flush=True)
        gc.collect(); torch.cuda.empty_cache()
        print("exporte", nom, flush=True)
    return sortie


@app.local_entrypoint()
def main():
    png = open(SORTIE + "/entrees/orc_rgba_union_sans_socle.png", "rb").read()
    configs = [
        dict(g=1792, mode="un", nom="G1792_fix"),
        dict(g=2048, mode="un", nom="G2048_fix"),
    ]
    r = generer.remote(png, configs)
    os.makedirs(SORTIE + "/glb", exist_ok=True)
    for k, v in r.items():
        open(SORTIE + "/glb/cmp_%s.glb" % k, "wb").write(v["glb"])
        print(k, v["jetons"], "jetons", len(v["glb"]))
