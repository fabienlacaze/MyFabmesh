"""RIG DES TRES GROS MAILLAGES (2026-09-30, idee du user : « reduire a 1 M sur une copie qui garde la meme enveloppe, rigger,
puis remettre avec le 10 M »).

Le rigger ne regarde que ~54 000 points de surface : le rigger une copie de 400 K faces donne le meme squelette et une
peau equivalente. Ce module fait les deux bouts, en numpy pur (aucun Blender : charger 10 M de faces dans Blender prenait
plus de 7 min et plantait) :
  - `extraire_geometrie` / `copie_reduite` : positions MONDE + triangles du GLB d'origine -> copie soudee et reduite (quadrique) ;
  - `transferer_peau` : squelette + poids du GLB rigge de la copie -> GLB d'origine (texture, UV, materiaux intacts),
    chaque sommet d'origine prenant les poids du sommet le plus proche de la copie.
Repere : la copie est ecrite en coordonnees MONDE (matrice du noeud deja appliquee), et le GLB final aussi (noeud de maillage
remis a l'identite), donc le squelette du rig colle a l'original.
"""
import json
import struct

import numpy as np

TYPES = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


def lire_glb(data):
    if data[:4] != b"glTF":
        raise ValueError("not a GLB")
    lon_json = struct.unpack("<I", data[12:16])[0]
    j = json.loads(data[20:20 + lon_json])
    debut = 20 + lon_json
    if debut + 8 <= len(data) and data[debut + 4:debut + 8] == b"BIN\x00":
        lon_bin = struct.unpack("<I", data[debut:debut + 4])[0]
        binaire = bytearray(data[debut + 8:debut + 8 + lon_bin])
    else:
        binaire = bytearray()
    return j, binaire


def ecrire_glb(j, binaire):
    while len(binaire) % 4:
        binaire.append(0)
    j["buffers"] = [{"byteLength": len(binaire)}]
    txt = json.dumps(j, separators=(",", ":")).encode("utf-8")
    txt += b" " * ((4 - len(txt) % 4) % 4)
    total = 12 + 8 + len(txt) + 8 + len(binaire)
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(txt), b"JSON") + txt
            + struct.pack("<I4s", len(binaire), b"BIN\x00") + bytes(binaire))


def lire_accessor(j, binaire, i):
    a = j["accessors"][i]
    if "sparse" in a:
        raise ValueError("sparse accessor not supported")
    n, k, dt = a["count"], TYPES[a["type"]], DTYPES[a["componentType"]]
    bv = j["bufferViews"][a["bufferView"]]
    debut = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    taille = np.dtype(dt).itemsize * k
    pas = bv.get("byteStride") or taille
    if pas == taille:
        r = np.frombuffer(binaire, dtype=dt, count=n * k, offset=debut).reshape(n, k)
    else:
        brut = np.frombuffer(binaire, dtype=np.uint8, count=(n - 1) * pas + taille, offset=debut)
        r = np.lib.stride_tricks.as_strided(brut, shape=(n, taille), strides=(pas, 1)).copy().view(dt).reshape(n, k)
    if a.get("normalized"):
        r = r.astype(np.float32) / (np.iinfo(dt).max if np.issubdtype(dt, np.integer) else 1)
    return r


def _matrice_noeud(n):
    if "matrix" in n:
        return np.array(n["matrix"], np.float64).reshape(4, 4).T
    t = np.array(n.get("translation", [0, 0, 0]), np.float64)
    q = np.array(n.get("rotation", [0, 0, 0, 1]), np.float64)
    s = np.array(n.get("scale", [1, 1, 1]), np.float64)
    x, y, z, w = q / (np.linalg.norm(q) or 1.0)
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4)
    M[:3, :3] = R * s[None, :]
    M[:3, 3] = t
    return M


def _parents(j):
    p = {}
    for i, n in enumerate(j.get("nodes", [])):
        for c in n.get("children", []):
            p[c] = i
    return p


def _monde(j, i, parents):
    M = _matrice_noeud(j["nodes"][i])
    while i in parents:
        i = parents[i]
        M = _matrice_noeud(j["nodes"][i]) @ M
    return M


def _primitives(j):
    """[(indice noeud, indice maillage, indice primitive)] des triangles, dans l'ordre du fichier."""
    res = []
    for ni, n in enumerate(j.get("nodes", [])):
        if "mesh" in n:
            for pi, p in enumerate(j["meshes"][n["mesh"]]["primitives"]):
                if p.get("mode", 4) == 4:
                    res.append((ni, n["mesh"], pi))
    return res


