"""Tests du banc de fidelite de forme (formes synthetiques dont on connait la reponse). Sans pytest : `python test_fidelite.py` ; avec : `pytest test_fidelite.py`.
Python de l'application : C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/python/python.exe. CPU seulement, quelques secondes, rien n'est ecrit hors du dossier temporaire."""
import os
import sys
import tempfile

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rendre_silhouette as RS      # noqa: E402
import masque_reference as MR       # noqa: E402
import iou_silhouette as IS         # noqa: E402


# ------------------------------------------------------------------ formes de test
def boite(cx, cy, cz, lx, ly, lz):
    """(V, F) d'un parallelepipede centre en (cx,cy,cz), cotes (lx,ly,lz) : 8 sommets, 12 triangles."""
    s = np.array([[x, y, z] for x in (-.5, .5) for y in (-.5, .5) for z in (-.5, .5)], float) * [lx, ly, lz] + [cx, cy, cz]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    F = []
    for a, b, c, d in quads:
        F += [(a, b, c), (a, c, d)]
    return s, np.array(F, np.int32)


def fusion(*parties):
    V, F, d = [], [], 0
    for v, f in parties:
        V.append(v)
        F.append(f + d)
        d += len(v)
    return np.concatenate(V), np.concatenate(F)


def sphere(r=0.5, sous=3):
    import trimesh
    m = trimesh.creation.icosphere(subdivisions=sous, radius=r)
    return np.asarray(m.vertices, float), np.asarray(m.faces, np.int32)


def humanoide(avec_bras=True, avec_epee=True):
    """Corps (0,0)..(1 x 1,8), tete, jambes ; deux bras fins tendus en T et, option, une epee fine verticale au bout du bras gauche."""
    p = [boite(0, 0.0, 0, 0.5, 0.8, 0.3),              # torse
         boite(0, 0.55, 0, 0.25, 0.25, 0.25),          # tete
         boite(-0.12, -0.7, 0, 0.18, 0.6, 0.2),        # jambe g
         boite(0.12, -0.7, 0, 0.18, 0.6, 0.2)]         # jambe d
    if avec_bras:
        p += [boite(-0.65, 0.3, 0, 0.8, 0.05, 0.05), boite(0.65, 0.3, 0, 0.8, 0.05, 0.05)]
    if avec_epee:
        p += [boite(-1.05, 0.55, 0, 0.03, 0.6, 0.03)]  # epee tenue au bout du bras gauche
    return fusion(*p)


def tourner_lacet(V, deg):
    """Applique a V la rotation que `orienter(..., yaw=deg)` applique : orienter(tourner_lacet(V, d), yaw=-d) restitue V."""
    return RS.orienter(V, '+y', deg)


def masque(V, F, taille=512, **kw):
    return RS.rendre_masque(V, F, taille, **kw)[0]


# ------------------------------------------------------------------ tests : rendu
def test_cube_silhouette_plein_cadre():
    V, F = boite(0, 0, 0, 1, 1, 1)
    m = masque(V, F, 400, marge=0.05)
    # carre de 90 % du cote
    assert abs(m.mean() - 0.81) < 0.02, m.mean()
    ys, xs = np.where(m)
    assert abs((xs.min() + xs.max()) / 2 - 200) < 2 and abs((ys.min() + ys.max()) / 2 - 200) < 2


def test_sphere_est_un_disque():
    V, F = sphere()
    m = masque(V, F, 512, marge=0.05)
    attendu = np.zeros((512, 512), np.uint8)
    cv2.circle(attendu, (256, 256), int(round(512 * 0.45)), 1, -1)
    iou = (m & (attendu > 0)).sum() / (m | (attendu > 0)).sum()
    assert iou > 0.97, iou


def test_triangles_plus_petits_que_le_pixel_ne_trouent_pas():
    """Maillage dense (200 K faces sur un petit disque) : la silhouette est pleine, pas 'poivre et sel'."""
    V, F = sphere(0.5, 6)           # ~82 K faces
    m = masque(V, F, 256, marge=0.05)
    attendu = np.zeros((256, 256), np.uint8)
    cv2.circle(attendu, (128, 128), int(round(256 * 0.45)), 1, -1)
    assert (m & (attendu > 0)).sum() / (attendu > 0).sum() > 0.98


def test_plan_mince_vu_par_la_tranche_ne_gonfle_pas_la_boite():
    """Cas reel de l'orc : une dalle de sol de 2 mm d'epaisseur sous un sujet ne doit pas changer l'echelle."""
    V0, F0 = boite(0, 0, 0, 0.5, 1.0, 0.5)
    Vs, Fs = boite(0, -0.5, 0, 3.0, 0.002, 3.0)
    V, F = fusion((V0, F0), (Vs, Fs))
    m = masque(V, F, 512, marge=0.05)
    ys, xs = np.where(m)
    assert xs.max() - xs.min() < 0.6 * 512, 'la dalle a etire la boite englobante'


