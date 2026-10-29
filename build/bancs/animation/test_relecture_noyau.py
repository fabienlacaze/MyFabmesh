"""Tests SANS GPU de la relecture par Qwen3.6 : python -m pytest build/bancs/animation/test_relecture_noyau.py (ou python ce_fichier.py)."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import relecture_noyau as N  # noqa: E402
import relecture_qwen as Q  # noqa: E402


def mesure(**k):
    """Course saine (normes run tenues) ; k remplace des valeurs."""
    m = {'moteur': 'anatomique', 'vitesse_Hs': 1.95, 'phase_aerienne_pct': 20, 'glissement_max_par_appui_pctH': [0, 0.5], 'ecart_entre_pieds_pctH': 11,
         'tete_verticale_pctH': 1.3, 'os_sous_sol_pctH': 0, 'acoups_max_deg': 15, 'buste_deg': {'max': 12}, 'tete_vs_buste_deg': 8,
         'bras': [{'coude_flexion_deg': [75, 105], 'abduction_bras_deg': [18, 20], 'balancement_bras_deg': [-55, 25], 'main_vs_yeux_max_pctH': -4}] * 2}
    m.update(k)
    return m


# --- extraction du JSON
def test_json_tolere_les_formes_courantes():
    attendu = {'analyse': 'x', 'changements': {'buste': 12}}
    for t in ['{"analyse": "x", "changements": {"buste": 12}}',
              '```json\n{"analyse": "x", "changements": {"buste": 12}}\n```',
              '<think>je pense {pas du json}</think>{"analyse": "x", "changements": {"buste": 12}}',
              'Voici : {"analyse": "x", "changements": {"buste": 12},} merci',
              "{'analyse': 'x', 'changements': {'buste': 12}}",
              'texte {cassé} puis {"analyse": "x", "changements": {"buste": 12}}']:
        assert N.extraire_json(t) == attendu, t


def test_json_illisible_rend_none():
    for t in [None, '', 'aucun objet', '{"a": ', '[1, 2]']:
        assert N.extraire_json(t) is None, t


def test_accolade_dans_une_chaine():
    assert N.extraire_json('{"analyse": "bras } trop hauts", "changements": {}}')['analyse'] == 'bras } trop hauts'


# --- validation des changements
def test_validation_borne_et_filtre():
    act = {'buste': 10, 'coude': 90, 'appui': 0.4}
    ch, rej = N.valider_changements({'changements': {'buste': 40, 'coude': 'beaucoup', 'inconnu': 3, 'appui': float('nan'), 'teteTangage': 4}}, act)
    assert ch == {'buste': 15, 'teteTangage': 4}          # 40 -> plage 28 -> pas 5 depuis 10 ; teteTangage depuis le milieu (7,5) : 4 dans le pas
    assert any('inconnu' in r for r in rej) and any('non numerique' in r for r in rej) and any('non finie' in r for r in rej)


def test_validation_ignore_les_non_changements_et_limite_le_nombre():
    act = {k: (lo + hi) / 2 for k, (lo, hi, _, _) in N.LEVIERS.items()}
    ch, _ = N.valider_changements({'changements': {k: act[k] + N.LEVIERS[k][2] / 2 for k in N.LEVIERS}}, act)
    assert len(ch) == N.MAX_CHANGEMENTS
    ch, _ = N.valider_changements({'changements': {'buste': act['buste']}}, act)
    assert ch == {}
    assert N.valider_changements({'changements': [1, 2]}, act)[0] == {}


# --- notes et normes
def test_course_saine_vaut_zero_et_abimee_non():
    assert N.note(mesure(), 'run') == 0
    assert N.note(mesure(buste_deg={'max': 0}, glissement_max_par_appui_pctH=[0, 3]), 'run') > 3
    assert N.note(mesure(moteur='ancien'), 'run') == 10


def test_sprint_tolere_plus_d_acoups_que_la_course():
    m = mesure(acoups_max_deg=55, vitesse_Hs=3.4, phase_aerienne_pct=30, buste_deg={'max': 18},
               bras=[{'coude_flexion_deg': [50, 105], 'abduction_bras_deg': [18, 20], 'balancement_bras_deg': [-65, 40], 'main_vs_yeux_max_pctH': -4}] * 2)
    assert not any(v[0] == 'acoups' for v in N.violations(m, 'sprint'))
    assert any(v[0] == 'acoups' for v in N.violations(mesure(acoups_max_deg=55), 'run'))


# --- decision multi-rigs
def test_decision_refuse_une_contrainte_dure_degradee_sur_un_seul_rig():
    mb = {'a': mesure(buste_deg={'max': 2}), 'b': mesure()}
    mc = {'a': mesure(), 'b': mesure(glissement_max_par_appui_pctH=[0, 2.6])}        # cas du 29/10 : mieux sur a, le pied glisse sur b
    nb = {k: N.note(v, 'run') for k, v in mb.items()}; nc = {k: N.note(v, 'run') for k, v in mc.items()}
    ok, raison = N.decider(nb, nc, mb, mc, 'run')
    assert not ok and 'glissement' in raison and 'b' in raison


def test_decision_accepte_un_vrai_gain_et_refuse_un_gain_nul():
    mb = {'a': mesure(buste_deg={'max': 2}), 'b': mesure()}
    mc = {'a': mesure(), 'b': mesure()}
    nb = {k: N.note(v, 'run') for k, v in mb.items()}; nc = {k: N.note(v, 'run') for k, v in mc.items()}
    assert N.decider(nb, nc, mb, mc, 'run')[0]
    assert not N.decider(nb, nb, mb, mb, 'run')[0]


def test_decision_refuse_un_rig_qui_perd_la_course_anatomique():
    mb = {'a': mesure(buste_deg={'max': 2})}; mc = {'a': mesure(moteur='ancien')}
    assert not N.decider({'a': N.note(mb['a'], 'run')}, {'a': 10.0}, mb, mc, 'run')[0]


# --- boucle complete, modele et mesures simules
def faux_mesurer(rig, allure, lev, positions=None):
    """Monde simule : norme du buste 6-17 deg ; au-dela de 8 le pied du rig « b » glisse ; le rig « c » n'est pas anime par la course anatomique."""
    if rig.endswith('c.glb'):
        return mesure(moteur='ancien')
    b = lev.get('buste', 2)
    return mesure(buste_deg={'max': b}, glissement_max_par_appui_pctH=[0, 2.5 if (rig.endswith('b.glb') and b > 8) else 0.4])


