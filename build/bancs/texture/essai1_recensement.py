"""Essai #1 (plan texture du 03/10/2026) : recensement de la realite servie. LECTURE SEULE (R2 + Supabase), agregats uniquement."""
import sys, os, json, struct, collections, re, datetime, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(__file__))
import _r2, _sb
s3, cfg = _r2.client(); B = cfg['R2_BUCKET']

def dims_image(b):
    if b[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', b[16:24]), 'png'
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        t = b[12:16]
        if t == b'VP8X': return (1 + int.from_bytes(b[24:27], 'little'), 1 + int.from_bytes(b[27:30], 'little')), 'webp'
        if t == b'VP8 ': return (struct.unpack('<H', b[26:28])[0] & 0x3fff, struct.unpack('<H', b[28:30])[0] & 0x3fff), 'webp'
        if t == b'VP8L':
            v = int.from_bytes(b[21:25], 'little'); return ((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1), 'webp'
    if b[:2] == b'\xff\xd8':
        i = 2
        while i < len(b) - 9:
            if b[i] != 0xff: i += 1; continue
            m = b[i + 1]
            if m in (0xc0, 0xc1, 0xc2): return (struct.unpack('>H', b[i + 7:i + 9])[0], struct.unpack('>H', b[i + 5:i + 7])[0]), 'jpeg'
            i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
    return None, '?'

def atlas(key):
    try:
        h = s3.get_object(Bucket=B, Key=key, Range='bytes=0-262143')['Body'].read()
        jl = struct.unpack('<I', h[12:16])[0]
        if 20 + jl > len(h): h = s3.get_object(Bucket=B, Key=key, Range='bytes=0-%d' % (20 + jl + 8))['Body'].read()
        js = json.loads(h[20:20 + jl].decode('utf-8'))
        binstart = 20 + jl + 8
        mats = js.get('materials', []); idx = None
        if mats: idx = mats[0].get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index')
        tex = js['textures'][idx] if idx is not None else js['textures'][0]
        src = tex.get('source', tex.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))
        bv = js['bufferViews'][js['images'][src]['bufferView']]
        o = binstart + bv.get('byteOffset', 0)
        hb = s3.get_object(Bucket=B, Key=key, Range='bytes=%d-%d' % (o, o + 70000))['Body'].read()
        d, f = dims_image(hb)
        return d, f
    except Exception as e:
        return None, 'err:' + type(e).__name__

objs = []
for p in s3.get_paginator('list_objects_v2').paginate(Bucket=B, Prefix='mesh/'):
    for o in p.get('Contents', []):
        if o['Key'].endswith('.glb'): objs.append((o['Key'], o['Size'], o['LastModified']))
with cf.ThreadPoolExecutor(12) as ex: res = list(ex.map(lambda t: atlas(t[0]), objs))
glb = {k: dict(taille=s, date=m.strftime('%Y-%m-%d'), atlas=(d[0] if d else None), fmt=f) for (k, s, m), (d, f) in zip(objs, res)}
print('GLB R2 :', len(glb), '; atlas lus :', sum(1 for g in glb.values() if g['atlas']))
c_atlas = collections.Counter(g['atlas'] for g in glb.values()); print('atlas (tous les GLB) :', sorted(c_atlas.items(), key=lambda x: (x[0] is None, x[0])))

# jobs
c = _sb.cfg(); rows = []; off = 0
while True:
    r = _sb.get('jobs?select=id,type,status,options,mesh_url,created_at,mode&type=eq.mesh&order=created_at.asc&limit=1000&offset=%d' % off, c); rows += r; off += 1000
    if len(r) < 1000: break
def cle(u):
    m = re.search(r'(mesh/modal_[0-9a-f]+\.glb)', u or ''); return m.group(1) if m else None
J = []
for r in rows:
    o = r['options'] or {}
    if r['status'] != 'succeeded' or r['mode'] != 'standard': continue
    k = cle(r['mesh_url']); g = glb.get(k) if k else None
    J.append(dict(date=r['created_at'][:10], preset=o.get('preset'), ultra_q=bool(o.get('ultra_q')), quality_plus=bool(o.get('quality_plus')), ultra_hd=bool(o.get('ultra_hd')), fast=bool(o.get('fast')),
                  refine=bool(o.get('refine')), backend=o.get('backend'), atlas=(g or {}).get('atlas'), glb=bool(g), max_tris=o.get('max_tris'), duree_s=(o.get('duration_ms') or 0) / 1000))
print('jobs mesh reussis (generations standard) :', len(J), '; avec GLB lisible dans R2 :', sum(1 for j in J if j['atlas']))
out = {'essai': 1, 'glb_r2': len(glb), 'glb_atlas_lus': sum(1 for g in glb.values() if g['atlas']), 'atlas_tous_glb': {str(k): v for k, v in c_atlas.items()}, 'jobs_mesh_reussis': len(J)}
APRES = '2026-09-27'
def tab(sub, nom):
    n = len(sub); cp = collections.Counter(j['preset'] or '(aucun)' for j in sub); ca = collections.Counter(j['atlas'] for j in sub if j['atlas'])
    na = sum(ca.values()); a1024 = ca.get(1024, 0)
    uq = sum(1 for j in sub if j['ultra_q']); qp = sum(1 for j in sub if j['quality_plus']); uh = sum(1 for j in sub if j['ultra_hd'])
    d = dict(n=n, presets=dict(cp), atlas_mesures=dict((str(k), v) for k, v in ca.items()), n_atlas=na, part_atlas_1024_pct=round(100 * a1024 / na, 1) if na else None,
             ultra_q=uq, ultra_q_pct=round(100 * uq / n, 1) if n else None, quality_plus=qp, ultra_hd=uh, ultra_hd_pct=round(100 * uh / n, 1) if n else None)
    print(nom, json.dumps(d, ensure_ascii=False)); out[nom] = d
tab(J, 'toutes'); tab([j for j in J if j['date'] >= APRES], 'depuis_2026-09-27 (paliers cote serveur)'); tab([j for j in J if j['date'] < APRES], 'avant_2026-09-27')
rec = [j for j in J if j['date'] >= '2026-10-01']; tab(rec, 'depuis_2026-10-01')
# atlas 1024 / palier et ultra_hd (4096 -> 8192 apres ESRGAN)
croise = collections.Counter((j['preset'] or '(aucun)', j['ultra_hd'], j['atlas']) for j in J if j['atlas' ] and j['date'] >= APRES)
out['croise_depuis_09_27_preset_ultrahd_atlas'] = {str(k): v for k, v in croise.items()}
print('croise (preset, ultra_hd, atlas) depuis 09-27 :', dict(croise))
# part des generations "Fast"
def part(sub):
    return round(100 * sum(1 for j in sub if (j['preset'] == 'fast' or (j['preset'] is None and not j['ultra_hd'] and not j['ultra_q'] and not j['quality_plus']))) / max(len(sub), 1), 1)
out['part_fast_depuis_09_27_pct'] = part([j for j in J if j['date'] >= APRES]); out['part_fast_toutes_pct'] = part(J)
print('part Fast :', out['part_fast_toutes_pct'], '% (toutes) ;', out['part_fast_depuis_09_27_pct'], '% (depuis 09-27)')
json.dump(out, open('C:/tmp/texture_essais/essai1.json', 'w'), indent=1, ensure_ascii=False)
