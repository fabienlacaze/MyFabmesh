"""RealVisXL V4.0 text2image generation — cloud version.

Mirrors the default (non-T-pose) path of
`scripts/local_juggernaut_bridge.py:generate_images()` but rewritten as
a *pure function*: the pipeline is passed in, the function returns a
PIL image. This shape is what Modal's @modal.cls / @modal.method
expects — the pipeline lives on `self` so Memory Snapshots can capture
its weights once and replay them in seconds on cold restore.

The desktop script keeps doing its own thing (CLI + subprocess + custom
loggers + GPU throttle) — we do NOT touch it.
"""
from PIL import Image as _PImage
import torch


def _angle_token(prompt: str) -> str:
    """Same anti-doubling angle injection as the desktop bridge."""
    lc = prompt.lower()
    has_angle = any(t in lc for t in (
        'three-quarter', 'three quarter', '3/4', 'angled view',
        'angled side view', 'isometric', 'side profile', 'side view',
        'strict front view', 'front view', 'facing camera',
        'frontal view', 'front-facing',
    ))
    return '' if has_angle else 'slight angle, one side visible, '


# 2026-06-09: Asset-type-specific anti-anatomy negatives. Empirically
# (training_data_gen.py batch, 50 quadruped samples without these tokens)
# RealVis V4 generates 5-6 legs ~20% of the time on quadrupeds, extra
# arms ~10% on humanoids, and split/duplicate wings on dragons. Adding
# the targeted anatomy negatives drops the failure rate to ~2%. These
# are dispatched by asset_type so we don't pollute prop/vehicle/icon
# generations with irrelevant anatomy tokens.
# A1111-style emphasis weights — our chunked encoder
# (scripts/_sdxl_prompt_utils.py) parses (token:1.5) and scales the
# CLIP token embeddings. Single mention of "five legs" wasn't strong
# enough on RealVis V4.0 (still ~10% failure on quadrupeds); weighting
# to 1.6 makes the anti-anatomy clause dominate CFG. Verified
# empirically on training_data_gen batch.
_ANATOMY_NEG = {
    'animal':    "(five legs:1.6), (six legs:1.6), (extra leg:1.6), "
                 "(polydactyly:1.5), (three legs:1.4), (two heads:1.5), "
                 "(deformed legs:1.4)",
    'creature':  "(extra wings:1.6), (missing wing:1.6), (single wing:1.6), "
                 "(five legs:1.6), (three legs:1.4), (two heads:1.5), "
                 "(fused wings:1.4), "
                 "(bust shot:1.6), (cropped body:1.6), (feet not visible:1.4), "
                 "(waist up:1.5), "
                 "(pedestal:1.6), (plinth:1.6), (stone platform:1.5), "
                 "(statue base:1.5), (decorative base:1.4)",
    # Les consignes « deux armes » (two weapons, dual wielding, mirrored
    # weapons…) sont retirees le 2026-09-26 : elles n'interdisaient que la
    # SECONDE arme. Toute arme est desormais interdite, voir _ARMES_NEG.
    'character': "(three arms:1.5), (extra arms:1.6), missing arm, "
                 "(mutated hands:1.4)",
    # Buildings/structures: SDXL's isometric-architecture prior tiles a
    # whole village/town into one frame ("house for orc" -> 30-house
    # diorama). Front-load anti-cluster tokens so they reach the U-Net.
    # ...plus figure-suppression: a noun like "robot house" makes SDXL render
    # the FIGURE (a robot) instead of the building; "no characters" in the
    # positive is ignored, so weight it out of the negative here.
    'building':    "(village:1.6), (town:1.6), (city:1.6), (cityscape:1.5), "
                   "(multiple buildings:1.6), (rows of houses:1.5), "
                   "(many houses:1.5), (suburb:1.4), (neighborhood:1.4), "
                   "(aerial view:1.4), (isometric city:1.5), "
                   "(tiled:1.4), (repeated pattern:1.4), (diorama:1.4), "
                   "(humanoid:1.5), (android:1.5), (robot figure:1.5), "
                   "(character:1.4), (person:1.4), (mascot:1.4), "
                   "(standing figure:1.4), (statue:1.3), (mannequin:1.3)",
    'environment': "(village:1.5), (town:1.5), (city:1.5), "
                   "(multiple buildings:1.5), (rows of houses:1.4), "
                   "(many houses:1.4), (aerial view:1.4), "
                   "(isometric city:1.4), (tiled:1.4), (diorama:1.4), "
                   "(humanoid:1.5), (android:1.5), (character:1.4), "
                   "(person:1.4), (mascot:1.4), (standing figure:1.4)",
}


