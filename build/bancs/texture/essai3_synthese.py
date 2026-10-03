"""Synthese des essais #3 et #4 a partir des JSON de C:/tmp/texture_essais/essai3 et essai4 (criteres du plan appliques tels qu'ecrits)."""
import json, glob, os
D3 = 'C:/tmp/texture_essais/essai3'; D4 = 'C:/tmp/texture_essais/essai4'
sujets = ['chevalier', 'bus', 'alien', 'cochon', 'portail', 'voiture']
out = {'essai3': {}, 'essai4': {}}
print('=== ESSAI 3 : fenetre cachee (dE2000 median : A origine -> condition ; critere : au moins -15 % sur 5 sujets sur 6) ===')
for etiq, lab in (('', 'B/D (photo 1024)'), ('_C_seedvr2', 'C (photo SeedVR2 2048)')):
    for cond in ('B_1passe', 'D_2passes'):
        ok = 0; ligne = []
        for s in sujets:
            f = '%s/%s%s.json' % (D3, s, etiq)
            if not os.path.exists(f): ligne.append('%s:n/a' % s); continue
            r = json.load(open(f)); a = r['conditions']['A_origine']['fenetre']['dE2000_median']; b = r['conditions'][cond]['fenetre']['dE2000_median']
            ch = 100.0 * (b - a) / a; ok += (ch <= -15.0)
            seam0 = r['conditions'][cond]['couture_bord_projete'][str(1024)]; seam2 = r['conditions'][cond]['couture_bord_projete'][str(256)]
            nt = r['conditions'][cond].get('non_touches_wasserstein_luminance_niveaux')
            ligne.append('%s: dE %.2f->%.2f (%+.1f%%) | couture mip0 %+.2f mip2 %+.2f | non touches W %s | proj %.1f%%' % (s, a, b, ch, (seam0['apres'][0] or 0) - (seam0['avant'][0] or 0), (seam2['apres'][0] or 0) - (seam2['avant'][0] or 0), nt, r['conditions'][cond]['texels_projetes_pct']))
            out['essai3'].setdefault(lab + ' ' + cond, {})[s] = dict(dE_A=a, dE_cond=b, variation_pct=round(ch, 2), couture_mip0_delta=round((seam0['apres'][0] or 0) - (seam0['avant'][0] or 0), 3), couture_mip2_delta=round((seam2['apres'][0] or 0) - (seam2['avant'][0] or 0), 3), non_touches_W=nt, texels_pct=r['conditions'][cond]['texels_projetes_pct'])
        print('--', lab, cond, ': sujets a -15 %% ou mieux : %d/6' % ok)
        for l in ligne: print('   ', l)
        out['essai3'][lab + ' ' + cond + ' _sujets_critere_atteints'] = ok
print('=== regle Auto ===')
for s in sujets:
    f = '%s/%s.json' % (D3, s)
    if os.path.exists(f): r = json.load(open(f)); print('   ', s, r['regle_auto']); out['essai3'].setdefault('regle_auto', {})[s] = r['regle_auto']
print('=== ESSAI 4 : proxy de doubles contours (segments fantomes dans 3 gros plans ; somme) ===')
for s in sujets:
    f = '%s/%s.json' % (D4, s)
    if not os.path.exists(f): continue
    r = json.load(open(f)); ligne = []
    for k, v in r['conditions'].items():
        seg = sum(x['segments_fantomes'] for x in v['proxy']['gros_plans']); prec = v['proxy']['zone']['precision_2px']; dz = v['metriques_zone_circulaires']['dE2000_median']
        ligne.append('%s seg=%d prec=%.3f dE=%.2f' % (k, seg, prec, dz)); out['essai4'].setdefault(s, {})[k] = dict(segments_fantomes=seg, precision_zone=prec, dE_zone_circulaire=dz)
    print('   ', s, ' | '.join(ligne))
json.dump(out, open('C:/tmp/texture_essais/synthese_essai3_4.json', 'w'), indent=1, ensure_ascii=False)
