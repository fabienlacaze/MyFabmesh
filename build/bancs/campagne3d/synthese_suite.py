"""Tableau de synthese (texte) de resultats_outils_3d_suite.jsonl : un essai par ligne, le dernier essai d'un meme nom fait foi.
Usage : python synthese_suite.py [filtre_sur_le_groupe_ou_le_nom]"""
import io, json, sys

SRC = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/docs/campagnes/resultats_outils_3d_suite.jsonl'
flt = sys.argv[1] if len(sys.argv) > 1 else ''
L = {}
for l in io.open(SRC, encoding='utf-8'):
    if not l.strip(): continue
    d = json.loads(l); L[(d.get('groupe'), d.get('nom'))] = d
for (g, n), d in L.items():
    if flt and flt not in (g or '') and flt not in n: continue
    m = d.get('mesures') or {}; ge = d.get('geometrie') or {}; bm = d.get('base_mesures') or {}; bg = d.get('base_geometrie') or {}
    cause = d.get('cause') or ''
    etat = 'OK' if d.get('ok') else ('NONTEST' if cause == 'acces_standard' else ('BANC' if cause == 'banc' else 'ECHEC'))
    res = []
    if m.get('faces') is not None: res.append('%s faces' % m['faces'] + (' (base %s)' % bm['faces'] if bm.get('faces') else ''))
    if m.get('tex_couleur'): res.append('tex %sx%s' % tuple(m['tex_couleur']) + (' (base %sx%s)' % tuple(bm['tex_couleur']) if bm.get('tex_couleur') else ''))
    if m.get('lum_moy') is not None: res.append('lum %s' % m['lum_moy'] + (' (base %s)' % bm['lum_moy'] if bm.get('lum_moy') is not None else ''))
    if m.get('part_noir_pct') is not None: res.append('noir %s%%' % m['part_noir_pct'])
    if ge: res.append('geom: comp %s bord %s retourn %s%% deg %s' % (ge.get('composantes'), ge.get('aretes_bord'), ge.get('retournees_pct_aire'), ge.get('faces_degenerees')) + (' (base comp %s bord %s retourn %s%%)' % (bg.get('composantes'), bg.get('aretes_bord'), bg.get('retournees_pct_aire')) if bg else ''))
    if m.get('joints') is not None: res.append('%s os' % m['joints'])
    if d.get('comparaison'): res.append('cmp ' + json.dumps(d['comparaison'], ensure_ascii=False)[:260])
    print('%-8s %-26s %-40s %6ss VRAM pic %s | %s | %s' % (etat, g, n, d.get('duree_s'), d.get('vram_pic_mo'), ' ; '.join(res)[:420], (d.get('erreur') or '')[:200]))
