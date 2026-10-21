def maj(p, fn):
    b = open(p, 'rb').read().decode('utf-8')
    crlf = '\r\n' in b
    s = b.replace('\r\n', '\n')
    s = fn(s)
    open(p, 'wb').write((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))

def cas(s):
    ancien = """  // B5z : les expressions retirees de CHACUNE des vues de la production"""
    nouveau = """  // B5w (21/10, mutations aleatoires du banc : « child n baby shower u s ») : la VUE EXACTE (mots « nu », « nus »...) etait lue sans le
  // rapprochement des lettres epelees que fait la production quand elle retire l'expression entiere
  for (const e of ['bath toys', 'bridal shower', 'baby shower', 'meteor shower', 'shower of', 'chinks in', 'suicide squad',
    'snuff box', 'snuff bottles', 'bikini atoll', 'bikini bottom', 'nu metal', 'anal retentive']) {
    ajouter('V6-B5w', 'P', `${ENF} n ${e} u ${F('s')}`, `a ${KID} n ${e} u ${F('e', 's')}`, `${ENF} n ${e} u ${F('e')}`);
  }
  // B5z : les expressions retirees de CHACUNE des vues de la production"""
    assert s.count(ancien) == 1
    return s.replace(ancien, nouveau)

def test(s):
    s = s.rstrip('\n') + """

test('jeu 6 : lettres epelees de part et d\\'autre d\\'une expression que la production retirait entiere (vue exacte, mots courts)', () => {
  // la production rapprochait « n » et « u s » en retirant « baby shower » ; le lot ne les rapprochait pas dans la vue exacte (« nus »)
  for (const e of ['baby shower', 'bridal shower', 'bath toys', 'suicide squad', 'nu metal']) {
    for (const t of [`${MIN_ENFANT} n ${e} u ${F('s')}`, `${MIN_ENFANT} n ${e} u ${F('e', 's')}`]) {
      assert.equal(checkHardFloor(t).safe, false, t);
    }
  }
  // temoins legitimes : l'expression seule, ou des lettres sans rapport
  for (const t of ['a baby shower with balloons', 'a child at a baby shower', 'a child n a u s']) assert.equal(checkHardFloor(t).safe, true, t);
});
"""
    return s

maj(r'C:\tmp\fix5_securite\build\bancs\moderation\cas_non_recul.mjs', cas)
maj(r'C:\tmp\fix5_securite\cloud\tests\moderation.test.mjs', test)
print('ok')
