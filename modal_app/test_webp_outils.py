"""BANC (2026-09-29) : l'export GLB des outils (`_mesh_op._export`, qui appelle `webp_rapide`)
dans la VRAIE image Modal, sur CPU seul (quelques centimes). Verifie l'import du module partage
dans le conteneur, la texture relue et le temps gagne.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_webp_outils.py --glb <fichier.glb>
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-webp-outils", image=image)


@app.function(cpu=4.0, memory=8192, timeout=600)
def essai(glb: bytes) -> dict:
    import io
    import time
    import trimesh
    from modal_app._mesh_op import _export

    def charger():
        return trimesh.load(io.BytesIO(glb), file_type='glb')

    def tex(scene):
        return next(iter(scene.geometry.values())).visual.material.baseColorTexture

    s = charger()
    b = io.BytesIO()
    t = time.time()
    s.export(b, file_type='glb', extension_webp=True)          # reglage d'origine de trimesh
    t_defaut = time.time() - t
    s = charger()
    t = time.time()
    octets = _export(s)                                          # chemin des outils (webp_rapide)
    t_outil = time.time() - t
    relu = tex(trimesh.load(io.BytesIO(octets), file_type='glb'))
    return {'texture': list(tex(charger()).size), 'relue': list(relu.size),
            'export_defaut_s': round(t_defaut, 2), 'export_outil_s': round(t_outil, 2),
            'octets_defaut': len(b.getvalue()), 'octets_outil': len(octets)}


@app.local_entrypoint()
def main(glb: str):
    print(essai.remote(open(glb, 'rb').read()))
