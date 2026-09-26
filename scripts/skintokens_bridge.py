"""SkinTokens bridge for FabMesh — native-skeleton auto-rigging.

Runs the SkinTokens (TokenRig, VAST-AI, MIT) inference in its dedicated venv and
produces a single rigged GLB (skeleton + per-vertex skin weights, native
skeleton) that FabMesh loads in its viewer. Same CLI contract as
``puppeteer_bridge.py`` / ``unirig_bridge.py`` so the caller stays engine-agnostic:

    python skintokens_bridge.py <mesh_path> <output_glb>
        [--points points.json --graine G --tirage T]   (editeur de points)

Runtime notes (Windows / RTX 5080 sm_120):
  - SkinTokens runs on torch 2.7 cu128 with an SDPA attention path (no flash-attn
    build, no Smart App Control block). See external/SkinTokens/flash_attn_interface.py
    and the attn_implementation="sdpa" patches.
  - The dedicated venv is resolved from FABMESH_SKINTOKENS_PY, then a short-path
    default, then an in-tree venv. Kept out of the deep repo path because pip's
    long jupyter/labextension file names overflow Windows MAX_PATH under it.
"""
import os
import sys
import subprocess

HERE = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(HERE, ".."))
SKINTOKENS_DIR = os.path.join(PROJECT_ROOT, "external", "SkinTokens")


def _resolve_python():
    # 1. explicit override
    p = os.environ.get("FABMESH_SKINTOKENS_PY")
    if p and os.path.exists(p):
        return p
    # 2. short-path venv (avoids Windows long-path pip failures)
    for c in (r"C:\tmp\skv\Scripts\python.exe", r"C:\skv\Scripts\python.exe"):
        if os.path.exists(c):
            return c
    # 3. in-tree venv (if a future installer places it there)
    intree = os.path.join(SKINTOKENS_DIR, "venv", "Scripts", "python.exe")
    if os.path.exists(intree):
        return intree
    return None


def log(msg):
    print(f"SKINTOKENS: {msg}", flush=True)