# LES UNITES NE PORTENT JAMAIS D'ARME (demande de l'utilisateur, 2026-09-26).
#
# Dans un jeu, l'arme est un asset SEPARE que le moteur attache a la main.
# Tenue dans l'image source, elle est fondue dans le maillage, deformee par la
# peau du rig, et ne peut plus etre retiree. L'ancien negatif n'interdisait que
# la SECONDE arme (« two weapons », « dual wielding ») : il tolerait la
# premiere, et « warrior », « spartan », « knight » en appellent toujours une.
#
# Une negation dans le positif ne marche pas (SDXL dessinerait l'arme nommee) :
# l'interdiction va ICI, et le gabarit positif demande des mains vides
# (« empty open hands », ASSET_TYPE_PROMPTS['character']). Priorite haute dans
# le budget : juste apres la securite et les ombres. La creature n'a qu'une
# version courte : son anatomie (ailes, pattes, cadrage) consomme deja presque
# tout le budget.
#
# Liste MESUREE (banc modal_app/test_prompts_unites.py, 6 unites x 2 graines,
# RealVisXL 30 pas) : sans elle 8 unites sur 12 tenaient une arme ; la premiere
# version (avec « dagger », « bow and arrow ») en laissait encore passer —
# deux LAMES dans les mains d'un guerrier. « blade », « knife », « club »
# couvrent ces cas, a budget egal (« bow » seul au lieu de « bow and arrow »).
_ARMES_UNITE = ("(weapon:1.6), (holding weapon:1.6), (sword:1.5), (blade:1.5), "
                "(knife:1.5), (spear:1.5), (axe:1.5), (club:1.4), (shield:1.5), "
                "(bow:1.4), (gun:1.4), (staff:1.3)")
_ARMES_NEG = {
    'character':    _ARMES_UNITE,
    'other_living': _ARMES_UNITE,
    'creature':     "(weapon:1.6), (holding weapon:1.6)",
}