def test_boucle_robuste_reponses_cassees_puis_bonnes():
    reponses = iter(['blabla sans json', 'toujours rien', '{"changements": "pas un objet"}',          # tour 1 : 3 essais illisibles -> refus
                     '```json\n{"analyse": "trunk too upright", "changements": {"buste": 25}}\n```',  # tour 2 : borne au pas (0 -> 5) puis accepte
                     '{"analyse": "more", "changements": {"buste": 12}}',                             # tour 3 : 5 -> 10 accepte
                     '{"analyse": "even more", "changements": {"buste": 17}}'])                       # tour 4 : rien (normes tenues, arret avant)
    with tempfile.TemporaryDirectory() as d:
        J = Q.boucle(['x/a.glb', 'x/c.glb'], 'run', {'buste': 0}, tours=6, demander=lambda t, i: next(reponses),
                     mesurer_=faux_mesurer, dessiner_=lambda p: [], sortie=d)
        assert J['rigs_ecartes'] == ['c']
        t = J['tours']
        assert t[0]['resultat'].startswith('reponse inexploitable') and len(t[0]['appels']) == 3
        assert t[1]['retenu'] == {'buste': 5} and t[1]['accepte']
        assert t[2]['retenu'] == {'buste': 10} and t[2]['accepte']
        assert J['meilleur']['leviers']['buste'] == 10 and J['meilleur']['moyenne'] == 0
        assert J['fin'] == 'toutes les normes sont tenues'
        assert os.path.exists(os.path.join(d, 'proposition.json'))


