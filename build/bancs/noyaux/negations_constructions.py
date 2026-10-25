"""Cas CONSTRUITS pour extraire_negations (2026-10-18) : le texte ET la sortie attendue sortent du MEME gabarit, aucune sortie du module n'est recopiee.

POURQUOI. Les cas ecrits a la main (build/intention_cas.json) et le balayage du lexique ne voient que ce qu'on a pense a ecrire ; les sorties gravees
(intention_attendus.json) prouvent que le Python et le JavaScript sont d'accord, pas qu'ils ont raison. Ici, chaque gabarit decrit une FORME de phrase
(« S, no N, P » ; « S with no N but a M » ; « S with no N smiling »...) et ce qu'elle doit devenir (« S, P » + terme N ; « S with a M » ; « S smiling »),
quels que soient le sujet S, le groupe nie N et le complement P. Un defaut de grammaire du module (un mot de liaison qui reste, un participe avale par
le terme, un verbe leger pris pour un terme) fait echouer des centaines de combinaisons d'un coup. Constate le 2026-10-18 : « a knight, no helmet and not
wearing a scarf » n'extrayait RIEN (le verbe leger du second declencheur devenait un terme et la locution entiere etait refusee) ; « an orc with no helmet
standing » envoyait « helmet standing » au negatif et perdait « standing » du positif.

Utilise par build/check_intention.py (jeu fixe, grave dans intention_attendus.json : le JavaScript doit donner les memes sorties) et par
build/bancs/noyaux/test_negations.py (jeu plus grand). Le generateur est un LCG maison : la meme graine donne les memes textes sur toute version de Python.
"""

SUJETS = ['an orc', 'a knight', 'the dragon', 'a house', 'a sword', 'a robot', 'a cat', 'a wizard', 'a pirate ship', 'two soldiers', 'An Orc Warrior',
          'a medieval castle']
NOMS = ['helmet', 'beard', 'armor', 'wings', 'tail', 'red cape', 'plate armor', 'spiked club', 'windows', 'wheels', 'scarf', 'shield', 'crown', 'axe',
        'signs of rust', 'suit of armor', 'ornate golden spiked helmet', 'carrot nose', 'hard edges', 'visible weapons']
NOMS2 = ['mustache', 'hood', 'lance', 'horns', 'eyepatch', 'glasses', 'big ears', 'sharp teeth']
VOULUS = ['mustache', 'red cape', 'hood', 'lance', 'golden crown']
COMPLEMENTS = ['holding a club', 'standing in a forest', 'highly detailed', 'with a long tail', 'painted red', '8k', 'in a dark cave', 'wearing a blue hat',
               'on a white background', 'carrying a bag', 'sitting on a throne', 'smiling at the camera']
PARTICIPES = ['smiling', 'sitting', 'walking', 'looking left', 'dancing', 'standing', 'flying', 'floating', 'kneeling', 'crouching']
SUITES = ['', 'at the camera', 'in a field', 'on a rock']


class _Alea:
    """LCG (Numerical Recipes) : meme suite de nombres sur toute version de Python."""

    def __init__(self, graine):
        self.etat = graine & 0xFFFFFFFF

    def choix(self, liste):
        self.etat = (self.etat * 1664525 + 1013904223) & 0xFFFFFFFF
        return liste[(self.etat >> 8) % len(liste)]


def terme(groupe):
    """Le terme de negatif attendu pour un groupe nominal : ses 3 derniers mots (MAX_MOTS_TERME)."""
    return ' '.join(groupe.split()[-3:])


def article(mot, choix):
    if choix == 'a':
        return 'an ' if mot[0] in 'aeiou' else 'a '
    if choix == 'the':
        return 'the '
    if choix == 'any':
        return 'any '
    return ''


