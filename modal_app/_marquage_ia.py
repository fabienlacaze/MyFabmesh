"""Marquage « contenu genere par IA » d'un GLB, octets -> octets (2026-10-03, AI Act art. 50).

POURQUOI. Le reglement (UE) 2024/1689, article 50, impose de marquer les contenus generes par IA dans un
format lisible par machine ; LICENSE.txt le promet (« extras.aiGenerated = true »). La generation le
faisait (modal_app/_mesh.py), mais TOUT fichier derive la perdait : un re-export par trimesh (Smooth,
Triangle count, Watertight, Fix normals...), par three.js ou par Blender remplace asset.generator et
supprime asset.extras. Le livrable de l'utilisateur n'etait donc plus marque. Ce module est appele juste
avant chaque renvoi ou ecriture d'un GLB derive.

CONTRAT.
  * marquer_glb_octets(octets) -> octets ; ne leve JAMAIS (au moindre doute : l'entree, telle quelle).
  * Memes valeurs que scripts/add_ai_metadata.py (surveille par le test build/bancs/noyaux/test_marquage_modal.py) :
      asset.generator = "FabMesh 1.0.0 (AI-generated)"
      asset.extras    = { aiGenerated: true, aiSystem: "FabMesh", aiActArticle50: true }
    Les autres cles de asset.extras sont conservees.
  * Seul le chunk JSON est reecrit (rembourrage a 4 octets par des espaces, longueurs corrigees) ; le
    chunk binaire et tout ce qui suit sont recopies octet pour octet : geometrie, textures, os et
    animations ne bougent pas.
  * IDEMPOTENT : un GLB deja marque est rendu tel quel (meme objet, aucune reecriture).
  * Doute = rendu inchange : en-tete incoherent (longueur declaree != taille reelle), chunk JSON absent
    ou deborde, JSON invalide, asset/extras qui ne sont pas des objets.

Bibliotheque standard seule (importable partout dans modal_app, comme _url_sure.py).
"""
import json
import struct

FABMESH_VERSION = "1.0.0"
GENERATEUR = f"FabMesh {FABMESH_VERSION} (AI-generated)"
EXTRAS_IA = {"aiGenerated": True, "aiSystem": "FabMesh", "aiActArticle50": True}


def _deja_marque(gltf) -> bool:
    asset = gltf.get("asset")
    if not isinstance(asset, dict) or asset.get("generator") != GENERATEUR:
        return False
    extras = asset.get("extras")
    return isinstance(extras, dict) and all(extras.get(k) == v and type(extras.get(k)) is type(v)
                                            for k, v in EXTRAS_IA.items())


def marquer_glb_octets(octets):
    """GLB (bytes) -> GLB marque IA (bytes). Rend `octets` inchange au moindre doute ; ne leve jamais."""
    try:
        if not isinstance(octets, (bytes, bytearray, memoryview)):
            return octets
        vue = memoryview(octets)
        n = len(vue)
        if n < 20 or bytes(vue[:4]) != b"glTF":
            return octets
        version, longueur_totale = struct.unpack("<II", bytes(vue[4:12]))
        if version != 2 or longueur_totale != n:
            return octets                     # taille declaree incoherente : on ne touche a rien
        longueur_json = struct.unpack("<I", bytes(vue[12:16]))[0]
        if bytes(vue[16:20]) != b"JSON" or 20 + longueur_json > n:
            return octets
        gltf = json.loads(bytes(vue[20:20 + longueur_json]).decode("utf-8"))
        if not isinstance(gltf, dict):
            return octets
        if _deja_marque(gltf):
            return octets
        asset = gltf.setdefault("asset", {})
        if not isinstance(asset, dict):
            return octets
        extras = asset.setdefault("extras", {})
        if not isinstance(extras, dict):
            return octets
        asset["generator"] = GENERATEUR
        extras.update(EXTRAS_IA)
        nouveau = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        nouveau += b" " * ((4 - len(nouveau) % 4) % 4)
        reste = vue[20 + longueur_json:]
        total = 12 + 8 + len(nouveau) + len(reste)
        if total >= 1 << 32:
            return octets                     # depasserait la limite du format GLB
        sortie = b"".join([b"glTF", struct.pack("<II", 2, total),
                           struct.pack("<I", len(nouveau)), b"JSON", nouveau, reste])
        # Controle final de coherence (sans recopier 300 Mo) ; sinon l'original reste.
        if len(sortie) != total or len(sortie) != 20 + len(nouveau) + len(reste):
            return octets
        return sortie
    except Exception:
        return octets
