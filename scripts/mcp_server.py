"""
MyFabmesh.AI - serveur MCP (Claude Desktop, Claude Code)
=========================================================

Parle MCP (JSON-RPC 2.0, un message par ligne sur stdin/stdout) et pilote
l'appli de bureau DEJA OUVERTE par son API locale (127.0.0.1:7331,
src/main/control_api.js), comme un utilisateur : projets, images, 3D, rig,
fenetres, captures. L'appli doit etre ouverte, avec Reglages > Assistant >
« Allow Claude and scripts on this PC » allume. La cle d'acces est relue a
chaque appel dans ~/.fabmesh/test_api_token.txt : elle change a chaque
demarrage de l'API.

Bibliotheque standard SEULEMENT : il tourne avec le Python livre avec l'appli
(resources/python-embed/python.exe, signe), dont le fichier ._pth n'ajoute
pas le dossier du script au chemin d'import (donc pas d'import local).

Configuration de Claude Desktop (ecrite par Reglages > Assistant > Connect
Claude Desktop, chemins de l'installation) :
    "mcpServers": { "fabmesh": {
        "command": "<resources>\\python-embed\\python.exe",
        "args": ["<resources>\\scripts\\mcp_server.py"] } }
Claude Code :
    claude mcp add --scope user fabmesh -- "<python.exe>" "<mcp_server.py>"

2026-09-30 : il passait par le pont 7555 (coupe dans l'appli installee, jeton
cherche au mauvais endroit) et lancait l'appli de DEVELOPPEMENT
(node_modules/electron) quand l'appli ne repondait pas. Il ne lance plus rien.
Les descriptions d'outils sont lues par l'utilisateur dans Claude : aucun nom
de moteur.
"""
import base64
import json
import os
import socket
import sys
import threading
import traceback
import urllib.error
import urllib.parse
import urllib.request

VERSION = "2.0.0"
API = os.environ.get("FABMESH_CONTROL_URL", "http://127.0.0.1:7331").rstrip("/")
AGENT = "MyFabmesh-MCP/" + VERSION
# Versions du protocole connues : on renvoie celle du client si on la connait,
# sinon la plus recente d'ici (regle de negociation de MCP).
PROTOCOLES = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
ICI = os.path.dirname(os.path.abspath(__file__))
FICHIERS_CLE = (
    os.path.join(os.path.expanduser("~"), ".fabmesh", "test_api_token.txt"),
    os.path.join(ICI, "..", ".test_api_token"),          # developpement : racine du depot
)
MSG_INJOIGNABLE = ("MyFabmesh.AI is not reachable. Open MyFabmesh.AI and turn on "
                   "Settings > Assistant > 'Allow Claude and scripts on this PC'.")
MSG_CLE = ("MyFabmesh.AI refused the access key. Retry; if it persists, turn the switch "
           "in Settings > Assistant off and on again.")

_ecriture = threading.Lock()


def log(msg):
    """Journal sur stderr (stdout est reserve au protocole)."""
    try:
        sys.stderr.write("[myfabmesh-mcp] %s\n" % msg)
        sys.stderr.flush()
    except Exception:
        pass


def envoyer(obj):
    ligne = (json.dumps(obj) + "\n").encode("utf-8")
    with _ecriture:
        sys.stdout.buffer.write(ligne)
        sys.stdout.buffer.flush()


def repondre(id_, result=None, erreur=None, code=-32000):
    msg = {"jsonrpc": "2.0", "id": id_}
    if erreur is not None:
        msg["error"] = {"code": code, "message": str(erreur)}
    else:
        msg["result"] = result
    envoyer(msg)


# =====================================================================
# API locale de l'appli
# =====================================================================
class Injoignable(Exception):
    pass


def lire_cle():
    env = os.environ.get("FABMESH_TOKEN", "").strip()
    if env:
        return env
    for f in FICHIERS_CLE:
        try:
            with open(f, "r", encoding="utf-8") as h:
                t = h.read().strip()
            if t:
                return t
        except OSError:
            continue
    return None


