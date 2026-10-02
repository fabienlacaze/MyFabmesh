"""Reproduit « Par operation » (30 jours, cout reel) de /admin2 a partir des donnees reelles : jobs Supabase + facture Modal par jour et par application (R2).
Sortie : C:/tmp/analyse_prix.json (par operation affichee) et un tableau lisible."""
import io, json, re, sys, collections, datetime, urllib.request

RACINE = r'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/'
cfg = {}
for l in io.open(RACINE + 'cloud/.env.local', encoding='utf-8'):
    l = l.strip()
    if l and not l.startswith('#') and '=' in l:
        k, v = l.split('=', 1); cfg[k.strip()] = v.strip().strip('"').strip("'")

url = cfg['NEXT_PUBLIC_SUPABASE_URL']; key = cfg['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': key, 'Authorization': 'Bearer ' + key}


def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(url + '/rest/v1/' + path, headers=H), timeout=60))


import boto3
s3 = boto3.client('s3', endpoint_url='https://%s.r2.cloudflarestorage.com' % cfg['R2_ACCOUNT_ID'], aws_access_key_id=cfg['R2_ACCESS_KEY_ID'], aws_secret_access_key=cfg['R2_SECRET_ACCESS_KEY'], region_name='auto')
BUCKET = cfg.get('R2_BUCKET_NAME') or cfg.get('R2_BUCKET') or 'myfabmesh-meshes'


def r2_json(k):
    try:
        return json.loads(s3.get_object(Bucket=BUCKET, Key=k)['Body'].read().decode('utf-8'))
    except Exception as e:
        return None


