"""25/10 (user : « le snake a des pattes et il n'est pas allonge ») : le gabarit des moteurs d'image rapide / meilleur ne dit plus « all feet on the ground » a un animal sans pattes."""
import importlib.util, os

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
spec = importlib.util.spec_from_file_location('imagegen_modeles', os.path.join(RACINE, 'modal_app', 'imagegen_modeles.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def test_sans_pattes():
    for texte in ['a blue cobra snake', 'a giant eel', 'an anaconda coiled on a branch', 'a rattlesnake', 'a viper']:
        g = m.gabarit(texte, 'animal', 'realistic', False)
        assert 'no legs' in g and 'stretched out nearly straight' in g, g
        assert 'all feet on the ground' not in g, g


def test_animaux_a_pattes_inchanges():
    for texte in ['a horse', 'a husky', 'a lion', 'snakeskin boots with laces']:
        g = m.gabarit(texte, 'animal', 'realistic', False)
        if texte.startswith('snakeskin'):
            assert 'all feet on the ground' in g, g      # « snakeskin » n'est pas « snake » (mot entier)
        else:
            assert 'all feet on the ground' in g and 'no legs' not in g, g


def test_autres_types_inchanges():
    assert 'T-pose' in m.gabarit('an orc', 'character', 'realistic', False)
    assert 'High three-quarter view' in m.gabarit('a chair', 'prop', 'realistic', False)


if __name__ == '__main__':
    for n, f in list(globals().items()):
        if n.startswith('test_'):
            f(); print('ok', n)
