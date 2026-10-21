p = r'C:\tmp\fix5_securite\build\bancs\noyaux\test_moderation_modal.py'
b = open(p, 'rb').read().decode('utf-8')
crlf = '\r\n' in b
s = b.replace('\r\n', '\n')
ancien = """    def test_longueur_et_syntaxe(self):
        self.assertEqual(M.controler_longueur_prompt('x' * 2000), {'safe': True})"""
nouveau = """    def test_lettres_epelees_autour_d_une_expression_retiree_entiere(self):
        # 21/10 : la production rapprochait « n » et « u s » en retirant « baby shower » ; la vue exacte (« nus ») ne le faisait plus
        for e in ('baby shower', 'bridal shower', 'bath toys', 'suicide squad', 'nu metal'):
            for t in ('%s n %s u s' % (MIN_ENFANT, e), '%s n %s u e s' % (MIN_ENFANT, e)):
                self.assertFalse(M.check_hard_floor(t)['safe'], t)
        for t in ('a baby shower with balloons', 'a child at a baby shower', 'a child n a u s'):
            self.assertTrue(M.check_hard_floor(t)['safe'], t)

    def test_longueur_et_syntaxe(self):
        self.assertEqual(M.controler_longueur_prompt('x' * 2000), {'safe': True})"""
assert s.count(ancien) == 1
s = s.replace(ancien, nouveau)
open(p, 'wb').write((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))
print('ok', crlf)
