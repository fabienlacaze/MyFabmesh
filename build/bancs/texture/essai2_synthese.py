"""Synthese de l'essai #2 : accord des metriques avec la degradation connue (atlas 1024) et repetabilite de la camera."""
import json, glob, os
D = 'C:/tmp/texture_essais/essai2'
bas_est_mieux = {'dE2000_median', 'dE2000_p90'}
mets = ['dE2000_median', 'psnr_basse_freq_dB', 'ratio_laplacien', 'ratio_HF_ecart_type', 'correlation_structure', 'correlation_HF', 'dinov2_patchs', 'dinov2_cls']
acc = {m: 0 for m in mets}; n = 0; rep_avant = {}; rep_apres = {}; ordre3 = {m: 0 for m in mets}; n3 = 0; ecarts = {}
for f in sorted(glob.glob(D + '/*.json')):
    if 'polish' in f or 'synthese' in f: continue
    r = json.load(open(f)); v = r['variantes']; o = v['origine']['cam1']; d = v['atlas1024']['cam1']; n += 1; rep_avant[r['sujet']] = r['repetabilite_dE_median']
    for m in mets:
        a, b = o.get(m), d.get(m)
        if a is not None and b is not None: acc[m] += (a < b) if m in bas_est_mieux else (a > b)
    ecarts[r['sujet']] = {m: round(d[m] - o[m], 3) for m in mets if m in o and m in d}
    if 'atlas2048' in v:
        n3 += 1; mid = v['atlas2048']['cam1']
        for m in mets:
            a, b, c = o.get(m), mid.get(m), d.get(m)
            ordre3[m] += (a <= b <= c) if m in bas_est_mieux else (a >= b >= c)
for f in sorted(glob.glob(D + '/*_polish.json')):
    r = json.load(open(f)); rep_apres[r['sujet']] = r['repetabilite_dE_median_apres']
res = {'sujets': n, 'origine_mieux_classee_que_atlas1024': acc, 'ordre_origine_2048_1024_respecte_(sujets_a_atlas>2048)': ordre3, 'sujets_avec_variante_2048': n3,
       'repetabilite_dE_median_avant_polissage': rep_avant, 'repetabilite_dE_median_apres_polissage': rep_apres,
       'sujets_repetabilite_inf_0_5_avant': sum(1 for x in rep_avant.values() if x < 0.5), 'sujets_repetabilite_inf_0_5_apres': sum(1 for x in rep_apres.values() if x < 0.5), 'variation_metrique_1024_moins_origine': ecarts}
json.dump(res, open(D + '/synthese_essai2.json', 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in res.items() if k != 'variation_metrique_1024_moins_origine'}, ensure_ascii=False, indent=1))