reel = r2_json('_meta/modal_real_usage.json') or {}
by_day_app = reel.get('by_day_app') or {}
by_day = reel.get('by_day') or {}
override = r2_json('_meta/pricing.json')
json.dump({'override': override}, io.open('C:/tmp/pricing_override_avant.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

GPU = {'A100': 0.001097, 'L40S': 0.000542, 'A10G': 0.000306, 'L4': 0.000222, 'CPU': 0.0000131}
HW = {'mesh': 'L40S', 'mesh-face': 'L40S', 'construction3d': 'L40S', 'text2image': 'L40S', 'back-view': 'L40S', 'rectify': 'L40S', 'sheet': 'L40S', 'tpose': 'L40S', 'remove-bg': 'L40S',
      'rig': 'A10G', 'segment': 'A100', 'animate': 'A10G', 'animate_fbx': 'CPU', 'mesh-op': 'CPU', 'mesh-op-client': 'CPU', 'mesh-convert': 'CPU'}
STAT = {'text2image': 0.003, 'back-view': 0.004, 'rectify': 0.003, 'sheet': 0.005, 'mvadapter': 0.012, 'tpose': 0.004, 'mesh': 0.370, 'mesh-face': 0.420, 'retexture': 0.150, 'reshape': 0.200, 'remove-bg': 0.005,
        'rig': 0.05, 'segment': 0.15, 'animate': 0.06, 'animate_fbx': 0.06, 'mesh-op': 0.001, 'construction3d': 0.01, 'mesh-op-client': 0}
USD_EUR = 0.93; EUR_CRED = 0.162


def mesure(op, c, f):
    if not c or not f:
        return None
    a = datetime.datetime.fromisoformat(c.replace('Z', '+00:00')).timestamp(); b = datetime.datetime.fromisoformat(f.replace('Z', '+00:00')).timestamp()
    sec = b - a
    if sec <= 0 or sec > 3600:
        return None
    return sec * GPU[HW.get(op, 'L40S')]


def cle_op(op, o):
    o = o or {}
    sous = lambda v: v if isinstance(v, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,40}', v) else ''
    if op == 'text2image':
        s = sous(o.get('op')); return ('segment-image' if s == 'segment' else s) if s else op
    if op in ('mesh-op', 'mesh-op-client', 'manual-tool'):
        s = sous(o.get('op_type')); return op + ':' + s if s else op
    return op


def poste_op(op):
    return 'rig' if op == 'rig' else 'anim' if op.startswith('animate') else 'segment' if op == 'segment' else 'cloud'


def poste_app(app):
    if app in ('myfabmesh-cloud', 'myfabmesh-lod'): return 'cloud'
    if re.search(r'skintokens|-rig$', app): return 'rig'
    if re.search(r'unimate|-anim$|fbx-retarget', app): return 'anim'
    if re.search(r'partsam|sampart', app): return 'segment'
    return None


jobs = get('jobs?select=user_id,status,credit_cost,options,created_at,finished_at,type,cost_usd&order=created_at.desc&limit=20000')
now = datetime.datetime.utcnow()
debut30 = (now - datetime.timedelta(days=29)).strftime('%Y-%m-%d')
lim = now - datetime.timedelta(days=30)
ops30 = []
for j in jobs:
    t = datetime.datetime.fromisoformat(j['created_at'].replace('Z', '+00:00')).replace(tzinfo=None)
    if t < lim:
        continue
    o = j.get('options') or {}
    op = str(o.get('operation_type') or 'mesh')
    m = mesure(op, j['created_at'], j.get('finished_at'))
    cout_usd = m if m is not None else float(j.get('cost_usd') or o.get('cost_usd') or STAT.get(op, 0) or 0)
    ok = j['status'] == 'succeeded'
    cred = (j.get('credit_cost') or 0) if ok else 0
    ops30.append({'day': t.strftime('%Y-%m-%d'), 'op': op, 'cle': cle_op(op, o), 'ok': ok, 'failed': j['status'] == 'failed', 'credits': cred, 'mesure': cout_usd * USD_EUR, 'dur': (m or 0) / GPU[HW.get(op, 'L40S')] if m else None})

mesure_cle = collections.defaultdict(float)
for x in ops30:
    mesure_cle[x['day'] + '|' + poste_op(x['op'])] += x['mesure']
facture_cle = collections.defaultdict(float); sans_op = 0.0
for d, apps in by_day_app.items():
    if d < debut30 or not isinstance(apps, dict):
        continue
    for app, usd in apps.items():
        if not isinstance(usd, (int, float)):
            continue
        p = poste_app(app)
        if p and mesure_cle.get(d + '|' + p, 0) > 0:
            facture_cle[d + '|' + p] += usd * USD_EUR
        else:
            sans_op += usd * USD_EUR

res = collections.OrderedDict()
for x in ops30:
    b = res.setdefault(x['cle'], {'n': 0, 'ok': 0, 'echecs': 0, 'credits': 0, 'valeur': 0.0, 'mesure': 0.0, 'reel': 0.0, 'durs': []})
    b['n'] += 1; b['ok'] += 1 if x['ok'] else 0; b['echecs'] += 1 if x['failed'] else 0; b['credits'] += x['credits']; b['valeur'] += x['credits'] * EUR_CRED; b['mesure'] += x['mesure']
    k = x['day'] + '|' + poste_op(x['op'])
    f = facture_cle.get(k)
    b['reel'] += f * (x['mesure'] / mesure_cle[k]) if f is not None and mesure_cle[k] > 0 else x['mesure']
    if x['dur']: b['durs'].append(x['dur'])

sortie = {}
for k, b in res.items():
    prix_moy = b['credits'] / b['ok'] if b['ok'] else 0
    ratio = b['valeur'] / b['reel'] if b['reel'] > 0.005 else None
    cout_op = b['reel'] / b['n'] if b['n'] else 0
    # prix minimal pour x4 : valeur des succes = 4 x cout reel total (echecs inclus)
    p4 = (4 * b['reel'] / (EUR_CRED * b['ok'])) if b['ok'] else None
    durs = sorted(b['durs']); med = durs[len(durs) // 2] if durs else None
    sortie[k] = {'n': b['n'], 'ok': b['ok'], 'echecs': b['echecs'], 'credits': b['credits'], 'prix_moyen': round(prix_moy, 2), 'valeur_eur': round(b['valeur'], 2), 'reel_eur': round(b['reel'], 3), 'mesure_eur': round(b['mesure'], 3),
                 'cout_op_eur': round(cout_op, 4), 'ratio': round(ratio, 2) if ratio else None, 'prix_min_x4': round(p4, 2) if p4 else None, 'duree_med_s': med}
json.dump({'genere': now.isoformat(), 'facture_sans_operation_eur': round(sans_op, 2), 'total_reel_eur': round(sum(b['reel'] for b in res.values()), 2), 'total_valeur_eur': round(sum(b['valeur'] for b in res.values()), 2), 'ops': sortie},
          io.open('C:/tmp/analyse_prix.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('jobs 30j :', len(ops30), '| facture reelle repartie :', round(sum(b['reel'] for b in res.values()), 2), '€ | valeur des credits :', round(sum(b['valeur'] for b in res.values()), 2), '€ | facture hors operations :', round(sans_op, 2), '€')
print('override R2 :', 'present (%d cles)' % len(override.get('prices', override)) if override else 'absent', '| bucket', BUCKET)
print('%-30s %5s %4s %6s %7s %8s %8s %6s %7s' % ('operation', 'n', 'ok', 'cred', 'valeur', 'reel €', 'cout/op', 'ratio', 'p min x4'))
for k, v in sorted(sortie.items(), key=lambda kv: (kv[1]['ratio'] is None, kv[1]['ratio'] or 0)):
    print('%-30s %5d %4d %6d %7.2f %8.3f %8.4f %6s %7s' % (k[:30], v['n'], v['ok'], v['credits'], v['valeur_eur'], v['reel_eur'], v['cout_op_eur'], v['ratio'], v['prix_min_x4']))
