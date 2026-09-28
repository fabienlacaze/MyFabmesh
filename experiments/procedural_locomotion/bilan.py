import sys, importlib
sys.path.insert(0, r'C:\tmp\procedural_test')
mod = importlib.import_module(sys.argv[1])
for nom, rig in (('lion', sys.argv[2]), ('humain', sys.argv[3])):
    for a in ('walk', 'run', 'turn_left'):
        _, i, _ = mod.animer(rig, a, 3, brut=True)
        print(f'{nom:7s} {a:10s}', {k: i[k] for k in ('extension_max_pct', 'acoups_max_deg', 'acoups_p99_deg', 'glissement_appui_pct', 'foulee', 'abaisse_pct')})
