"""ESSAI (03/10/2026) : etape haute resolution de TRELLIS decoupee en 8 tuiles (octants) qui se chevauchent, grille 2048.
Les predictions du flot sont moyennees (poids en rampe) dans les recouvrements a CHAQUE pas ; coordonnees absolues conservees.
Une seule generation (orc, graine 7). Lancer : PYTHONUTF8=1 python -m modal run modal_app/exp_trellis_tuiles.py
Sortie : C:/tmp/trellis_cloud/glb/orc_T8_2048.glb"""
import io
import os
import time

import modal

from modal_app.app import mesh_image

app = modal.App("myfabmesh-exp-tuiles", image=mesh_image)
SORTIE = "C:/tmp/trellis_cloud"


@app.function(gpu="L40S", timeout=3000, secrets=[modal.Secret.from_name("huggingface", required_keys=["HF_TOKEN"])])
def generer(png: bytes, configs: list, seed: int = 7, marge: int = 2) -> dict:
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
    pipe.low_vram = False        # tout reste sur la carte (48 Go) : sinon les flots restent sur le CPU
    pipe.cuda()
    import o_voxel
    from modal_app._mesh import prep_image

    class Tuiles(nn.Module):
        """Enveloppe d'un flot creux : 8 octants (n_div^3) + marge (en blocs de 16), moyenne ponderee des sorties."""
        def __init__(self, m, grille):
            super().__init__()
            self.m, self.g = m, grille
            self.in_channels = m.in_channels
            self.nt = 0
            self.n_div = 2

        def forward(self, x, t, cond, concat_cond=None, **kw):
            c = x.coords[:, 1:].float()
            n_div = self.n_div
            taille = self.g / n_div
            acc = torch.zeros(x.feats.shape[0], self.m.out_channels, device=x.feats.device)
            ws = torch.zeros(x.feats.shape[0], 1, device=x.feats.device)
            for i in range(n_div):
                for j in range(n_div):
                    for k in range(n_div):
                        lo = torch.tensor([i, j, k], device=c.device) * taille - marge
                        hi = lo + taille + 2 * marge
                        dans = ((c >= lo) & (c < hi)).all(1)
                        idx = torch.nonzero(dans).squeeze(1)
                        if idx.numel() == 0:
                            continue
                        # poids : 1 au coeur, rampe lineaire dans la marge
                        d = torch.minimum(c[idx] - lo, hi - 1 - c[idx]).min(1).values
                        w = (d + 1).clamp(max=2 * marge).float() / (2 * marge)
                        span = taille + 2 * marge
                        dec = 0 * lo                     # recale la tuile dans la plage de positions connue du modele (0..96)
                        dec = torch.cat([torch.zeros(1, device=c.device), dec]).round().int()
                        cs = x.coords[idx] + dec
                        sub = SparseTensor(feats=x.feats[idx], coords=cs)
                        k2 = dict(kw)
                        if concat_cond is not None:
                            k2["concat_cond"] = SparseTensor(feats=concat_cond.feats[idx], coords=cs)
                        out = self.m(sub, t, cond, **k2)
                        acc[idx] += out.feats.float() * w[:, None]
                        ws[idx] += w[:, None]
                        self.nt += 1
            return x.replace(acc / ws.clamp(min=1e-6))

        def to(self, *a, **k):
            return self

    img = prep_image(Image.open(io.BytesIO(png)))
    import gc
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
        hr = pipe.models["shape_slat_decoder"].upsample(slat, upsample_times=4)      # STRUCTURE ET LR COMMUNES aux trois essais
        fm = pipe.models["shape_slat_flow_model_1024"]
        tex_m = pipe.models["tex_slat_flow_model_1024"]
        tn = pipe.tex_slat_normalization
        for (g, nd) in configs:
            try:
                q = torch.cat([hr[:, :1], ((hr[:, 1:] + 0.5) / 512 * (g // 16)).int()], dim=1)
                hc = q.unique(dim=0)
                torch.manual_seed(seed + 1)
                tf = Tuiles(fm, g // 16) if nd > 1 else fm
                tt = Tuiles(tex_m, g // 16) if nd > 1 else tex_m
                if nd > 1:
                    tf.n_div = tt.n_div = nd
                noise = SparseTensor(feats=torch.randn(hc.shape[0], fm.in_channels).cuda(), coords=hc)
                sh = pipe.shape_slat_sampler.sample(tf, noise, **c1024, **sp, verbose=False).samples * std + mean
                shn = (sh - mean) / std
                nz = shn.replace(feats=torch.randn(shn.coords.shape[0], tex_m.in_channels - shn.feats.shape[1]).cuda())
                tp = dict(pipe.tex_slat_sampler_params); tp.update(steps=32, guidance_strength=3.0, guidance_rescale=0.5, rescale_t=1.5)
                tex = pipe.tex_slat_sampler.sample(tt, nz, concat_cond=shn, **c1024, **tp, verbose=False).samples
                tex = tex * torch.tensor(tn["std"])[None].cuda() + torch.tensor(tn["mean"])[None].cuda()
                lat[(g, nd)] = (sh, tex, int(hc.shape[0]))
                print("echantillonne", g, nd, hc.shape[0], "jetons", round(time.time() - t0, 1), "s", flush=True)
            except Exception as e:
                print('ECHEC echantillonnage', g, nd, repr(e)[:300], flush=True)
                gc.collect(); torch.cuda.empty_cache()
    for k in list(pipe.models):
        if "flow" in k:
            pipe.models[k].cpu()
    del hr, slat
    gc.collect(); torch.cuda.empty_cache()
    sortie = {}
    for (g, nd), (sh, tex, nt) in lat.items():
        try:
            with torch.no_grad():
                ov = pipe.decode_latent(sh, tex, g)[0]
            v = ov.vertices
            print("DECODAGE", g, "sommets", tuple(v.shape), "min", [round(float(x), 3) for x in v.min(0).values], "max", [round(float(x), 3) for x in v.max(0).values],
                  "faces", tuple(ov.faces.shape), "coords", str(ov.coords.dtype), int(ov.coords.min()), int(ov.coords.max()), "nan", bool(torch.isnan(v).any()), flush=True)
        except Exception as e:
            print("ECHEC decodage", g, repr(e)[:300], flush=True)
            continue
        for remesh in (True, False):
            try:
                glb = o_voxel.postprocess.to_glb(vertices=ov.vertices, faces=ov.faces, attr_volume=ov.attrs, coords=ov.coords, attr_layout=ov.layout,
                                                 voxel_size=ov.voxel_size, aabb=[[-0.5] * 3, [0.5] * 3], decimation_target=500_000, texture_size=4096, remesh=remesh, verbose=False)
                try:
                    print("EXPORT remesh=%s bornes %s" % (remesh, [[round(float(x), 3) for x in r] for r in glb.bounds]), flush=True)
                except Exception:
                    pass
                b = io.BytesIO()
                glb.export(b, file_type="glb")
                sortie["G%d_T%d_r%d" % (g, nd, int(remesh))] = {"glb": b.getvalue(), "jetons": nt}
                del glb
            except Exception as e:
                print("ECHEC export remesh=%s" % remesh, g, repr(e)[:300], flush=True)
            gc.collect(); torch.cuda.empty_cache()
        del ov
        gc.collect(); torch.cuda.empty_cache()
    return sortie


@app.local_entrypoint()
def main():
    png = open(SORTIE + "/entrees/orc_rgba_union_sans_socle.png", "rb").read()
    r = generer.remote(png, [[2048, 1]])
    os.makedirs(SORTIE + "/glb", exist_ok=True)
    for k, v in r.items():
        open(SORTIE + "/glb/cmp_%s.glb" % k, "wb").write(v["glb"])
        print(k, v["jetons"], "jetons", len(v["glb"]))
