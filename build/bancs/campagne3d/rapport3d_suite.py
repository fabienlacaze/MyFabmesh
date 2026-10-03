"""Rapport de la SUITE de la campagne (docs/campagnes/resultats_outils_3d_suite.jsonl) -> HTML sans image (docs/campagnes/rapport_outils_3d_suite.html) + vignettes optionnelles sous C:/tmp/campagne.
Usage : python rapport3d_suite.py [verdicts_suite.json]   verdicts : { "nom_essai": {"statut": "ok|partiel|echec|banc|non_testable", "verdict": "texte"} } (ecrase le verdict automatique)"""
import html, io, json, os, sys

REPO = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself'
SRC = REPO + '/docs/campagnes/resultats_outils_3d_suite.jsonl'
OUT = REPO + '/docs/campagnes/rapport_outils_3d_suite.html'
verd = {}
if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
    verd = json.load(io.open(sys.argv[1], encoding='utf-8'))
L = {}
for l in io.open(SRC, encoding='utf-8'):
    try:
        x = json.loads(l); L[(x.get('groupe'), x.get('nom'))] = x       # le DERNIER essai d'un nom fait foi
    except Exception:
        pass
lignes = list(L.values())


def mesures(x):
    m = x.get('mesures') or {}; g = x.get('geometrie') or {}; out = []
    if m.get('faces') is not None: out.append('%s faces' % format(m['faces'], ','))
    if m.get('tex_couleur'): out.append('texture %sx%s' % tuple(m['tex_couleur']))
    if m.get('lum_moy') is not None: out.append('lum. %s' % m['lum_moy'])
    if m.get('joints') is not None: out.append('%s os' % m['joints'])
    p = m.get('poids') or {}
    if p: out.append('poids: somme [%s ; %s], sans poids %s %%, orphelins %s' % (p.get('somme_min'), p.get('somme_max'), p.get('sans_poids_pct'), p.get('os_orphelins')))
    c = m.get('couverture')
    if c: out.append('couverture p99 %s H, extremites hors squelette %s %%' % (c.get('p99'), m.get('extremites_non_couvertes_pct')))
    f = m.get('flexion')
    if f: out.append('flexion: %s %% aretes etirees, %s %% ecrasees' % (f.get('etire_pct_moy'), f.get('ecrase_pct_moy')))
    for a in (m.get('animations') or [])[:6]:
        out.append('anim %s: %s s, %s images, raccord %s deg, racine %s H/s' % (a.get('nom'), a.get('duree_s'), a.get('images_max'), (a.get('raccord_rot_deg') or {}).get('max'), (a.get('racine') or {}).get('vitesse_h_par_s')))
    if g: out.append('geom: %s faces soudees, %s composantes, retournees %s %%, bord %s' % (g.get('faces'), g.get('composantes'), g.get('retournees_pct_aire'), g.get('aretes_bord')))
    e = x.get('export') or {}
    if e:
        v = e.get('validation') or {}
        out.append('export %s Mo : %s' % (e.get('taille_mo'), json.dumps({k: v.get(k) for k in ('maillages', 'sommets', 'faces', 'os', 'nb_actions', 'actions', 'erreur') if v.get(k) is not None}, ensure_ascii=False)[:260]))
    return out


def statut(x):
    if x['nom'] in verd and 'statut' in verd[x['nom']]: return verd[x['nom']]['statut']
    if x.get('cause') == 'banc': return 'banc'
    if x.get('cause') == 'acces_standard': return 'non_testable'
    return 'ok' if x.get('ok') else 'echec'


COUL = {'ok': '#2e7d32', 'partiel': '#ef6c00', 'echec': '#c62828', 'banc': '#6a1b9a', 'non_testable': '#546e7a'}
LIB = {'ok': 'OK (verifie)', 'partiel': 'A regarder', 'echec': 'Echec de l outil', 'banc': 'Echec du banc', 'non_testable': 'Non testable'}
o = ['<!doctype html><meta charset="utf-8"><title>Suite de la campagne des outils 3D, rigs et animations</title><style>body{font:14px system-ui,sans-serif;background:#14141c;color:#eee;margin:0;padding:18px 24px}h1{font-size:22px}h2{margin-top:26px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #2a2a36;padding:6px 8px;vertical-align:top;text-align:left}th{color:#9a9ab2;font-size:12px}.n{color:#9a9ab2;font-size:12px}.p{display:inline-block;padding:2px 8px;border-radius:10px;color:#fff;font-size:12px}</style>']
o.append('<h1>Suite de la campagne des outils 3D, rigs et animations (2026-10-02, nuit)</h1><p class="n">%d essais. Genere par build/bancs/campagne3d/rapport3d_suite.py.</p>' % len(lignes))
gr = []
for x in lignes:
    if x.get('groupe') not in gr: gr.append(x.get('groupe'))
for g in gr:
    o.append('<h2>%s</h2><table><tr><th>Essai</th><th>Resultat</th><th>Duree / ressources</th><th>Mesures</th></tr>' % html.escape(str(g)))
    for x in lignes:
        if x.get('groupe') != g: continue
        st = statut(x); v = (verd.get(x['nom']) or {}).get('verdict') or x.get('erreur') or ''
        res = '%s s ; VRAM +%s Mo (pic %s) ; RAM +%s Mo ; GPU %s %%' % (x.get('duree_s'), x.get('vram_ajoutee_mo'), x.get('vram_pic_mo'), x.get('ram_ajoutee_mo'), x.get('gpu_pic_pct')) if x.get('duree_s') is not None else ''
        o.append('<tr><td><b>%s</b><div class="n">%s</div><div class="n">%s</div></td><td><span class="p" style="background:%s">%s</span><div class="n">%s</div></td><td class="n">%s</td><td class="n">%s</td></tr>' % (
            html.escape(x['nom']), html.escape(x.get('projet') or ''), html.escape(x.get('note', '') or ''), COUL.get(st, '#555'), LIB.get(st, st), html.escape(v), html.escape(res), html.escape(' | '.join(mesures(x)))))
    o.append('</table>')
io.open(OUT, 'w', encoding='utf-8').write('\n'.join(o))
print('rapport ecrit :', OUT, len(lignes), 'essais')
