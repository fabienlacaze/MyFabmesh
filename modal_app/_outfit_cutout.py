"""Habits seuls — portage Modal de `scripts/outfit_cutout.py`.

Le noyau ci-dessous est une COPIE OCTET POUR OCTET du bloc « NOYAU PARTAGE »
de ce fichier. Il n'est pas importe : l'image Modal ne monte que `modal_app`,
et l'appli bureau packagee n'embarque que `scripts` — aucun des deux ne voit
l'autre. `build/check-outfit-parity.mjs` refuse la construction si les deux
copies divergent, pour ne pas revivre le cas u2net/Lucida ou une amelioration
n'avait atteint qu'une des deux plateformes.

Ne jamais editer ce bloc ici : editer `scripts/outfit_cutout.py`, puis
`node build/check-outfit-parity.mjs --sync`.

Les modeles (CLIPSeg, SDXL Inpaint) sont ceux deja charges par
MyFabmeshBackview._get_auto_inpaint_models() — aucun telechargement en plus.
"""

# --- NOYAU PARTAGE : DEBUT (copie identique dans modal_app/_outfit_cutout.py) ---
# Ne rien mettre ici qui depende du bureau ou de Modal : numpy + PIL seulement.
# Les modeles arrivent par CALLBACK (voir decouper_tenue).
import numpy as np
from PIL import Image, ImageFilter

#: Pieces proposees par defaut. Cle = identifiant stable (UI, noms de
#: fichiers), valeur = le texte envoye a CLIPSeg. CLIPSeg ne comprend que
#: l'anglais ; le libelle francais vit dans l'interface, pas ici.
PIECES_TENUE = {
    'cape':     'a cape, a cloak',
    'armor':    'body armor, breastplate, chest armor',
    'top':      'a shirt, a tunic, a jacket, a coat',
    'bottom':   'trousers, pants, a skirt',
    'boots':    'boots, shoes',
    'gloves':   'gloves, gauntlets',
    'belt':     'a belt',
    'helmet':   'a helmet, a hat, a headdress',
}

#: Ce qui n'est PAS un vetement et doit sortir de chaque masque.
TERMES_PEAU = 'a face, a head, hair, bare skin, a bare hand'

#: Ce qui identifie le personnage quand l'image n'a pas d'alpha exploitable.
TERME_PERSONNAGE = 'a person, a character, a full body'

#: Au-dela de cette fraction de la piece, les « trous » ne sont plus des trous :
#: recoudre revient a repeindre le vetement en entier, et SDXL invente alors
#: librement. Mesure du 2026-09-24 sur un orc : la completion a rendu un HOMME
#: en veste militaire a la place du personnage. Au-dessus de ce seuil on ne
#: complete pas, et on le DIT.
AIRE_MAX_TROUS = 0.35

#: Ce que la recouture n'a JAMAIS le droit de peindre. Sans lui, un inpaint a
#: forte denoise sur une grande zone fabrique un personnage entier.
NEGATIF_RECOUTURE = ('a person, a face, a head, hair, skin, a human, a body, '
                     'a character, hands, eyes')

#: En dessous de cette fraction de la silhouette, la piece est jugee absente.
#: Mesure de garde : une cape occupe ~10-30 % du perso, une ceinture ~1-2 %.
#: 0.004 laisse passer la ceinture sans laisser passer le bruit de CLIPSeg.
AIRE_MINI_PIECE = 0.004


def _binariser(arr_0_255, rel=0.5, plancher=50.0):
    """Seuil RELATIF au pic de reponse de l'image, plancher absolu en secours.

    CLIPSeg repond toujours quelque chose, meme pour un objet absent : un
    seuil absolu garderait ce bruit. Le seuil relatif au pic garde la zone
    reellement detectee. Meme recette que sdxl_server._clipseg_mask.
    """
    a = np.asarray(arr_0_255, dtype=np.float32)
    seuil = max(float(plancher), float(a.max()) * float(rel))
    return (a > seuil).astype(np.uint8) * 255


