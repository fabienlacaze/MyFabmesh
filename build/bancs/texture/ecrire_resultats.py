"""Assemble docs/campagnes/resultats_texture_essais.jsonl (une ligne par essai du plan texture du 03/10/2026) a partir des JSON de C:/tmp/texture_essais. Aucune valeur n'est ecrite a la main sauf les statuts et criteres."""
import json, glob, os, collections
T = 'C:/tmp/texture_essais'
OUT = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/docs/campagnes/resultats_texture_essais.jsonl'
L = []


def ligne(n, nom, statut, mesures, critere, atteint, conclusion, duree_s=None, vram_mo=None, **kw):
    d = {'numero_plan': n, 'nom': nom, 'statut': statut, 'mesures': mesures, 'critere_de_succes': critere, 'critere_atteint': atteint, 'conclusion': conclusion, 'duree_s': duree_s, 'vram_mo': vram_mo}
    d.update(kw); L.append(d)


def lire(f):
    return json.load(open(f, encoding='utf-8')) if os.path.exists(f) else None


# ---- 1
e1 = lire(T + '/essai1.json')
ligne(1, 'Recensement de la realite servie', 'realise_partiel', {
    'glb_r2': e1['glb_r2'], 'atlas_tous_glb_r2': e1['atlas_tous_glb'], 'part_atlas_1024_tous_glb_pct': round(100 * e1['atlas_tous_glb']['1024'] / e1['glb_r2'], 1),
    'jobs_mesh_reussis_standard': e1['jobs_mesh_reussis'], 'comptes_distincts': 4,
    'toutes_generations': e1['toutes'], 'depuis_2026-09-27': e1['depuis_2026-09-27 (paliers cote serveur)'], 'avant_2026-09-27': e1['avant_2026-09-27'],
    'part_fast_pct_toutes': e1['part_fast_toutes_pct'], 'part_fast_pct_depuis_09_27': e1['part_fast_depuis_09_27_pct'],
    'journaux_modal': {'fenetre_disponible': 'depuis le dernier deploiement (2026-10-02 17:55, ~1,5 jour, 5417 lignes) : les 14 jours demandes ne sont pas conserves pour l application deployee',
                       'generations_vues_(inference dt=)': 48, 'modes': {'1024': 42, '1024_cascade': 3, '1536_cascade': 3}, 'lignes_resolution_is_reduced': 0,
                       'limite': '--tail est plafonne a 20000 et s applique avant --search ; aucun rabattement observe sur 6 generations en cascade : taux de rabattement NON etabli'}},
    'repartition chiffree sur au moins 100 generations reelles ; priorite atlas Fast / plafond de jetons si plus de 30 % des atlas a 1024 ou plus de 20 % des Ultra rabattus',
    None, 'Repartition obtenue (197 generations standard, 193 GLB lisibles) MAIS seulement 4 comptes (proprietaire et essais) : pas du trafic client. Atlas a 1024 : 29,5 % des generations (sous 30 %), 36,9 % des 244 GLB (outils et essais compris), 20,5 % depuis les paliers serveur du 27/09 ; Fast = 25,4 % des generations. Seuil 30 % non franchi sur les generations ; taux de rabattement de grille NON ETABLI (journaux Modal trop courts). Decision de priorite : indeterminee.')

# ---- 2
e2 = lire(T + '/essai2/synthese_essai2.json')
ligne(2, 'Banc de fidelite a l image source', 'realise_partiel', {
    'sujets': 6, 'metriques': 'dE2000 median/p90, PSNR basse frequence (sigma 8), ratio de laplacien, ratio HF, correlation de structure, correlation HF, DINOv2-large patchs/CLS (hors ligne), surcontraste',
    'origine_mieux_classee_que_atlas1024_sur_6': e2['origine_mieux_classee_que_atlas1024'], 'ordre_origine_2048_1024_sur_3': e2['ordre_origine_2048_1024_respecte_(sujets_a_atlas>2048)'],
    'repetabilite_dE_median_avant_polissage': e2['repetabilite_dE_median_avant_polissage'], 'repetabilite_dE_median_apres_polissage': e2['repetabilite_dE_median_apres_polissage'],
    'sujets_repetabilite_inf_0_5_dE_apres_polissage': e2['sujets_repetabilite_inf_0_5_apres'], 'accord_avec_l_oeil_du_proprietaire': 'NON TESTABLE (proprietaire absent) ; 6 montages a l aveugle (cote tire au hasard, cle dans les JSON) prepares sous C:/tmp/texture_essais/essai2/aveugle_*.png ; relecture de l examinateur sur le bus : la version degradee est nettement plus floue'},
    'au moins 5 paires sur 6 classees comme l oeil ET ecart de repetabilite < 0,5 dE ; sinon corriger la metrique avant tout usage', False,
    'NON VALIDE. (a) Oeil du proprietaire non consulte. (b) Contre la degradation connue (atlas 1024) seules les metriques de nettete classent 6/6 (ratio de laplacien, ratio HF) ; dE2000 median (3/6), DINOv2 patchs (3/6) et PSNR basse frequence (5/6) ne voient PAS le flou : un dE plus bas peut accompagner une texture plus floue. (c) Repetabilite de la camera : 5 sujets sur 6 sous 0,5 dE apres polissage, le bus reste a 1,3 dE (la seconde recherche de pose tombe dans un optimum moins bon). Consequence : les essais suivants sont EXPLORATOIRES, en comparaisons appariees (meme camera pour toutes les conditions).')

