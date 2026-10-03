"""CORRECTIF PROPOSE (non installe) de l'export « Export to Unreal » d'un RIG (src/main/main.js, handler 'export-to-unreal', ~l.5463-5488).
Defaut mesure (Blender 5.1) : object_types={'MESH'} exclut l'armature -> FBX sans os ni peau (0 armature, 0 groupe de sommets).
Ici : MESH + ARMATURE, sans os feuille, sans animation, echelle cm par global_scale. Verifie : 1 armature, 72 os, 72 groupes de sommets, 0 sommet sans groupe.
Usage : blender.exe --background --python unreal_corrige.py -- <entree.glb> <sortie.fbx>"""
import sys
import bpy
src, out = sys.argv[sys.argv.index('--') + 1], sys.argv[sys.argv.index('--') + 2]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=src)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.fbx(
    filepath=out, use_selection=False, global_scale=100.0, apply_unit_scale=True, apply_scale_options='FBX_SCALE_NONE',
    axis_forward='-Z', axis_up='Y', object_types={'MESH', 'ARMATURE'}, use_mesh_modifiers=True, mesh_smooth_type='FACE',
    add_leaf_bones=False, bake_anim=False, primary_bone_axis='Y', secondary_bone_axis='X', path_mode='COPY', embed_textures=True)
