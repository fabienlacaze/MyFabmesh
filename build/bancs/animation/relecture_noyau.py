"""Noyau de la RELECTURE + CORRECTION des animations de course par Qwen3.6 (29/10/2026, demande du user : « robustifie la relecture + modif de qwen3.6 »).

Fonctions pures, testees sans GPU (test_relecture_noyau.py) : normes cibles par allure, note de realisme, extraction tolerante du JSON
rendu par le modele, validation et bornage des changements de leviers, decision d'acceptation sur PLUSIEURS rigs.

Ce que l'ancienne boucle (C:/tmp/anim_glb/boucle_regl.py, 28/10) faisait mal et que ce noyau corrige :
- une reponse mal formee (balises de reflexion, ```json, virgule finale, texte autour) arretait tout -> extraire_json() tolere, et la boucle redemande ;
- un levier pouvait sauter d'un bout a l'autre de sa plage en un tour -> pas maximal par tour (region de confiance) ;
- le jugement se faisait sur UN rig -> un changement n'est garde que s'il ameliore la moyenne SANS degrader un rig sur une contrainte dure
  (glissement du pied, os sous le sol, a-coups) : c'est exactement le piege du 29/10 (leviers ajustes sur un rig, pied qui glisse sur un autre) ;
- normes mal calibrees (« corrigeait » ce qui etait sain) -> normes verifiees sur le moteur actuel (une course saine a une note proche de 0, test).
"""
import json
import math
import re

# --- normes : (min, max, poids, echelle). Penalite = poids * distance hors plage / echelle. None = pas de borne.
# Sources : Fukuchi 2017 (vol, genou), Hinrichs 1987 et Mann & Herman 1985 (bras), mesures du moteur sain (29/10) pour les bornes de stabilite.
_COMMUN = {
    'glissement': (None, 1.5, 3.0, 0.5),        # % H, pire appui
    'ecart_pieds': (None, 12.5, 1.0, 2.0),      # % H
    'tete_verticale': (None, 2.5, 1.0, 0.5),    # % H
    'sous_sol': (None, 0.0, 5.0, 0.5),          # % H
    'acoups': (None, 45.0, 2.0, 15.0),          # deg d'une image a l'autre (genou retourne = 180)
    'tete_vs_buste': (-8.0, 18.0, 0.5, 5.0),    # deg (+ = tete penchee en avant plus que le buste)
    'abduction': (8.0, 30.0, 0.4, 5.0),         # deg, moyenne des bras
    'main_vs_yeux': (None, 0.0, 1.0, 2.0),      # % H (> 0 = main au-dessus des yeux)
}
NORMES = {
    'run': dict(_COMMUN, vitesse=(1.7, 2.3, 2.0, 0.2), vol=(10.0, 32.0, 0.6, 5.0), buste=(6.0, 17.0, 0.8, 3.0),
                coude_min=(55.0, 92.0, 0.5, 10.0), coude_max=(95.0, 125.0, 0.5, 10.0), balancement=(60.0, 125.0, 0.6, 15.0)),
    'jog': dict(_COMMUN, vitesse=(1.2, 1.7, 2.0, 0.2), vol=(3.0, 25.0, 0.6, 5.0), buste=(3.0, 13.0, 0.8, 3.0),
                coude_min=(65.0, 95.0, 0.5, 10.0), coude_max=(88.0, 120.0, 0.5, 10.0), balancement=(40.0, 100.0, 0.6, 15.0)),
    'sprint': dict(_COMMUN, vitesse=(2.9, 3.9, 2.0, 0.3), vol=(22.0, 45.0, 0.6, 5.0), buste=(11.0, 25.0, 0.8, 3.0), acoups=(None, 60.0, 2.0, 15.0),
                   coude_min=(35.0, 75.0, 0.5, 10.0), coude_max=(95.0, 125.0, 0.5, 10.0), balancement=(80.0, 150.0, 0.6, 15.0)),
}
CONTRAINTES_DURES = ('glissement', 'sous_sol', 'acoups')