def _dilater(m, rayon):
    if rayon <= 0:
        return m
    return m.filter(ImageFilter.MaxFilter(int(rayon) * 2 + 1))


def _eroder(m, rayon):
    if rayon <= 0:
        return m
    return m.filter(ImageFilter.MinFilter(int(rayon) * 2 + 1))


def _fermeture(m, rayon):
    """Fermeture morphologique = dilatation puis erosion.

    Elle bouche les creux plus etroits que le rayon SANS grossir la forme :
    c'est ce qui permet de retrouver « le vetement continuait ici, derriere
    le bras » sans jamais elargir la silhouette.
    """
    return _eroder(_dilater(m, rayon), rayon)


def _trous_enclos(m):
    """Regions de fond ENTIEREMENT entourees par le masque.

    C'est le cas qui compte vraiment : un bras en travers d'une cape laisse un
    creux de 40 a 100 px, qu'aucune fermeture raisonnable ne comble (rayon 14
    ne franchit que ~28 px). Mesure du banc : avec la seule fermeture, la
    completion ne se declenchait tout simplement jamais.

    Un remplissage depuis le bord resout le cas exactement et sans limite de
    taille : ce que le fond ne peut pas atteindre depuis l'exterieur est, par
    construction, entoure de vetement.
    """
    from PIL import ImageDraw
    a = (np.asarray(m, np.uint8) > 127)
    h, w = a.shape
    # Marge de 1 px garantie en fond : le remplissage part toujours du bord,
    # meme si le vetement touche le cadre.
    pad = np.zeros((h + 2, w + 2), np.uint8)
    pad[1:-1, 1:-1] = a.astype(np.uint8) * 255
    inv = Image.fromarray(255 - pad, mode='L')
    ImageDraw.floodfill(inv, (0, 0), 0)
    reste = np.asarray(inv)[1:-1, 1:-1]
    return Image.fromarray((reste > 127).astype(np.uint8) * 255, mode='L')


def _aire(m):
    """Fraction de pixels allumes, 0..1."""
    a = np.asarray(m, dtype=np.uint8)
    return float((a > 127).sum()) / float(max(1, a.size))


def _et(a, b):
    return Image.fromarray(np.minimum(np.asarray(a, np.uint8), np.asarray(b, np.uint8)))


def _sauf(a, b):
    """a MOINS b."""
    aa = np.asarray(a, np.uint8).astype(np.int16)
    bb = np.asarray(b, np.uint8).astype(np.int16)
    return Image.fromarray(np.clip(aa - bb, 0, 255).astype(np.uint8))


def _ou(a, b):
    return Image.fromarray(np.maximum(np.asarray(a, np.uint8), np.asarray(b, np.uint8)))