def compter_faces(j):
    t = 0
    for _, mi, pi in _primitives(j):
        p = j["meshes"][mi]["primitives"][pi]
        a = j["accessors"][p["indices"]]["count"] if "indices" in p else j["accessors"][p["attributes"]["POSITION"]]["count"]
        t += a // 3
    return t


def extraire_geometrie(j, binaire):
    """Positions MONDE (n, 3) float32 et triangles (m, 3) int64 de toutes les primitives, indices decales."""
    parents = _parents(j)
    P, F, base = [], [], 0
    for ni, mi, pi in _primitives(j):
        p = j["meshes"][mi]["primitives"][pi]
        pos = lire_accessor(j, binaire, p["attributes"]["POSITION"]).astype(np.float64)
        M = _monde(j, ni, parents)
        pos = pos @ M[:3, :3].T + M[:3, 3]
        idx = lire_accessor(j, binaire, p["indices"]).reshape(-1).astype(np.int64) if "indices" in p else np.arange(len(pos))
        P.append(pos.astype(np.float32))
        F.append(idx.reshape(-1, 3) + base)
        base += len(pos)
    return np.concatenate(P), np.concatenate(F)


def copie_reduite(P, F, faces, log=print):
    """Copie soudee (par position) et reduite a ~`faces` triangles, sans UV ni materiau. Rend (V, F) ; les triangles
    degeneres sont retires. Les coutures d'UV dupliquent les sommets : sans soudure la quadrique tirerait les bords."""
    lo, hi = P.min(0), P.max(0)
    q = np.clip(((P - lo) / np.maximum(hi - lo, 1e-9) * 2097151.0).round(), 0, 2097151).astype(np.int64)
    cle = (q[:, 0] << 42) | (q[:, 1] << 21) | q[:, 2]
    _, premier, inv = np.unique(cle, return_index=True, return_inverse=True)
    V = P[premier]
    Fw = inv.reshape(-1)[F]
    Fw = Fw[(Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])]
    log(f"[gros] soudure : {len(P)} -> {len(V)} sommets, {len(Fw)} triangles")
    if len(Fw) <= faces:
        return V, Fw
    try:
        import fast_simplification
        V2, F2 = fast_simplification.simplify(V.astype(np.float32), Fw.astype(np.int64),
                                              target_reduction=1 - faces / len(Fw))
    except ImportError:
        import open3d as o3d
        om = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(V.astype(np.float64)),
                                       o3d.utility.Vector3iVector(Fw.astype(np.int32)))
        om = om.simplify_quadric_decimation(target_number_of_triangles=int(faces))
        V2, F2 = np.asarray(om.vertices, np.float32), np.asarray(om.triangles, np.int64)
    log(f"[gros] copie reduite : {len(Fw)} -> {len(F2)} triangles")
    return np.asarray(V2, np.float32), np.asarray(F2, np.int64)


def ecrire_maillage_simple(V, F):
    """GLB minimal (positions + indices) pour le rigger."""
    binaire = bytearray()
    pos = np.ascontiguousarray(V, np.float32).tobytes()
    idx = np.ascontiguousarray(F.reshape(-1), np.uint32).tobytes()
    binaire += pos
    while len(binaire) % 4:
        binaire.append(0)
    off = len(binaire)
    binaire += idx
    j = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
         "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "mode": 4}]}],
         "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
                         {"buffer": 0, "byteOffset": off, "byteLength": len(idx), "target": 34963}],
         "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(V), "type": "VEC3",
                        "min": V.min(0).tolist(), "max": V.max(0).tolist()},
                       {"bufferView": 1, "componentType": 5125, "count": int(F.size), "type": "SCALAR"}]}
    return ecrire_glb(j, binaire)


def _ajouter_vue(j, binaire, octets, cible=None):
    while len(binaire) % 4:
        binaire.append(0)
    bv = {"buffer": 0, "byteOffset": len(binaire), "byteLength": len(octets)}
    if cible:
        bv["target"] = cible
    binaire += octets
    j["bufferViews"].append(bv)
    return len(j["bufferViews"]) - 1


def _ajouter_accessor(j, vue, ctype, count, typ, **extra):
    a = {"bufferView": vue, "componentType": ctype, "count": int(count), "type": typ}
    a.update(extra)
    j["accessors"].append(a)
    return len(j["accessors"]) - 1


