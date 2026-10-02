"""Vues laterales / dos / dessus par RealVisXL V4.0 (SDXL) PARTANT DE LA 3D : rendu de la texture actuelle sous les cameras de MV-Adapter, puis img2img guide par
  - les normales de la 3D (ControlNet-Union, mode NORMAL, normales plates de chaque triangle en repere camera : fiables meme si les normales de sommets de TRELLIS ne le sont pas),
  - la vue de DEVANT du projet en reference (IP-Adapter), et le texte du projet.
Meme recette que « Detail++ » (scripts/detail_synth.py + /refine_geo de sdxl_server.py), mais sur les cameras orthographiques connues, pour reporter ensuite avec projeter_vues_ortho.py.
Usage : python refine_vues_realvis.py <maillage.glb> <dossier_ig2mv(vues.json, normalisation.json)> <sortie> --ref <image_de_devant.png> [--prompt ...] [--force 0.4] [--cns 0.8] [--ip 0.6] [--vues 1,2,3,4,5]"""
import argparse, json, math, os, shutil, sys, time
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('glb'); ap.add_argument('dossier'); ap.add_argument('sortie')
ap.add_argument('--ref', required=True)
ap.add_argument('--prompt', default='')
ap.add_argument('--negatif', default='blurry, low quality, text, watermark, deformed, window, glass, transparent, black panel, graffiti, lettering')
ap.add_argument('--force', type=float, default=0.4)       # force du img2img (0,35 = valeur de Detail++)
ap.add_argument('--cns', type=float, default=0.8)         # poids du ControlNet normales
ap.add_argument('--ip', type=float, default=0.6)          # poids de la reference (IP-Adapter)
ap.add_argument('--guidage', type=float, default=6.0)
ap.add_argument('--pas', type=int, default=50)
ap.add_argument('--graine', type=int, default=42)
ap.add_argument('--vues', default='1,2,3,4,5')
ap.add_argument('--taille', type=int, default=1024)
ap.add_argument('--sans-ip', action='store_true')
args = ap.parse_args()
os.makedirs(args.sortie, exist_ok=True)
T0 = time.time()


def log(*a):
    print('[%6.1fs]' % (time.time() - T0), *a, flush=True)


for f in ('vues.json', 'normalisation.json'):
    shutil.copy(os.path.join(args.dossier, f), os.path.join(args.sortie, f))
vj = json.load(open(os.path.join(args.dossier, 'vues.json'))); nj = json.load(open(os.path.join(args.dossier, 'normalisation.json')))
EL, AZ, DIST, CADRE = vj['elevations'], vj['azimuts'], vj['distance'], vj['cadre']
centre = np.array(nj['centre']); echelle = nj['echelle']
VUES = [int(x) for x in args.vues.split(',') if x]

# ───────────── rendus : couleur de la texture actuelle + normales plates en repere camera
import trimesh, moderngl
sc = trimesh.load(args.glb, force='scene', process=False); mesh = list(sc.geometry.values())[0]
V = np.asarray(mesh.vertices, dtype=np.float64); F = np.asarray(mesh.faces, dtype=np.int32); UV = np.asarray(mesh.visual.uv, dtype=np.float32)
mat = mesh.visual.material
ATLAS = np.asarray((getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)).convert('RGB')); AH = ATLAS.shape[0]
M2S = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
Vstd = (M2S @ ((V - centre) / echelle * 0.5).T).T.astype(np.float32)


def camera(el, az):
    e, a = math.radians(el), math.radians(az)
    p = np.array([DIST * math.cos(e) * math.cos(a), DIST * math.cos(e) * math.sin(a), DIST * math.sin(e)])
    look = -p / np.linalg.norm(p)
    droite = np.cross(look, [0, 0, 1.0]); droite /= np.linalg.norm(droite)
    haut = np.cross(droite, look); haut /= np.linalg.norm(haut)
    return p, look, droite, haut


