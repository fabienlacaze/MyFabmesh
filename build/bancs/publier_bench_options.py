"""Publie les RESULTATS du banc Modal « avec / sans » des options 3D dans R2 (`_meta/bench_options.json`) : /admin2 (carte « Mesures du banc Modal », onglet Argent) les lit via stats.json.

Entrees : les deux fichiers de resultats du banc (C:/tmp/bench_options.json, C:/tmp/bench_paliers.json ; copie versionnee : docs/campagnes/bench_options_avec_sans_2026-10-02.json).
    python build/bancs/publier_bench_options.py [--dry-run]
`source` : avec_sans = ecart de duree entre paires (la mesure fait foi) ; direct = duree lue dans le journal Modal de l'etape (l'ecart avec/sans est noye dans le bruit) ;
mesure_30j = facture reelle repartie ; bruit = ecart non significatif, estimation physique conservee ; non_mesuree.
"""
import io
import json
import os
import statistics
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
USD_EUR = 0.93
RATE = 0.000542 * USD_EUR          # EUR par seconde de L40S
EUR_CRED = 0.162


def charge():
    chemin = os.path.join(RACINE, 'docs', 'campagnes', 'bench_options_avec_sans_2026-10-02.json')
    j = json.load(io.open(chemin, encoding='utf-8'))
    return j['banc_options'], j['banc_paliers']