def build_prompts(prompt: str, asset_type: str | None = None) -> tuple[str, str]:
    """Returns (optimized_prompt, negative_prompt). Desktop bridge
    mirrors this verbatim (scripts/local_juggernaut_bridge.py L211-302).

    2026-06-09 (workflow wb66mnlri): rewritten to fit inside the SDXL
    CLIP-L 77-token cap. The previous negative was 410 tokens — 333
    silently truncated by diffusers. The anti-anatomy + anti-doubling
    block was past position 77 = invisible to the U-Net. Also removed
    'single instance only, one subject, no duplicate' from the POSITIVE
    (canonical SDXL anti-pattern that fills empty space with the
    subject — the bear-cub doubling at seed 1004/1009).

    Compel-style (token:weight) syntax dropped: vanilla diffusers does
    NOT parse it, each weight token wastes 7 CLIP tokens for zero gain.

    asset_type (optional): anatomy-aware negatives are now front-loaded
    so they reach the U-Net via CFG.
    """
    angle_token = _angle_token(prompt)
    # POSITIVE: minimal — the enriched prompt from
    # modal_app/_prompts.py:build_enriched_prompt() already supplies the
    # asset_type framing (full body / single instance / plain background).
    # We just add lighting + quality tokens. Crucially we DO NOT add
    # 'single instance only, one subject, no duplicate' — empirically
    # (workflow wb66mnlri + SDXL community) those POSITIVE tokens make
    # SDXL fill empty space with a second subject (bear-cub doubling).
    #
    # 2026-09-25 — « studio lighting » RETIRE. Le user signale que les ombres
    # faussent la generation : en demandant un eclairage de studio on en
    # FABRIQUAIT la cause (ombre portee au sol + fond gris degrade), puis on
    # les interdisait dans le negatif — les deux consignes se combattaient.
    # L'image sert de SOURCE au maillage : ce qui est ombre dans la photo est
    # cuit comme une tache sombre dans l'atlas UV. On demande donc un
    # eclairage PLAT et diffuse (« even lighting, no directional light »),
    # qui n'appelle pas d'ombre. Une negation ne va pas ici : SDXL dessine ce
    # qu'on nomme dans le positif (voir le negatif ci-dessous).
    optimized = (
        f"{prompt}, {angle_token}"
        f"flat even lighting, diffuse light, no directional light, "
        f"sharp focus, 8k, professional product photography"
    )

    # NEGATIVE: front-load anti-anatomy + anti-doubling so they reach
    # the U-Net through CFG. Drop the close-up/portrait/headshot triple-
    # repetitions (CLIP de-dupes identical token IDs in attention —
    # repetition does NOT brute-force weighting at guidance_scale 9.5).
    # Total budget: <=77 CLIP tokens (verified by tests).
    anatomy = _ANATOMY_NEG.get(asset_type or "") if asset_type else ""
    if anatomy:
        anatomy = anatomy + ", "
    # NEGATIF CONSTRUIT SOUS BUDGET, par ordre d'importance.
    #
    # MESURE DU 2026-09-24 : ce negatif depassait la limite CLIP de 77 jetons
    # pour TOUS les types d'asset — 88 pour un animal, 97 pour un personnage,
    # 136 pour une creature. Au-dela, SDXL jette la fin SANS RIEN DIRE : la
    # qualite generique (« blurry, deformed, bad anatomy ») et les consignes
    # d'eclairage etaient donc ignorees depuis toujours, alors qu'elles
    # figuraient dans le code.
    #
    # On ajoute desormais par priorite decroissante et on s'arrete net quand
    # le budget est atteint. Ce qui tombe est ECRIT dans le journal : une
    # troncature qu'on voit vaut mieux qu'une consigne qu'on croit appliquee.
    _MORCEAUX = [
        # La securite d'abord : elle ne doit jamais sauter.
        "nude, naked, nsfw, undressed",
        # LES OMBRES, EN TETE — demande explicite du user (2026-09-25).
        #
        # Elles etaient placees plus bas et SE FAISAIENT JETER chez character,
        # building ET creature : l'anatomie par type consomme le budget avant
        # elles (mesure : la consigne « pas d'ombres » n'etait appliquee que
        # sur animal, soit 1 type sur 5). Une consigne qui ne survit que sur
        # les types dont l'utilisateur ne sert pas ne corrige rien.
        #
        # POURQUOI CETTE PLACE EST JUSTE, ET PAS SEULEMENT ARRANGEANTE :
        # l'image sert de SOURCE au maillage, toute ombre est cuite en tache
        # sombre dans l'atlas UV, donc le defaut est VISIBLE SUR LE RESULTAT
        # FINAL. Une patte en trop est un defaut de forme, qu'une nouvelle
        # generation peut corriger ; une ombre cuite dans la texture est un
        # defaut que le client ne peut retirer qu'a la main dans Blender.
        #
        # REDUCTION A 11 JETONS, ET CE N'EST PAS UN COMPROMIS : la premiere
        # version en pesait 36 et nommait « shadow » quatre fois. CLIP
        # deduplique les jetons identiques, la repetition n'ajoute aucun poids
        # et consomme seulement le budget — meme lecon que les triples
        # « close-up, portrait, headshot » retires a cote.
        "cast shadow, soft shadow, ambient occlusion",
        # Les armes, pour les unites : voir _ARMES_NEG.
        _ARMES_NEG.get(asset_type or "", ""),
        # L'anatomie propre au type d'asset — c'est elle qui corrige les
        # cinq pattes et les ailes manquantes.
        anatomy.rstrip(', ') if anatomy else '',
        # Anti-doublement : deux sujets dans une image la rendent inutilisable.
        "duplicate, twin, split image, collage, side by side",
        # Cadrage : un buste ne fait pas un mesh complet.
        "headshot, portrait, close-up, partial body, cropped, out of frame",
        # Eclairage et proprete du cadre. La consigne d'ombres N'EST PLUS ICI :
        # elle est remontee en tete du bloc (voir plus haut), car a cette
        # place elle se faisait jeter des que le type d'asset avait une
        # anatomie. Ce qui reste ici ne vaut que si le budget le permet.
        #
        # Rappel de l'origine de ces termes : ils vivaient dans le prompt
        # POSITIF sous la forme « no shadows », « no text », « no characters »,
        # ou SDXL ne comprend pas la negation — il n'y voyait que le mot et le
        # dessinait.
        "text, watermark, logo, user interface",
        "extra characters, bystanders",
        # Qualite generique, en dernier : c'est le moins couteux a perdre.
        "blurry, deformed, bad anatomy",
    ]
    _BUDGET_NEG = 77          # limite CLIP, au-dela la fin est jetee
    _gardes, _jetons, _jetes = [], 0, []
    for _m in _MORCEAUX:
        if not _m:
            continue
        _n = round(len(_m.replace(',', ' ').split()) * 1.35)
        if _jetons + _n > _BUDGET_NEG:
            _jetes.append(_m)
            continue
        _gardes.append(_m)
        _jetons += _n
    if _jetes:
        print(f"[prompt] negatif tronque a {_jetons} jetons — ecarte : "
              f"{' | '.join(_jetes)}", flush=True)
    negative = ", ".join(_gardes)
    return optimized, negative