def appel(methode, chemin, corps=None, delai=60, brut=False):
    """Requete a l'API locale. brut=True rend (octets, type) ; sinon le champ data."""
    cle = lire_cle()
    if not cle:
        raise Injoignable(MSG_INJOIGNABLE)
    entetes = {"Authorization": "Bearer " + cle, "User-Agent": AGENT}
    data = None
    if corps is not None:
        data = json.dumps(corps).encode("utf-8")
        entetes["Content-Type"] = "application/json"
    req = urllib.request.Request(API + chemin, data=data, method=methode, headers=entetes)
    try:
        with urllib.request.urlopen(req, timeout=delai) as r:
            contenu = r.read()
            type_ = r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        contenu = e.read()
        if e.code == 401:
            raise Injoignable(MSG_CLE)
        try:
            message = json.loads(contenu.decode("utf-8")).get("error")
        except Exception:
            message = None
        raise RuntimeError(message or ("HTTP %d" % e.code))
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), (socket.timeout, TimeoutError)):
            raise RuntimeError("MyFabmesh.AI did not answer in time.")
        raise Injoignable(MSG_INJOIGNABLE)
    except (socket.timeout, TimeoutError):
        raise RuntimeError("MyFabmesh.AI did not answer in time.")
    except (ConnectionError, OSError):
        raise Injoignable(MSG_INJOIGNABLE)
    if brut:
        return contenu, type_
    obj = json.loads(contenu.decode("utf-8"))
    if not obj.get("ok"):
        raise RuntimeError(obj.get("error") or "unknown error")
    return obj.get("data")


def fenetres_ouvertes():
    """Fenetres ouvertes de l'appli (titre + boutons), en abrege."""
    try:
        m = appel("GET", "/ui/modal", delai=20) or []
    except Exception:
        return []
    out = []
    for f in m:
        out.append({
            "id": f.get("id"),
            "title": f.get("titre"),
            "text": (f.get("texte") or "")[:400],
            "buttons": [{"target": b.get("ref"), "label": b.get("label")} for b in (f.get("boutons") or [])][:12],
        })
    return out


# =====================================================================
# Outils
# =====================================================================
def t_app_state(a):
    etat = appel("GET", "/state", delai=20)
    return {"state": etat, "open_windows": fenetres_ouvertes()}


def t_list_projects(a):
    etat = appel("GET", "/state", delai=20) or {}
    courant = (etat.get("currentProject") or {}).get("name")
    return {"projects": etat.get("projects") or [], "open_project": courant}


def t_open_project(a):
    nom = str(a.get("name") or "").strip()
    if not nom:
        raise RuntimeError("name is required")
    return appel("POST", "/select-project", {"name": nom}, delai=30)


def t_new_project(a):
    nom = str(a.get("name") or "").strip()
    if not nom:
        raise RuntimeError("name is required")
    champs = {"np-auto": False, "np-name": nom}
    if a.get("description"):
        champs["np-prompt"] = str(a["description"])
    if a.get("asset_type"):
        champs["np-asset-type"] = str(a["asset_type"])
    if a.get("style"):
        champs["np-asset-style"] = str(a["style"])
    appel("POST", "/ui/click", {"target": "btn-new-project", "wait": 300}, delai=30)
    rempli = appel("POST", "/ui/fill", {"fields": champs}, delai=30)
    erreurs = {k: v for k, v in (rempli or {}).items() if isinstance(v, dict) and v.get("erreur")}
    if erreurs:
        raise RuntimeError("could not fill the New project window: " + json.dumps(erreurs))
    clic = appel("POST", "/ui/click", {"target": "np-create", "wait": 1200}, delai=30)
    etat = appel("GET", "/state", delai=20) or {}
    return {"created": nom, "open_project": (etat.get("currentProject") or {}).get("name"),
            "toasts": (clic or {}).get("toasts"), "open_windows": fenetres_ouvertes()}


def _lancement(route, corps):
    r = appel("POST", route, corps, delai=90) or {}
    return {"started": bool(r.get("triggered")), "job_id": r.get("jobId"),
            "note": None if r.get("jobId") else "No job yet: a window may be asking for confirmation (see open_windows).",
            "open_windows": fenetres_ouvertes()}


