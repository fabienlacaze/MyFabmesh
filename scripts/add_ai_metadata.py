"""Add AI-generated metadata to a .glb file.

Required by EU Regulation 2024/1689 ("AI Act") Article 50, applicable from
2 August 2026. Marks the output as AI-generated in machine-readable form.

Adds to the glTF JSON:
  - asset.generator = "FabMesh <version> (AI-generated)"
  - asset.extras.aiGenerated = true
  - asset.extras.aiSystem = "FabMesh"
  - asset.extras.aiActArticle50 = true

Usage:
    python add_ai_metadata.py <input.glb> [<output.glb>]

If <output.glb> is omitted, the input is patched in place.

2026-10-03 (AI Act art. 50, vague 3, voie marquage-bureau) : l'ecriture se fait
maintenant EN FLUX (blocs de 8 Mo) vers un fichier temporaire du meme dossier,
puis remplacement atomique. Avant, le GLB entier etait lu en memoire (x3 avec la
copie reconstruite) et reecrit en place : un GLB de 100 Mo+ coutait ~300 Mo, et une
coupure pendant l'ecriture laissait un fichier TRONQUE. L'operation est aussi
IDEMPOTENTE : un fichier deja marque n'est pas reecrit. Toute structure
inattendue laisse le fichier d'origine intact.
"""
import sys
import os
import json
import struct

FABMESH_VERSION = "1.0.0"

_BLOC = 8 * 1024 * 1024          # taille des blocs de copie (octets)
_JSON_MAX = 256 * 1024 * 1024    # un chunk JSON plus gros est considere comme anormal


def _deja_marque(gltf):
    """Vrai si le JSON porte deja les trois cles du marquage."""
    asset = gltf.get('asset') if isinstance(gltf, dict) else None
    extras = asset.get('extras') if isinstance(asset, dict) else None
    return (isinstance(extras, dict)
            and extras.get('aiGenerated') is True
            and extras.get('aiSystem') == 'FabMesh'
            and extras.get('aiActArticle50') is True
            and isinstance(asset.get('generator'), str)
            and '(AI-generated)' in asset['generator'])


def _lire_en_tete(f, taille):
    """Lit l'en-tete GLB et le chunk JSON. Retourne (gltf, json_len) ou (None, message)."""
    entete = f.read(20)
    if len(entete) < 20 or entete[:4] != b'glTF':
        return None, 'not a valid GLB'
    version, total = struct.unpack('<II', entete[4:12])
    if version != 2:
        return None, f'unsupported GLB version {version}'
    if total != taille:
        return None, f'inconsistent GLB length (header {total}, file {taille})'
    json_len = struct.unpack('<I', entete[12:16])[0]
    if entete[16:20] != b'JSON':
        return None, f'first chunk is not JSON ({entete[16:20]!r})'
    if json_len > _JSON_MAX or 20 + json_len > taille:
        return None, f'inconsistent JSON chunk length ({json_len})'
    blob = f.read(json_len)
    if len(blob) != json_len:
        return None, 'truncated JSON chunk'
    try:
        # certains exporteurs remplissent le chunk JSON par des NUL : on les ecarte avant de lire
        gltf = json.loads(blob.decode('utf-8').rstrip('\x00 \t\r\n'))
    except Exception as e:
        return None, f'JSON parse failed: {e}'
    if not isinstance(gltf, dict):
        return None, 'JSON root is not an object'
    return (gltf, json_len), None


def patch_glb(in_path, out_path=None):
    """Marque le GLB. Retourne True si le fichier de sortie est marque (y compris
    s'il l'etait deja), False si le fichier est inutilisable (alors intact)."""
    if out_path is None:
        out_path = in_path
    en_place = os.path.abspath(out_path) == os.path.abspath(in_path)
    tmp = None
    try:
        taille = os.path.getsize(in_path)
        with open(in_path, 'rb') as f:
            res, err = _lire_en_tete(f, taille)
            if res is None:
                print(f'[add_ai_metadata] {err}: {in_path}', flush=True)
                return False
            gltf, json_len = res

            if en_place and _deja_marque(gltf):
                return True      # idempotent : rien a reecrire

            asset = gltf.get('asset')
            if not isinstance(asset, dict):
                asset = gltf['asset'] = {}
            asset['generator'] = f'FabMesh {FABMESH_VERSION} (AI-generated)'
            extras = asset.get('extras')
            if not isinstance(extras, dict):
                extras = asset['extras'] = {}
            extras['aiGenerated'] = True
            extras['aiSystem'] = 'FabMesh'
            extras['aiActArticle50'] = True

            # Reserialise, remplissage a 4 octets par des espaces (exige par la spec GLB).
            nouveau = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
            nouveau += b' ' * ((4 - len(nouveau) % 4) % 4)
            reste = taille - 20 - json_len
            nouveau_total = 12 + 8 + len(nouveau) + reste
            if nouveau_total > 0xFFFFFFFF:
                print(f'[add_ai_metadata] GLB too large to patch: {in_path}', flush=True)
                return False

            dossier = os.path.dirname(os.path.abspath(out_path))
            os.makedirs(dossier, exist_ok=True)
            tmp = os.path.join(dossier, os.path.basename(out_path) + '.marquage-ia.tmp')
            with open(tmp, 'wb') as g:
                g.write(b'glTF' + struct.pack('<II', 2, nouveau_total))
                g.write(struct.pack('<I', len(nouveau)) + b'JSON')
                g.write(nouveau)
                # f est positionne juste apres le chunk JSON d'origine : on recopie le reste
                # (chunk binaire et suivants) tel quel, sans jamais le charger en entier.
                copie = 0
                while True:
                    bloc = f.read(_BLOC)
                    if not bloc:
                        break
                    g.write(bloc)
                    copie += len(bloc)
                if copie != reste:
                    raise IOError(f'binary tail size mismatch ({copie} != {reste})')
                g.flush()
                os.fsync(g.fileno())
            if os.path.getsize(tmp) != nouveau_total:
                raise IOError('temporary file size mismatch')
        os.replace(tmp, out_path)       # atomique : l'original reste intact tant que ce n'est pas fait
        tmp = None
        return True
    except Exception as e:
        print(f'[add_ai_metadata] patch failed ({type(e).__name__}: {e}): {in_path}', flush=True)
        return False
    finally:
        if tmp:
            try:
                os.remove(tmp)
            except OSError:
                pass


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    inp = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    if not os.path.isfile(inp):
        print(f'[add_ai_metadata] file not found: {inp}', flush=True)
        sys.exit(2)
    ok = patch_glb(inp, out)
    if ok:
        target = out or inp
        print(f'[add_ai_metadata] OK: {target}', flush=True)
        sys.exit(0)
    else:
        sys.exit(3)
