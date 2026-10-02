"""MV-Adapter « image + forme » (ig2mv-sdxl) SANS nvdiffrast (licence non commerciale de NVIDIA, volontairement absente de l'appli).
Les cartes de la forme (position + normales vues sous chacune des 6 cameras orthographiques de MV-Adapter) sont calculees ici avec moderngl (MIT).
Conventions reprises de MV-Adapter (scripts/inference_ig2mv_sdxl.py, mvadapter/utils/mesh_utils) :
  - maillage : sommets centres puis divises par max|v| et multiplies par 0.5 ; axes mesh2std pour (haut=+y, avant=+x) : v_std = (x, -z, y)
  - cameras orthographiques : elevations [0,0,0,0,89.99,-89.99], azimuts [0,90,180,270,180,180] - 90, distance 1.8, cadre [-0.55, 0.55]
  - carte de controle = concat(pos + 0.5, normale / 2 + 0.5) (6 canaux), fond = 0.5
Usage : python ig2mv_sans_nvdiffrast.py <maillage.glb> <image.png> <dossier_sortie> [--pas 40] [--graine 42] [--cartes-seulement]"""
import argparse, json, math, os, sys, time
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('glb'); ap.add_argument('image'); ap.add_argument('sortie')
ap.add_argument('--pas', type=int, default=40)
ap.add_argument('--guidage', type=float, default=3.0)
ap.add_argument('--graine', type=int, default=42)
ap.add_argument('--taille', type=int, default=768)
ap.add_argument('--ref-scale', type=float, default=1.0)
ap.add_argument('--cartes-seulement', action='store_true')
ap.add_argument('--base', default='stabilityai/stable-diffusion-xl-base-1.0')
args = ap.parse_args()
os.makedirs(args.sortie, exist_ok=True)
T0 = time.time()


def log(*a):
    print('[%6.1fs]' % (time.time() - T0), *a, flush=True)


H = W = args.taille
EL = [0, 0, 0, 0, 89.99, -89.99]
AZ = [x - 90 for x in [0, 90, 180, 270, 180, 180]]
DIST, CADRE = 1.8, 0.55

# ───────────── maillage (comme load_mesh(rescale=True), avec centrage)
import trimesh
sc = trimesh.load(args.glb, force='scene', process=False)
mesh = list(sc.geometry.values())[0]
V = np.asarray(mesh.vertices, dtype=np.float64); F = np.asarray(mesh.faces, dtype=np.int32); N = np.asarray(mesh.vertex_normals, dtype=np.float64)
centre = (V.min(0) + V.max(0)) / 2
Vc = V - centre
echelle = np.abs(Vc).max()
Vs = Vc / echelle * 0.5
M2S = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)          # v_std = (x, -z, y)
Vstd = (M2S @ Vs.T).T.astype(np.float32); Nstd = (M2S @ N.T).T.astype(np.float32)
Nstd /= np.maximum(np.linalg.norm(Nstd, axis=1, keepdims=True), 1e-8)
json.dump({'centre': centre.tolist(), 'echelle': float(echelle)}, open(os.path.join(args.sortie, 'normalisation.json'), 'w'))
log('maillage', len(V), 'sommets ; echelle', round(float(echelle), 4))


def camera(el, az):
    e, a = math.radians(el), math.radians(az)
    p = np.array([DIST * math.cos(e) * math.cos(a), DIST * math.cos(e) * math.sin(a), DIST * math.sin(e)])
    look = -p / np.linalg.norm(p)
    droite = np.cross(look, [0, 0, 1.0]); droite /= np.linalg.norm(droite)
    haut = np.cross(droite, look); haut /= np.linalg.norm(haut)
    return p, look, droite, haut