def t_generate_images(a):
    corps = {}
    if a.get("prompt"):
        corps["prompt"] = str(a["prompt"])
    if a.get("count"):
        corps["count"] = int(a["count"])
    return _lancement("/generate-image", corps)


def t_generate_3d(a):
    corps = {}
    if a.get("image_index") is not None:
        corps["imageIndex"] = int(a["image_index"])
    return _lancement("/generate-3d", corps)


def t_auto_rig(a):
    return _lancement("/auto-rig", {})


def t_wait_for_jobs(a):
    s = max(1, min(int(a.get("timeout_s") or 50), 600))
    r = appel("POST", "/ui/wait", {"jobsDone": True, "timeout": s * 1000}, delai=s + 15) or {}
    jobs = appel("GET", "/jobs", delai=20)
    fini = bool(r.get("ok"))
    return {"done": fini, "jobs": jobs,
            "note": None if fini else "Still running: call wait_for_jobs again.",
            "open_windows": fenetres_ouvertes()}


def t_list_jobs(a):
    return appel("GET", "/jobs", delai=20)


def t_find_controls(a):
    q = {"limit": str(max(1, min(int(a.get("limit") or 60), 300)))}
    if a.get("query"):
        q["q"] = str(a["query"])
    if a.get("zone"):
        q["zone"] = str(a["zone"])
    return appel("GET", "/ui/catalog?" + urllib.parse.urlencode(q), delai=30)


def cible(t):
    """'text:Apply' -> recherche par libelle (comme build/fab.mjs) ; sinon id, #id, @ref ou selecteur."""
    t = str(t or "").strip()
    return {"text": t[5:].strip()} if t.lower().startswith("text:") else t


def t_click(a):
    if not str(a.get("target") or "").strip():
        raise RuntimeError("target is required")
    return appel("POST", "/ui/click", {"target": cible(a["target"])}, delai=40)


def t_fill(a):
    champs = a.get("fields")
    if not isinstance(champs, dict) or not champs:
        raise RuntimeError("fields is required, e.g. {\"np-name\": \"house\"}")
    return appel("POST", "/ui/fill", {"fields": champs}, delai=40)


def t_read_windows(a):
    return appel("GET", "/ui/modal", delai=20)


def t_close_window(a):
    corps = {"id": a["id"]} if a.get("id") else {}
    return appel("POST", "/dismiss-popup", corps, delai=20)


def t_notifications(a):
    since = int(a.get("since") or 0)
    return appel("GET", "/ui/toasts?since=%d" % since, delai=20)


def t_screenshot(a):
    q = {"largeur": "1280", "format": "jpeg"}
    if a.get("target"):
        if str(a["target"]).lower().startswith("text:"):
            raise RuntimeError("screenshot target: use an id or @ref from find_controls")
        q["target"] = str(a["target"])
    octets, type_ = appel("GET", "/ui/shot?" + urllib.parse.urlencode(q), delai=40, brut=True)
    return {"__image__": base64.b64encode(octets).decode("ascii"), "mimeType": (type_ or "image/jpeg").split(";")[0]}


