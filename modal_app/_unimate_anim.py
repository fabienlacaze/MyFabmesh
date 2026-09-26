"""Animation « Motion+ » (UniMate, texte -> mouvement) sur Modal.

POURQUOI UNE APP A PART
UniMate demande torch 2.7 / transformers 5 / Python 3.11 ; l'app AnyTop
(`myfabmesh-anim`) est figee sur torch 2.4 / Python 3.10. On ne partage donc
pas l'image. En revanche on partage TOUT le reste : le routeur de
`_anytop_anim.py` lance la fonction ci-dessous quand le worker demande
`engine: "motionplus"`, et elle ecrit sur le MEME volume, avec le MEME
protocole (`<job>.glb` / `<job>.err`, `<job>.call_id` ecrit par le routeur).
Sondage, livraison dans R2, annulation, remboursement et faucheur du worker
marchent donc sans une ligne de plus.

POIDS : checkpoint TIERS (tarn59/UniMate-Weights, etiquette MIT) entraine sur
Mixamo / Objaverse / Truebones — EVALUATION seulement tant que l'exploitant
n'a pas tranche la question de licence. Le worker n'ouvre ce moteur qu'aux
comptes autorises. Revisions figees et empreintes verifiees a la construction :
un depot tiers peut etre modifie ou pousse avec un autre contenu.

Deployer :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/_unimate_anim.py
"""
import json
import os
import time

import modal

UNIMATE_REPO = "https://github.com/Friedrich-M/UniMate.git"
UNIMATE_COMMIT = "9f3076e1db482883edb6f6a37a67f521c3853278"
POIDS_REPO = "tarn59/UniMate-Weights"
POIDS_REVISION = "518325e09a555f059ba0efe6face299e9b853d8c"
T5_REPO = "google/flan-t5-base"
T5_REVISION = "7bcac572ce56db69c1ea7c8af255c5d7c9672fc2"
# Traduction des descriptions libres (Apache-2.0) : voir MoteurUniMate.traduire.
TRAD_REPO = "Helsinki-NLP/opus-mt-fr-en"
TRAD_REVISION = "c4aed37b318c763fd177aa449b44e3b783cc6c02"
TRAD_EMPREINTES = {
    "model.safetensors": "6e3837f34b903802c3d0d670362b997cee6e87584a1108eb3fa89e4625e4424a",
    "source.spm": "78d0e717c77053f1c4b856d8661d9cb87c64f083a35418c087b9146300e4f585",
    "target.spm": "173e9f493a668fe396d599e28d414a201193094e6ffd7a4678e5aab0f6d3d838",
    "vocab.json": "945c604346ce15ce4aff9001001e7f925e336d942c4087017f191871162cbdc4",
}
POIDS_DIR = "/poids"
UNIMATE_DIR = "/UniMate"

# Empreintes des fichiers valides en local le 2026-09-26 (chevalier anime).
EMPREINTES = {
    "config.json": "000215c32bd8901229f9e924cf0aaf4d95b6e135e68704f03a05a8fd5964c512",
    "dataset_stats.npy": "653a9c7c2ec746f1fcbbd74481aae4ff35f3d340beaaf81984a53a49dd28159a",
    "model_ema.safetensors": "716b8b359216ef6a89cf40b35e3e8489e672a67b3ecd60cd48f4d4ff7d888222",
}