def transferer_peau(glb_rigge, glb_origine, log=print):
    """Squelette + poids de `glb_rigge` (copie reduite riggee) -> `glb_origine`. Rend les octets du GLB final."""
    from scipy.spatial import cKDTree
    jr, br = lire_glb(glb_rigge)
    jo, bo = lire_glb(glb_origine)
    if not jr.get("skins"):
        raise ValueError("le GLB rigge n'a pas de peau")
    skin = jr["skins"][0]
    # sommets, joints et poids de la copie (primitives skinnees, dans l'ordre)
    Pr, Jr, Wr = [], [], []
    for ni, mi, pi in _primitives(jr):
        p = jr["meshes"][mi]["primitives"][pi]
        if "JOINTS_0" not in p["attributes"]:
            continue
        Pr.append(lire_accessor(jr, br, p["attributes"]["POSITION"]).astype(np.float32))
        Jr.append(lire_accessor(jr, br, p["attributes"]["JOINTS_0"]).astype(np.uint16))
        Wr.append(lire_accessor(jr, br, p["attributes"]["WEIGHTS_0"]).astype(np.float32))
    if not Pr:
        raise ValueError("aucune primitive skinnee dans le GLB rigge")
    Pr, Jr, Wr = np.concatenate(Pr), np.concatenate(Jr), np.concatenate(Wr)
    arbre = cKDTree(Pr)
    log(f"[gros] copie riggee : {len(Pr)} sommets, {len(skin['joints'])} os")

    # noeuds du squelette (os + ancetres, sans maillage) recopies dans l'original
    pr = _parents(jr)
    garde = []
    for x in skin["joints"]:
        while True:
            if x not in garde:
                garde.append(x)
            if x in pr:
                x = pr[x]
            else:
                break
    garde.sort()
    decalage = len(jo["nodes"])
    nouv = {a: decalage + k for k, a in enumerate(garde)}
    for a in garde:
        n = dict(jr["nodes"][a])
        n.pop("mesh", None); n.pop("skin", None); n.pop("camera", None)
        n["children"] = [nouv[c] for c in n.get("children", []) if c in nouv]
        if not n["children"]:
            n.pop("children")
        jo["nodes"].append(n)
    racines = [nouv[a] for a in garde if a not in pr or pr[a] not in nouv]

    # matrices de repos inverses
    ibm = lire_accessor(jr, br, skin["inverseBindMatrices"]).astype(np.float32)
    acc_ibm = _ajouter_accessor(jo, _ajouter_vue(jo, bo, ibm.tobytes()), 5126, len(ibm), "MAT4")
    jo.setdefault("skins", []).append({"joints": [nouv[x] for x in skin["joints"]], "inverseBindMatrices": acc_ibm,
                                       "skeleton": nouv[skin["skeleton"]] if skin.get("skeleton") in nouv else racines[0]})
    idx_skin = len(jo["skins"]) - 1

    # sommets de l'original : passage en repere monde, poids du sommet le plus proche
    parents_o = _parents(jo)
    for ni, mi, pi in _primitives(jo):
        p = jo["meshes"][mi]["primitives"][pi]
        a_pos = p["attributes"]["POSITION"]
        pos = lire_accessor(jo, bo, a_pos).astype(np.float64)
        M = _monde(jo, ni, parents_o)
        pos_m = (pos @ M[:3, :3].T + M[:3, 3]).astype(np.float32)
        _, k = arbre.query(pos_m, workers=-1)
        J = Jr[k]
        W = Wr[k]
        s = W.sum(1, keepdims=True)
        W = np.where(s > 1e-8, W / np.maximum(s, 1e-8), np.array([1, 0, 0, 0], np.float32))
        acc_pos = _ajouter_accessor(jo, _ajouter_vue(jo, bo, pos_m.tobytes(), 34962), 5126, len(pos_m), "VEC3",
                                    min=pos_m.min(0).tolist(), max=pos_m.max(0).tolist())
        p["attributes"]["POSITION"] = acc_pos
        if "NORMAL" in p["attributes"]:
            nor = lire_accessor(jo, bo, p["attributes"]["NORMAL"]).astype(np.float64)
            nor = nor @ np.linalg.inv(M[:3, :3])                         # (M^-T n)^T = n^T M^-1
            nor /= np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-12)
            p["attributes"]["NORMAL"] = _ajouter_accessor(jo, _ajouter_vue(jo, bo, nor.astype(np.float32).tobytes(), 34962),
                                                          5126, len(nor), "VEC3")
        p["attributes"]["JOINTS_0"] = _ajouter_accessor(jo, _ajouter_vue(jo, bo, J.astype(np.uint16).tobytes(), 34962),
                                                        5123, len(J), "VEC4")
        p["attributes"]["WEIGHTS_0"] = _ajouter_accessor(jo, _ajouter_vue(jo, bo, W.astype(np.float32).tobytes(), 34962),
                                                         5126, len(W), "VEC4")
        n = jo["nodes"][ni]
        for cle in ("matrix", "translation", "rotation", "scale"):
            n.pop(cle, None)
        n["skin"] = idx_skin
        if ni in parents_o:                       # noeud de maillage sorti de son parent : le repere est deja bake
            jo["nodes"][parents_o[ni]]["children"].remove(ni)
            jo["scenes"][jo.get("scene", 0)]["nodes"].append(ni)
        log(f"[gros] peau transferee sur {len(pos_m)} sommets d'origine")
    sc = jo["scenes"][jo.get("scene", 0)]
    sc["nodes"] = list(sc["nodes"]) + racines
    avant = len(bo)
    bo = compacter(jo, bo)
    log(f"[gros] binaire compacte : {avant} -> {len(bo)} octets")
    return ecrire_glb(jo, bo)