def test_boucle_refuse_ce_qui_fait_glisser_et_s_arrete_par_patience():
    with tempfile.TemporaryDirectory() as d:
        J = Q.boucle(['x/a.glb', 'x/b.glb'], 'run', {'buste': 4}, tours=8, mesurer_=faux_mesurer, dessiner_=lambda p: [], sortie=d,
                     demander=lambda t, i: '{"analyse": "lean more", "changements": {"buste": 19}}')
        assert all(not x['accepte'] for x in J['tours'])
        assert 'glissement' in J['tours'][0]['raison']
        assert J['fin'].startswith('3 refus') and J['meilleur']['leviers']['buste'] == 4
        assert 'ALREADY TRIED' in Q.N.texte_demande('run', {'buste': 14}, {'a': mesure()}, {'a': 0}, ['{"buste": 19} -> x'], 'a')


def test_changement_deja_refuse_non_remesure_et_noms_anglais():
    appels = []
    def mes(r, a, l, p=None):
        appels.append(1); return faux_mesurer(r, a, l, p)
    with tempfile.TemporaryDirectory() as d:
        J = Q.boucle(['x/a.glb', 'x/b.glb'], 'run', {'buste': 4}, tours=3, mesurer_=mes, dessiner_=lambda p: [], sortie=d,
                     demander=lambda t, i: '{"changements": {"buste": 9}}')
        assert J['tours'][1]['raison'] == 'changement deja refuse' and 'notes' not in J['tours'][1]
        assert len(appels) == 2 * 2      # depart + 1 seul candidat mesure (2 rigs chacun)
    t = Q.N.texte_demande('jog', {}, {'a': mesure(phase_aerienne_pct=0)}, {'a': 1}, [], 'a')
    assert 'flight_phase_pct_of_cycle=0' in t and 'vol=' not in t


def test_boucle_modele_injoignable_ne_plante_pas():
    def panne(t, i):
        raise RuntimeError('Qwen3.6 injoignable apres 3 essais')
    with tempfile.TemporaryDirectory() as d:
        J = Q.boucle(['x/a.glb'], 'run', {'buste': 2}, mesurer_=faux_mesurer, dessiner_=lambda p: [], sortie=d, demander=panne)
        assert J['fin'] == 'modele injoignable' and J['meilleur']['leviers'] == {'buste': 2}


def test_boucle_rendu_en_echec_continue_sur_les_chiffres():
    def rendu(p):
        raise OSError('pas de PIL')
    with tempfile.TemporaryDirectory() as d:
        J = Q.boucle(['x/a.glb'], 'run', {'buste': 2}, tours=1, mesurer_=lambda r, a, l, p=None: (open(p, 'w').write('{}') and None) or faux_mesurer(r, a, l),
                     dessiner_=rendu, sortie=d, demander=lambda t, i: '{"changements": {"buste": 7}}')
        assert 'echec' in J['tours'][0]['rendu'] and J['tours'][0]['accepte']


def test_lire_defauts_du_moteur():
    d = Q.lire_defauts('sprint')
    assert 2.5 < d['vitesse'] < 4.5 and 'coude' in d and 'buste' in d


if __name__ == '__main__':   # lanceur sans pytest (pas installe sur ce poste)
    import traceback
    ko = 0
    for nom, f in sorted((k, v) for k, v in dict(globals()).items() if k.startswith('test_') and callable(v)):
        try:
            f(); print('ok  ', nom)
        except Exception:  # noqa: BLE001
            ko += 1; print('KO  ', nom); traceback.print_exc()
    print(f'{ko} echec(s)'); sys.exit(1 if ko else 0)