# ───────────── rendu des cartes (moderngl)
import moderngl
ctx = moderngl.create_standalone_context()
prog = ctx.program(vertex_shader="""#version 330
uniform vec3 cp; uniform vec3 look; uniform vec3 droite; uniform vec3 haut; uniform float cadre;
in vec3 in_pos; in vec3 in_nrm; out vec3 pos; out vec3 nrm;
void main(){
  vec3 d = in_pos - cp;
  float xc = dot(droite, d), yc = dot(haut, d), prof = dot(look, d);
  gl_Position = vec4(xc / cadre, -yc / cadre, (prof - 0.1) / 99.9 * 2.0 - 1.0, 1.0);
  pos = in_pos; nrm = in_nrm;
}""", fragment_shader="""#version 330
in vec3 pos; in vec3 nrm; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ o0 = vec4(pos, 1.0); o1 = vec4(normalize(nrm), 1.0); }""")
vbo = ctx.buffer(np.hstack([Vstd, Nstd]).astype('f4').tobytes()); ibo = ctx.buffer(F.astype('i4').tobytes())
vao = ctx.vertex_array(prog, [(vbo, '3f 3f', 'in_pos', 'in_nrm')], ibo)
c0 = ctx.texture((W, H), 4, dtype='f4'); c1 = ctx.texture((W, H), 4, dtype='f4'); dp = ctx.depth_renderbuffer((W, H))
fbo = ctx.framebuffer(color_attachments=[c0, c1], depth_attachment=dp); fbo.use()
ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE)
controle = np.zeros((6, 6, H, W), np.float32); masques = []
for i in range(6):
    p, look, droite, haut = camera(EL[i], AZ[i])
    prog['cp'].value = tuple(p); prog['look'].value = tuple(look); prog['droite'].value = tuple(droite); prog['haut'].value = tuple(haut); prog['cadre'].value = CADRE
    fbo.clear(0.0, 0.0, 0.0, 0.0, depth=1.0)
    vao.render(moderngl.TRIANGLES)
    pos = np.frombuffer(fbo.read(attachment=0, components=4, dtype='f4'), np.float32).reshape(H, W, 4)
    nrm = np.frombuffer(fbo.read(attachment=1, components=4, dtype='f4'), np.float32).reshape(H, W, 4)
    masque = pos[..., 3] > 0.5
    P = np.where(masque[..., None], pos[..., :3], 0.0); Nn = np.where(masque[..., None], nrm[..., :3], 0.0)
    controle[i, :3] = np.transpose(np.clip(P + 0.5, 0, 1), (2, 0, 1)); controle[i, 3:] = np.transpose(np.clip(Nn / 2 + 0.5, 0, 1), (2, 0, 1))
    masques.append(masque)
    Image.fromarray((np.clip(P + 0.5, 0, 1) * 255).astype(np.uint8)).save(os.path.join(args.sortie, 'carte_pos_%d.png' % i))
    Image.fromarray((np.clip(Nn / 2 + 0.5, 0, 1) * 255).astype(np.uint8)).save(os.path.join(args.sortie, 'carte_nrm_%d.png' % i))
    Image.fromarray((masque * 255).astype(np.uint8)).save(os.path.join(args.sortie, 'masque_%d.png' % i))
np.save(os.path.join(args.sortie, 'controle.npy'), controle)
log('cartes de forme calculees (6 vues) ; pixels couverts :', [int(m.sum()) for m in masques])
if args.cartes_seulement:
    sys.exit(0)