def compacter(j, binaire):
    """Retire accessors / bufferViews orphelins (positions et normales d'origine remplacees) : sans cela le GLB final
    garde ~250 Mo inutiles pour 10 M de faces. Rend le nouveau binaire ; j est modifie en place."""
    acc_used = set()
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            acc_used.update(p.get("attributes", {}).values())
            if "indices" in p:
                acc_used.add(p["indices"])
            for t in p.get("targets", []):
                acc_used.update(t.values())
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s:
            acc_used.add(s["inverseBindMatrices"])
    for a in j.get("animations", []):
        for sm in a.get("samplers", []):
            acc_used.update((sm["input"], sm["output"]))
    acc_list = sorted(acc_used)
    acc_map = {old: new for new, old in enumerate(acc_list)}
    vues = set(j["accessors"][a]["bufferView"] for a in acc_list if "bufferView" in j["accessors"][a])
    vues.update(i["bufferView"] for i in j.get("images", []) if "bufferView" in i)
    vue_list = sorted(vues)
    vue_map = {old: new for new, old in enumerate(vue_list)}
    nb = bytearray()
    nouvelles = []
    for old in vue_list:
        bv = dict(j["bufferViews"][old])
        while len(nb) % 4:
            nb.append(0)
        d = bv.get("byteOffset", 0)
        nb += binaire[d:d + bv["byteLength"]]
        bv["byteOffset"] = len(nb) - bv["byteLength"]
        nouvelles.append(bv)
    accs = []
    for old in acc_list:
        a = dict(j["accessors"][old])
        if "bufferView" in a:
            a["bufferView"] = vue_map[a["bufferView"]]
        accs.append(a)
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
            for t in p.get("targets", []):
                for k in list(t):
                    t[k] = acc_map[t[k]]
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s:
            s["inverseBindMatrices"] = acc_map[s["inverseBindMatrices"]]
    for a in j.get("animations", []):
        for sm in a.get("samplers", []):
            sm["input"], sm["output"] = acc_map[sm["input"]], acc_map[sm["output"]]
    for i in j.get("images", []):
        if "bufferView" in i:
            i["bufferView"] = vue_map[i["bufferView"]]
    j["bufferViews"], j["accessors"] = nouvelles, accs
    return nb


# ── TEXTURES PEINTES SUR LA VERSION LEGERE -> MAILLAGE COMPLET (2026-09-30) ──────────────────────────────────────────
# Paint Mesh / Decals travaillent sur la version legere (~500 K) et sa texture plafonnee a 2048 : ce que l'utilisateur a peint est
# donc en 2048. La version legere partage les UV du maillage complet : on reporte SEULEMENT les pixels peints (marques par le
# navigateur avec un alpha de 254 dans l'image enregistree) sur la texture ORIGINALE du complet (4K / 8K), sans rien perdre ailleurs.
ALPHA_PEINT = 254


def _index_image(j, tex):
    if tex is None or tex.get("index") is None:
        return None
    t = j["textures"][tex["index"]]
    if t.get("source") is not None:
        return t["source"]
    for ext in (t.get("extensions") or {}).values():
        if isinstance(ext, dict) and ext.get("source") is not None:
            return ext["source"]
    return None