# --- leviers proposes au modele : (min, max, pas maximal par tour, sens)
LEVIERS = {
    'vitesse': (1.0, 3.8, 0.3, 'forward speed, body heights per second'),
    'cadence': (2.4, 4.6, 0.3, 'steps per second'),
    'appui': (0.28, 0.50, 0.03, 'fraction of the cycle each foot is on the ground (lower = longer flight)'),
    'buste': (0, 28, 5, 'forward trunk lean, degrees'),
    'coude': (50, 120, 10, 'mean elbow flexion, degrees (90 = right angle)'),
    'coudeVar': (0, 35, 8, 'elbow flexion change during the swing: closes in front, opens behind, degrees'),
    'ecartCoude': (5, 35, 6, 'elbows away from the body, degrees (0 = glued to the ribs)'),
    'mainsRentrees': (0, 20, 5, 'hands pulled toward the midline, degrees'),
    'brasAvant': (10, 60, 8, 'forward arm swing, degrees'),
    'brasArriere': (15, 75, 8, 'backward arm swing, degrees'),
    'levee': (0.12, 0.45, 0.05, 'swing foot lift'),
    'genou': (0.0, 0.35, 0.05, 'knee drive (knee comes up higher)'),
    'talon': (0, 18, 4, 'heel strike angle, degrees'),
    'poussee': (25, 48, 5, 'toe push-off angle, degrees'),
    'largeurPas': (0.3, 1.0, 0.15, 'step width factor (large = crab-like)'),
    'teteTangage': (-10, 25, 5, 'head pitch relative to the neck, degrees (+ = looks down)'),
    'teteSuivi': (0.0, 1.0, 0.2, 'how much the head follows the chest twist (0 = fixed in the world)'),
    'torseTorsion': (5, 35, 6, 'shoulders vs pelvis counter-rotation, degrees peak to peak'),
    'poidsImpact': (0.0, 0.008, 0.002, 'pelvis drop at foot strike, fraction of height'),
}
MAX_CHANGEMENTS = 6


def extraire_valeurs(m):
    """Mesures brutes (mesures_course.mjs) -> grandeurs normees."""
    bras = m.get('bras') or []
    v = {
        'vitesse': m.get('vitesse_Hs'), 'vol': m.get('phase_aerienne_pct'),
        'glissement': max(m.get('glissement_max_par_appui_pctH') or [0]), 'ecart_pieds': m.get('ecart_entre_pieds_pctH'),
        'tete_verticale': m.get('tete_verticale_pctH'), 'sous_sol': m.get('os_sous_sol_pctH'), 'acoups': m.get('acoups_max_deg'),
        'buste': (m.get('buste_deg') or {}).get('max'), 'tete_vs_buste': m.get('tete_vs_buste_deg'),
    }
    if bras:
        v['coude_min'] = sum(b['coude_flexion_deg'][0] for b in bras) / len(bras)
        v['coude_max'] = sum(b['coude_flexion_deg'][1] for b in bras) / len(bras)
        v['balancement'] = sum(b['balancement_bras_deg'][1] - b['balancement_bras_deg'][0] for b in bras) / len(bras)
        v['abduction'] = sum(sum(b['abduction_bras_deg']) / 2 for b in bras) / len(bras)
        v['main_vs_yeux'] = max(b.get('main_vs_yeux_max_pctH', -99) for b in bras)
    return v


def violations(m, allure):
    """Liste des normes non tenues : [(nom, valeur, min, max, penalite)]."""
    out = []
    for k, (lo, hi, w, ech) in NORMES[allure].items():
        x = extraire_valeurs(m).get(k)
        if x is None or not math.isfinite(x):
            continue
        d = (lo - x if lo is not None and x < lo else 0) + (x - hi if hi is not None and x > hi else 0)
        if d > 1e-9:
            out.append((k, round(x, 2), lo, hi, round(w * d / ech, 3)))
    return out


