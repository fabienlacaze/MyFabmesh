"""Projection de la photo sur l'atlas (essais #3 et #4 du plan texture du 03/10/2026) : refonte en fonction de build/bancs/projeter_source8.py (meme algorithme : flot de Farneback plafonne,
visibilite profondeur + normale, etalonnage global des tons, calage local de couleur, garde-fou de couleur), avec en plus : fenetre cachee (pixels de la photo exclus du recalage, du flot et du report),
atlas de depart fourni (deuxieme passe), garde-fou reglable. Camera = celle de l'essai #2. N'ecrit rien dans les projets."""
import math, time
import numpy as np, cv2, torch, moderngl
import fid_lib as L


def fenetre_cachee(S, frac=0.5):
    """Rectangle de frac x frac de la boite du sujet (donc 25 % de sa boite), centre sur le centre de masse du masque."""
    ys, xs = np.where(S.MS); cy, cx = ys.mean(), xs.mean(); bw, bh = S.box[1] - S.box[0], S.box[3] - S.box[2]
    h = np.zeros(S.MS.shape, bool); y0 = int(cy - frac * bh / 2); y1 = int(cy + frac * bh / 2); x0 = int(cx - frac * bw / 2); x1 = int(cx + frac * bw / 2)
    h[max(0, y0):y1, max(0, x0):x1] = True
    return h


def texels_positions(S, tuile=4096):
    """Rend (position, normale, valide) par texel de l'atlas, par tuiles : generateur (ti, tj, N, Tl, P, Nn)."""
    ctx = S.ctx
    prog = ctx.program(vertex_shader="""#version 330
uniform vec2 tile; uniform float N; in vec3 in_pos; in vec2 in_uv; in vec3 in_nrm; out vec3 p; out vec3 n;
void main(){ gl_Position = vec4((in_uv * N - tile) * 2.0 - 1.0, 0.0, 1.0); p = in_pos; n = in_nrm; }""", fragment_shader="""#version 330
in vec3 p; in vec3 n; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ o0 = vec4(p, 1.0); o1 = vec4(n, 1.0); }""")
    vbo = ctx.buffer(np.hstack([S.V0, S.UV, S.NRM]).astype('f4').tobytes())
    vao = ctx.vertex_array(prog, [(vbo, '3f 2f 3f', 'in_pos', 'in_uv', 'in_nrm')], S.ibo)
    Tl = min(tuile, S.AH); N = S.AH // Tl
    for tj in range(N):
        for ti in range(N):
            c0 = ctx.texture((Tl, Tl), 4, dtype='f4'); c1 = ctx.texture((Tl, Tl), 4, dtype='f4'); fbo = ctx.framebuffer(color_attachments=[c0, c1]); fbo.use()
            ctx.disable(moderngl.DEPTH_TEST); fbo.clear(0.0, 0.0, 0.0, 0.0)
            prog['tile'].value = (float(ti), float(tj)); prog['N'].value = float(N); vao.render(moderngl.TRIANGLES)
            P = np.frombuffer(fbo.read(attachment=0, components=4, dtype='f4'), dtype=np.float32).reshape(Tl, Tl, 4)[::-1].copy()
            Nn = np.frombuffer(fbo.read(attachment=1, components=4, dtype='f4'), dtype=np.float32).reshape(Tl, Tl, 4)[::-1].copy()
            c0.release(); c1.release(); fbo.release()
            yield ti, tj, N, Tl, P, Nn
    vbo.release(); vao.release(); prog.release()