def _champs_images(j, mat=0):
    m = j["materials"][mat]
    pbr = m.get("pbrMetallicRoughness", {})
    return {"base": pbr.get("baseColorTexture"), "metal": pbr.get("metallicRoughnessTexture"), "emissif": m.get("emissiveTexture")}


def _octets_image(j, b, ii):
    bv = j["bufferViews"][j["images"][ii]["bufferView"]]
    o = bv.get("byteOffset", 0)
    return bytes(b[o:o + bv["byteLength"]])


def _poser_image(j, b, ii, octets, mime):
    while len(b) % 4:
        b.append(0)
    j["bufferViews"].append({"buffer": 0, "byteOffset": len(b), "byteLength": len(octets)})
    b += octets
    j["images"][ii]["bufferView"] = len(j["bufferViews"]) - 1
    j["images"][ii]["mimeType"] = mime


def _fusion_pixels(plein_img, peint_img):
    """plein_img : PIL (RGB ou RGBA, grande) ; peint_img : PIL RGBA (2048). Rend (PIL fusionne, nb de pixels peints)."""
    import numpy as np
    from PIL import Image, ImageFilter
    W, H = plein_img.size
    p = np.asarray(peint_img.convert("RGBA"))
    masque = (p[:, :, 3] == ALPHA_PEINT)
    n = int(masque.sum())
    if n == 0:
        return plein_img, 0
    m_img = Image.fromarray((masque * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))     # 1 px de marge
    m_up = np.asarray(m_img.resize((W, H), Image.BILINEAR), dtype=np.uint8)
    rgb_up = np.asarray(peint_img.convert("RGB").resize((W, H), Image.LANCZOS), dtype=np.uint8)
    base = np.asarray(plein_img.convert("RGB"), dtype=np.uint8).copy()
    for y0 in range(0, H, 1024):
        y1 = min(H, y0 + 1024)
        a = m_up[y0:y1, :, None].astype(np.float32) / 255.0
        base[y0:y1] = (base[y0:y1] * (1 - a) + rgb_up[y0:y1] * a + 0.5).astype(np.uint8)
    return Image.fromarray(base), n


def fusionner_textures(glb_plein, glb_peint, log=print):
    """Reporte les pixels peints (alpha 254) de `glb_peint` (version legere peinte) sur les textures du maillage complet `glb_plein`
    (couleur et metal / rugosite) ; ajoute la couche emissive si elle est peinte. Rend les octets du GLB complet mis a jour."""
    import io as _io
    from PIL import Image
    jf, bf = lire_glb(glb_plein)
    jp, bp = lire_glb(glb_peint)
    cf, cp = _champs_images(jf), _champs_images(jp)
    change = 0
    for champ in ("base", "metal"):
        ip, ifu = _index_image(jp, cp.get(champ)), _index_image(jf, cf.get(champ))
        if ip is None or ifu is None:
            continue
        peint = Image.open(_io.BytesIO(_octets_image(jp, bp, ip)))
        plein = Image.open(_io.BytesIO(_octets_image(jf, bf, ifu)))
        mime = jf["images"][ifu].get("mimeType", "image/png")
        res, n = _fusion_pixels(plein, peint)
        log(f"[texture] {champ} : {n} pixels peints ({peint.size[0]}) reportes sur {plein.size[0]}x{plein.size[1]}")
        if not n:
            continue
        buf = _io.BytesIO()
        if mime == "image/webp":
            res.save(buf, "WEBP", quality=92, method=4)
        else:
            res.save(buf, "PNG")
        _poser_image(jf, bf, ifu, buf.getvalue(), mime)
        change += n
    # couche emissive peinte : recopiee telle quelle (2048)
    ie = _index_image(jp, cp.get("emissif"))
    if ie is not None:
        em = Image.open(_io.BytesIO(_octets_image(jp, bp, ie))).convert("RGB")
        if em.getextrema() != ((0, 0), (0, 0), (0, 0)):
            buf = _io.BytesIO()
            em.save(buf, "PNG")
            jf.setdefault("images", []).append({"mimeType": "image/png"})
            jf.setdefault("textures", []).append({"source": len(jf["images"]) - 1})
            _poser_image(jf, bf, len(jf["images"]) - 1, buf.getvalue(), "image/png")
            mat = jf["materials"][0]
            mat["emissiveTexture"] = {"index": len(jf["textures"]) - 1}
            mat["emissiveFactor"] = [1.0, 1.0, 1.0]
            log("[texture] couche emissive ajoutee")
            change += 1
    if not change:
        return glb_plein
    bf = compacter(jf, bf)
    return ecrire_glb(jf, bf)