LECTURE = {"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False}
ACTION = {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}
CIBLE = {"type": "string",
         "description": "Control to use: its id or ref from find_controls (e.g. \"np-create\", \"@r12\"), "
                        "or \"text:<label>\" (e.g. \"text:Apply\")."}

OUTILS = {
    "app_state": {
        "description": "Current state of MyFabmesh.AI: open project (its images, 3D models and rigs), "
                       "project list, running jobs and open windows. Call this first.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": LECTURE, "fn": t_app_state,
    },
    "list_projects": {
        "description": "Names of the projects in MyFabmesh.AI, and the one currently open.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": LECTURE, "fn": t_list_projects,
    },
    "open_project": {
        "description": "Open an existing project by its name.",
        "inputSchema": {"type": "object", "properties": {
            "name": {"type": "string", "description": "Project name, as listed by list_projects"}},
            "required": ["name"]},
        "annotations": ACTION, "fn": t_open_project,
    },
    "new_project": {
        "description": "Create a new project and open it. 'description' says what to make, for example "
                       "'a medieval stone house with a thatched roof'. Then call generate_images.",
        "inputSchema": {"type": "object", "properties": {
            "name": {"type": "string", "description": "Short project name, e.g. medieval_house_1"},
            "description": {"type": "string", "description": "What to create, in plain words"},
            "asset_type": {"type": "string", "description": "Optional: character, creature, animal, insect, vehicle, avion, bateau, building, environment, weapon, prop, icon, custom"},
            "style": {"type": "string", "description": "Optional: realistic, pbr, stylized, stylized-pbr, hand-painted, cartoon, anime, lowpoly, pixelart, voxel..."}},
            "required": ["name"]},
        "annotations": ACTION, "fn": t_new_project,
    },
    "generate_images": {
        "description": "Generate reference images in the open project, like its Generate button. Leave "
                       "'prompt' empty to use the one prepared from the project description. Returns a job "
                       "id; the app may first open a window asking for confirmation (see open_windows, then click). "
                       "Then call wait_for_jobs.",
        "inputSchema": {"type": "object", "properties": {
            "prompt": {"type": "string", "description": "Optional: replaces the image description"},
            "count": {"type": "integer", "description": "Optional: number of images"}}},
        "annotations": ACTION, "fn": t_generate_images,
    },
    "generate_3d": {
        "description": "Make the 3D model of the open project from one of its images (like the Generate 3D "
                       "button). Then call wait_for_jobs.",
        "inputSchema": {"type": "object", "properties": {
            "image_index": {"type": "integer", "description": "Optional: which image (0 = first); default: the selected one"}}},
        "annotations": ACTION, "fn": t_generate_3d,
    },
    "auto_rig": {
        "description": "Add a skeleton (rig) to the 3D model of the open project. Then call wait_for_jobs.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": ACTION, "fn": t_auto_rig,
    },
    "wait_for_jobs": {
        "description": "Wait until no job is running (at most timeout_s seconds, default 50). Jobs take "
                       "minutes: call it again while done is false.",
        "inputSchema": {"type": "object", "properties": {
            "timeout_s": {"type": "integer", "description": "Seconds to wait, 1 to 600 (default 50)"}}},
        "annotations": LECTURE, "fn": t_wait_for_jobs,
    },
    "list_jobs": {
        "description": "Jobs of this session: name, status, progress.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": LECTURE, "fn": t_list_jobs,
    },
    "find_controls": {
        "description": "Find buttons, fields and lists of the app by words (e.g. 'export', 'resize'). "
                       "Returns their target (id or @ref), label, zone and value, for click and fill.",
        "inputSchema": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Words to look for"},
            "zone": {"type": "string", "description": "Optional: page, step or window id"},
            "limit": {"type": "integer", "description": "Maximum results (default 60)"}}},
        "annotations": LECTURE, "fn": t_find_controls,
    },
    "click": {
        "description": "Click a control, like the user. Folded panels open by themselves. Some settings "
                       "(Assistant, uninstall, parental control) are reserved to the user.",
        "inputSchema": {"type": "object", "properties": {"target": CIBLE}, "required": ["target"]},
        "annotations": ACTION, "fn": t_click,
    },
    "fill": {
        "description": "Fill fields, checkboxes and lists: {\"fields\": {target: value, ...}}.",
        "inputSchema": {"type": "object", "properties": {
            "fields": {"type": "object", "description": "target -> value (text, number, true/false, or option)"}},
            "required": ["fields"]},
        "annotations": ACTION, "fn": t_fill,
    },
    "read_windows": {
        "description": "Open windows of the app: title, text, fields and buttons (targets to click).",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": LECTURE, "fn": t_read_windows,
    },
    "close_window": {
        "description": "Close the top window (or the one with this id) with its Close or Cancel button.",
        "inputSchema": {"type": "object", "properties": {
            "id": {"type": "string", "description": "Optional window id from read_windows"}}},
        "annotations": ACTION, "fn": t_close_window,
    },
    "notifications": {
        "description": "Messages recently shown by the app (errors, successes).",
        "inputSchema": {"type": "object", "properties": {
            "since": {"type": "integer", "description": "Optional: only after this time (ms since 1970)"}}},
        "annotations": LECTURE, "fn": t_notifications,
    },
    "screenshot": {
        "description": "Picture of the MyFabmesh.AI window (or of one control or window), to see the result.",
        "inputSchema": {"type": "object", "properties": {"target": CIBLE}},
        "annotations": LECTURE, "fn": t_screenshot,
    },
}