def projeter(S, cam, pose, photo, photo_hr=None, atlas_base=None, hide=None, tau=45.0, gain_max=1.4, flot_max=14.0, cos_min=0.40, tol=0.0025, garde=True, flot=True, log=print):
    """Retourne dict(FINAL, POIDS, diag...). photo : (S.S, S.S, 3) uint8. hide : masque bool (photo) a ne PAS utiliser."""
    dev = torch.device('cuda'); SZ = S.S; ATLAS = S.ATLAS if atlas_base is None else atlas_base; AH = S.AH
    S.POSE[:] = pose; cam = tuple(cam); diag = {}
    # atlas de rendu pour le recalage (reduit a 2048 pour la rapidite : suffit au flot a 1024 px)
    S.poser_texture(ATLAS if AH <= 2048 else cv2.resize(ATLAS, (2048, 2048), interpolation=cv2.INTER_AREA))
    r0, m0, _ = S.rendre(cam, SZ)
    MSb = S.MS.copy()
    if hide is not None: MSb = MSb & ~hide
    mm0 = m0 & (cv2.erode(MSb.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
    sr = L.structure(np.where(m0[..., None], r0, 128).astype(np.uint8), 1.5, 8); sp = L.structure(photo, 2.0, 8)
    if hide is not None: sp = np.where(cv2.dilate(hide.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0, sr, sp).astype(np.float32)   # fenetre cachee : le flot n'y voit aucune difference
    diag['ncc_avant'] = L.ncc(sr, sp, mm0)
    ALIGN = photo.copy()
    gx, gy = np.meshgrid(np.arange(SZ, dtype=np.float32), np.arange(SZ, dtype=np.float32))
    if flot:
        u8 = lambda x: np.clip(x * 40 + 128, 0, 255).astype(np.uint8)
        fl = cv2.calcOpticalFlowFarneback(u8(sr), u8(sp), None, 0.5, 6, 31, 6, 7, 1.5, 0)
        zone = cv2.dilate(m0.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)
        fl = cv2.GaussianBlur(fl, (0, 0), 6) * zone[..., None]
        mag = np.linalg.norm(fl, axis=2); fl *= np.minimum(1.0, flot_max / np.maximum(mag, 1e-6))[..., None]
        sp_w = cv2.remap(sp, gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        k = 21
        def ncc_loc(a, b):
            ma = cv2.blur(a, (k, k)); mb = cv2.blur(b, (k, k)); va = cv2.blur(a * a, (k, k)) - ma * ma; vb = cv2.blur(b * b, (k, k)) - mb * mb
            return (cv2.blur(a * b, (k, k)) - ma * mb) / np.sqrt(np.maximum(va * vb, 1e-6))
        mieux = cv2.GaussianBlur((ncc_loc(sr, sp_w) > ncc_loc(sr, sp) + 0.02).astype(np.float32), (0, 0), 8)
        fl *= mieux[..., None]
        ALIGN = cv2.remap(photo, gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        sp_w2 = cv2.remap(sp, gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        diag['ncc_apres'] = L.ncc(sr, sp_w2, mm0); diag['flot_deplacement_moyen_px'] = float(np.linalg.norm(fl[m0], axis=1).mean())
    else:
        diag['ncc_apres'] = diag['ncc_avant']
    if photo_hr is not None:        # photo agrandie : le recalage (flot) est calcule a la taille de travail, puis applique a la photo haute resolution
        Nh = photo_hr.shape[0]; kh = Nh / SZ; gxh, gyh = np.meshgrid(np.arange(Nh, dtype=np.float32), np.arange(Nh, dtype=np.float32))
        if flot:
            flh = cv2.resize(fl, (Nh, Nh), interpolation=cv2.INTER_LINEAR) * kh
            ALIGN = cv2.remap(photo_hr, gxh + flh[..., 0], gyh + flh[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        else: ALIGN = photo_hr
    # profondeur (2x) pour la visibilite
    SD = 2 * SZ; _, _, WD = S.rendre(cam, SD)
    MSK = cv2.erode(MSb.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
    WDn = WD.copy(); WDn[WDn > 1e5] = 0
    saut = (cv2.dilate(WDn, np.ones((5, 5), np.uint8)) - cv2.erode(WDn, np.ones((5, 5), np.uint8))) > 0.012 * cam[0]
    BORDT = torch.from_numpy(1.0 - cv2.dilate(saut.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)).to(dev)
    MSKb = cv2.GaussianBlur(MSK, (0, 0), 2.0)
    NOUVEAU = np.empty_like(ATLAS); POIDS = np.zeros((AH, AH), np.uint8); VALID = np.zeros((AH, AH), bool)
    SRCT = torch.from_numpy(ALIGN).to(dev).permute(2, 0, 1)[None].float(); WDT = torch.from_numpy(WD).to(dev); MSKT = torch.from_numpy(MSKb).to(dev)[None, None]
    D, Fo, cx, cy = cam; RT = torch.from_numpy(L.mat_pose(*pose)).to(dev)
    couvert = 0; total = 0
    for ti, tj, N, Tl, P, Nn in texels_positions(S):
        Pt = torch.from_numpy(P).to(dev); Nt = torch.from_numpy(Nn).to(dev); valide = Pt[..., 3] > 0.5
        pos = Pt[..., :3] @ RT.T; nrm = torch.nn.functional.normalize(Nt[..., :3], dim=-1) @ RT.T
        w = D - pos[..., 2]; u = cx + Fo * pos[..., 0] / w; v = cy - Fo * pos[..., 1] / w
        ud = (u / SZ * SD).long().clamp(0, SD - 1); vd = (v / SZ * SD).long().clamp(0, SD - 1)
        vu = (w - WDT[vd, ud]).abs() < tol * D
        vdir = torch.nn.functional.normalize(torch.stack([-pos[..., 0], -pos[..., 1], D - pos[..., 2]], dim=-1), dim=-1)
        cs = (nrm * vdir).sum(-1).abs(); wang = ((cs - cos_min) / 0.30).clamp(0, 1)
        grille = torch.stack([(u / (SZ - 1) * 2 - 1), (v / (SZ - 1) * 2 - 1)], dim=-1)[None]
        dans = (u >= 0) & (u <= SZ - 1) & (v >= 0) & (v <= SZ - 1)
        mk = torch.nn.functional.grid_sample(MSKT, grille, mode='bilinear', padding_mode='zeros', align_corners=True)[0, 0]
        col = torch.nn.functional.grid_sample(SRCT, grille, mode='bilinear', padding_mode='border', align_corners=True)[0]
        a = (valide & vu & dans).float() * wang * mk * BORDT[vd, ud]
        NOUVEAU[(N - 1 - tj) * Tl:(N - tj) * Tl, ti * Tl:(ti + 1) * Tl] = col.permute(1, 2, 0).clamp(0, 255).byte().cpu().numpy()
        POIDS[(N - 1 - tj) * Tl:(N - tj) * Tl, ti * Tl:(ti + 1) * Tl] = (a * 255).byte().cpu().numpy()
        VALID[(N - 1 - tj) * Tl:(N - tj) * Tl, ti * Tl:(ti + 1) * Tl] = valide.cpu().numpy()
        couvert += int((a > 0.5).sum()); total += int(valide.sum())
        del Pt, Nt, pos, nrm, w, u, v, col, a; torch.cuda.empty_cache()
    diag['texels_projetes_pct'] = 100.0 * couvert / max(total, 1); diag['texels_utiles'] = total
    # etalonnage + melange (identique a source8)
    K = 8; Lr = AH // K; w_f = POIDS.astype(np.float32) / 255.0
    aire = lambda x: cv2.resize(x, (Lr, Lr), interpolation=cv2.INTER_AREA); den = aire(w_f)
    sel = den > 0.5; ATLAST = ATLAS
    if sel.sum() > 20:
        Lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
        oL = Lum([aire(ATLAS[..., c].astype(np.float32) * w_f) / np.maximum(den, 1e-6) for c in range(3)]); nL = Lum([aire(NOUVEAU[..., c].astype(np.float32) * w_f) / np.maximum(den, 1e-6) for c in range(3)])
        qs = np.linspace(0.01, 0.99, 50); oq = np.quantile(oL[sel], qs); nq = np.maximum.accumulate(np.quantile(nL[sel], qs))
        x = np.arange(256, dtype=np.float32); l = np.interp(x, oq, nq); l[x < oq[0]] = x[x < oq[0]] + (nq[0] - oq[0]); l[x > oq[-1]] = x[x > oq[-1]] + (nq[-1] - oq[-1])
        fac = np.clip(np.clip(l, 0, 255) / np.maximum(x, 10.0), 0.6, 1.6).astype(np.float32); fac[x < 10] = 1.0
        diag['ton_facteurs'] = [float(fac.min()), float(fac.max())]
        ATLAST = np.empty_like(ATLAS)
        for r_ in range(0, AH, 1024):
            blk = ATLAS[r_:r_ + 1024].astype(np.float32); Li = np.clip(Lum([blk[..., 0], blk[..., 1], blk[..., 2]]), 0, 255).astype(np.uint8)
            ATLAST[r_:r_ + 1024] = np.clip(blk * fac[Li][..., None], 0, 255).astype(np.uint8)
    gains = []
    for c in range(3):
        n_old = aire(ATLAST[..., c].astype(np.float32) * w_f); n_new = aire(NOUVEAU[..., c].astype(np.float32) * w_f)
        g = (n_old + 12.0 * den + 1e-3) / (n_new + 12.0 * den + 1e-3)
        gs = cv2.GaussianBlur(g * den, (0, 0), 2.0) / np.maximum(cv2.GaussianBlur(den, (0, 0), 2.0), 1e-4)
        gs = np.where(cv2.GaussianBlur(den, (0, 0), 2.0) > 1e-3, gs, 1.0)
        gains.append(np.clip(gs, 1.0 / gain_max, gain_max).astype(np.float32))
    L2 = AH // 4; aire2 = lambda x: cv2.resize(x, (L2, L2), interpolation=cv2.INTER_AREA); den2 = aire2(w_f)
    g_up = [cv2.resize(g, (L2, L2), interpolation=cv2.INTER_LINEAR) for g in gains]; delta = np.zeros((L2, L2), np.float32)
    for c in range(3):
        o = cv2.GaussianBlur(aire2(ATLAST[..., c].astype(np.float32) * w_f), (0, 0), 1.5); n = cv2.GaussianBlur(aire2(NOUVEAU[..., c].astype(np.float32) * w_f), (0, 0), 1.5)
        delta += np.abs(n * g_up[c] - o) / np.maximum(cv2.GaussianBlur(den2, (0, 0), 1.5), 1e-3)
    delta /= 3.0
    gd = np.exp(-(delta / tau) ** 2).astype(np.float32) if garde else np.ones_like(delta); gd[den2 < 1e-3] = 1.0
    diag['garde_poids_moyen'] = float((gd * den2).sum() / max(den2.sum(), 1e-6)); diag['ecart_couleur_moyen_niveaux'] = float((delta * den2).sum() / max(den2.sum(), 1e-6))
    w_f = w_f * cv2.resize(gd, (AH, AH), interpolation=cv2.INTER_LINEAR)
    FINAL = ATLAST.copy()
    for r0_ in range(0, AH, 1024):
        sl = slice(r0_, r0_ + 1024); wb = w_f[sl][..., None]
        g_full = np.stack([cv2.resize(g[r0_ // K:(r0_ + 1024) // K], (AH, 1024), interpolation=cv2.INTER_LINEAR) for g in gains], axis=-1)
        FINAL[sl] = np.clip(ATLAST[sl].astype(np.float32) * (1 - wb) + np.clip(NOUVEAU[sl].astype(np.float32) * g_full, 0, 255) * wb, 0, 255).astype(np.uint8)
    diag['atlas_tone'] = ATLAST
    return dict(FINAL=FINAL, POIDS=POIDS, W=w_f, VALID=VALID, ALIGN=ALIGN, diag=diag)