# ---- 3 / 4
s34 = lire(T + '/synthese_essai3_4.json')
e3 = s34['essai3']
ligne(3, 'Projection de la photo : validation non circulaire (fenetre cachee)', 'realise', {
    'fenetre_cachee': '50 % x 50 % de la boite du sujet (31 a 62 % du masque), exclue du recalage, du flot et du report', 'atlas_de_travail': 'plafonne a 4096',
    'conditions': {k: v for k, v in e3.items() if k != 'regle_auto'}, 'regle_auto': e3['regle_auto'],
    'projection_circulaire_dE_zone_(essai4)': {s: {k: v['dE_zone_circulaire'] for k, v in c.items()} for s, c in s34['essai4'].items()}},
    'dE pixel au moins 15 % plus bas dans la fenetre cachee sur 5 sujets sur 6, couture au plus base + 1, zones non touchees inchangees (Wasserstein < 3 niveaux), voiture et portail refuses par la regle Auto', False,
    'RESULTAT NEGATIF sur le critere tel qu ecrit : 0 sujet sur 6 a -15 % (variations de -2,4 % a +4,3 %, conditions B et C) ; la couture a mip0 depasse base + 1 sur 5 sujets sur 6 ; les zones non touchees changent de 2 a 18 niveaux (courbe de tons globale) ; SeedVR2 n apporte rien dans la fenetre. La regle Auto (score >= 0,85, correlation >= 0,45, >= 2 % de texels) refuse bien voiture et portail et accepte les 4 autres. Limite de conception : les pixels caches ne sont jamais reportes, donc seul l etalonnage de tons peut s y propager ; le gain de la projection n existe que sur les pixels utilises (mesure circulaire : dE de zone 21,6 a 13,8-18,0 sur le chevalier). La fenetre mesure l innocuite hors zone, pas le gain.',
    regle_auto_voiture_portail_refuses=True)
e4 = s34['essai4']
tot = {}
for s, c in e4.items():
    tot[s] = {k: v['segments_fantomes'] for k, v in c.items()}
ligne(4, 'Garde-fou local et deuxieme passe de projection', 'realise_proxy', {'segments_fantomes_dans_3_gros_plans (proxy automatique)': tot, 'details': e4,
    'releveurs_humains': 'NON DISPONIBLES (3 relecteurs demandes)'},
    'doubles contours du casque du chevalier reduits d au moins 50 % avec dE non degrade', False,
    'NON REDUIT selon le proxy (contours du rendu sans contour de la photo a moins de 2 px, composantes >= 15 px) : chevalier 34 (origine) -> 43 (1 passe) / 49 (2 passes) ; garde-fou strict (tau 25) 43 ; aucune condition ne reduit de 50 %. Le comptage visuel par releveurs n a pas pu etre fait : critere strict NON TESTABLE, proxy negatif. La deuxieme passe aggrave la couture (essai 3 : +7,2 dE a mip0 pour le chevalier contre +4,6 en une passe).')

