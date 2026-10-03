"""ESSAI (03/10/2026) : TRELLIS a tres haute grille (3072, 4096), en deux etapes separees pour iterer sans refaire les 20 minutes d'echantillonnage.

  --etape sampler : echantillonne la forme + la texture (UNE seule tuile) pour chaque grille et SAUVE les latents sur un volume (/lat/<nom>.pt).
  --etape decoder : relit les latents, decode par TRANCHES (le decodeur n'a que des convolutions 3x3x3 : tranche + bord de securite, puis on ne garde
                    que le coeur), reconstruit le maillage en une fois, exporte le GLB. `--mode verif` compare, a 1792, le decodage par tranches au
                    decodage complet (memes voxels, memes valeurs) ; `--mode tranches` ; `--mode plein`.

Le correctif de la table de hachage (volume calcule en int32 : deborde des la grille 1626) est installe a l'execution dans les deux cas.
Lancer : PYTHONUTF8=1 python -m modal run modal_app/exp_trellis_haute_res.py --etape sampler
         PYTHONUTF8=1 python -m modal run modal_app/exp_trellis_haute_res.py --etape decoder --nom G1792 --mode verif
Sortie GLB : C:/tmp/trellis_cloud/glb/hr_<nom>_<mode>.glb"""
import io
import os
import time

import modal

from modal_app.app import mesh_image

app = modal.App("myfabmesh-exp-haute-res", image=mesh_image)
SORTIE = "C:/tmp/trellis_cloud"
vol = modal.Volume.from_name("exp-trellis-latents", create_if_missing=True)
SECRETS = [modal.Secret.from_name("huggingface", required_keys=["HF_TOKEN"])]


def _charger_pipeline():
    """Pipeline TRELLIS.2 sur la carte (meme chargement que MyFabmeshMesh.load_everything), correctif de hachage installe."""
    import sys
    sys.path.insert(0, "/opt/trellis2_local")
    os.environ.setdefault("TRELLIS2_USE_KAOLIN_RASTER", "1")
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    import torch
    from huggingface_hub import snapshot_download

    root = snapshot_download("microsoft/TRELLIS.2-4B", allow_patterns=["pipeline.json"])
    pj = os.path.join(root, "pipeline.json")
    s = open(pj, encoding="utf-8").read()
    if "briaai/RMBG-2.0" in s:
        open(pj, "w", encoding="utf-8").write(s.replace("briaai/RMBG-2.0", "ZhengPeng7/BiRefNet"))
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    from trellis2.pipelines import rembg as rm
    orig = rm.BiRefNet
    rm.BiRefNet = type("X", (), {"__init__": lambda self, *a, **k: None})
    try:
        pipe = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
    finally:
        rm.BiRefNet = orig
    pipe.rembg_model = None
    pipe.low_vram = False
    pipe.cuda()

    # CORRECTIF TABLE DE HACHAGE : VOL = grid[0] * grid[1] * grid[2] est calcule sur des tenseurs int32 (deborde des la grille 1626 : 2048 -> 0),
    # le type de cle retombe sur uint32 alors que x * H * D depasse 2^32 : les cles se replient (2048 : x et x + 1024 -> meme cle).
    import o_voxel  # noqa: F401
    fdg = sys.modules["o_voxel.convert.flexible_dual_grid"]

    def _init_hashmap_corrige(grid_size, capacity, device):
        vol_ = int(grid_size[0].item()) * int(grid_size[1].item()) * int(grid_size[2].item())
        dt = torch.uint32 if vol_ < 2 ** 32 else torch.uint64
        return (torch.full((capacity,), torch.iinfo(dt).max, dtype=dt, device=device),
                torch.empty((capacity,), dtype=torch.uint32, device=device))
    fdg._init_hashmap = _init_hashmap_corrige
    return pipe


