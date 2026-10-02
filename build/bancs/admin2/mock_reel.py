import json, re, io, os, sys
sys.argv = ['x']
src = open('C:/tmp/projection_prix.py', encoding='utf-8').read().split("print('%-30s")[0]
g = {}
exec(compile(src, 'p', 'exec'), g)
res = g['res']; EUR = g['EUR_CRED']
w = io.open('C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/cloud/src/worker.ts', encoding='utf-8').read()
blk = w[w.index('const COUT_ESTIME_PAR_PRIX'):]; blk = blk[:blk.index('};')]
est = {k: float(v) for k, v in re.findall(r'(\w+): ([0-9.]+)', blk.split('{', 1)[1])}
base = ['text2image', 'tpose', 'rectify', 'back-view', 'sheet', 'mvadapter', 'remove-bg', 'modify', 'auto_inpaint', 'mask_inpaint', 'face_fix_image', 'upscale', 'tex_variant', 'recolor', 'outfit', 'segment-image',
        'mesh', 'retexture', 'reshape', 'segment', 'rig', 'animate', 'animate_fbx', 'construction3d', 'mesh-convert']
base += ['mesh-op:' + o for o in 'smooth decimate center fix_normals fill_holes subdivide material material_adjust retex_swap watertight align_texture resize explode texture_var enhance_tex region_retex name_parts'.split()]
base += ['mesh-op-client:' + o for o in 'smooth decimate subdivide fix_normals fill_holes center paint_emissive paint_mesh clone3d skin_paint'.split()]
base += ['manual-tool:' + o for o in 'skeleton_points rig_joints symmetrize paint extend clone_stamp color_pick export_image export_glb export_anim open_anim'.split()]
types = {}
for k, b in res.items():
    types[k] = {'count': b['n'], 'failed': b['n'] - b['ok'], 'credits': b['enr'], 'credits_now': b['now'], 'value_eur': round(b['enr'] * EUR, 3), 'value_now_eur': round(b['now'] * EUR, 3), 'real_eur': round(b['reel'] if 'rattache' not in b else b['reel'], 3), 'paid_eur': 0}
# le reel d'une annexe rattachee dans la projection a deja ete ajoute au parent ; le serveur, lui, renvoie le reel PROPRE de chaque ligne -> on le retire du parent
for cle, par in g['PARENT'].items():
    if cle in res and par in res:
        types[par]['real_eur'] = round(types[par]['real_eur'] - res[cle]['reel'], 3)

# --- options de la generation 3D : meme decoupage que _decomposerMeshAuPrix du worker
import collections
def decomp(o, p):
    pr = o.get('preset')
    base = p['mesh_ultra_8k'] if pr == 'ultra_8k' else p['mesh_quality'] if pr == 'quality' else p['mesh_balanced'] if pr == 'balanced' else p['mesh_fast']
    opt = collections.OrderedDict()
    if o.get('rectify'): opt['rectify'] = p['mesh_rectify']
    if o.get('refine'): opt['refine'] = p['mesh_refine']
    ult = o.get('ultra_q')
    if o.get('quality_plus') and not ult: opt['quality_plus'] = p['mesh_quality_plus']
    if ult: opt['ultra_q'] = p['mesh_ultra_q']
    if o.get('ultra_hd') and pr != 'ultra_8k': opt['ultra_hd'] = p['mesh_ultra_hd']
    if o.get('face_fix'): opt['face_fix'] = p['mesh_face_fix']
    if o.get('smooth'): opt['smooth'] = p['mesh_smooth']
    opt['max_tris'] = g['tris'](o.get('max_tris') or 500000, p['mesh_tris_500k'], p['mesh_tris_base'], p['mesh_tris_courbe_pct'])
    return base, opt
P_ = g['P']; base_tot = 0
for x in g['ops30']:
    if x['op'] == 'mesh' and x['ok']:
        b, op = decomp(x['o'], P_); base_tot += b
        for k, c in op.items():
            r = types.setdefault('mesh-option:' + k, {'count': 0, 'failed': 0, 'credits': 0, 'credits_now': 0, 'value_eur': 0, 'value_now_eur': 0, 'real_eur': 0, 'paid_eur': 0})
            r['count'] += 1; r['credits'] += c; r['credits_now'] += c; r['value_eur'] = round(r['value_eur'] + c * EUR, 3); r['value_now_eur'] = round(r['value_now_eur'] + c * EUR, 3)
types['mesh']['credits_now'] = base_tot; types['mesh']['value_now_eur'] = round(base_tot * EUR, 3)
base += ['mesh-option:' + o for o in 'rectify quality_plus ultra_q ultra_hd smooth max_tris multiref refine face_fix'.split()]
for k in ('rectify','sheet','mvadapter'):
    if k in types and types[k]['credits'] == 0: types[k]['credits_now'] = 0; types[k]['value_now_eur'] = 0
json.dump({'types': types, 'connues': base, 'estimes': est, 'grille': json.load(open('C:/tmp/grille_candidate.json', encoding='utf-8'))}, open('C:/tmp/mock_reel.json', 'w', encoding='utf-8'), ensure_ascii=False)
print(len(types), 'types', len(base), 'connues', len(est), 'estimes')