# ---- 5
e5 = lire(T + '/essai5/plaques.json')
base = e5['final_rv (cellule 8, reference du plan)']['contours_fantomes_px']
red = {k: round(100.0 * (v['contours_fantomes_px'] - base) / base, 1) for k, v in e5.items() if isinstance(v, dict) and not k.startswith('etape1')}
ligne(5, 'Report des vues cotes et dos : cause des contours polygonaux (version reduite)', 'realise_partiel', {'proxy_plaques_sur_GLB_finaux_du_02_10_(bus)': e5, 'variation_pct_des_pixels_de_contours_fantomes_contre_cellule_8': red,
    'variantes_A_B_C': 'NON CONSTRUITES (dossiers vue_k par variante effaces) ; seul l effet de la taille de cellule du gain (8 / 32 / 64 / 256 / global) est testable'},
    'contours reduits d au moins 50 % avec PSNR basse frequence > 30 dB ; sinon abandonner la voie cotes et dos', False,
    'INDETERMINE (version reduite, NON concluant pour l hypothese). Contours fantomes (contours du rendu sans contour de la vue RealVisXL a 3 px) : cellule 8 = 1314 px / 18 segments ; cellule 32 : 2132 (+62 %) ; cellule 64 : 2642 (+101 %) ; cellule 256 : 656 (-50 %) ; gain GLOBAL : 315 (-76 %). Les contours baissent seulement quand le gain local disparait presque (256 et global), au prix d un ecart de couleur lisse a la vue de 44 et 99 niveaux (contre 28) : PSNR basse frequence bien sous 30 dB. Les tailles intermediaires AGGRAVENT les plaques : la cellule de 8 texels n est donc pas, a elle seule, la cause ; le gain local de couleur en general l est peut-etre. Variantes A (gain par ilot), B, C (ajustement differentiable) non construites : la voie cotes/dos n est ni abandonnee ni validee.')

# ---- 6
r6 = {s: lire(T + '/essai6/%s.json' % s) for s in ('alien', 'chevalier', 'bus')}
ligne(6, 'Remplissage des vides par bord le plus proche (vrai masque de to_glb)', 'realise', {s: {k: r[k] for k in ('atlas', 'couverts_pct', 'texels_couverts_identiques_telea', 'texels_couverts_identiques_proche', 'secondes_telea_couleur_rayon3', 'secondes_bord_proche_couleur', 'gain_secondes_couleur_seule', 'gain_secondes_4_canaux', 'ecart_moyen_des_remplissages_niveaux')} | {'couture_dE2000_[moyenne,mediane]': r['couture_dE2000_[moyenne, mediane]']} for s, r in r6.items()},
    'texels couverts identiques, couture mip2 au plus Telea, gain d au moins 3 s sur atlas 4096', True,
    'CRITERE ATTEINT sur la machine locale : texels couverts identiques (3/3), couture mip2 de bord_proche <= Telea (alien 4,39 contre 4,65 ; chevalier 5,20 contre 5,66 ; bus 3,07 contre 3,30), gain 4,6 s (chevalier 4K) et 4,2 s (bus 4K) sur la couleur seule, 8,4 a 9,3 s avec les 4 canaux. Reserves : CPU de Modal non mesure, interaction avec Ultra 8K non testee, masque reconstruit par rasterisation GL (meme regle centre-de-pixel que nvdiffrast, non verifie texel a texel), definition de couture propre a ce banc.')

# ---- 7 / 9 / 12 selon les analyses
def an(f): return lire(T + '/' + f)


KEY = 'dE2000_median_vs_ref4096_par_azimut(0,25,-25,60)'
m7 = {}; gains = {}
for s_ in ('chevalier', 'alien', 'cochon'):
    a = an('analyse_%s_m1024_atlas4096.json' % s_); i_ = lire(T + '/gen/%s_m1024_info.json' % s_)
    if not a: m7[s_] = 'non realise'; continue
    ent = {}
    for nm, x in a['variantes'].items():
        k = nm.split('_atlas')[-1].replace('.glb', ''); pa = x.get('vs_ref_par_azimut')
        ent[k] = {'dE2000_median_vs_photo': x['vs_photo'].get('dE2000_median'), 'ratio_laplacien_vs_photo': x['vs_photo'].get('ratio_laplacien'), 'dinov2_patchs': x['vs_photo'].get('dinov2_patchs'),
                  KEY: ({a_: v['dE2000_median'] for a_, v in pa.items()} if isinstance(pa, dict) else None), 'psnr_vs_ref4096_dB(0,25,-25,60)': ({a_: v['psnr_dB'] for a_, v in pa.items()} if isinstance(pa, dict) else None)}
    d1 = ent['1024'][KEY]; d2 = ent['2048'][KEY]
    gains[s_] = {'baisse_dE_vs_ref4096_de_1024_a_2048_pct_(moyenne_4_azimuts)': round(100.0 * (sum(d2.values()) / 4 - sum(d1.values()) / 4) / (sum(d1.values()) / 4), 1),
                 'variation_dE_vs_photo_de_1024_a_2048_pct': round(100.0 * (ent['2048']['dE2000_median_vs_photo'] - ent['1024']['dE2000_median_vs_photo']) / ent['1024']['dE2000_median_vs_photo'], 2),
                 'variation_dE_vs_photo_de_2048_a_4096_pct': round(100.0 * (ent['4096']['dE2000_median_vs_photo'] - ent['2048']['dE2000_median_vs_photo']) / ent['2048']['dE2000_median_vs_photo'], 2),
                 'secondes_to_glb': {k: v['secondes_to_glb'] for k, v in i_['cuissons'].items()}, 'octets_glb': {k: v['octets_glb'] for k, v in i_['cuissons'].items()}, 'duree_generation_s': i_['duree_totale_s']}
    m7[s_] = {'cuissons': ent, 'synthese': gains[s_]}