# ------------------------------------------------------------------ etape 1 : echantillonnage -> latents sur le volume
@app.function(gpu="L40S", timeout=7200, secrets=SECRETS, volumes={"/lat": vol})
def echantillonner(png: bytes, grilles: list, seed: int = 7) -> dict:
    import sys
    sys.path.insert(0, "/opt/trellis2_local")
    import gc
    import torch
    from PIL import Image
    from trellis2.modules.sparse import SparseTensor
    from modal_app._mesh import prep_image

    pipe = _charger_pipeline()
    img = prep_image(Image.open(io.BytesIO(png)))
    t0 = time.time()
    res = {}
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
        for g in grilles:
            t1 = time.time()
            try:
                q = torch.cat([hr[:, :1], ((hr[:, 1:] + 0.5) / 512 * (g // 16)).int()], dim=1)
                hc = q.unique(dim=0)
                torch.manual_seed(seed + 1)
                noise = SparseTensor(feats=torch.randn(hc.shape[0], fm.in_channels).cuda(), coords=hc)
                sh = pipe.shape_slat_sampler.sample(fm, noise, **c1024, **sp, verbose=False).samples * std + mean
                shn = (sh - mean) / std
                nz = shn.replace(feats=torch.randn(shn.coords.shape[0], tex_m.in_channels - shn.feats.shape[1]).cuda())
                tp = dict(pipe.tex_slat_sampler_params); tp.update(steps=32, guidance_strength=3.0, guidance_rescale=0.5, rescale_t=1.5)
                tex = pipe.tex_slat_sampler.sample(tex_m, nz, concat_cond=shn, **c1024, **tp, verbose=False).samples
                tex = tex * torch.tensor(tn["std"])[None].cuda() + torch.tensor(tn["mean"])[None].cuda()
                torch.save({"g": g, "coords": sh.coords.cpu(), "sh": sh.feats.cpu(), "tex": tex.feats.cpu(), "tex_coords": tex.coords.cpu()}, "/lat/G%d.pt" % g)
                vol.commit()
                res["G%d" % g] = {"jetons": int(hc.shape[0]), "secondes": round(time.time() - t1, 1)}
                print("echantillonne + sauve G%d" % g, res["G%d" % g], flush=True)
                del sh, tex, shn, nz, noise
            except Exception as e:
                res["G%d" % g] = {"echec": repr(e)[:300]}
                print("ECHEC echantillonnage", g, repr(e)[:300], flush=True)
            gc.collect(); torch.cuda.empty_cache()
    return res


# ------------------------------------------------------------------ etape 2 : decodage (plein ou par tranches) + export
def _decoder_plein(pipe, sh, tex, torch, SparseTensor):
    from trellis2.models.sc_vaes.sparse_unet_vae import SparseUnetVaeDecoder
    dec, texd = pipe.models["shape_slat_decoder"], pipe.models["tex_slat_decoder"]
    with torch.no_grad():
        h, subs = SparseUnetVaeDecoder.forward(dec, sh, return_subs=True)
        tv = texd(tex, guide_subs=subs)
    return h.coords, h.feats, tv.coords, tv.feats


def _decoder_tranches(pipe, sh, tex, g, axe, K, halo, torch, SparseTensor, log):
    """Decode par tranches le long de `axe` (coordonnees des BLOCS de 16 voxels), `halo` blocs de contexte de chaque cote ; garde le coeur."""
    from trellis2.models.sc_vaes.sparse_unet_vae import SparseUnetVaeDecoder
    dec, texd = pipe.models["shape_slat_decoder"], pipe.models["tex_slat_decoder"]
    co = sh.coords
    c = co[:, 1 + axe]
    cmin, cmax = int(c.min()), int(c.max())
    larg = -(-(cmax - cmin + 1) // K)
    hc_, hf_, tc_, tf_ = [], [], [], []
    for k in range(K):
        lo = cmin + k * larg
        hi = min(lo + larg, cmax + 1)
        if lo >= hi:
            break
        idx = torch.nonzero((c >= lo - halo) & (c < hi + halo)).squeeze(1)
        if idx.numel() == 0:
            continue
        sub = SparseTensor(feats=sh.feats[idx], coords=co[idx])
        subt = SparseTensor(feats=tex.feats[idx], coords=co[idx])
        with torch.no_grad():
            h, subs = SparseUnetVaeDecoder.forward(dec, sub, return_subs=True)
            tv = texd(subt, guide_subs=subs)
        kh = (h.coords[:, 1 + axe] >= lo * 16) & (h.coords[:, 1 + axe] < hi * 16)
        kt = (tv.coords[:, 1 + axe] >= lo * 16) & (tv.coords[:, 1 + axe] < hi * 16)
        hc_.append(h.coords[kh]); hf_.append(h.feats[kh]); tc_.append(tv.coords[kt]); tf_.append(tv.feats[kt])
        log("tranche %d/%d blocs [%d, %d[ : %d jetons (avec bord), %d voxels forme gardes, %d voxels texture gardes, pic memoire %.1f Go"
            % (k + 1, K, lo, hi, idx.numel(), int(kh.sum()), int(kt.sum()), torch.cuda.max_memory_allocated() / 2 ** 30))
        del h, subs, tv, sub, subt, kh, kt
        torch.cuda.empty_cache()
    return torch.cat(hc_), torch.cat(hf_), torch.cat(tc_), torch.cat(tf_)


GPU_DEC = os.environ.get("EXP_GPU", "L40S")


@app.function(gpu=GPU_DEC, timeout=3600, secrets=SECRETS, volumes={"/lat": vol})
def decoder(nom: str, mode: str = "tranches", K: int = 6, halo: int = 10, remesh: bool = True, texture_size: int = 4096, fill_holes: bool = False,
            faces_cible: int = 500_000) -> dict:
    import sys
    sys.path.insert(0, "/opt/trellis2_local")
    import gc
    import torch
    import torch.nn.functional as F
    from types import SimpleNamespace
    from trellis2.modules.sparse import SparseTensor
    import o_voxel
    from o_voxel.convert import flexible_dual_grid_to_mesh

    def log(*a):
        print(*a, flush=True)

    vol.reload()
    d = torch.load("/lat/%s.pt" % nom)
    g = int(d["g"])
    pipe = _charger_pipeline()
    sh = SparseTensor(feats=d["sh"].cuda(), coords=d["coords"].cuda())
    tex = SparseTensor(feats=d["tex"].cuda(), coords=d["tex_coords"].cuda())
    for k in list(pipe.models):
        if "flow" in k:
            pipe.models[k].cpu()
    gc.collect(); torch.cuda.empty_cache()
    co = sh.coords[:, 1:]
    etend = (co.max(0).values - co.min(0).values + 1)
    axe = int(etend.argmax())          # tranches le long de l'axe le plus etendu
    stats = {"g": g, "jetons": int(sh.coords.shape[0]), "axe_tranches": axe, "etendues_blocs": etend.tolist()}
    t0 = time.time()
    torch.cuda.reset_peak_memory_stats()

    if mode == "verif":
        ca, fa, ta, tfa = _decoder_plein(pipe, sh, tex, torch, SparseTensor)
        log("decodage PLEIN : %d voxels forme, %d voxels texture, pic %.1f Go" % (ca.shape[0], ta.shape[0], torch.cuda.max_memory_allocated() / 2 ** 30))
        torch.cuda.reset_peak_memory_stats()
        cb, fb, tb, tfb = _decoder_tranches(pipe, sh, tex, g, axe, K, halo, torch, SparseTensor, log)

        def cle(c_):
            return (c_[:, 1].long() * g + c_[:, 2].long()) * g + c_[:, 3].long()

        def comparer(c1, f1, c2, f2, nomc):
            k1, i1 = torch.sort(cle(c1)); k2, i2 = torch.sort(cle(c2))
            seul1 = int((~torch.isin(k1, k2)).sum()); seul2 = int((~torch.isin(k2, k1)).sum())
            out = {"plein": int(k1.numel()), "tranches": int(k2.numel()), "seulement_plein": seul1, "seulement_tranches": seul2}
            if seul1 == 0 and seul2 == 0:
                diff = (f1[i1].float() - f2[i2].float()).abs()
                out["ecart_max"] = float(diff.max()); out["ecart_moyen"] = float(diff.mean())
                out["part_voxels_ecart_gt_1e-3"] = float((diff.max(1).values > 1e-3).float().mean())
            log("VERIF", nomc, out)
            return out
        stats["verif_forme"] = comparer(ca, fa, cb, fb, "forme")
        stats["verif_texture"] = comparer(ta, tfa, tb, tfb, "texture")
        stats["secondes"] = round(time.time() - t0, 1)
        return stats

    if mode == "plein":
        hc, hf, tc, tf = _decoder_plein(pipe, sh, tex, torch, SparseTensor)
    else:
        hc, hf, tc, tf = _decoder_tranches(pipe, sh, tex, g, axe, K, halo, torch, SparseTensor, log)
    stats["decodage_s"] = round(time.time() - t0, 1)
    stats["pic_go_decodage"] = round(torch.cuda.max_memory_allocated() / 2 ** 30, 1)
    stats["voxels_forme"], stats["voxels_texture"] = int(hc.shape[0]), int(tc.shape[0])
    log("decodage", stats)

    # maillage en une fois (meme calcul que FlexiDualGridVaeDecoder.forward)
    t1 = time.time()
    margin = pipe.models["shape_slat_decoder"].voxel_margin
    vtx = (1 + 2 * margin) * torch.sigmoid(hf[:, 0:3]) - margin
    inter = hf[:, 3:6] > 0
    ql = F.softplus(hf[:, 6:7])
    v, f = flexible_dual_grid_to_mesh(hc[:, 1:], vtx, inter, ql, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], grid_size=g, train=False)
    del vtx, inter, ql, hf, hc
    gc.collect(); torch.cuda.empty_cache()
    stats["sommets"], stats["faces_brutes"] = int(v.shape[0]), int(f.shape[0])
    stats["maillage_s"] = round(time.time() - t1, 1)
    stats["bornes_maillage"] = [[round(float(x), 3) for x in v.min(0).values], [round(float(x), 3) for x in v.max(0).values]]
    log("maillage", stats["sommets"], "sommets", stats["faces_brutes"], "faces", stats["bornes_maillage"], "en", stats["maillage_s"], "s")
    if fill_holes:
        from trellis2.representations import Mesh
        m = Mesh(v, f); m.fill_holes(); v, f = m.vertices, m.faces

    ov = SimpleNamespace(vertices=v, faces=f, attrs=tf * 0.5 + 0.5, coords=tc[:, 1:], layout=pipe.pbr_attr_layout, voxel_size=1.0 / g)
    for k_ in list(pipe.models):
        pipe.models[k_].cpu()
    del sh, tex, tf
    gc.collect(); torch.cuda.empty_cache()
    log('avant export : %.1f Go alloues sur la carte' % (torch.cuda.memory_allocated() / 2 ** 30))
    t2 = time.time()
    glb = None
    for rm_ in ([remesh, False] if remesh else [False]):
        try:
            glb = o_voxel.postprocess.to_glb(vertices=ov.vertices, faces=ov.faces, attr_volume=ov.attrs, coords=ov.coords, attr_layout=ov.layout,
                                             voxel_size=ov.voxel_size, aabb=[[-0.5] * 3, [0.5] * 3], decimation_target=faces_cible, texture_size=texture_size,
                                             remesh=rm_, verbose=False)
            stats["remesh_utilise"] = bool(rm_)
            remesh = rm_
            break
        except Exception as e:
            log("ECHEC to_glb remesh=%s : %s" % (rm_, repr(e)[:300]))
            stats["echec_remesh_%s" % rm_] = repr(e)[:200]
            gc.collect(); torch.cuda.empty_cache()
    if glb is None:
        return stats
    stats["export_s"] = round(time.time() - t2, 1)
    stats["bornes_glb"] = [[round(float(x), 3) for x in r] for r in glb.bounds]
    b = io.BytesIO()
    glb.export(b, file_type="glb")
    os.makedirs("/lat/out", exist_ok=True)
    chemin = "/lat/out/hr_%s_%s_t%d_f%d.glb" % (nom, mode, texture_size, faces_cible)
    open(chemin, "wb").write(b.getvalue())
    vol.commit()
    stats["glb"] = chemin
    stats["octets"] = len(b.getvalue())
    stats["pic_go_total"] = round(torch.cuda.max_memory_allocated() / 2 ** 30, 1)
    log("EXPORT", stats)
    return stats


@app.local_entrypoint()
def main(etape: str = "sampler", nom: str = "G1792", mode: str = "tranches", k: int = 6, halo: int = 10, remesh: int = 1, grilles: str = "1792,3072,4096",
         fill_holes: int = 0, texture: int = 4096, faces: int = 500000):
    import json
    os.makedirs(SORTIE + "/glb", exist_ok=True)
    if etape == "sampler":
        png = open(SORTIE + "/entrees/orc_rgba_union_sans_socle.png", "rb").read()
        r = echantillonner.remote(png, [int(x) for x in grilles.split(",")])
        print(json.dumps(r))
    else:
        r = decoder.remote(nom, mode, k, halo, bool(remesh), texture, bool(fill_holes), faces)
        print(json.dumps(r))
        if r.get("glb"):
            octets = b"".join(vol.read_file(r["glb"].replace("/lat", "", 1)))
            cible = SORTIE + "/glb/hr_%s_%s_t%d_f%d.glb" % (nom, mode, texture, faces)
            open(cible, "wb").write(octets)
            print("GLB ->", cible, len(octets))