def _taille_travail(w, h, maxi=1024):
    """Reduit le grand cote a `maxi` et aligne sur 8 (exigence SDXL)."""
    if max(w, h) > maxi:
        if w > h:
            w, h = maxi, int(h * maxi / w)
        else:
            h, w = maxi, int(w * maxi / h)
    return max(8, (w // 8) * 8), max(8, (h // 8) * 8)


def masque_personnage(img_rgba, clipseg, w, h):
    """Silhouette du personnage — le garde-fou morphologique.

    Si l'image porte deja un alpha (elle sort de Remove BG), c'est LUI qui
    fait foi : il est plus fiable que CLIPSeg et c'est deja ce que
    l'utilisateur a valide a l'oeil. Sinon on segmente.
    """
    if img_rgba.mode == 'RGBA':
        a = np.asarray(img_rgba.split()[-1])
        if not (a == 255).all() and (a > 127).any():
            m = Image.fromarray((a > 127).astype(np.uint8) * 255, mode='L')
            return m.resize((w, h), Image.LANCZOS)
    return Image.fromarray(_binariser(clipseg(TERME_PERSONNAGE), rel=0.35), mode='L')


def decouper_tenue(
    img_source,
    clipseg,
    inpaint=None,
    pieces=None,
    ensemble=True,
    par_piece=False,
    completer=True,
    rayon_fermeture=14,
    adoucir=2,
    recadrer=False,
    max_dim=1024,
):
    """Extrait la tenue. Retourne une LISTE de resultats, ordre stable.

    clipseg(texte) -> tableau 0..255 a la taille de travail (le noyau ne
        charge aucun modele : chaque plateforme branche le sien).
    inpaint(image_rgb, masque_L, prompt, negatif) -> PIL.Image RGB, ou None pour
        desactiver la completion.

    Chaque element : {'nom', 'image' (RGBA), 'aire', 'complete' (bool)}.
    Les pieces sous AIRE_MINI_PIECE sont ABSENTES de la liste — l'appelant
    les signale a l'utilisateur au lieu de livrer une image vide.
    """
    src = img_source
    ow, oh = src.size
    w, h = _taille_travail(ow, oh, max_dim)
    rgb = src.convert('RGB').resize((w, h), Image.LANCZOS)

    m_perso = masque_personnage(src, clipseg, w, h)
    m_peau = Image.fromarray(_binariser(clipseg(TERMES_PEAU), rel=0.45), mode='L')
    # La peau n'est soustraite qu'a l'interieur du personnage : sinon un
    # faux positif sur le fond viendrait grignoter le vetement.
    m_peau = _et(m_peau, m_perso)

    noms = list(pieces) if pieces else list(PIECES_TENUE.keys())
    # Chaque entree porte une LISTE de termes, dont on unit les masques.
    # L'ensemble interrogeait CLIPSeg avec les vingt concepts colles en une
    # seule phrase : le modele rendait alors une tache vague couvrant tout le
    # personnage, peau comprise (constate sur un orc le 2026-09-24). Interroge
    # piece par piece, chaque masque est net, et leur union est la tenue.
    demandes = []
    if ensemble:
        termes = [PIECES_TENUE[n] for n in noms if n in PIECES_TENUE]
        demandes.append(('outfit', termes or ['clothing, garment']))
    if par_piece:
        demandes += [(n, [PIECES_TENUE[n]]) for n in noms if n in PIECES_TENUE]

    resultats = []
    for nom, termes in demandes:
        m = None
        for t in termes:
            mt = Image.fromarray(_binariser(clipseg(t), rel=0.45), mode='L')
            m = mt if m is None else _ou(m, mt)
        m = _sauf(_et(m, m_perso), m_peau)     # BORNAGE DUR + retrait de la peau
        if _aire(m) < AIRE_MINI_PIECE:
            continue                            # piece absente de l'image

        rgb_piece, complete = rgb, False
        if completer and inpaint is not None:
            # Creux INTERNES seulement, de deux natures :
            #   - enclos  : entoures de vetement (bras en travers d'une cape),
            #               de taille quelconque ;
            #   - encoche : ouverts sur le contour mais plus etroits que le
            #               rayon de fermeture.
            # Ni l'un ni l'autre ne peut ajouter quoi que ce soit a
            # l'exterieur du vetement ; on re-borne quand meme a la silhouette.
            trous = _ou(_trous_enclos(m), _sauf(_fermeture(m, rayon_fermeture), m))
            # BORNAGE a la silhouette, PUIS retrait de la peau : la tete est
            # entouree par les epaules et le col, donc le remplissage des trous
            # enclos la comptait comme du tissu a recoudre — SDXL la repeignait
            # en bloc uniforme (constate sur un orc le 2026-09-24). La peau est
            # dilatee un peu avant soustraction pour ne pas laisser un halo au
            # ras du col.
            trous = _sauf(_et(trous, m_perso), _dilater(m_peau, 3))
            # PLAFOND. Des trous qui pesent plus que AIRE_MAX_TROUS de la piece
            # ne sont plus des manques a combler : les recoudre revient a
            # laisser le modele redessiner le vetement, et il redessine alors
            # le personnage avec. On prefere livrer la decoupe fidele et le
            # signaler plutot que rendre une invention.
            part = _aire(trous) / max(1e-6, _aire(m))
            if part > AIRE_MAX_TROUS:
                trous = None
            if trous is not None and _aire(trous) > 0.001:
                try:
                    rgb_piece = inpaint(
                        rgb, _dilater(trous, 2).filter(ImageFilter.GaussianBlur(2)),
                        'seamless continuation of the same garment, same fabric, '
                        'same colors, same lighting', NEGATIF_RECOUTURE)
                    if rgb_piece.size != (w, h):
                        rgb_piece = rgb_piece.resize((w, h), Image.LANCZOS)
                    m = _et(_ou(m, trous), m_perso)   # BORNAGE DUR, a nouveau
                    complete = True
                except Exception:
                    rgb_piece, complete = rgb, False   # jamais fatal

        # Adoucir PUIS re-borner, jamais l'inverse : un flou applique apres le
        # bornage bave de 2-3 px hors de la silhouette (mesure du banc), ce qui
        # suffit a rendre fausse la garantie « la tenue ne deborde pas du
        # personnage ». Ici le flou ne peut que ronger vers l'interieur.
        alpha = m.filter(ImageFilter.GaussianBlur(adoucir)) if adoucir > 0 else m
        # Les DEUX bornages, pas seulement la silhouette : le flou repousse le
        # bord du vetement de quelques pixels DANS la peau (mesure : un lisere
        # de 1036 px sur la tete, 736 px de peau dans la tenue). Une encolure
        # un peu serree vaut mieux qu'un morceau de visage colle au col.
        alpha = _sauf(_et(alpha, m_perso), m_peau)
        out = rgb_piece.convert('RGBA')
        out.putalpha(alpha)
        out = out.resize((ow, oh), Image.LANCZOS)      # CADRE D'ORIGINE
        if recadrer:
            boite = out.split()[-1].getbbox()
            if boite:
                out = out.crop(boite)
        resultats.append({'nom': nom, 'image': out, 'aire': _aire(m),
                          'complete': complete})
    return resultats
# --- NOYAU PARTAGE : FIN ---

# ---------------------------------------------------------------------------
# Glu MODAL : branche les modeles charges par _get_auto_inpaint_models().
# ---------------------------------------------------------------------------
def generate(seg_processor, seg_model, inpaint_pipe, source_img,
             pieces=None, ensemble=True, par_piece=False, completer=True,
             recadrer=False, max_dim=1024):
    """Retourne [{'nom', 'image' (PIL RGBA), 'aire', 'complete'}].

    Leve ValueError si aucune piece n'atteint AIRE_MINI_PIECE — l'appelant
    rembourse les credits, comme pour face_fix_image sans visage detecte.
    """
    import torch

    ow, oh = source_img.size
    w, h = _taille_travail(ow, oh, int(max_dim))
    travail = source_img.convert('RGB').resize((w, h), Image.LANCZOS)

    def clipseg(texte):
        entrees = seg_processor(text=[texte], images=[travail],
                                padding=True, return_tensors='pt')
        entrees = {k: v.to('cuda') for k, v in entrees.items()}
        with torch.no_grad():
            sortie = seg_model(**entrees)
        logits = sortie.logits.squeeze().detach().cpu().numpy()
        proba = 1.0 / (1.0 + np.exp(-logits))
        return np.asarray(Image.fromarray((proba * 255).astype(np.uint8))
                          .resize((w, h), Image.LANCZOS))

    def inpaint(image_rgb, masque, prompt, negatif=None):
        return inpaint_pipe(
            prompt=prompt, negative_prompt=negatif or NEGATIF_RECOUTURE,
            image=image_rgb, mask_image=masque,
            num_inference_steps=25, guidance_scale=7.0, strength=0.99,
        ).images[0]

    demandes = list(pieces or PIECES_TENUE.keys())
    res = decouper_tenue(source_img, clipseg,
                         inpaint if completer else None,
                         pieces=demandes, ensemble=ensemble,
                         par_piece=par_piece, completer=completer,
                         recadrer=recadrer, max_dim=max_dim)
    if not res:
        raise ValueError('Aucun vetement detecte sur cette image.')
    trouvees = {r['nom'] for r in res}
    return res, [n for n in demandes if n not in trouvees]
