"""Etalonnage des normes de relecture_noyau : note du moteur ACTUEL (doit etre ~0 : course jugee saine) et d'une course ABIMEE (doit etre elevee),
sur chaque rig et chaque allure. usage : python build/bancs/animation/etalonner.py <rig.glb> ..."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import relecture_noyau as N  # noqa: E402
import relecture_qwen as Q  # noqa: E402

ABIME = {'buste': 0, 'coude': 120, 'coudeVar': 0, 'ecartCoude': 5, 'brasAvant': 10, 'brasArriere': 15, 'largeurPas': 1.0, 'teteTangage': -10}
res = {}
for allure in ('jog', 'run', 'sprint'):
    dep = Q.lire_defauts(allure)
    for rig in sys.argv[1:]:
        nom = os.path.splitext(os.path.basename(rig))[0]
        ms, ma = Q.mesurer(rig, allure, dep), Q.mesurer(rig, allure, dict(dep, **ABIME))
        res[f'{allure}/{nom}'] = {'sain': N.note(ms, allure), 'violations_sain': N.violations(ms, allure) if ms else 'mesure en echec', 'abime': N.note(ma, allure)}
        print(f"{allure:6s} {nom:28s} sain={res[f'{allure}/{nom}']['sain']:<6} abime={res[f'{allure}/{nom}']['abime']:<6} {res[f'{allure}/{nom}']['violations_sain']}", flush=True)
json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'etalonnage.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
