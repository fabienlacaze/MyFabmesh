"""Reglage des parametres d'animation par Qwen3.6-35B-A3B sur GPU (ESSAI du 28/10/2026, decision du user : « on va tester sur Modal d'abord »).

Modele : Qwen/Qwen3.6-35B-A3B-FP8 (open weights, Apache-2.0 annonce ; 35 Md de parametres dont ~3 Md actifs par jeton, mixture-of-experts),
servi par vLLM (>= 0.17 d'apres la recette vLLM du modele). Poids DANS l'image : un conteneur froid ne telecharge rien.
APPLICATION A PART (`myfabmesh-reglage-gpu`) : la deployer ne touche pas `myfabmesh-cloud` (ni ses instantanes GPU).

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/reglage_anim_gpu.py

Meme contrat que modal_app/reglage_anim.py (Qwen3-4B CPU) : regler(utilisateur, max_jetons, systeme) -> {"texte": ..., temps}.
Essai : mesurer (1) le demarrage a froid, (2) la duree d'une reponse a chaud, (3) la qualite sur le prompt « liste des 52 os -> concevoir la course ».
"""
import os
import re
import threading
import time

import modal

app = modal.App("myfabmesh-reglage-gpu")

_MODELE = "Qwen/Qwen3.6-35B-A3B-FP8"
_GPU = os.environ.get("REGLAGE_GPU", "L40S")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm>=0.17,<1", "huggingface_hub>=0.36,<2", "hf_transfer", "fastapi[standard]")
    .env({"HF_HOME": "/root/hf", "HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .run_commands(
        f"python -c \"from huggingface_hub import snapshot_download; snapshot_download('{_MODELE}')\""
    )
    .env({"HF_HUB_OFFLINE": "1"})
    .add_local_file("modal_app/redacteur/redacteur.py", remote_path="/opt/redacteur/redacteur.py")
)


def _check_auth(payload: dict) -> None:
    from fastapi import HTTPException
    attendu = os.environ.get("SHARED_SECRET", "")
    if not attendu or (payload.get("_auth") or "").strip() != attendu:
        raise HTTPException(status_code=401, detail="auth")


# ---------------------------------------------------------------------------------------------------------------------------------
# RELECTURE DES ANIMATIONS A CHAQUE GENERATION (29/10, decision du user : « Qwen3.6 doit faire le travail qu'on fait maintenant de
# maniere automatique pour rendre realistes les animations », « a chaque generation »). L'appli calcule l'animation (moteur
# procedural, dans le navigateur), dessine les squelettes et mesure ; le worker relaie ici. Deux modes :
#  - « proposer » : Qwen3.6 regarde l'animation et propose des LEVIERS (multiplicateurs bornes du moteur) ;
#  - « comparer » : il dit laquelle de deux versions (A, B) est la plus realiste et la plus conforme a l'intention de l'animation.
# L'appli garde un candidat seulement s'il GAGNE la comparaison et respecte les garde-fous mesures (sol, glissement, a-coups).
LEVIERS_RELECTURE = {
    'deplacement': 'how far the body travels (forward lunge, step)',
    'bascule': 'body pitch amplitude (rearing up / leaning into the strike)',
    'rebond': 'vertical body motion (crouch, rise, landing)',
    'rotation': 'yaw twist of hips and shoulders',
    'roulis': 'sideways roll / shaking',
    'tete': 'head motion',
    'hauteurPattes': 'how high the legs / feet are lifted',
    'ecart': 'how far the legs spread sideways',
    'bras': 'arm swing / punch amplitude (humanoids)',
    'crochets': 'fang opening (spiders)',
    'vitesse': 'tempo: above 1 = faster and snappier, below 1 = slower',
}
INTENTIONS = {
    'attack': 'an AGGRESSIVE, explosive attack: clear anticipation, weight shifted back then thrown forward, the body travels toward the target, fast strike, follow-through, recovery',
    'hit': 'a creature hit by a blow: sharp recoil, then damped recovery',
    'death': 'a creature dying: loses balance and collapses under its own weight',
    'jump': 'a jump: crouch, explosive push, flight, landing that absorbs the impact',
    'eat': 'eating: head down to the ground, chewing, looking up',
}
def _extraire_json(texte):
    t = texte or ''
    if '</think>' in t:
        t = t.split('</think>', 1)[1]
    t = re.sub(r'```(?:json)?', '', t)
    i = t.find('{')
    while i >= 0:
        prof, dans, ech = 0, False, False
        for k in range(i, len(t)):
            ch = t[k]
            if dans:
                if ech: ech = False
                elif ch == '\\': ech = True
                elif ch == '"': dans = False
                continue
            if ch == '"': dans = True
            elif ch == '{': prof += 1
            elif ch == '}':
                prof -= 1
                if prof == 0:
                    bloc = t[i:k + 1]
                    for essai in (bloc, re.sub(r',\s*([}\]])', r'\1', bloc)):
                        try:
                            import json as _j
                            r = _j.loads(essai)
                            if isinstance(r, dict):
                                return r
                        except ValueError:
                            pass
                    break
        i = t.find('{', i + 1)
    return None


