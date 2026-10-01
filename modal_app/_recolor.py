"""Recolorier — portage Modal de `scripts/recolor_core.py`.

Le noyau ci-dessous est une COPIE OCTET POUR OCTET du bloc « NOYAU PARTAGE »
de ce fichier (lui-meme extrait de scripts/sdxl_server.py). Il n'est pas
importe : l'image Modal ne monte que `modal_app`, l'appli packagee n'embarque
que `scripts`. build/check-noyaux-partages.mjs refuse une divergence.

Ne jamais editer ce bloc ici : editer la source, puis
`node build/check-noyaux-partages.mjs --sync`.

Banc sur la vraie image Modal : modal_app/test_recolor_matiere.py.

CLIPSeg est celui deja charge par _get_auto_inpaint_models() — aucun modele
supplementaire.
"""

# --- NOYAU PARTAGE : DEBUT (copie identique dans modal_app/_recolor.py) ---
# Extrait de scripts/sdxl_server.py — ne rien y ajouter qui depende du bureau
# ou de Modal : numpy + PIL seulement (scipy en option : recolor_masque_fond
# s'en passe s'il manque).
import numpy as np
from PIL import Image

_COLOR_LEXICON = {
    'rouge': (0, 1.4, 'chroma'), 'red': (0, 1.4, 'chroma'),
    'orange': (18, 1.4, 'chroma'),
    'jaune': (35, 1.4, 'chroma'), 'yellow': (35, 1.4, 'chroma'),
    'vert': (85, 1.3, 'chroma'), 'verte': (85, 1.3, 'chroma'), 'green': (85, 1.3, 'chroma'),
    'cyan': (128, 1.3, 'chroma'), 'turquoise': (128, 1.3, 'chroma'),
    'bleu': (156, 1.3, 'chroma'), 'bleue': (156, 1.3, 'chroma'), 'blue': (156, 1.3, 'chroma'),
    'violet': (195, 1.3, 'chroma'), 'violette': (195, 1.3, 'chroma'),
    'purple': (195, 1.3, 'chroma'), 'mauve': (200, 1.2, 'chroma'),
    'rose': (227, 1.2, 'chroma'), 'pink': (227, 1.2, 'chroma'),
    'marron': (14, 0.7, 'chroma'), 'brun': (14, 0.7, 'chroma'), 'brune': (14, 0.7, 'chroma'), 'brown': (14, 0.7, 'chroma'),
    'dore': (32, 1.5, 'chroma'), 'dores': (32, 1.5, 'chroma'),
    'doree': (32, 1.5, 'chroma'), 'gold': (32, 1.5, 'chroma'), 'golden': (32, 1.5, 'chroma'),
    'argent': (0, 0.0, 'grey'), 'argente': (0, 0.0, 'grey'), 'argentee': (0, 0.0, 'grey'),
    'silver': (0, 0.0, 'grey'), 'gris': (0, 0.0, 'grey'), 'grise': (0, 0.0, 'grey'),
    'grey': (0, 0.0, 'grey'), 'gray': (0, 0.0, 'grey'),
    'noir': (0, 0.0, 'black'), 'noire': (0, 0.0, 'black'), 'black': (0, 0.0, 'black'),
    'blanc': (0, 0.0, 'white'), 'blanche': (0, 0.0, 'white'), 'white': (0, 0.0, 'white'),
}