def test_orientation_axes():
    V, F = humanoide()
    for haut in RS.AXES_HAUT:
        W = _mettre_haut(V, haut)
        m = masque(W, F, 256, haut=haut)
        m0 = masque(V, F, 256)
        assert (m == m0).mean() > 0.999, haut


def _mettre_haut(V, haut):
    """Inverse de orienter(.., haut) : cree un modele dont l'axe du haut est `haut` et qui, une fois oriente, redonne V."""
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    inv = {'+y': (x, y, z), '-y': (-x, -y, z), '+z': (x, -z, y), '-z': (x, z, -y), '+x': (y, -x, z), '-x': (-y, x, z)}
    a, b, c = inv[haut]
    W = np.stack([a, b, c], axis=1)
    assert np.allclose(RS.orienter(W, haut, 0), V), haut
    return W


def test_lacet_connu_retrouve():
    V, F = humanoide()
    ref = masque(V, F, 512)
    for d in (0, 90, 180, 270):
        W = tourner_lacet(V, -d)          # modele pivote de -d : il faut le lacet +d pour le remettre de face
        r = RS.chercher_orientation(W, F, ref, ('+y',), RS.LACETS, 384)
        # le lacet 90/270 d'un modele plat (profondeur 0,3) donne une silhouette tres differente : l'optimum est unique
        assert r['meilleur']['yaw'] == d, (d, r['meilleur'], [c['iou'] for c in r['candidats'] if not c['miroir']])
        assert r['meilleur']['iou'] > 0.9      # (bras de 3 % de la hauteur : l'ecart restant est le reechantillonnage 512 -> 384)


def test_axe_du_haut_retrouve():
    V, F = humanoide()
    ref = masque(V, F, 512)
    W = _mettre_haut(V, '+z')
    r = RS.chercher_orientation(W, F, ref, RS.AXES_HAUT, (0, 180), 384)
    assert r['meilleur']['haut'] == '+z' and r['meilleur']['iou'] > 0.9, r['meilleur']


def test_pose_libre_retrouve_lacet_et_tangage():
    V, F = humanoide()
    for az, pi in ((37.0, 0.0), (150.0, 15.0)):
        ref = RS.rendre_masque(V, F, 512, '+y', az, False, None, pitch=pi)[0]
        r = RS.chercher_pose(V, F, ref, hauts=('+y',))
        assert r['iou'] > 0.93, (az, pi, r)
        d = abs(((r['yaw'] - az + 180) % 360) - 180)
        assert d < 8 and abs(r['pitch'] - pi) < 8, (az, pi, r)


def test_pose_libre_trouve_la_vue_de_dessus():
    """Reference = vue DE DESSUS du modele (cas de l'insecte) : la pose libre le voit, la face stricte non."""
    V, F = humanoide()
    dessus = RS.rendre_masque(V, F, 512, '+y', 0, False, None, pitch=90)[0]
    face = RS.chercher_orientation(V, F, dessus, ('+y',), (0, 180), 384)['meilleur']['iou']
    libre = RS.chercher_pose(V, F, dessus)['iou']
    assert libre > 0.93 and face < 0.5, (libre, face)


def test_miroir_diagnostique_pas_choisi_a_tort():
    """Une reference MIROIR du modele : l'orientation retenue est physique (lacet 180), le miroir est seulement rapporte."""
    V, F = humanoide()
    ref = masque(V, F, 512)[:, ::-1]
    r = RS.chercher_orientation(V, F, ref, ('+y',), (0, 180), 384)
    assert r['meilleur']['yaw'] == 180 and not r['meilleur']['miroir']
    assert r['miroir_diagnostic']['iou'] > 0.9


# ------------------------------------------------------------------ tests : metriques
def _comparer(a, b, **kw):
    return IS.comparer(a, b, avec_recalage=kw.pop('avec_recalage', False), **kw)


def test_identique_vaut_un():
    V, F = humanoide()
    m = masque(V, F, 512)
    r = _comparer(m, m)
    assert r['iou'] == 1.0 and r['dice'] == 1.0 and r['f_contour'] == 1.0
    assert r['hausdorff_moyen'] == 0.0 and r['manquant_pct'] == 0 and r['en_trop_pct'] == 0
    assert r['score'] > 99.9, r['score']
    assert r['parties_fines']['nb_fines_perdues'] == 0


def test_disjoints_score_bas():
    a = np.zeros((300, 300), bool)
    b = np.zeros((300, 300), bool)
    a[20:120, 20:60] = True
    b[200:290, 220:290] = True
    r = _comparer(a, b)
    # apres normalisation de boite, deux rectangles de formes differentes se recouvrent un peu : IoU bien en dessous de 0,6
    assert r['iou'] < 0.7 and r['score'] < 70


