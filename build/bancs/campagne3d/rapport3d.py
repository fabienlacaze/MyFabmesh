"""Rapport HTML de la campagne des outils 3D (resultats3d.jsonl + captures). Usage : python rapport3d.py [verdicts.json]
verdicts.json (optionnel) : { "nom_de_l_outil": {"statut": "ok|partiel|echec", "verdict": "texte"} } ecrase le verdict automatique."""
import base64, html, io, json, os, sys
from PIL import Image

D = 'C:/tmp/campagne'
verd = {}
if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
    verd = json.load(io.open(sys.argv[1], encoding='utf-8'))
base = json.load(io.open(D + '/base_v4.json', encoding='utf-8')) if os.path.exists(D + '/base_v4.json') else {}
lignes = []
if os.path.exists(D + '/resultats3d.jsonl'):
    for l in io.open(D + '/resultats3d.jsonl', encoding='utf-8'):
        try:
            lignes.append(json.loads(l))
        except Exception:
            pass


def vignette(f, t=300):
    if not f or not os.path.exists(f):
        return None
    im = Image.open(f).convert('RGB'); im.thumbnail((t, t))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=70)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()


def auto(x):
    if not x.get('ok'):
        return 'echec', x.get('erreur') or 'echec'
    m = x.get('mesures') or {}
    notes = []
    st = 'ok'
    if x.get('versions_ajoutees') == 0 and x.get('groupe') in ('geo', 'tex', 'edit'):
        st = 'echec'; notes.append('aucune version creee')
    if m:
        if m.get('non_fini'):
            st = 'echec'; notes.append('%d valeurs non finies' % m['non_fini'])
        if base and m.get('lum_moy') is not None and base.get('lum_moy') is not None:
            d = m['lum_moy'] - base['lum_moy']
            if abs(d) > 25:
                st = 'partiel' if st == 'ok' else st; notes.append('luminance %+.0f' % d)
        if m.get('part_noir_pct') is not None and m['part_noir_pct'] > 5:
            st = 'partiel' if st == 'ok' else st; notes.append('%.0f %% de pixels noirs' % m['part_noir_pct'])
        if m.get('faces') is not None and base.get('faces') and m['faces'] < 0.5 * base['faces'] and 'triangle' not in x.get('nom', '') and x.get('base') in ('v4',):
            notes.append('faces %d' % m['faces'])
    if x.get('erreur_gpu'):
        st = 'echec'; notes.append('erreur GPU')
    return st, '; '.join(notes)


COUL = {'ok': '#2e7d32', 'partiel': '#ef6c00', 'echec': '#c62828'}
LIB = {'ok': 'OK', 'partiel': 'À regarder', 'echec': 'Échec'}
out = ['<!doctype html><meta charset="utf-8"><title>Campagne des outils 3D</title><style>body{font:14px system-ui,sans-serif;background:#14141c;color:#eee;margin:0;padding:18px 24px}h1{font-size:22px}h2{margin:26px 0 8px;font-size:17px;border-bottom:1px solid #333;padding-bottom:4px}'
       'table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #2a2a36;padding:6px 8px;vertical-align:top;text-align:left}th{color:#9a9ab2;font-weight:600;font-size:12px}img{border-radius:6px;display:block}.p{display:inline-block;padding:2px 9px;border-radius:10px;color:#fff;font-size:12px;font-weight:600}.n{color:#9a9ab2;font-size:12px}</style>']
out.append('<h1>Campagne des outils 3D du bureau — projet chevalier_medieval</h1>')
if base:
    out.append('<p class="n">Version de base v4 : %s faces, texture %s, luminance %s, métal %s.</p>' % (base.get('faces'), base.get('tex_couleur'), base.get('lum_moy'), base.get('metal_moy')))
nok = sum(1 for x in lignes if auto(x)[0] == 'ok' and (verd.get(x['nom'], {}).get('statut', 'ok') == 'ok'))
out.append('<p>%d essais ; %d sans problème apparent.</p>' % (len(lignes), nok))
groupes = []
for x in lignes:
    if x['groupe'] not in groupes:
        groupes.append(x['groupe'])
for g in groupes:
    out.append('<h2>%s</h2><table><tr><th>Outil</th><th>Résultat</th><th>Durée</th><th>Mesures</th><th>Capture</th></tr>' % html.escape(g))
    for x in lignes:
        if x['groupe'] != g:
            continue
        st, v = auto(x)
        if x['nom'] in verd:
            st = verd[x['nom']].get('statut', st); v = verd[x['nom']].get('verdict', v)
        m = x.get('mesures') or {}
        mes = []
        if m.get('faces') is not None: mes.append('%s faces' % format(m['faces'], ','))
        if m.get('tex_couleur'): mes.append('texture %sx%s' % tuple(m['tex_couleur']))
        if m.get('lum_moy') is not None: mes.append('lum. %s' % m['lum_moy'])
        if m.get('part_noir_pct') is not None: mes.append('noir %s %%' % m['part_noir_pct'])
        if m.get('metal_moy') is not None: mes.append('métal %s' % m['metal_moy'])
        if m.get('boite'): mes.append('boîte %s' % m['boite'])
        if m.get('joints') is not None: mes.append('%s os' % m['joints'])
        if m.get('animations'): mes.append('%s anim.' % m['animations'] + (' %s s' % m['duree_s'] if m.get('duree_s') else ''))
        if m.get('taille_mo') is not None: mes.append('%s Mo' % m['taille_mo'])
        gpu = 'VRAM +%s Mo (pic %s), GPU %s %%, %s °C' % (x.get('vram_ajoutee_mo'), x.get('vram_pic_mo'), x.get('gpu_pic_pct'), x.get('temp_pic_c')) if x.get('vram_pic_mo') else ''
        cap = vignette(x.get('capture'))
        out.append('<tr><td><b>%s</b><div class="n">%s</div></td><td><span class="p" style="background:%s">%s</span><div class="n">%s</div></td><td>%s s</td><td class="n">%s<br>%s</td><td>%s</td></tr>' % (
            html.escape(x['nom']), html.escape(x.get('note', '') or ''), COUL[st], LIB[st], html.escape(v or ''), x.get('duree_s'), html.escape(' · '.join(mes)), html.escape(gpu),
            ('<img src="%s">' % cap) if cap else ''))
    out.append('</table>')
io.open(D + '/rapport_outils_3d.html', 'w', encoding='utf-8').write('\n'.join(out))
print('rapport ecrit :', D + '/rapport_outils_3d.html', len(lignes), 'essais')