def _strip_accents(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def parse_recolor_prompt(prompt):
    """'cape rouge' -> ('cape', color_spec) ; color_spec is None when no known
    colour word is present (-> ControlNet-Tile material fallback)."""
    text = (prompt or '').strip()
    color_spec = None
    noun_words = []
    for raw in text.split():
        w = _strip_accents(raw.strip(".,;:!?\"'()").lower())
        if w in _COLOR_LEXICON:
            if color_spec is None:
                hue, sat, mode = _COLOR_LEXICON[w]
                color_spec = {'hue': hue, 'sat': sat, 'mode': mode, 'word': w}
            # colour words are dropped from the CLIPSeg target either way
        else:
            noun_words.append(raw)
    noun = ' '.join(noun_words).strip() or text
    return noun, color_spec


def recolor_hsv_masked(img_rgb, mask_soft, color_spec, strength=1.0):
    """Shift HSV inside the masked region, preserving luminance (V) so folds and
    shadows stay intact. Blends through the feathered mask * strength."""
    hsv = np.array(img_rgb.convert('HSV')).astype(np.float32)  # H,S,V each 0-255
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    newH, newS, newV = H.copy(), S.copy(), V.copy()
    mode = color_spec['mode']
    if mode == 'chroma':
        newH[:] = color_spec['hue']
        # Saturation floor 110 so a GREY source (S~0) still takes a clearly visible
        # tint (not a washed-out pastel); already-saturated pixels keep their level.
        newS = np.clip(np.maximum(S * color_spec['sat'], 110.0), 0, 255)
    elif mode == 'grey':
        newS = S * 0.10
    elif mode == 'black':
        newS = S * 0.20
        newV = V * 0.35
    elif mode == 'white':
        newS = S * 0.10
        newV = np.clip(V * 1.15 + 60, 0, 255)
    out_hsv = np.stack([np.clip(newH, 0, 255), np.clip(newS, 0, 255), np.clip(newV, 0, 255)], axis=-1).astype(np.uint8)
    recolored = Image.fromarray(out_hsv, mode='HSV').convert('RGB')
    m = (np.array(mask_soft).astype(np.float32) / 255.0) * float(max(0.0, min(1.0, strength)))
    m = m[..., None]
    base = np.array(img_rgb).astype(np.float32)
    blended = base * (1 - m) + np.array(recolored).astype(np.float32) * m
    return Image.fromarray(blended.clip(0, 255).astype(np.uint8), 'RGB')
# ROUTE ET REGLAGES DU RE-RENDU « MATIERE / STYLE » (2026-09-30, decision du user : « B — meme capacite que le PC » : le cloud repeint aussi
# les matieres). Une demande sans mot de couleur (« cuir vieilli », « rusty metal ») ou un style sur toute l'image (« military green camo »)
# passe par un re-rendu ControlNet-Tile masque par CLIPSeg ; une couleur simple (« cape rouge ») garde le virage HSV ci-dessus.
# UNE SEULE definition pour le bureau (scripts/sdxl_server.py) et Modal : les reglages ne peuvent plus diverger.
def recolor_mots_descriptifs(prompt):
    """Mots du prompt qui ne sont PAS des mots de couleur : « military green camo » -> ['military', 'camo'] ; « green » -> []."""
    mots = []
    for raw in (prompt or '').split():
        if _strip_accents(raw.strip(".,;:!?\"'()").lower()) not in _COLOR_LEXICON:
            mots.append(raw)
    return mots


def recolor_tile_route(color_spec, prompt, recolor_all):
    """True quand la demande passe par le re-rendu ControlNet-Tile plutot que par le virage HSV : aucune couleur connue (matiere),
    OU toute l'image avec des mots descriptifs en plus d'une couleur (« military green camo »). Une couleur SEULE (« vert »)
    garde le virage rapide. (Correctif du 2026-09-30 : l'ancienne condition testait le « nom » de parse_recolor_prompt, qui retombe sur
    le texte entier quand il ne reste aucun autre mot — « green » partait donc en re-rendu, contre l'intention du commit 45a1e2e7.)"""
    return color_spec is None or bool(recolor_all and recolor_mots_descriptifs(prompt))


def recolor_tile_params(noun, full_prompt, recolor_all=False, strength=1.0):
    """Reglages du re-rendu : { denoise, cn, steps, guidance, prompt, negative }.

    Toute l'image (style) : vrai re-rendu img2img (denoise 0,57 a 0,85 selon le curseur Strength, ControlNet a 0,45 pour que les
    couleurs changent tout en tenant la forme, prompt oriente COHERENCE). Une partie : reglage prudent (denoise 0,18) pour
    preserver la zone detectee."""
    s = max(0.2, min(1.0, float(strength)))
    if recolor_all:
        return {
            'denoise': 0.5 + s * 0.35, 'cn': 0.45, 'steps': 30, 'guidance': 6.5,
            'prompt': (f"the whole subject repainted in a {full_prompt} colour scheme, "
                       f"cohesive realistic {full_prompt} palette applied consistently to every surface, "
                       f"natural studio lighting and soft shadows preserved, each material keeps its own "
                       f"surface qualities (metal stays metallic, glass stays glass), same exact shape and "
                       f"structure, photorealistic, highly detailed"),
            'negative': ("flat uniform tint, single flat colour smear, washed out, monochrome, posterised, "
                         "unrealistic colours, oversaturated, deformed, distorted, blurry, low quality, "
                         "changed shape, extra parts"),
        }
    return {
        'denoise': 0.18, 'cn': 0.65, 'steps': 20, 'guidance': 5.5,
        'prompt': f"{full_prompt}, same shape, preserve folds and details, photorealistic",
        'negative': "deformed, distorted, blurry, low quality, changed shape, extra parts",
    }


# DETECTION ET RECOLLAGE (2026-09-30, banc modal_app/test_recolor_matiere.py) : communs au bureau et a Modal.
def recolor_variantes_cible(nom):
    """Formulations essayees tour a tour pour trouver la partie (CLIPSeg rate souvent les petites parties repetees, « windows ») :
    telle quelle, singulier / pluriel, « the X », « X area ». Reprise telle quelle du bureau, que Modal n'avait pas (une seule
    formulation : une partie trouvee sur le PC pouvait etre « introuvable » sur le site)."""
    base = (nom or '').strip()
    if not base:
        return []
    autre = base[:-1] if (base.lower().endswith('s') and len(base) > 3) else base + 's'
    vues = []
    for v in (base, autre, 'the ' + base, base + ' area'):
        if v not in vues:
            vues.append(v)
    return vues


def recolor_meilleur_masque(nom, masquer, assez=2.0):
    """Masque le plus couvrant parmi `recolor_variantes_cible(nom)`, arret des qu'une formulation couvre `assez` % de l'image.
    `masquer(texte)` rend un masque PIL « L » a la taille de travail. Retourne (masque ou None, couverture en %)."""
    meilleur, couverture = None, 0.0
    for v in recolor_variantes_cible(nom):
        m = masquer(v)
        c = float((np.asarray(m) > 128).mean() * 100.0)
        if meilleur is None or c > couverture:
            meilleur, couverture = m, c
        if couverture >= assez:
            break
    return meilleur, couverture


def recolor_masque_a_taille(masque, taille):
    """Masque de la taille de travail (<= 1024 px) ramene a la taille d'ORIGINE de l'image (bilineaire : pas de rebond hors
    du masque, le zero reste zero)."""
    taille = tuple(taille)
    return masque if masque.size == taille else masque.resize(taille, Image.BILINEAR)


def recolor_recoller(original, rendu, masque):
    """Recolle un re-rendu (taille de travail) sur l'image d'ORIGINE a travers le masque : hors du masque, les pixels d'origine
    au pixel pres. Avant le 2026-09-30, TOUTE l'image faisait l'aller-retour taille de travail -> taille d'origine et sortait
    adoucie des qu'elle n'etait pas deja a cette taille (image agrandie, importee, cote non multiple de 8). Le virage de teinte,
    lui, se fait directement a la taille d'origine : recolor_hsv_masked(original, recolor_masque_a_taille(masque, ...))."""
    base = original.convert('RGB')
    if rendu.size != base.size:
        rendu = rendu.resize(base.size, Image.LANCZOS)
    m = (np.asarray(recolor_masque_a_taille(masque, base.size)).astype(np.float32) / 255.0)[..., None]
    sortie = np.asarray(base).astype(np.float32) * (1 - m) + np.asarray(rendu.convert('RGB')).astype(np.float32) * m
    return Image.fromarray(sortie.clip(0, 255).astype(np.uint8), 'RGB')


def recolor_masque_fond(img):
    """Fond de STUDIO d'un asset : zone LISSE reliee aux bords de l'image (blanc, gris, BEIGE, degrade et ombre douce compris).
    Masque doux 0..1 (H x W), ou None si l'image n'a pas un tel fond (scene, fond sombre) ou si scipy manque (rien n'est alors
    protege, comme avant).

    2026-10-02 (rapport d'essais du 01/10 : « One part » deborde, halo rose autour du chevalier) : l'ancienne regle ne reconnaissait
    que les fonds NEUTRES clairs (moyenne > 150 et ecart de couleur < 15). Le fond beige du chevalier (ecart ~26) n'etait donc pas
    protege et la teinte coloriait tout autour de la partie. Un fond de studio se reconnait mieux a sa LISSEUR (gradient de luminance
    quasi nul, degrade doux compris) qu'a sa couleur : on garde les pixels lisses, proches de la mediane du pourtour, relies aux bords.
    Les reflets d'acier ou un aplat de l'objet ne sont pas absorbes : ils sont separes du fond par le contour du sujet (fort gradient).
    Mesure sur 5 images reelles : fond du chevalier 77 % (l'ancienne regle : aucun), les autres equivalentes ou meilleures, 0-6 % du
    sujet central classe en fond. L'ancienne regle reste en repli quand la zone lisse couvre moins de 15 % de l'image (image bruitee)."""
    try:
        from scipy import ndimage
    except Exception:
        return None
    a = np.asarray(img.convert('RGB'), dtype=np.float32)
    fond = None
    lum = ndimage.gaussian_filter(a.mean(axis=2), 1.5)
    gy, gx = np.gradient(lum)
    grad = ndimage.uniform_filter(np.hypot(gx, gy), 3) * (max(a.shape[:2]) / 1024.0)     # niveaux par pixel a 1024 px : independant de la taille
    bord = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    med = np.median(bord, axis=0)
    lisse = (grad < 1.6) & (np.abs(a - med).max(axis=2) < 70)
    lab, n = ndimage.label(lisse)
    if n:
        bords = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        f = np.isin(lab, bords[bords > 0])
        if f.mean() >= 0.15:
            # Petites poches NON lisses cernees par le fond (grain du papier, bruit) : le fond aussi. Le sujet, lui, est UNE grande zone
            # (seuil 0,2 % de l'image) : il n'est jamais comble. Sans cela, des taches de teinte restaient dans le cadre autour de la partie.
            reste, nr = ndimage.label(~f)
            if nr:
                tailles = np.bincount(reste.ravel())
                petites = np.zeros(nr + 1, dtype=bool)
                petites[1:] = tailles[1:] < 0.002 * f.size
                f = f | petites[reste]
            fond = f
    if fond is None:                            # repli : ancienne regle (fond neutre clair relie aux bords)
        neutre = (a.mean(axis=2) > 150) & ((a.max(axis=2) - a.min(axis=2)) < 15)
        lab, n = ndimage.label(neutre)
        if not n:
            return None
        bords = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        fond = np.isin(lab, bords[bords > 0])
        if fond.mean() < 0.15:                  # pas un fond d'asset
            return None
    fond = ndimage.binary_erosion(fond, iterations=2)
    return ndimage.gaussian_filter(fond.astype(np.float32), 1.5)


def recolor_garder_fond(source, sortie):
    """« One part » : le fond de studio reste celui de la source. La marge de detection (15 px par defaut) et le plancher
    de saturation du virage coloraient le blanc AUTOUR de la partie : bloc rose de 110 niveaux autour d'un casque « red »
    (banc modal_app/test_recolor_matiere.py, 2026-09-30). La variante de texture a deja cette protection (_garder_fond)."""
    m = recolor_masque_fond(source)
    if m is None:
        return sortie
    m = m[..., None]
    a = np.asarray(source.convert('RGB'), dtype=np.float32)
    o = np.asarray(sortie.convert('RGB'), dtype=np.float32)
    return Image.fromarray(np.clip(o * (1 - m) + a * m, 0, 255).astype(np.uint8), 'RGB')
# --- NOYAU PARTAGE : FIN ---

# ---------------------------------------------------------------------------
# Glu MODAL.
# ---------------------------------------------------------------------------
from PIL import ImageFilter


def _masque_clipseg(seg_processor, seg_model, img_work, w, h, texte, dilate, rel=0.5):
    """CLIPSeg -> masque doux. Meme recette que sdxl_server._clipseg_mask :
    seuil RELATIF au pic de reponse, plancher 50, dilatation puis flou."""
    import torch
    entrees = seg_processor(text=[texte.strip()], images=[img_work],
                            padding=True, return_tensors='pt')
    entrees = {k: v.to('cuda') for k, v in entrees.items()}
    with torch.no_grad():
        sortie = seg_model(**entrees)
    logits = sortie.logits.squeeze().detach().cpu().numpy()
    proba = 1.0 / (1.0 + np.exp(-logits))
    arr = np.asarray(Image.fromarray((proba * 255).astype(np.uint8))
                     .resize((w, h), Image.LANCZOS)).astype(np.float32)
    seuil = max(50.0, float(arr.max()) * float(rel))
    m = Image.fromarray((arr > seuil).astype(np.uint8) * 255, mode='L')
    d = max(0, int(dilate))
    if d > 0:
        m = m.filter(ImageFilter.MaxFilter(d * 2 + 1))
    return m.filter(ImageFilter.GaussianBlur(3))


def _image_de_travail(img, max_dim=1024):
    """Meme reduction que resize_for_sdxl du bureau : grand cote a max_dim, cotes multiples de 8. Rend (image, w, h)."""
    ow, oh = img.size
    if max(ow, oh) > max_dim:
        if ow > oh:
            w, h = max_dim, int(oh * max_dim / ow)
        else:
            h, w = max_dim, int(ow * max_dim / oh)
    else:
        w, h = ow, oh
    w = max(8, (w // 8) * 8); h = max(8, (h // 8) * 8)
    return img.resize((w, h), Image.LANCZOS), w, h


def generate(seg_processor, seg_model, source_img, prompt,
             strength=1.0, dilate=15, rel=0.5, recolor_all=False,
             max_dim=1024):
    """Recolorie la partie nommee. Retourne (image, couverture_pourcent).

    Comme le bureau (sdxl_server.do_recolor) : detection par plusieurs formulations (recolor_meilleur_masque), puis virage de
    teinte A LA TAILLE D'ORIGINE : hors du masque, l'image reste identique au pixel pres ; une partie ne colore plus le fond
    de studio autour d'elle (recolor_garder_fond) (2026-09-30).

    Leve ValueError si le prompt ne nomme aucune couleur connue (l'op `recolor` de app.py aiguille alors la demande vers
    `generate_tile` AVANT d'arriver ici : ce garde ne sert que de filet) ou si la partie est introuvable (422, rembourse).
    """
    noun, color_spec = parse_recolor_prompt(prompt)
    if color_spec is None:
        raise ValueError("'%s' names no known colour." % prompt)

    img = source_img.convert('RGB')
    if recolor_all:
        masque = Image.new('L', img.size, 255)
        couverture = 100.0
    else:
        travail, w, h = _image_de_travail(img, max_dim)
        masque, couverture = recolor_meilleur_masque(
            noun or prompt,
            lambda texte: _masque_clipseg(seg_processor, seg_model, travail, w, h, texte, dilate, rel))
        if masque is None or couverture < 0.2:
            raise ValueError("'%s' not found on the image. Try a broader or simpler word." % (noun or prompt))

    sortie = recolor_hsv_masked(img, recolor_masque_a_taille(masque, img.size), color_spec, strength)
    return (sortie if recolor_all else recolor_garder_fond(img, sortie)), couverture


def generate_tile(seg_processor, seg_model, tile_pipe, source_img, prompt,
                  strength=1.0, dilate=15, rel=0.5, recolor_all=False,
                  max_dim=1024):
    """Matiere ou style (« cuir vieilli », « rusty metal », « sunset gradient ») : re-rendu ControlNet-Tile
    masque par CLIPSeg. Retourne (image, couverture_pourcent).

    Portage de scripts/sdxl_server.do_recolor_tile (decision du user, 2026-09-30 : « B — meme capacite que le PC »).
    Memes reglages que le bureau : ils viennent du noyau partage (`recolor_tile_params`). `tile_pipe` est le pipe ControlNet-Tile
    deja utilise par `tex_variant` (self._get_tile_pipe()). Le re-rendu est recolle sur l'image d'ORIGINE (recolor_recoller) :
    hors du masque, pixels d'origine. Leve ValueError si la partie nommee est introuvable."""
    import torch
    noun, _spec = parse_recolor_prompt(prompt)
    img = source_img.convert('RGB')
    travail, w, h = _image_de_travail(img, max_dim)

    if recolor_all:
        masque = Image.new('L', (w, h), 255)
        couverture = 100.0
    else:
        masque = _masque_clipseg(seg_processor, seg_model, travail, w, h, noun or prompt, dilate, rel)
        couverture = float((np.asarray(masque) > 128).mean() * 100.0)
        if couverture < 0.2:
            raise ValueError("'%s' not found on the image (coverage %.1f %%)." % (noun or prompt, couverture))

    p = recolor_tile_params(noun, prompt, recolor_all, strength)
    with torch.inference_mode():
        resultat = tile_pipe(
            prompt=p['prompt'], negative_prompt=p['negative'],
            image=travail, control_image=travail,
            strength=p['denoise'], num_inference_steps=p['steps'],
            guidance_scale=p['guidance'], controlnet_conditioning_scale=p['cn'],
            generator=torch.Generator('cuda').manual_seed(42),
        ).images[0]
    sortie = recolor_recoller(img, resultat, masque)
    return (sortie if recolor_all else recolor_garder_fond(img, sortie)), couverture
