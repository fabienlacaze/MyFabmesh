p = r'C:\tmp\fix5_securite\build\moderation_modal\_moderation_texte.tpl.py'
b = open(p, 'rb').read().decode('utf-8')
assert '\r\n' in b
s = b.replace('\r\n', '\n')

a1 = """    s = _sans_expressions_sures(_hors_ascii_en_point(_translit("".join(sortie)) if translit else "".join(sortie)), desactivees)
    # assemblee comme les autres vues du plancher (quatrieme relecture du 14/10, R3) : « n.u.e », « nuuue », « nu3 »
"""
n1 = """    avant_expressions = _hors_ascii_en_point(_translit("".join(sortie)) if translit else "".join(sortie))
    s = _sans_expressions_sures(avant_expressions, desactivees)
    # assemblee comme les autres vues du plancher (quatrieme relecture du 14/10, R3) : « n.u.e », « nuuue », « nu3 »
"""
assert s.count(a1) == 1
s = s.replace(a1, n1)

a2 = """        if v not in vues:
            vues.append(v)
    return vues


def _vue_unicode(net):"""
n2 = """        if v not in vues:
            vues.append(v)
    # sixieme passe (21/10, mutations aleatoires du banc : « child n baby shower u s ») : la production retirait ENTIERE l'expression
    # d'`IDIOMES_PRODUCTION` (« baby shower ») et rapprochait ainsi les lettres epelees voisines (« n  u s » = « nus ») ; la vue
    # exacte est AUSSI lue comme elle quand le texte contient une de ces expressions
    for x in (avant_expressions, _leet(avant_expressions, "i"), _leet(avant_expressions, "l")):
        j = _simple(_joindre_ponctue(x))
        if not (_RE_INDICE_PHRASES.search(j) and _IDIOMES_PRODUCTION.search(j)):
            continue
        v = _RE_ESPACES.sub(" ", _RE_IDIOMES_EXACTS.sub(" ", _ecraser(_joindre(_simple(_joindre_ponctue(x), True, True))))).strip(" ")
        if v not in vues:
            vues.append(v)
    return vues


def _vue_unicode(net):"""
assert s.count(a2) == 1
s = s.replace(a2, n2)
open(p, 'wb').write(s.replace('\n', '\r\n').encode('utf-8'))
print('ok')