m7['bus'] = 'ABANDONNE : 24 s par pas d echantillonnage (contre 1,6 s pour le chevalier), VRAM 12,2 Go sur 16,3 : plus de 15 min de calcul ; arrete par l examinateur (sujet dense, voir la memoire sur la 3D lente du bus)'
m7['husky'] = 'absent (pas d image source locale)'
ligne(7, 'A/B de cuisson 1024 / 2048 / 4096 depuis les memes voxels', 'realise_3_sujets_sur_4', m7,
      'dE median au moins 20 % plus bas de 1024 a 2048, moins de 5 % de 2048 a 4096, surcout de cuisson inferieur a 5 s : alors Fast passe a 2048', None,
      'Lecture A (dE contre la cuisson 4096 de la meme generation, camera de la reference, maillages quasi identiques) : 1024 -> 2048 baisse le dE de 28 a 34 % (chevalier, alien, cochon) et gagne ~4 dB ; la cuisson 2048 coute 0,5 a 2,2 s DE MOINS que la 1024 (4096 : +6 a +9 s) ; 2048 -> 4096 : ecart residuel 1,0 a 1,6 dE, non separable du bruit de remaillage de to_glb (le maillage differe de 0,4 % d un appel a l autre) donc le critere « moins de 5 % » n est pas verifiable. Lecture B (dE contre la PHOTO, metrique du plan) : AUCUNE difference (0,1 a 0,8 %) entre 1024, 2048 et 4096 : la metrique est aveugle a cette echelle (en vue d ensemble le 1024 suffit, la perte n apparait qu en gros plan). Verdict : information perdue a 1024 CONFIRMEE face a 2048 ; gain de fidelite vers la photo NON demontre ; « Fast a 2048 » soutenu par le cout nul, pas par la fidelite a la photo.',
      note='mode 1024 (preset Fast), graine 42, 24 pas ; cuissons brutes (avant retouches de couleur) ; comparaison a 2048 px a l ecran inutilisable (desalignement geometrique, 20 a 24 dE)', synthese_par_sujet=gains)
a9 = an('analyse_chevalier_m1024_atlas2048_s9.json'); a12 = an('analyse_chevalier_m1024_atlas2048_s12.json')


def tab(a):
    out = {}
    for nm, x in (a['variantes'].items() if a else []):
        pa = x.get('vs_ref_par_azimut')
        out[nm] = {'dE2000_median_vs_photo': x['vs_photo'].get('dE2000_median'), 'ratio_laplacien': x['vs_photo'].get('ratio_laplacien'), 'dinov2_patchs': x['vs_photo'].get('dinov2_patchs'), 'ecart_luminance_V': x['vs_photo'].get('ecart_luminance_V'),
                   'ecart_saturation_S': x['vs_photo'].get('ecart_saturation_S'), 'sommets': x.get('sommets', a['n_sommets_ref']), 'dE_vs_ref_base_1024px_az0': (pa.get('0', {}) or {}).get('dE2000_median') if isinstance(pa, dict) else None}
    return out