def gabarits(s, n, n2, m, p, v, pp, a, a2, am):
    """[(nom, texte, positif attendu, negatifs attendus)] pour UN tirage de vocabulaire."""
    tn, tn2 = terme(n), terme(n2)
    vv = (v + ' ' + pp).strip()
    tous12 = (NOMS + NOMS2)[:10]
    return [
        # --- une negation en tete de segment
        ('T01', '%s, no %s' % (s, n), s, [tn]),
        ('T02', '%s, no %s, %s' % (s, n, p), '%s, %s' % (s, p), [tn]),
        ('T07', '%s, without %s%s' % (s, a, n), s, [tn]),
        ('T14', '%s, %s, no %s' % (s, p, n), '%s, %s' % (s, p), [tn]),
        ('T15', '%s %s, no %s' % (s, p, n), '%s %s' % (s, p), [tn]),
        ('T12', '%s, not wearing %s%s' % (s, a, n), s, [tn]),
        ('T54', '%s, never %s%s' % (s, a, n), s, [tn]),
        ('T31', '%s, no %s whatsoever' % (s, n), s, [tn]),
        ('T22', '%s, no %s and %s%s' % (s, n, am, m), '%s, %s%s' % (s, am, m), [tn]),
        # --- listes
        ('T08', '%s, no %s and no %s' % (s, n, n2), s, [tn, tn2]),
        ('T09', '%s, no %s, no %s' % (s, n, n2), s, [tn, tn2]),
        ('T16', '%s, no %s, %s, no %s' % (s, n, p, n2), '%s, %s' % (s, p), [tn, tn2]),
        ('T10', '%s without %s or %s' % (s, n, n2), s, [tn, tn2]),
        ('T11', '%s with no %s or %s' % (s, n, n2), s, [tn, tn2]),
        ('T37', '%s, no %s and not wearing %s%s' % (s, n, a2, n2), s, [tn, tn2]),
        ('T38', '%s without %s%s, without %s%s' % (s, a, n, a2, n2), s, [tn, tn2]),
        ('T48', '%s, ' % s + ', '.join('no %s' % x for x in tous12), s, [terme(x) for x in tous12[:8]]),
        # --- une negation au milieu d'une phrase
        ('T03', '%s with no %s' % (s, n), s, [tn]),
        ('T04', '%s with no %s, %s' % (s, n, p), '%s, %s' % (s, p), [tn]),
        ('T05', '%s without %s%s' % (s, a, n), s, [tn]),
        ('T06', '%s without %s%s, %s' % (s, a, n, p), '%s, %s' % (s, p), [tn]),
        ('T13', '%s not wearing %s%s, %s' % (s, a, n, p), '%s, %s' % (s, p), [tn]),
        ('T27', '%s wearing no %s' % (s, n), s, [tn]),
        ('T28', '%s has no %s' % (s, n), s, [tn]),
        ('T29', '%s has no %s.' % (s, n), s + '.', [tn]),
        ('T30', '%s with no %s at all' % (s, n), s, [tn]),
        ('T32', '%s that has no %s' % (s, n), s, [tn]),
        ('T33', '%s who is not wearing %s%s' % (s, a, n), s, [tn]),
        ('T35', '%s with no %s in a forest' % (s, n), '%s in a forest' % s, [tn]),
        ('T36', '%s with no %s holding a club' % (s, n), '%s holding a club' % s, [tn]),
        ('T51', '%s with %s%s, no %s' % (s, am, m, n), '%s with %s%s' % (s, am, m), [tn]),
        ('T52', '%s with %s%s and no %s' % (s, am, m, n), '%s with %s%s' % (s, am, m), [tn]),
        # --- le participe qui suit decrit le SUJET, il reste dans le positif (2026-10-18)
        ('T17', '%s with no %s %s' % (s, n, vv), '%s %s' % (s, vv), [tn]),
        ('T19', '%s without %s%s and %s' % (s, a, n, vv), '%s %s' % (s, vv), [tn]),
        ('T41', '%s without %s%s wearing %s%s' % (s, a, n, am, m), '%s wearing %s%s' % (s, am, m), [tn]),
        ('T43', '%s with no %s and no %s %s' % (s, n, n2, vv), '%s %s' % (s, vv), [tn, tn2]),
        # --- le mot de liaison qui suivait la locution ne reste pas pendant (2026-10-18)
        ('T20', '%s with no %s but %s%s' % (s, n, am, m), '%s with %s%s' % (s, am, m), [tn]),
        ('T21', '%s with no %s and %s%s' % (s, n, am, m), '%s with %s%s' % (s, am, m), [tn]),
        ('T39', '%s with no %s, but %s%s' % (s, n, am, m), '%s, but %s%s' % (s, am, m), [tn]),
        # --- ponctuation et casse
        ('T23', '%s (no %s) %s' % (s, n, p), '%s %s' % (s, p), [tn]),
        ('T24', '%s - no %s - %s' % (s, n, p), '%s - %s' % (s, p), [tn]),
        ('T25', '%s. No %s. %s' % (s, n, p), '%s. %s' % (s, p), [tn]),
        ('T26', '%s; without %s; %s' % (s, n, p), '%s; %s' % (s, p), [tn]),
        ('T44', '%s\nno %s\n%s' % (s, n, p), '%s\n%s' % (s, p), [tn]),
        ('T46', ('%s, no %s, %s' % (s, n, p)).upper(), ('%s, %s' % (s, p)).upper(), [tn]),
        ('T47', ('%s, no %s, %s' % (s, n, p)).title(), ('%s, %s' % (s, p)).title(), [tn]),
        ('T50', '%s ,no %s, %s' % (s, n, p), '%s ,%s' % (s, p), [tn]),
        # --- temoins : le texte ne bouge pas, aucun terme
        ('C01', '%s with %s%s' % (s, am, m), '%s with %s%s' % (s, am, m), []),
        ('C02', '%s, no %s except %s%s' % (s, n, am, m), '%s, no %s except %s%s' % (s, n, am, m), []),
        ('C03', '%s, %s, %s' % (s, p, m), '%s, %s, %s' % (s, p, m), []),
        ('C04', '%s, no %s a %s' % (s, n, m), '%s, no %s a %s' % (s, n, m), []),
        ('C05', '%s, not only %s but also %s' % (s, n, n2), '%s, not only %s but also %s' % (s, n, n2), []),
        ('C06', '%s, no longer %s' % (s, vv), '%s, no longer %s' % (s, vv), []),
        ('C07', '%s not %s%s' % (s, a, n), '%s not %s%s' % (s, a, n), []),
        ('C08', '%s never wearing %s%s' % (s, a, n), '%s never wearing %s%s' % (s, a, n), []),
        ('C09', '%s, %s' % (s, p), '%s, %s' % (s, p), []),
    ]