def _telecharger_poids():
    """Etape de construction de l'image : poids UniMate + encodeur T5."""
    import hashlib
    from huggingface_hub import hf_hub_download, snapshot_download

    def verifier(chemin, attendu, nom):
        h = hashlib.sha256()
        with open(chemin, "rb") as f:
            for bloc in iter(lambda: f.read(1 << 20), b""):
                h.update(bloc)
        if h.hexdigest() != attendu:
            raise RuntimeError(f"empreinte inattendue pour {nom} : {h.hexdigest()}")

    os.makedirs(POIDS_DIR, exist_ok=True)
    for nom, attendu in EMPREINTES.items():
        verifier(hf_hub_download(POIDS_REPO, nom, revision=POIDS_REVISION, local_dir=POIDS_DIR),
                 attendu, nom)
    for repo, rev, motifs in (
        (T5_REPO, T5_REVISION, ["config.json", "generation_config.json", "model.safetensors",
                                "special_tokens_map.json", "spiece.model", "tokenizer.json",
                                "tokenizer_config.json"]),
        (TRAD_REPO, TRAD_REVISION, ["config.json", "generation_config.json", "model.safetensors",
                                    "source.spm", "target.spm", "tokenizer_config.json", "vocab.json"]),
    ):
        dossier = snapshot_download(repo, revision=rev, allow_patterns=motifs)
        if repo == TRAD_REPO:
            for nom, attendu in TRAD_EMPREINTES.items():
                verifier(os.path.join(dossier, nom), attendu, nom)
        # Telecharge par revision, le cache n'ecrit pas `refs/main` : hors
        # ligne, from_pretrained("<depot>") ne resoudrait alors rien.
        refs = os.path.join(os.environ["HF_HOME"], "hub", "models--" + repo.replace("/", "--"), "refs")
        os.makedirs(refs, exist_ok=True)
        with open(os.path.join(refs, "main"), "w") as f:
            f.write(rev)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install("torch==2.7.0", index_url="https://download.pytorch.org/whl/cu128")
    # Versions du venv qui a produit les animations validees en local.
    .pip_install(
        "numpy==2.2.6", "scipy==1.17.1", "safetensors==0.8.0", "transformers==5.17.0",
        "tokenizers==0.23.2", "sentencepiece==0.2.2", "huggingface_hub==1.33.0",
        "accelerate==1.15.0", "einops==0.8.2", "torch-geometric==2.7.0", "torchdiffeq==0.2.5",
        "networkx==3.6.1", "psutil==7.2.2", "rich==15.0.0", "tqdm==4.70.1", "PyYAML==6.0.3",
        "pillow==12.3.0",
    )
    .run_commands(f"git clone {UNIMATE_REPO} {UNIMATE_DIR} && cd {UNIMATE_DIR} && git checkout {UNIMATE_COMMIT}")
    .env({"HF_HOME": "/hf"})
    .run_function(_telecharger_poids)
    .env({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
    # Le classifieur de roles d'os vit dans _anytop_anim.py (lu par ast, pas
    # importe) : les deux fichiers voyagent ensemble.
    .add_local_file("modal_app/_unimate_moteur.py", "/root/_unimate_moteur.py")
    .add_local_file("modal_app/_anytop_anim.py", "/root/_anytop_anim.py")
)

app = modal.App("myfabmesh-unimate", image=image)

# Volume de sortie PARTAGE avec myfabmesh-anim (voir docstring).
anim_output_volume = modal.Volume.from_name("myfabmesh-anim-output", create_if_missing=True)

_MOTEUR = None


def _moteur():
    global _MOTEUR
    if _MOTEUR is None:
        import sys
        if "/root" not in sys.path:
            sys.path.insert(0, "/root")
        import _unimate_moteur as um
        _MOTEUR = um.MoteurUniMate(UNIMATE_DIR, POIDS_DIR)
    return _MOTEUR


@app.function(gpu="A10G", timeout=600, scaledown_window=120,
              volumes={"/anim_data": anim_output_volume})
def animer_unimate(rig_octets: bytes, anim_type: str, prompt: str, asset_type: str, job_id: str):
    """Ecrit /anim_data/<job_id>.glb (ou .err) — contrat de `animate_mesh`."""
    import hashlib
    t0 = time.time()
    sortie = f"/anim_data/{job_id}.glb"
    erreur = f"/anim_data/{job_id}.err"
    try:
        m = _moteur()
        import _unimate_moteur as um
        famille = um.famille_pour(asset_type)
        texte = um.prompt_pour(anim_type, famille, m.traduire(prompt), asset_type)
        # graine tiree du job : un meme job rejoue donne le meme clip
        graine = int(hashlib.sha256(job_id.encode()).hexdigest()[:8], 16) % 100000
        nom = texte[:48] if (anim_type or "").lower() == "custom" else (anim_type or "clip")
        glb, infos = m.animer(rig_octets, texte, famille=famille, graine=graine, nom_clip=nom)
        with open(sortie + ".part", "wb") as f:
            f.write(glb)
        os.replace(sortie + ".part", sortie)
        print(f"[motionplus] {job_id} ok en {time.time() - t0:.1f}s {json.dumps(infos)}", flush=True)
    except Exception as e:
        import traceback
        traceback.print_exc()
        with open(erreur, "w") as f:
            json.dump({"error": f"animation failed: {str(e)[:300]}"}, f)
    finally:
        anim_output_volume.commit()


@app.local_entrypoint()
def essai(rig: str, anim: str = "walk", asset_type: str = "character"):
    """modal run modal_app/_unimate_anim.py --rig chemin.glb — ecrit <rig>_<anim>.glb."""
    import uuid
    jid = "essai_" + uuid.uuid4().hex[:12]
    animer_unimate.remote(open(rig, "rb").read(), anim, "", asset_type, jid)
    print("job", jid, "- lire /anim_data sur le volume myfabmesh-anim-output")