def main():
    a, b = charge()
    r = a['resume']
    # (cle de prix, nom, cle du resume, source, cout retenu EUR, secondes retenues, note)
    lignes = [
        ('mesh_rectify', 'Redressement auto', None, 'mesure_30j', 0.33, None, "21,4 € de GPU réel pour 65 générations qui l'ont payé (appel à part, avec son propre démarrage à froid)"),
        ('mesh_ultra_q', 'Géométrie fine', 'ultra_q', 'avec_sans', None, None, 'voxels 1536 en cascade'),
        ('mesh_ultra_hd', 'Texture nette 8K', 'ultra_hd', 'avec_sans', None, None, 'Real-ESRGAN ×2 ; le fichier passe de 36 à 53 Mo'),
        ('mesh_tris_500k', 'Triangles max (2 M au lieu de 500 K)', 'tris_2M', 'avec_sans', None, None, 'deux doublements, ~21 s chacun ; le fichier passe de 36 à 95 Mo'),
        ('mesh_refine', 'Affinage des détails', 'refine', 'direct', None, 53.0, "journal Modal : « atlas affiné en 53,0 s » (9 tuiles) ; option suspendue sur le site, active au bureau"),
        ('mesh_face_fix', 'Correction du visage', 'face_fix', 'direct', None, 16.1, "journal Modal : « face_fix done in 16,1 s » ; option suspendue sur le site, active au bureau"),
        ('mesh_quality_plus', 'Arêtes nettes', 'quality_plus', 'bruit', 0.008, None, 'écart noyé dans le bruit : estimation physique conservée (~15 s)'),
        ('mesh_smooth', 'Texture lissée', 'smooth', 'avec_sans', None, None, 'filtre bilatéral sur le processeur'),
        ('mesh_multiref', 'Multi-références', None, 'non_mesuree', 0.005, None, "jamais utilisée sur 30 jours : estimation (~10 s)"),
    ]
    options = []
    for cle, nom, k, source, cout, secs, note in lignes:
        m = r.get(k) if k else None
        o = {'cle': cle, 'nom': nom, 'source': source, 'note': note}
        if m:
            o.update({'paires': m['paires'], 'sans_s': m['sans_s'], 'avec_s': m['avec_s'], 'ecart_s': m['delta_s'], 'erreur_s': m['erreur_type_s']})
        if source == 'direct':
            o['direct_s'] = secs
            cout = round(secs * RATE, 3)
        elif source == 'avec_sans':
            cout = round(max(m['delta_s'], 0) * RATE, 3)
        o['cout_eur'] = cout
        options.append(o)
    sans = [x['dt'] for x in a['resultats'] if x['mesuree'] and x['ok'] and x['groupe'].endswith('|sans')]
    fast = [x['dt'] for x in a['resultats'] if x['mesuree'] and x['ok'] and x['groupe'] == 'palier|fast']
    qual = [x['dt'] for x in b['resultats'] if x['mesuree'] and x['ok'] and x['groupe'] == 'palier|quality']
    u8k = [x['dt'] for x in b['resultats'] if x['mesuree'] and x['ok'] and x['groupe'] == 'palier|ultra_8k']
    paliers = []
    for cle, nom, v, specif in (('mesh_fast', 'Rapide (fast)', fast, "24 pas, atlas 1024"), ('mesh_balanced', 'Équilibré (balanced)', sans, "24 pas, atlas 2048 ; générations « sans option » du banc"),
                                ('mesh_quality', 'Qualité (quality)', qual, "32 pas, atlas 4096"), ('mesh_ultra_8k', '8K (ultra_8k)', u8k, "32 pas, atlas 4096, texture 8192 px")):
        d = statistics.mean(v)
        paliers.append({'cle': cle, 'nom': nom, 'n': len(v), 'duree_s': round(d, 1), 'min_s': round(min(v), 1), 'max_s': round(max(v), 1), 'gpu_chaud_eur': round(d * RATE, 3), 'reglage': specif})
    total_s = sum(x['dt'] for x in a['resultats']) + sum(x['dt'] for x in b['resultats'])
    sortie = {
        'v': 1, 'date': '2026-10-02', 'generations': len(a['resultats']) + len(b['resultats']), 'echecs': 0,
        'cout_usd': round((a['duree_s'] + b['duree_s']) * 0.000542, 2), 'duree_min': round((a['duree_s'] + b['duree_s']) / 60),
        'methode': "Même image (un personnage), même graine, conteneur L40S chaud ; paires « sans / avec » intercalées ; 1re génération de chaque configuration écartée ; 2 paires par option, 3 mesures par palier.",
        'limites': "2 paires seulement : seules Géométrie fine, Texture nette 8K et Triangles max sortent nettement du bruit. Une seule image : le coût de l'affinage et de la correction du visage dépend du contenu. Multi-références non mesurée.",
        'cout_reel_par_generation_eur': 0.62, 'gpu_chaud_par_generation_eur': [round(min(p['gpu_chaud_eur'] for p in paliers), 3), round(max(p['gpu_chaud_eur'] for p in paliers), 3)],
        'options': options, 'paliers': paliers,
    }
    if '--dry-run' in sys.argv:
        print(json.dumps(sortie, ensure_ascii=False, indent=1)[:2500]); return
    io.open(os.path.join(RACINE, 'docs', 'campagnes', 'bench_options_r2_2026-10-02.json'), 'w', encoding='utf-8').write(json.dumps(sortie, ensure_ascii=False, indent=1))
    cfg = {}
    for l in io.open(os.path.join(RACINE, 'cloud', '.env.local'), encoding='utf-8'):
        l = l.strip()
        if l and not l.startswith('#') and '=' in l:
            k, v = l.split('=', 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
    import boto3
    s3 = boto3.client('s3', endpoint_url='https://%s.r2.cloudflarestorage.com' % cfg['R2_ACCOUNT_ID'], aws_access_key_id=cfg['R2_ACCESS_KEY_ID'], aws_secret_access_key=cfg['R2_SECRET_ACCESS_KEY'], region_name='auto')
    bucket = cfg.get('R2_BUCKET_NAME') or cfg.get('R2_BUCKET') or 'myfabmesh-meshes'
    s3.put_object(Bucket=bucket, Key='_meta/bench_options.json', Body=json.dumps(sortie, ensure_ascii=False).encode('utf-8'), ContentType='application/json')
    print('R2 _meta/bench_options.json ecrit : %d options, %d paliers' % (len(options), len(paliers)))


if __name__ == '__main__':
    main()