def note(m, allure):
    """Penalite de realisme (0 = toutes les normes tenues). Un rig dont la course anatomique n'a pas tourne vaut 10."""
    if not m or m.get('moteur') != 'anatomique':
        return 10.0
    return round(sum(p for *_, p in violations(m, allure)), 3)


_VIRGULE_FINALE = re.compile(r',\s*([}\]])')


def extraire_json(texte):
    """Premier objet JSON d'une reponse de modele : tolere les balises de reflexion, les blocs ```json, le texte autour,
    les virgules finales et les guillemets simples. Rend un dict ou None."""
    if not isinstance(texte, str):
        return None
    t = texte
    if '</think>' in t:
        t = t.split('</think>', 1)[1]
    t = re.sub(r'```(?:json)?', '', t)
    depart = t.find('{')
    while depart >= 0:
        prof, dans, ech = 0, False, False
        for i in range(depart, len(t)):
            c = t[i]
            if dans:
                if ech:
                    ech = False
                elif c == '\\':
                    ech = True
                elif c == '"':
                    dans = False
                continue
            if c == '"':
                dans = True
            elif c == '{':
                prof += 1
            elif c == '}':
                prof -= 1
                if prof == 0:
                    bloc = t[depart:i + 1]
                    for essai in (bloc, _VIRGULE_FINALE.sub(r'\1', bloc), _VIRGULE_FINALE.sub(r'\1', bloc).replace("'", '"')):
                        try:
                            r = json.loads(essai)
                            if isinstance(r, dict):
                                return r
                        except ValueError:
                            pass
                    break
        depart = t.find('{', depart + 1)
    return None


def valider_changements(reponse, actuels):
    """Changements proposes -> (changements retenus, rejets). Leviers inconnus, valeurs non numeriques ou non finies : rejetes ;
    valeur hors plage : ramenee dans la plage ; saut plus grand que le pas maximal : limite au pas ; au plus MAX_CHANGEMENTS."""
    ch = (reponse or {}).get('changements')
    if not isinstance(ch, dict):
        return {}, ['pas de champ "changements" (objet attendu)']
    retenus, rejets = {}, []
    for k, v in ch.items():
        if k not in LEVIERS:
            rejets.append(f'{k} : levier inconnu'); continue
        try:
            x = float(v)
        except (TypeError, ValueError):
            rejets.append(f'{k} : valeur non numerique ({v!r})'); continue
        if not math.isfinite(x):
            rejets.append(f'{k} : valeur non finie'); continue
        lo, hi, pas, _ = LEVIERS[k]
        a = float(actuels.get(k, (lo + hi) / 2))
        if x < lo or x > hi:
            rejets.append(f'{k} : {x} hors plage [{lo}, {hi}], ramene'); x = min(max(x, lo), hi)
        if abs(x - a) > pas:
            rejets.append(f'{k} : saut {a} -> {x} limite au pas {pas}'); x = a + math.copysign(pas, x - a)
        x = round(x, 4)
        if abs(x - a) < 1e-9:
            continue
        retenus[k] = x
        if len(retenus) >= MAX_CHANGEMENTS:
            if len(ch) > MAX_CHANGEMENTS:
                rejets.append(f'au plus {MAX_CHANGEMENTS} changements par tour : le reste est ignore')
            break
    return retenus, rejets