def test_sujet_decale_et_mis_a_l_echelle_est_neutre():
    V, F = humanoide()
    ref = masque(V, F, 600)
    petit = cv2.resize(ref.astype(np.uint8), (240, 240), interpolation=cv2.INTER_AREA) > 0
    deca = np.zeros((900, 700), bool)
    deca[300:540, 400:640] = petit                # decale, autre taille de canevas, autre echelle
    r = _comparer(ref, deca)
    assert r['iou'] > 0.93, r['iou']              # reste le bruit de reechantillonnage de la forme fine


def test_cube_contre_sphere_connu():
    """Carre inscrit dans un disque de meme boite : IoU = 1 / (pi/4) -> carre/disque = (L^2)/(pi L^2/4) = 4/pi. Boites normalisees identiques :
    le disque de diametre L contient le carre de cote L ? Non : carre de cote L CONTIENT le disque de diametre L, donc IoU = pi/4 = 0,785."""
    Vc, Fc = boite(0, 0, 0, 1, 1, 1)
    Vs, Fs = sphere()
    r = _comparer(masque(Vc, Fc, 800), masque(Vs, Fs, 800))
    assert abs(r['iou'] - np.pi / 4) < 0.02, r['iou']
    assert abs(r['en_trop_pct']) < 1.0                                  # le disque est dans le carre : rien en trop dans le 3D
    assert abs(r['manquant_pct'] - 100 * (1 - np.pi / 4)) < 2.0       # reference = carre : 21,5 % de son aire n'est pas couverte


def test_regions_localisent_l_erreur():
    ref = np.zeros((512, 512), bool)
    ref[40:470, 150:360] = True
    ref[100:130, 20:150] = True            # bras gauche (a gauche, en haut)
    ref[100:130, 360:492] = True           # bras droit
    ref[469:472, 100:103] = True           # reperes de coin : gardent la meme boite englobante dans les deux masques (la boite est normalisee)
    ref[40:43, 20:23] = True
    ref[469:472, 489:492] = True
    sil = ref.copy()
    sil[95:135, 360:495] = False           # le bras droit disparait
    r = _comparer(ref, sil)
    reg = {c['zone']: c for c in r['regions']}
    assert reg['haut-droit']['manquant_pct'] > 2.0
    assert reg['haut-gauche']['manquant_pct'] < 0.5 and reg['bas-centre']['manquant_pct'] < 0.5


def test_perte_d_une_partie_fine_detectee():
    V, F = humanoide(avec_bras=True, avec_epee=True)
    Vs, Fs = humanoide(avec_bras=True, avec_epee=False)       # le 3D a perdu l'epee
    ref = masque(V, F, 768)
    sil = masque(Vs, Fs, 768)
    # on garde le MEME cadre : l'epee depasse a gauche, donc les boites different -> on compare via comparer (boites normalisees chacune)
    r = _comparer(ref, sil)
    pf = r['parties_fines']
    assert pf['nb_fines_perdues'] >= 1, pf
    assert any(p['perdue'] and p['aire_pct_ref'] > 0.5 for p in pf['fines'])
    # a l'inverse, un 3D complet ne perd rien
    ok = _comparer(ref, ref)
    assert ok['parties_fines']['nb_fines_perdues'] == 0


def test_bras_perdus_detectes_et_score_baisse():
    V, F = humanoide(True, False)
    Vn, Fn = humanoide(False, False)
    ref, sil = masque(V, F, 768), masque(Vn, Fn, 768)
    r = _comparer(ref, ref)
    r2 = _comparer(ref, sil)
    assert r2['score'] < r['score'] - 25, (r['score'], r2['score'])
    assert r2['parties_fines']['nb_fines_perdues'] >= 2          # les deux bras
    assert r2['aspect_rapport'] < 0.8                              # le 3D est nettement plus etroit


def test_corps_epais_manquant_est_une_composante_perdue():
    ref = np.zeros((512, 512), bool)
    ref[50:450, 100:200] = True
    ref[300:450, 330:450] = True           # un deuxieme objet, epais (pas une partie fine)
    ref[60:63, 470:473] = True             # repere : meme boite englobante dans les deux masques
    sil = ref.copy()
    sil[290:460, 320:460] = False
    r = _comparer(ref, sil)
    assert len(r['parties_fines']['composantes_perdues']) == 1


def test_recalage_retrouve_un_decalage():
    V, F = humanoide()
    m = masque(V, F, 384)
    dec = np.roll(np.roll(m, 12, axis=1), -8, axis=0)
    iou, p = IS.recaler(m, dec, S=192)
    assert iou > 0.95, iou
    assert abs(p['dx_pct'] + 12 / 384 * 100) < 1.5 and abs(p['dy_pct'] - 8 / 384 * 100) < 1.5


