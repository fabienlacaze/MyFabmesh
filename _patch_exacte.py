import io
p = r'C:\tmp\fix5_securite\cloud\src\nsfw_filter.ts'
b = open(p, 'rb').read().decode('utf-8')
assert '\r\n' in b
s = b.replace('\r\n', '\n')

ancien1 = """  s = _sansExpressionsSures((translit ? _translit(s) : s).replace(/[^\\x00-\\x7f]/gu, (c) => (/\\s/.test(c) ? ' ' : '.')), desactivees);
"""
nouveau1 = """  const avantExpressions = (translit ? _translit(s) : s).replace(/[^\\x00-\\x7f]/gu, (c) => (/\\s/.test(c) ? ' ' : '.'));
  s = _sansExpressionsSures(avantExpressions, desactivees);
"""
assert s.count(ancien1) == 1
s = s.replace(ancien1, nouveau1)

ancien2 = """    if (!sortie.includes(v)) sortie.push(v);
  }
  return sortie;
}

/** VUE UNICODE"""
nouveau2 = """    if (!sortie.includes(v)) sortie.push(v);
  }
  // Sixieme passe (21/10, trouve par les mutations aleatoires du banc : « child n baby shower u s » refuse par la production, accepte
  // ensuite) : la production retirait ENTIERE l'expression d'`IDIOMES_PRODUCTION` (« baby shower ») et rapprochait ainsi les lettres
  // epelees qui l'entouraient (« n  u s » = « nus ») ; le lot ne retire que le mot sensible, et un jalon separe les voisins. Quand le
  // texte contient une de ces expressions, la vue exacte est AUSSI lue comme la production (meme regle que `separees`, dans `_vues`).
  for (const x of [avantExpressions, _leet(avantExpressions, 'i'), _leet(avantExpressions, 'l')]) {
    const j = _simple(_joindrePonctue(x));
    if (!_RE_INDICE_PHRASES.test(j) || !_RE_IDIOMES_PRODUCTION.test(j)) continue;
    const v = _ecraser(_joindre(_simple(_joindrePonctue(x), true, true))).replace(_RE_IDIOMES_EXACTS, ' ').replace(/ +/g, ' ').trim();
    if (!sortie.includes(v)) sortie.push(v);
  }
  return sortie;
}

/** VUE UNICODE"""
assert s.count(ancien2) == 1
s = s.replace(ancien2, nouveau2)
open(p, 'wb').write(s.replace('\n', '\r\n').encode('utf-8'))
print('ok')