t9 = tab(a9); t12 = tab(a12)
b = t12['chevalier_m1024_atlas2048.glb']['dE2000_median_vs_photo']
var9 = {k.replace('_atlas2048.glb', ''): round(100.0 * (v['dE2000_median_vs_photo'] - b) / b, 1) for k, v in t9.items() if k != 'chevalier_m1024_atlas2048.glb'}
var12 = {k.replace('_atlas2048.glb', ''): round(100.0 * (v['dE2000_median_vs_photo'] - b) / b, 1) for k, v in t12.items() if k != 'chevalier_m1024_atlas2048.glb'}
ligne(9, 'Balayage du sampler de texture (un facteur a la fois), exploratoire', 'realise_exploratoire', {'mesures': t9, 'variation_dE_vs_photo_pct_contre_base': var9,
    'non_realises': 'pas 32 : plantage natif (segmentation fault dans cumesh/remeshing.py pendant to_glb) ; guidage [0 ; 0,9] et [0,1 ; 0,9], pas 48, rescale_t 3,0 : temps et plafond de 12 generations ; une seule forme (chevalier), une seule graine',
    'config_juin': 'approximee par pas 12 + guidage 1,0 (rescale 0,5 et rescale_t 1,5 actuels conserves : la config exacte de juin n est pas consignee)'},
    'gain d au moins 8 % du dE median sur au moins 4 cas sur 6, sans derive de luminance ni metal degenere ; sinon garder la config actuelle', False,
    'NON ATTEINT / INDETERMINE. Meilleure variante : intervalle de guidage [0,5 ; 0,9] a -7,0 % du dE a la photo (guidage 4 : -3,1 % ; guidage 2 : +0,9 % ; config de juin : +6,5 %), mais (i) 1 sujet, 1 graine, loin de 6 cas, (ii) l ecart entre deux graines (42 et 7) est de -7,1 % : tout gain <= 7 % est dans le bruit de graine, (iii) le ratio de laplacien chute (0,258 -> 0,171 pour [0,5 ; 0,9]) : plus lisse. Config actuelle conservee ; la config de juin est PIRE (dE +6,5 %, nettete 0,122). Aucune conclusion causale sans la dispersion de graine (essai 8).')
ligne(12, 'Marge de recadrage (0 / 0,08 / 0,15) et dispersion de graine, exploratoire', 'realise_exploratoire', {'mesures': t12, 'variation_dE_vs_photo_pct_contre_base_0_08': var12,
    'recadrage_px': {'pad_0': 978, 'pad_0_08': 1134, 'pad_0_15': 1271}, 'limites': 'maillages differents (426 K, 407 K, 420 K sommets) : camera ajustee a part pour chaque variante ; une seule graine ; resolution DINOv3 1536/2048 et sujets allonges NON testes'},
    'baisse du dE d au moins 5 % sans artefact ; rejet rapide si le dE ne baisse pas', None,
    'marge 0 : dE +7,7 % et saturation -31 contre -16 : REJETEE (rejet rapide). marge 0,15 : dE -8,3 % (16,04 contre 17,48), mais la graine 7 (marge 0,08) donne -7,1 % : INDISTINGUABLE du bruit de graine, non retenue. Dispersion de graine (42 contre 7, formes differentes) : dE 17,48 -> 16,24 (-7,1 %), ratio de laplacien 0,258 -> 0,467, ecart de luminance V +11,7 -> -12,8 : la dispersion entre tirages depasse tout effet de reglage mesure ; confirme l interet de mesurer la dispersion (essai 8) avant tout reglage.')

# ---- non realises
for n, nom, why in ((8, 'Dispersion entre graines de texture (forme figee, 8 graines)', 'Non realise : exige un accrochage dans pipeline.run (forme figee, 8 echantillonnages de texture sans cuisson) ; temps insuffisant. Remplace par 2 graines completes (42 et 7, forme differente) dans la ligne 12.'),
                    (10, 'Re-texture all : accord de couleurs', 'Exclu par la consigne.'), (11, 'Plafond de jetons 49 152 / 65 536', 'Exclu par la consigne (Modal).'),
                    (13, 'RoMa contre Farneback', 'Exclu par la consigne (telechargement de poids).'), (14, 'Poids Step1X / ig2mv_partial', 'Exclu par la consigne (telechargement de poids).'),
                    (15, 'Qwen-Image-Edit-2511', 'Exclu par la consigne (Modal).'),
                    (16, 'Faisabilite de l optimisation du code latent', 'Non realise : temps (accrochage du decodeur de matiere et de la perte a coder) ; reste a faire.')):
    ligne(n, nom, 'non_realise', {}, '', None, why)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    for d in sorted(L, key=lambda x: x['numero_plan']): f.write(json.dumps(d, ensure_ascii=False) + '\n')
print(len(L), 'lignes ecrites ->', OUT)