def decider(notes_meilleur, notes_candidat, mesures_meilleur, mesures_candidat, allure, gain_min=0.05):
    """Garde le candidat seulement s'il AMELIORE la moyenne des rigs d'au moins gain_min, sans qu'aucun rig ne se degrade sur une contrainte dure.
    Rend (accepte, raison)."""
    for nom in notes_candidat:
        if notes_candidat[nom] >= 10 and notes_meilleur.get(nom, 10) < 10:
            return False, f'{nom} : la course anatomique ne tourne plus'
        vb, vc = extraire_valeurs(mesures_meilleur[nom] or {}), extraire_valeurs(mesures_candidat[nom] or {})
        for k in CONTRAINTES_DURES:
            hi = NORMES[allure][k][1]
            a, c = vb.get(k), vc.get(k)
            if a is None or c is None:
                continue
            if c > max(hi, a) + 1e-6 and c - a > 0.05 * max(1.0, hi):
                return False, f'{nom} : {k} se degrade ({a} -> {c}, borne {hi})'
    mb = sum(notes_meilleur.values()) / len(notes_meilleur)
    mc = sum(notes_candidat.values()) / len(notes_candidat)
    if mc < mb - gain_min:
        return True, f'note moyenne {mb:.3f} -> {mc:.3f}'
    return False, f'pas de gain suffisant ({mb:.3f} -> {mc:.3f})'


# noms ANGLAIS des normes dans la consigne : le 29/10, Qwen3.6 a lu « vol » (phase de vol) comme « volatilise »
NOMS_EN = {
    'vitesse': 'speed_body_heights_per_s', 'vol': 'flight_phase_pct_of_cycle', 'glissement': 'stance_foot_slide_pct_height', 'ecart_pieds': 'feet_lateral_gap_pct_height',
    'tete_verticale': 'head_vertical_bob_pct_height', 'sous_sol': 'bones_below_ground_pct_height', 'acoups': 'max_joint_jump_deg_per_frame',
    'buste': 'trunk_forward_lean_deg', 'tete_vs_buste': 'head_pitch_vs_trunk_deg', 'coude_min': 'elbow_flexion_min_deg', 'coude_max': 'elbow_flexion_max_deg',
    'balancement': 'arm_swing_total_deg', 'abduction': 'upper_arm_away_from_body_deg', 'main_vs_yeux': 'hand_above_eyes_pct_height',
}


def cle_changement(ch):
    """Forme canonique d'un changement (pour reconnaitre un changement deja refuse)."""
    return json.dumps({k: round(float(v), 4) for k, v in sorted(ch.items())})


def texte_demande(allure, leviers, mesures_par_rig, notes, refus, rig_images):
    """Consigne envoyee a Qwen3.6 (avec les images du rig rig_images)."""
    lignes = []
    for nom, m in mesures_par_rig.items():
        vio = violations(m, allure) if m else []
        lignes.append(f'- {nom} (penalty {notes[nom]}): ' + ('; '.join(f'{NOMS_EN.get(k, k)}={x} (target {lo}..{hi})' for k, x, lo, hi, _ in vio) or 'all targets met'))
    table = {k: {'current': leviers.get(k), 'min': lo, 'max': hi, 'max_step': pas, 'meaning': s} for k, (lo, hi, pas, s) in LEVIERS.items()}
    deja = ('\nALREADY TRIED AND REJECTED (do not repeat): ' + '; '.join(refus[-6:])) if refus else ''
    nom_allure = {'run': 'run', 'jog': 'jog', 'sprint': 'sprint'}[allure]
    return (
        f'You review a procedural {nom_allure} animation of a humanoid character. REALISM IS THE GOAL. '
        f'The 4 images show the character "{rig_images}" over one cycle (8 frames, 2 per image), left = side view (moving to the right), '
        'right = front view; spine in black, legs in blue, arms in red.\n'
        f'MEASURED TARGET VIOLATIONS on each test character (units: % of body height, degrees):\n' + '\n'.join(lignes) +
        f'\nENGINE LEVERS (shared by all characters): {json.dumps(table)}{deja}\n'
        'Decide what makes it unrealistic (images and numbers), and change the levers that fix it, respecting max_step. '
        'A change is kept only if it improves the average penalty without making the foot slide or a joint pop on any character. '
        'Reply with ONE JSON object only: {"analyse": "<max 30 words>", "changements": {"<lever>": <new value>, ...}}'
    )