# INSTANTANE GPU (demande du user : « lancer Qwen 3.6 le plus vite possible ») : le modele est charge sur la carte PENDANT la prise
# d'instantane, puis RESTAURE au demarrage d'un conteneur froid, comme `MyFabmeshMesh` (modal_app/app.py). Meme regle que les autres classes :
# un instantane est propre au type de machine (2-3 par type de GPU, crees aux premiers demarrages apres un deploiement).
@app.cls(
    image=image, gpu=_GPU, timeout=900, scaledown_window=30,   # 29/10 (user) : le conteneur s'eteint 30 s apres le dernier appel ; redemarrage a froid mesure : 20 s (snapshot GPU)
     enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
    secrets=[modal.Secret.from_name("myfabmesh-shared", required_keys=["SHARED_SECRET"])],
)
class ReglageGpu:
    @modal.enter(snap=True)
    def charger(self):
        from vllm import LLM
        t0 = time.time()
        self.llm = LLM(model=_MODELE, max_model_len=12288, gpu_memory_utilization=0.88, enforce_eager=True, limit_mm_per_prompt={"image": 4})
        self.s_chargement = round(time.time() - t0, 1)

    @modal.enter(snap=False)
    def apres_restauration(self):
        self.verrou = threading.Lock()

    @modal.method()
    def rechauffer(self):
        """Methode vide : la lancer cree l'instantane tout de suite (comme build/rechauffer_apres_deploy.py)."""
        return {"ok": True, "s_chargement_pris_dans_l_instantane": self.s_chargement}

    def _generer(self, utilisateur: str, max_jetons: int = 1100, systeme: str = None, temperature: float = 0.0):
        from vllm import SamplingParams
        messages = []
        if systeme:
            messages.append({"role": "system", "content": systeme})
        messages.append({"role": "user", "content": utilisateur})
        t0 = time.time()
        sortie = self.llm.chat(
            messages, SamplingParams(temperature=temperature, max_tokens=max_jetons),
            chat_template_kwargs={"enable_thinking": False},
        )[0]
        texte = sortie.outputs[0].text
        return {"texte": texte, "jetons_entree": len(sortie.prompt_token_ids), "jetons_sortie": len(sortie.outputs[0].token_ids),
                "s_generation": round(time.time() - t0, 1), "s_chargement_conteneur": self.s_chargement}

    def _voir(self, utilisateur: str, images_b64: list, max_jetons: int = 900, systeme: str = None, reflexion: bool = False):
        """Le modele regarde des images (JPEG en base64) et repond a la question : juge visuel des planches d'animation."""
        from vllm import SamplingParams
        contenu = [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b}} for b in images_b64[:4]]
        contenu.append({"type": "text", "text": utilisateur})
        messages = ([{"role": "system", "content": systeme}] if systeme else []) + [{"role": "user", "content": contenu}]
        t0 = time.time()
        # reflexion=True : mode « thinking » de Qwen3.6 (le modele raisonne avant de repondre : plus lent, parfois plus juste) ; le texte de reflexion est retire de la reponse
        sortie = self.llm.chat(messages, SamplingParams(temperature=0.0, max_tokens=max_jetons),
                               chat_template_kwargs={"enable_thinking": bool(reflexion)})[0]
        texte = sortie.outputs[0].text
        if "</think>" in texte:
            texte = texte.split("</think>", 1)[1]
        return {"texte": texte.strip(), "jetons_entree": len(sortie.prompt_token_ids),
                "jetons_sortie": len(sortie.outputs[0].token_ids), "s_generation": round(time.time() - t0, 1)}

    @modal.method()
    def voir(self, utilisateur: str, images_b64: list, max_jetons: int = 900, systeme: str = None, reflexion: bool = False):
        with self.verrou:
            return self._voir(utilisateur, images_b64, max_jetons, systeme, reflexion)

    @modal.method()
    def regler(self, utilisateur: str, max_jetons: int = 1100, systeme: str = None):
        """Appel direct par le SDK Modal (essais) : protege par les identifiants Modal."""
        with self.verrou:
            return self._generer(utilisateur, max_jetons, systeme)

    @modal.fastapi_endpoint(method="POST")
    def ajuster(self, payload: dict):
        _check_auth(payload)
        if payload.get("prechauffer"):
            return {"ok": True, "pret": True}
        with self.verrou:
            return self._generer(str(payload.get("texte", ""))[:12000], int(payload.get("max_jetons", 1100)), payload.get("systeme"))

    @modal.fastapi_endpoint(method="POST")
    def decrire(self, payload: dict):
        """PROMPT AUTOMATIQUE de « New project » (29/10, decision du user : Qwen3.6 sur le site et le bureau en mode Cloud, repli sur le 4B CPU cote worker).
        Meme contrat et memes regles que `myfabmesh-redacteur` (modal_app/redacteur/redacteur.py : consigne, types, filtre de sortie), meme reponse
        { ok, type, description }. Mesure du 29/10 sur 50 projets : 50/50 valides, 46/50 types justes, 3,4 s a chaud, 20 s a froid (snapshot GPU)."""
        _check_auth(payload)
        if payload.get("prechauffer"):
            return {"ok": True, "pret": True}
        import sys
        sys.path.insert(0, "/opt/redacteur")
        import redacteur as red
        nom = re.sub(r"[\x00-\x1f]", " ", red.sans_balises(payload.get("name", ""))).strip()[:80]
        notes = re.sub(r"[\x00-\x1f]", " ", red.sans_balises(payload.get("notes", ""))).strip()[:400]
        lang = str(payload.get("lang") or "en").lower()[:2]
        type_indice = payload.get("type")
        if len(nom) < 2 and len(notes) < 3:
            return {"ok": False, "error": "name required"}
        langue = red.LANGUES.get(lang, "English")
        u = f"Project name: {nom}"
        if type_indice in red.TYPES:
            u += f"\nType: {type_indice} ({red.TYPES[type_indice]})"
        if notes:
            u += f"\nNotes: {notes}"
        # la langue demandee etait parfois ignoree (« T-rex » en anglais alors que le francais etait demande) : on la redit en dernier
        u += f"\nLanguage: {langue}\nWrite the description in {langue}."
        with self.verrou:
            for temperature in (0.0, 0.6):
                r = red._analyser(self._generer(u, 140, red.SYSTEME, temperature)["texte"])
                if r:
                    if type_indice in red.TYPES:
                        r["type"] = type_indice
                    return {"ok": True, **r}
        return {"ok": False, "error": "no valid answer"}

    @modal.fastapi_endpoint(method="POST")
    def relire(self, payload: dict):
        """Relecture d'une animation (voir LEVIERS_RELECTURE). payload : mode (proposer | comparer), allure, espece, leviers {nom: valeur},
        mesures {...}, refus [texte], images [JPEG base64] (proposer : 1 a 4 ; comparer : 2 de A puis 2 de B). Reponse :
        proposer -> {ok, analyse, changements {levier: valeur}} ; comparer -> {ok, meilleur: 'A' | 'B', raison}."""
        import json
        _check_auth(payload)
        if payload.get("prechauffer"):
            return {"ok": True, "pret": True}
        mode = payload.get("mode")
        allure = str(payload.get("allure") or "attack")[:40]
        base = allure.split("__")[0]
        espece = re.sub(r"[^a-z_]", "", str(payload.get("espece") or "creature").lower())[:30] or "creature"
        intention = INTENTIONS.get(base, "a natural, believable " + base.replace("_", " ") + " motion")
        images = [str(b) for b in (payload.get("images") or [])][:4]
        mesures = json.dumps(payload.get("mesures") or {})[:2500]
        systeme = "You are an expert creature animator and biomechanics specialist. Reply with ONE valid JSON object only, no markdown."
        if mode == "comparer":
            if len(images) != 4:
                return {"ok": False, "error": "comparer needs 4 images"}
            texte = (f"Two versions of the same procedural animation of a {espece}. Images 1-2 = version A, images 3-4 = version B "
                     "(each image: frames of one cycle, rows in time order, left = side view, right = front view, camera fixed). "
                     f"Goal: {intention}. Which version is MORE REALISTIC and closer to that goal (weight, timing, amplitude, believability)? "
                     'Reply {"meilleur": "A" or "B", "raison": "<max 20 words>"}')
            with self.verrou:
                r = self._voir(texte, images, 120, systeme)
            j = _extraire_json(r["texte"]) or {}
            m = str(j.get("meilleur", "")).strip().upper()[:1]
            return {"ok": m in ("A", "B"), "meilleur": m, "raison": str(j.get("raison", ""))[:200], "s": r["s_generation"]}
        leviers = {k: float(v) for k, v in (payload.get("leviers") or {}).items() if k in LEVIERS_RELECTURE and isinstance(v, (int, float))}
        table = {k: {"current": round(leviers.get(k, 1.0), 3), "meaning": s} for k, s in LEVIERS_RELECTURE.items()}
        refus = "; ".join(str(x)[:160] for x in (payload.get("refus") or [])[-5:])
        texte = (f"You review a procedural {base.replace('_', ' ')} animation of a {espece}. Goal: {intention}. "
                 "The images show one cycle (rows in time order, left = side view, right = front view, camera fixed). "
                 f"MEASUREMENTS (units: % of body height, degrees): {mesures}\n"
                 f"ENGINE LEVERS (multipliers, 1 = default, allowed 0.3 to 3, change each by at most 0.35 per step): {json.dumps(table)}\n"
                 + (f"ALREADY TRIED AND REJECTED (propose something different): {refus}\n" if refus else "")
                 + "Say what is unrealistic or too weak, then change the levers that fix it (at most 4). "
                 'Reply {"analyse": "<max 25 words>", "changements": {"<lever>": <new value>}}')
        with self.verrou:
            for essai in range(2):
                r = self._voir(texte + ("" if essai == 0 else "\nYour previous reply was not valid JSON. Reply with the JSON object only."), images, 220, systeme)
                j = _extraire_json(r["texte"])
                if j and isinstance(j.get("changements"), dict):
                    ch = {}
                    for k, v in j["changements"].items():
                        try:
                            x = float(v)
                        except (TypeError, ValueError):
                            continue
                        if k in LEVIERS_RELECTURE and x == x:
                            a = leviers.get(k, 1.0)
                            ch[k] = round(min(3.0, max(0.3, a + max(-0.35, min(0.35, x - a)))), 3)
                    return {"ok": True, "analyse": str(j.get("analyse", ""))[:300], "changements": dict(list(ch.items())[:4]), "s": r["s_generation"]}
        return {"ok": False, "error": "no valid answer"}