def main():
    import argparse
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("mesh_path", nargs="?")
    ap.add_argument("output_glb", nargs="?")
    # Editeur des points du squelette : transmis tels quels au pilote
    ap.add_argument("--points")
    ap.add_argument("--graine", type=int)
    ap.add_argument("--tirage", type=int)
    a, _ = ap.parse_known_args()
    if not a.mesh_path or not a.output_glb:
        print("AUTORIG_ERROR: usage: skintokens_bridge.py <mesh_path> <output_glb>")
        sys.exit(1)
    mesh_path = os.path.abspath(a.mesh_path)
    output_glb = os.path.abspath(a.output_glb)

    if not os.path.exists(mesh_path):
        print(f"AUTORIG_ERROR: mesh not found: {mesh_path}")
        sys.exit(1)

    venv_py = _resolve_python()
    if not venv_py:
        print("AUTORIG_ERROR: SkinTokens venv not found (set FABMESH_SKINTOKENS_PY "
              "or install the rig engine).")
        sys.exit(1)

    demo = os.path.join(SKINTOKENS_DIR, "demo.py")
    if not os.path.exists(demo):
        print(f"AUTORIG_ERROR: SkinTokens not installed at {SKINTOKENS_DIR}")
        sys.exit(1)

    os.makedirs(os.path.dirname(output_glb), exist_ok=True)
    # --use_transfer ACTIVE (2026-09-26). Sans lui, SkinTokens exporte SON
    # maillage normalise (hauteur 2) SANS UV ni materiau : le rig sortait
    # BLANC. Le transfert remet squelette et peau sur le maillage SOURCE (UV,
    # textures et materiaux conserves). L'ancienne note l'accusait de laisser
    # les os « flottant au-dessus du maillage » : c'etait un bug D'AFFICHAGE
    # (aide squelette du visualiseur web), corrige le meme jour. Mesure sur
    # le fichier : os 100 % dans le maillage, Monde x IBM = identite.
    def _run(cmd):
        log(f"exec: {' '.join(cmd)}")
        proc = subprocess.Popen(
            cmd, cwd=SKINTOKENS_DIR,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        refuse = False
        for line in iter(proc.stdout.readline, ""):
            line = line.rstrip()
            if line:
                print(line, flush=True)
                # « [SKIP] » = le MODELE refuse le maillage, pas le transfert.
                if "[SKIP]" in line:
                    refuse = True
        proc.stdout.close()
        return proc.wait(), refuse

    log(f"python={venv_py}")
    # Alignement EXACT du transfert (voir patch_skintokens_transfert.py) :
    # sans lui, SkinTokens aligne par une ACP a tirage aleatoire, retournement
    # a 180 degres mesure dans ~40 % des cas. S'il ne s'applique pas, on
    # renonce au transfert : un rig sans texture vaut mieux qu'un rig retourne.
    try:
        from patch_skintokens_transfert import appliquer
        log(f"correctif d'alignement : {appliquer(SKINTOKENS_DIR)}")
        transfert = True
    except Exception as exc:
        log(f"correctif d'alignement indisponible ({exc}) - rig SANS texture")
        transfert = False
    produit = lambda: os.path.exists(output_glb) and os.path.getsize(output_glb) > 0
    rc, refuse = 0, False
    # SQUELETTE COMPLET (2026-09-26, parite cloud) : meilleur de 2 tirages de
    # l'IA + completion generique + peau recalculee par l'IA (rig_complet.py,
    # meme fichier que modal_app/squelette/rig_complet.py). Sans resultat,
    # l'ancien chemin prend le relais. FABMESH_RIG_COMPLET=0 le desactive.
    pilote = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_complet.py")
    options = []
    if a.graine is not None:
        options += ["--graine", str(a.graine)]
    if a.tirage is not None:
        options += ["--tirage", str(a.tirage)]
    if a.points:
        # Points de l'utilisateur : PAS de repli sur l'ancien chemin, il rendrait
        # un rig qui ignore ce qu'il a demande. Echec explicite a la place.
        if not transfert or not os.path.exists(pilote):
            print("AUTORIG_ERROR: skeleton points need the up-to-date rig engine.")
            sys.exit(1)
        rc, refuse = _run([venv_py, pilote, mesh_path, output_glb, "--tirages", "2",
                           "--points", os.path.abspath(a.points)] + options)
        if not produit():
            print(f"AUTORIG_ERROR: rig with the skeleton points failed (rc={rc}).")
            sys.exit(1)
        print(f"AUTORIG_SUCCESS: {output_glb} ({os.path.getsize(output_glb)} bytes)")
        sys.exit(0)
    if transfert and os.environ.get("FABMESH_RIG_COMPLET", "1") != "0" and os.path.exists(pilote):
        rc, refuse = _run([venv_py, pilote, mesh_path, output_glb, "--tirages", "2"] + options)
        if not produit():
            log(f"squelette complet sans resultat (rc={rc}) - ancien chemin")
    if not produit():
        rc, refuse = _run([venv_py, demo, "--input", mesh_path, "--output", output_glb]
                          + (["--use_transfer"] if transfert else []))
    if not produit() and not refuse and transfert:
        # Le plus souvent un DECODAGE rate (tirage aleatoire), pas le
        # transfert : un nouveau tirage AVEC texture suffit presque toujours.
        log("rig sans resultat - nouveau tirage avec texture")
        rc, refuse = _run([venv_py, demo, "--input", mesh_path, "--output", output_glb, "--use_transfer"])
    if not produit() and not refuse and transfert:
        # Repli : un rig sans texture vaut mieux qu'aucun rig. Pas de relance
        # si le modele a refuse le maillage : elle echouerait pareil.
        log("deux tirages sans resultat - repli sur l'export normalise, sans texture")
        rc, refuse = _run([venv_py, demo, "--input", mesh_path, "--output", output_glb])

    if not os.path.exists(output_glb):
        print(f"AUTORIG_ERROR: SkinTokens produced no output (rc={rc}). "
              f"Meshes with no natural skeleton (mechanical objects) are rejected.")
        sys.exit(1)
    print(f"AUTORIG_SUCCESS: {output_glb} ({os.path.getsize(output_glb)} bytes)")
    sys.exit(0)


if __name__ == "__main__":
    main()
