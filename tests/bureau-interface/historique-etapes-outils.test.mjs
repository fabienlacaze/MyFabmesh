// 25/10 (user : « le construction steps est passe a la trappe ») : les versions de maillage produites par Etapes de construction, Explosion, Recolorier,
// Material adjust, Re-texture a region et Sharpen texture n'etaient pas reconnues par l'historique : elles passaient pour des maillages d'origine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const [nom, f] of Object.entries({ bureau: 'src/renderer/index2.js', site: 'cloud/public/app/index2.js' })) {
  const src = readFileSync(join(RACINE, f), 'utf-8');
  const re = new Function('return ' + src.match(/^const _OP_RE = (\/.*\/i);$/m)[1])();
  const lab = src.slice(src.indexOf('const _OP_LABEL'), src.indexOf('};', src.indexOf('const _OP_LABEL')));
  test(`${nom} : les noms de versions des outils sont reconnus comme des operations`, () => {
    for (const [fichier, op] of [['hut_chantier3d_1792941906756', 'chantier3d'], ['hut_explode_1792941906756', 'explode'], ['hut_recolor_1792941906756', 'recolor'],
      ['hut_mat_1792941906756', 'mat'], ['1792941906756_region_retex', 'region_retex'], ['hut_enhance_tex_1792941906756', 'enhance_tex'], ['hut_watertight_1792941906756', 'watertight']]) {
      const m = fichier.match(re);
      assert.ok(m, fichier);
      assert.equal(m[1], op);
      assert.ok(lab.includes(op + ':'), `libelle de ${op}`);
    }
  });
  test(`${nom} : un maillage d'utilisateur se terminant par « mat » n'est pas pris pour une operation`, () => {
    assert.equal('wood_mat'.match(re), null);
    assert.equal('orc_warrior'.match(re), null);
  });
}
