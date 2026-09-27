"""Sauvegarde COMPLETE des donnees de production, en LECTURE SEULE.

- R2 (bucket myfabmesh-meshes) : tous les objets, arborescence conservee ;
- Supabase : toutes les tables exposees par l'API REST + la liste des comptes (auth).

Destination : HORS du depot (le depot est PUBLIC et ces donnees contiennent des
comptes clients, leurs fichiers et les reglages internes de l'admin) :
  C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself_sauvegardes/<date>/

Reprise : un objet R2 deja present avec la meme taille n'est pas retelecharge.
Usage (depuis cloud/) : python scripts/sauvegarde-donnees.py
"""
import concurrent.futures as cf
import datetime
import io
import json
import os
import sys
import urllib.parse
import urllib.request

import boto3

DEST_RACINE = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself_sauvegardes'
BUCKET = 'myfabmesh-meshes'

cfg = {}
for l in io.open('.env.local', encoding='utf-8'):
    l = l.strip()
    if l and not l.startswith('#') and '=' in l:
        k, v = l.split('=', 1)
        cfg[k.strip()] = v.strip().strip('"').strip("'")

jour = datetime.date.today().isoformat()
dest = os.path.join(DEST_RACINE, jour)
os.makedirs(dest, exist_ok=True)
journal = io.open(os.path.join(dest, 'journal.txt'), 'a', encoding='utf-8')


def log(*a):
    m = ' '.join(str(x) for x in a)
    print(m, flush=True)
    journal.write(m + '\n'); journal.flush()


# ---------------------------------------------------------------- Supabase
url = cfg.get('SUPABASE_URL') or cfg.get('NEXT_PUBLIC_SUPABASE_URL')
cle = cfg['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': cle, 'Authorization': 'Bearer ' + cle, 'User-Agent': 'Mozilla/5.0'}


def get(u, h=None):
    return urllib.request.urlopen(urllib.request.Request(u, headers={**H, **(h or {})}), timeout=120)


sb = os.path.join(dest, 'supabase'); os.makedirs(sb, exist_ok=True)
spec = json.load(get(url + '/rest/v1/'))
tables = sorted(p.strip('/') for p in spec.get('paths', {}) if p.count('/') == 1 and p != '/' and not p.startswith('/rpc'))
for t in tables:
    lignes, debut = [], 0
    while True:
        r = get(f"{url}/rest/v1/{urllib.parse.quote(t)}?select=*", {'Range-Unit': 'items', 'Range': f'{debut}-{debut + 999}'})
        lot = json.load(r)
        lignes += lot
        if len(lot) < 1000:
            break
        debut += 1000
    io.open(os.path.join(sb, t + '.json'), 'w', encoding='utf-8').write(json.dumps(lignes, ensure_ascii=False, indent=1, default=str))
    log(f'supabase {t}: {len(lignes)} lignes')
comptes, page = [], 1
while True:
    lot = json.load(get(f'{url}/auth/v1/admin/users?page={page}&per_page=200')).get('users', [])
    comptes += lot
    if len(lot) < 200:
        break
    page += 1
io.open(os.path.join(sb, '_auth_users.json'), 'w', encoding='utf-8').write(json.dumps(comptes, ensure_ascii=False, indent=1, default=str))
log(f'supabase comptes (auth): {len(comptes)}')

# ---------------------------------------------------------------- R2
s3 = boto3.client('s3', endpoint_url='https://%s.r2.cloudflarestorage.com' % cfg['R2_ACCOUNT_ID'],
                  aws_access_key_id=cfg['R2_ACCESS_KEY_ID'], aws_secret_access_key=cfg['R2_SECRET_ACCESS_KEY'],
                  region_name='auto')
objets = [o for p in s3.get_paginator('list_objects_v2').paginate(Bucket=BUCKET) for o in p.get('Contents', [])]
total = sum(o['Size'] for o in objets)
log(f'r2: {len(objets)} objets, {total / 1e9:.2f} Go')
racine_r2 = os.path.join(dest, 'r2')


def copier(o):
    cible = os.path.join(racine_r2, *o['Key'].split('/'))
    if os.path.exists(cible) and os.path.getsize(cible) == o['Size']:
        return o['Size'], 'deja'
    os.makedirs(os.path.dirname(cible), exist_ok=True)
    s3.download_file(BUCKET, o['Key'], cible + '.part')
    os.replace(cible + '.part', cible)
    return o['Size'], 'copie'


fait = 0; echecs = []
with cf.ThreadPoolExecutor(8) as ex:
    futurs = {ex.submit(copier, o): o['Key'] for o in objets}
    for i, f in enumerate(cf.as_completed(futurs), 1):
        try:
            t, _ = f.result(); fait += t
        except Exception as e:
            echecs.append((futurs[f], str(e)))
        if i % 100 == 0 or i == len(objets):
            log(f'r2: {i}/{len(objets)} objets, {fait / 1e9:.2f}/{total / 1e9:.2f} Go')
io.open(os.path.join(dest, 'r2_inventaire.json'), 'w', encoding='utf-8').write(
    json.dumps([{'cle': o['Key'], 'taille': o['Size'], 'modifie': str(o['LastModified'])} for o in objets], ensure_ascii=False, indent=1))
log(f'r2 echecs: {len(echecs)}', echecs[:5])
log('=== fin', datetime.datetime.now().isoformat(timespec='seconds'))
sys.exit(1 if echecs else 0)