def construire(graine, tirages):
    """Liste de dicts {nom, texte, positif, negatifs}, sans doublon de texte : `tirages` tirages de vocabulaire, tous les gabarits pour chacun."""
    r = _Alea(graine)
    vus, sortie = set(), []
    for _ in range(tirages):
        s, n, n2, m, p, v, pp = (r.choix(SUJETS), r.choix(NOMS), r.choix(NOMS2), r.choix(VOULUS), r.choix(COMPLEMENTS), r.choix(PARTICIPES), r.choix(SUITES))
        a = article(n, r.choix(['a', 'the', 'any', '']))
        a2 = article(n2, r.choix(['a', 'the', '']))
        am = article(m, r.choix(['a', 'the', '']))
        for nom, texte, positif, negatifs in gabarits(s, n, n2, m, p, v, pp, a, a2, am):
            if texte in vus:
                continue
            vus.add(texte)
            # `negatifs` : au plafond PRUDENT (8, outils a appel direct) ; `negatifs_longs` : au plafond des routes a encodeur long (20, generation d'image)
            longs = [terme(x) for x in (NOMS + NOMS2)[:10]] if nom == 'T48' else negatifs
            sortie.append({'nom': nom, 'texte': texte, 'positif': positif, 'negatifs': negatifs, 'negatifs_longs': longs})
    return sortie