# ------------------------------------------------------------------ tests : masque de reference
def test_masque_fond_uni():
    img = np.full((300, 300, 3), 245, np.uint8)
    cv2.circle(img, (150, 150), 80, (200, 30, 30), -1)
    cv2.circle(img, (150, 150), 20, (245, 245, 245), -1)        # trou blanc a l'interieur : doit rester dans le sujet
    r = MR.masque_reference(img, 'auto')
    assert r['methode'] == 'fond'
    attendu = np.zeros((300, 300), bool)
    cv2.circle(attendu.view(np.uint8), (150, 150), 80, 1, -1)
    assert (r['masque'] & attendu).sum() / (r['masque'] | attendu).sum() > 0.97
    assert r['masque'][150, 150], 'le blanc interne ne doit pas etre pris pour du fond'
    assert r['coupe_bords'] == 0.0


def test_masque_alpha():
    rgba = np.zeros((200, 200, 4), np.uint8)
    rgba[..., :3] = 90
    rgba[50:150, 60:140, 3] = 255
    r = MR.masque_reference(rgba, 'auto')
    assert r['methode'] == 'alpha' and abs(r['masque'].sum() - 8000) < 5


def test_masque_fond_degrade():
    h = w = 320
    yy, xx = np.mgrid[0:h, 0:w]
    fond = (70 + 40 * xx / w + 25 * yy / h)[..., None] * np.ones(3)          # degrade lisse 70..135
    img = fond.astype(np.uint8)
    cv2.rectangle(img, (110, 40), (210, 290), (170, 90, 60), -1)
    cv2.rectangle(img, (40, 90), (280, 120), (170, 90, 60), -1)          # bras
    r = MR.masque_reference(img, 'auto')
    assert r['methode'] in ('degrade', 'u2net'), r['methode']
    if r['methode'] == 'degrade':
        attendu = np.zeros((h, w), np.uint8)
        cv2.rectangle(attendu, (110, 40), (210, 290), 1, -1)
        cv2.rectangle(attendu, (40, 90), (280, 120), 1, -1)
        a = attendu > 0
        assert (r['masque'] & a).sum() / (r['masque'] | a).sum() > 0.93


def test_sujet_coupe_par_le_cadre_signale():
    img = np.full((200, 200, 3), 240, np.uint8)
    img[0:120, 80:120] = (30, 30, 30)       # sujet qui sort par le haut
    r = MR.masque_reference(img, 'fond')
    assert r['coupe_bords'] > 0.04      # 40 colonnes du bord haut sur un perimetre de 800 cases


def test_chaine_complete_glb_fichier():
    """evaluer() sur un vrai fichier GLB et une image synthetique : le meme sujet rend un score eleve, un sujet amputé un score plus bas."""
    import trimesh
    V, F = humanoide(True, True)
    tmp = tempfile.mkdtemp()
    glb = os.path.join(tmp, 'h.glb')
    trimesh.Trimesh(V, F, process=False).export(glb)
    ref = masque(V, F, 512)
    img = np.full((512, 512, 3), 250, np.uint8)
    img[ref] = (60, 120, 200)
    png = os.path.join(tmp, 'ref.png')
    cv2.imwrite(png, cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    r = IS.evaluer(png, glb, '+y', 'auto', 'auto', panneau_png=os.path.join(tmp, 'p.png'), aussi_u2net=False)
    assert r['score'] > 93 and r['orientation']['yaw'] == 0 and r['masque_reference']['methode'] == 'fond', (r['score'], r['orientation'])
    assert os.path.isfile(os.path.join(tmp, 'p.png'))
    Vn, Fn = humanoide(False, False)
    glb2 = os.path.join(tmp, 'n.glb')
    trimesh.Trimesh(Vn, Fn, process=False).export(glb2)
    r2 = IS.evaluer(png, glb2, '+y', 'auto', 'auto', aussi_u2net=False)
    assert r2['score'] < r['score'] - 20


# ------------------------------------------------------------------ lanceur
def main():
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith('test_') and callable(f)]
    echecs = 0
    for n, f in tests:
        try:
            f()
            print('OK    ', n)
        except Exception as e:   # noqa: BLE001
            import traceback
            echecs += 1
            tb = traceback.extract_tb(sys.exc_info()[2])[-1]
            print('ECHEC ', n, '->', type(e).__name__, e, '(ligne %d : %s)' % (tb.lineno, tb.line))
    print('%d tests, %d echecs' % (len(tests), echecs))
    return 1 if echecs else 0


if __name__ == '__main__':
    sys.exit(main())