# ───────────── image de reference (comme preprocess_image, avec un detourage u2net a la place de BiRefNet)
import importlib.util
spec = importlib.util.spec_from_file_location('detourage', 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/modal_app/_detourage.py')
det = importlib.util.module_from_spec(spec)
os.environ['U2NET_HOME'] = os.path.join(os.environ['APPDATA'], 'myfabmesh-ai', 'ai-cache', 'u2net')
spec.loader.exec_module(det)
det.POIDS_U2NET = os.path.join(os.environ['U2NET_HOME'], 'u2net.onnx')
photo = Image.open(args.image).convert('RGB')
alpha = det.masque(photo)
rgba = photo.copy(); rgba.putalpha(alpha)
a = np.array(rgba); alpha_b = a[..., 3] > 0
ys, xs = np.where(alpha_b)
y0, y1 = max(ys.min() - 1, 0), min(ys.max() + 1, a.shape[0]); x0, x1 = max(xs.min() - 1, 0), min(xs.max() + 1, a.shape[1])
centre_img = a[y0:y1, x0:x1]; h, w, _ = centre_img.shape
if h > w:
    w = int(w * (H * 0.9) / h); h = int(H * 0.9)
else:
    h = int(h * (W * 0.9) / w); w = int(W * 0.9)
centre_img = np.array(Image.fromarray(centre_img).resize((w, h)))
sh, sw = (H - h) // 2, (W - w) // 2
img = np.zeros((H, W, 4), np.uint8); img[sh:sh + h, sw:sw + w] = centre_img
img = img.astype(np.float32) / 255.0
img = img[:, :, :3] * img[:, :, 3:4] + (1 - img[:, :, 3:4]) * 0.5
reference = Image.fromarray((img * 255).clip(0, 255).astype(np.uint8))
reference.save(os.path.join(args.sortie, 'reference.png'))
log('image de reference preparee')

# ───────────── pipeline (infrastructure du script de l'appli : modules optionnels factices, correctif cpu_offload)
R = os.path.join(os.environ['LOCALAPPDATA'], 'Programs', 'myfabmesh-ai', 'resources')
sys.path.insert(0, os.path.join(R, 'scripts'))
import multiview_mvadapter_gen as G          # execute les stubs et le correctif au chargement
import torch
from diffusers import AutoencoderKL
from mvadapter.pipelines.pipeline_mvadapter_i2mv_sdxl import MVAdapterI2MVSDXLPipeline
from mvadapter.schedulers.scheduling_shift_snr import ShiftSNRScheduler
from mvadapter.models.attention_processor import DecoupledMVRowColSelfAttnProcessor2_0

dtype = torch.float16
vae = AutoencoderKL.from_pretrained('madebyollin/sdxl-vae-fp16-fix', torch_dtype=dtype)
pipe = MVAdapterI2MVSDXLPipeline.from_pretrained(args.base, vae=vae, torch_dtype=dtype, variant='fp16')
pipe.scheduler = ShiftSNRScheduler.from_scheduler(pipe.scheduler, shift_mode='interpolated', shift_scale=8.0, scheduler_class=None)
pipe.init_custom_adapter(num_views=6, self_attn_processor=DecoupledMVRowColSelfAttnProcessor2_0)
pipe.load_custom_adapter('huanngzh/mv-adapter', weight_name='mvadapter_ig2mv_sdxl.safetensors')
pipe.to(device='cuda', dtype=dtype)
pipe.cond_encoder.to(device='cuda', dtype=dtype)
pipe.enable_vae_slicing()
pipe.enable_model_cpu_offload()
log('pipeline chargee ; generation (%d pas)...' % args.pas)
images = pipe('high quality', height=H, width=W, num_inference_steps=args.pas, guidance_scale=args.guidage, num_images_per_prompt=6,
              control_image=torch.from_numpy(controle).to('cuda'), control_conditioning_scale=1.0, reference_image=reference,
              reference_conditioning_scale=args.ref_scale, negative_prompt='watermark, ugly, deformed, noisy, blurry, low contrast',
              cross_attention_kwargs={'scale': 1.0}, generator=torch.Generator(device='cuda').manual_seed(args.graine)).images
for i, im in enumerate(images):
    im.save(os.path.join(args.sortie, 'vue_%d.png' % i))
json.dump({'engine': 'mvadapter_ig2mv', 'elevations': EL, 'azimuts': AZ, 'distance': DIST, 'cadre': CADRE, 'pas': args.pas, 'graine': args.graine,
           'duree_s': round(time.time() - T0, 1)}, open(os.path.join(args.sortie, 'vues.json'), 'w'))
log('TERMINE : 6 vues enregistrees')