INSTRUCTIONS = (
    "MyFabmesh.AI makes game-ready 3D assets on this PC: project, reference images, 3D model, rig. "
    "Typical flow: app_state, new_project (or open_project), generate_images, wait_for_jobs, "
    "generate_3d, wait_for_jobs, auto_rig. Jobs take minutes: call wait_for_jobs again while done is false. "
    "If a window asks for confirmation, read_windows then click its button. For anything else, "
    "find_controls then click or fill, like a user; screenshot shows the app. "
    "MyFabmesh.AI must be open with Settings > Assistant > 'Allow Claude and scripts on this PC' on."
)


def contenu_resultat(res):
    if isinstance(res, dict) and "__image__" in res:
        return [{"type": "image", "data": res["__image__"], "mimeType": res.get("mimeType") or "image/jpeg"}]
    return [{"type": "text", "text": json.dumps(res, indent=1, ensure_ascii=False, default=str)}]


def appeler_outil(id_, params):
    nom = params.get("name", "")
    args = params.get("arguments") or {}
    outil = OUTILS.get(nom)
    if not outil:
        repondre(id_, erreur="Unknown tool: %s" % nom, code=-32602)
        return
    try:
        log("tool %s %s" % (nom, json.dumps(args)[:200]))
        res = outil["fn"](args if isinstance(args, dict) else {})
        repondre(id_, {"content": contenu_resultat(res), "isError": False})
    except Injoignable as e:
        repondre(id_, {"content": [{"type": "text", "text": str(e)}], "isError": True})
    except Exception as e:
        log("tool %s error: %s" % (nom, e))
        traceback.print_exc(file=sys.stderr)
        repondre(id_, {"content": [{"type": "text", "text": "Error: %s" % e}], "isError": True})


def traiter(req):
    methode = req.get("method", "")
    id_ = req.get("id")
    params = req.get("params") or {}
    if methode == "initialize":
        demande = params.get("protocolVersion")
        repondre(id_, {
            "protocolVersion": demande if demande in PROTOCOLES else PROTOCOLES[0],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "myfabmesh", "title": "MyFabmesh.AI", "version": VERSION},
            "instructions": INSTRUCTIONS,
        })
    elif methode == "tools/list":
        repondre(id_, {"tools": [
            {"name": n, "description": o["description"], "inputSchema": o["inputSchema"], "annotations": o["annotations"]}
            for n, o in OUTILS.items()]})
    elif methode == "tools/call":
        # Un fil par appel : wait_for_jobs dure, un ping doit pouvoir passer entre-temps.
        threading.Thread(target=appeler_outil, args=(id_, params), daemon=True).start()
    elif methode == "ping":
        repondre(id_, {})
    elif methode.startswith("notifications/"):
        pass  # initialized, cancelled... : rien a repondre
    elif id_ is not None:
        repondre(id_, erreur="Method not found: %s" % methode, code=-32601)


def main():
    log("MyFabmesh.AI MCP server %s, API %s, python %s" % (VERSION, API, sys.version.split()[0]))
    for brut in sys.stdin.buffer:
        ligne = brut.decode("utf-8", errors="replace").strip()
        if not ligne:
            continue
        try:
            req = json.loads(ligne)
        except ValueError as e:
            log("invalid JSON: %s" % e)
            envoyer({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
            continue
        try:
            if isinstance(req, list):
                for r in req:
                    if isinstance(r, dict):
                        traiter(r)
            elif isinstance(req, dict):
                traiter(req)
        except Exception as e:
            log("error handling request: %s" % e)
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
