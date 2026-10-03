"""Valide un export FBX / GLB en le RE-IMPORTANT dans Blender (en arriere-plan). A lancer par Blender :
  blender.exe --background --factory-startup --python valider_fbx.py -- <fichier.fbx|.glb>
Une ligne « JSON:{...} » : objets, maillages (sommets / faces / UV / materiaux / textures), armatures (os), actions (images, courbes), boite englobante."""
import bpy, sys, json, os, math

chemin = sys.argv[sys.argv.index('--') + 1]
r = {'fichier': os.path.basename(chemin), 'taille_mo': round(os.path.getsize(chemin) / 1048576, 2), 'blender': bpy.app.version_string}
try:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = chemin.lower().rsplit('.', 1)[-1]
    if ext == 'fbx':
        try: bpy.ops.import_scene.fbx(filepath=chemin)
        except Exception as e1:
            r['import_legacy_erreur'] = repr(e1)[:120]
            bpy.ops.wm.fbx_import(filepath=chemin)
    elif ext in ('glb', 'gltf'): bpy.ops.import_scene.gltf(filepath=chemin)
    elif ext == 'obj':
        try: bpy.ops.wm.obj_import(filepath=chemin)
        except Exception: bpy.ops.import_scene.obj(filepath=chemin)
    r['objets'] = {}
    for ob in bpy.data.objects: r['objets'][ob.type] = r['objets'].get(ob.type, 0) + 1
    ms = [o for o in bpy.data.objects if o.type == 'MESH']
    r['maillages'] = len(ms)
    r['sommets'] = int(sum(len(o.data.vertices) for o in ms)); r['faces'] = int(sum(len(o.data.polygons) for o in ms))
    r['uv'] = bool(ms and all(len(o.data.uv_layers) > 0 for o in ms))
    mats = set(); imgs = set()
    for o in ms:
        for sl in o.material_slots:
            if sl.material:
                mats.add(sl.material.name)
                if sl.material.use_nodes:
                    for n in sl.material.node_tree.nodes:
                        if n.type == 'TEX_IMAGE' and n.image: imgs.add((n.image.name, tuple(n.image.size)))
    r['materiaux'] = len(mats); r['textures'] = [list(x[1]) for x in sorted(imgs)][:6]
    ar = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    r['armatures'] = len(ar); r['os'] = int(sum(len(a.data.bones) for a in ar))
    skin = 0
    for o in ms:
        if any(m.type == 'ARMATURE' for m in o.modifiers): skin += 1
    r['maillages_avec_modifier_armature'] = skin
    # groupes de sommets (poids)
    vg = 0; sans = 0
    for o in ms:
        vg += len(o.vertex_groups)
        if o.vertex_groups:
            n_sans = 0
            for v in o.data.vertices:
                if not v.groups: n_sans += 1
            sans += n_sans
    r['groupes_de_sommets'] = vg; r['sommets_sans_groupe'] = int(sans)
    acts = []
    for a in bpy.data.actions:
        fr = a.frame_range
        acts.append({'nom': a.name, 'images': [round(fr[0], 1), round(fr[1], 1)], 'courbes': len(a.fcurves) if hasattr(a, 'fcurves') else None})
    r['actions'] = acts[:12]; r['nb_actions'] = len(acts)
    r['fps_scene'] = bpy.context.scene.render.fps
    import mathutils
    pts = []
    for o in ms:
        for c in o.bound_box: pts.append(o.matrix_world @ mathutils.Vector(c))
    if pts:
        mn = [min(p[i] for p in pts) for i in range(3)]; mx = [max(p[i] for p in pts) for i in range(3)]
        r['boite_monde'] = [round(mx[i] - mn[i], 3) for i in range(3)]
    for a in ar:
        r['echelle_armature'] = [round(x, 3) for x in a.scale]
except Exception as e:  # noqa
    import traceback
    r['erreur'] = repr(e)[:300]; r['trace'] = traceback.format_exc()[-500:]
print('JSON:' + json.dumps(r, ensure_ascii=False))