ctx = moderngl.create_standalone_context()
prog = ctx.program(vertex_shader="""#version 330
uniform vec3 cp; uniform vec3 look; uniform vec3 droite; uniform vec3 haut; uniform float cadre;
in vec3 in_pos; in vec2 in_uv; out vec2 uv; out vec3 vp;
void main(){
  vec3 d = in_pos - cp; float xc = dot(droite, d), yc = dot(haut, d), prof = dot(look, d);
  gl_Position = vec4(xc / cadre, -yc / cadre, (prof - 0.1) / 99.9 * 2.0 - 1.0, 1.0); uv = in_uv; vp = vec3(xc, yc, -prof);
}""", fragment_shader="""#version 330
uniform sampler2D tex; in vec2 uv; in vec3 vp; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){
  vec3 n = normalize(cross(dFdx(vp), dFdy(vp)));
  if (n.z < 0.0) n = -n;
  o0 = vec4(texture(tex, uv).rgb, 1.0); o1 = vec4(n * 0.5 + 0.5, 1.0);
}""")
vbo = ctx.buffer(np.hstack([Vstd, UV]).astype('f4').tobytes()); ibo = ctx.buffer(F.astype('i4').tobytes())
vao = ctx.vertex_array(prog, [(vbo, '3f 2f', 'in_pos', 'in_uv')], ibo)
tex = ctx.texture((AH, AH), 3, np.ascontiguousarray(np.flipud(ATLAS)).tobytes()); tex.build_mipmaps(); tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tex.anisotropy = 8.0
tex.use(0); prog['tex'].value = 0
S = args.taille
c0 = ctx.texture((S, S), 4, dtype='f1'); c1 = ctx.texture((S, S), 4, dtype='f1'); dp = ctx.depth_renderbuffer((S, S))
fbo = ctx.framebuffer(color_attachments=[c0, c1], depth_attachment=dp); fbo.use()
ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE)
RENDUS, NORMALES = {}, {}
for k in VUES:
    p, look, droite, haut = camera(EL[k], AZ[k])
    prog['cp'].value = tuple(p); prog['look'].value = tuple(look); prog['droite'].value = tuple(droite); prog['haut'].value = tuple(haut); prog['cadre'].value = CADRE
    fbo.clear(0.5, 0.5, 0.5, 0.0, depth=1.0)
    vao.render(moderngl.TRIANGLES)
    rgba = np.frombuffer(fbo.read(attachment=0, components=4), np.uint8).reshape(S, S, 4)
    nrm = np.frombuffer(fbo.read(attachment=1, components=4), np.uint8).reshape(S, S, 4)
    masque = rgba[..., 3:4] > 0
    RENDUS[k] = np.where(masque, rgba[..., :3], 255).astype(np.uint8)                       # fond blanc, comme Detail++
    NORMALES[k] = np.where(masque, nrm[..., :3], np.array([128, 128, 255], np.uint8)).astype(np.uint8)   # fond neutre (0,5 0,5 1)
    Image.fromarray(RENDUS[k]).save(os.path.join(args.sortie, 'rendu_%d.png' % k)); Image.fromarray(NORMALES[k]).save(os.path.join(args.sortie, 'normales_%d.png' % k))
log('rendus et normales faits pour les vues', VUES)

# ───────────── RealVisXL + ControlNet-Union (normales) + IP-Adapter (vue de devant)
cache = os.path.join(os.environ['APPDATA'], 'myfabmesh-ai', 'hf_cache')
os.environ.setdefault('HF_HOME', cache); os.environ.setdefault('HF_HUB_CACHE', os.path.join(cache, 'hub')); os.environ['HF_HUB_OFFLINE'] = '1'
import torch
from diffusers import AutoencoderKL, ControlNetUnionModel, StableDiffusionXLControlNetUnionImg2ImgPipeline
cn = ControlNetUnionModel.from_pretrained('xinsir/controlnet-union-sdxl-1.0', torch_dtype=torch.float16, use_safetensors=True)
pipe = StableDiffusionXLControlNetUnionImg2ImgPipeline.from_pretrained('SG161222/RealVisXL_V4.0', controlnet=cn, torch_dtype=torch.float16, use_safetensors=True)
pipe.vae = AutoencoderKL.from_pretrained('madebyollin/sdxl-vae-fp16-fix', torch_dtype=torch.float16); pipe.vae.config.force_upcast = False
ip_ok = False
if not args.sans_ip:
    try:
        pipe.load_ip_adapter('h94/IP-Adapter', subfolder='sdxl_models', weight_name='ip-adapter_sdxl.bin'); pipe.set_ip_adapter_scale(args.ip); ip_ok = True
    except Exception as e:
        log('IP-Adapter indisponible :', repr(e)[:200])
pipe.enable_model_cpu_offload(); pipe.enable_vae_tiling()
log('pipeline chargee ; IP-Adapter', 'ON' if ip_ok else 'OFF')
ref = Image.open(args.ref).convert('RGB')
for k in VUES:
    t1 = time.time()
    kw = dict(prompt=(args.prompt + ', photorealistic, high quality, detailed') if args.prompt else 'photorealistic, high quality, detailed', negative_prompt=args.negatif,
              image=Image.fromarray(RENDUS[k]), control_image=Image.fromarray(NORMALES[k]), control_mode=4, strength=args.force, num_inference_steps=args.pas,
              guidance_scale=args.guidage, controlnet_conditioning_scale=args.cns, control_guidance_end=1.0, generator=torch.Generator(device='cuda').manual_seed(args.graine))
    if ip_ok:
        kw['ip_adapter_image'] = ref
    with torch.inference_mode():
        out = pipe(**kw).images[0]
    out.save(os.path.join(args.sortie, 'vue_%d.png' % k))
    log('vue %d faite (%.1f s)' % (k, time.time() - t1))
json.dump({'engine': 'realvisxl_v4_controlnet_union_normal_ip', 'prompt': args.prompt, 'force': args.force, 'cns': args.cns, 'ip': args.ip if ip_ok else 0, 'guidage': args.guidage, 'pas': args.pas, 'graine': args.graine},
          open(os.path.join(args.sortie, 'refine.json'), 'w'))
log('TERMINE')