def generate(pipe, prompt: str, seed: int, steps: int = 30,
             asset_type: str | None = None, turbo: bool = False) -> _PImage.Image:
    """Run RealVisXL on the given pipeline. `pipe` must already be on
    GPU and configured (called by app.py after Memory Snapshot restore).

    asset_type (optional): forwarded to build_prompts() for anatomy-aware
    negatives. Backwards compatible — old callers passing only prompt
    still work and get the legacy negative.

    Returns the raw PIL image — the caller (Modal @method) is
    responsible for NSFW filtering and PNG encoding.
    """
    optimized, negative = build_prompts(prompt, asset_type=asset_type)
    base_kwargs = dict(
        num_inference_steps=(4 if turbo else int(steps)),
        guidance_scale=(0.0 if turbo else 9.5),
        height=1024,
        width=1024,
        generator=torch.Generator("cuda").manual_seed(int(seed)),
    )
    # Compel bypasses SDXL's 77-token CLIP-L cap (workflow wb66mnlri).
    # Without this, the long anti-anatomy + anti-doubling negative is
    # silently truncated past position 77 and the load-bearing tokens
    # never reach the U-Net. Falls back to vanilla pipe() if Compel
    # is unavailable or fails — never blocks generation.
    try:
        from modal_app._sdxl_prompt_utils import encode_sdxl_long_prompt
        embeds = encode_sdxl_long_prompt(pipe, optimized, negative)
        result = pipe(**embeds, **base_kwargs)
    except Exception as _ce:
        print(f"[_realvis] Compel fallback ({_ce}); using truncated prompts",
              flush=True)
        result = pipe(prompt=optimized, negative_prompt=negative, **base_kwargs)
    return result.images[0]
