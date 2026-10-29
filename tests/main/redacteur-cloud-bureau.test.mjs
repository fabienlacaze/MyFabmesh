// 29/10 (decision du user) : le prompt automatique du bureau passe par le site (Qwen3.6 sur GPU, repli 4B cote serveur) en mode CLOUD, et garde le 4B local en repli.
// Garde de structure : la branche cloud precede le demarrage du 4B local, ne s'ouvre qu'en mode cloud, a un interrupteur, et filtre la description recue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(racine, 'src/main/main.js'), 'utf8').replace(/\r\n/g, '\n');
const debut = src.indexOf("ipcMain.handle('redacteur:decrire'");
const fin = src.indexOf("ipcMain.handle('redacteur:arreter'", debut);
const corps = src.slice(debut, fin);

test('redacteur:decrire : branche cloud avant le 4B local, seulement en mode cloud, avec interrupteur', () => {
  assert.ok(debut > 0 && fin > debut);
  const iCloud = corps.indexOf("cloudFallback.authedFetch('/api/describe-asset'");
  const iLocal = corps.indexOf('await redacteurDemarrer()');
  assert.ok(iCloud > 0 && iLocal > iCloud, 'le site est essaye AVANT le 4B local');
  assert.match(corps, /isCloudMode\(\) && process\.env\.FABMESH_REDACTEUR_CLOUD !== '0'/);
});

test('redacteur:decrire : le filtre du bureau est applique avant ET apres, et un echec du site retombe sur le 4B local', () => {
  assert.ok(corps.indexOf("refusTexteOutil(String(name || '').slice(0, 80)") < corps.indexOf("cloudFallback.authedFetch('/api/describe-asset'"), 'filtre d\'entree avant l\'appel au site');
  assert.match(corps, /if \(refusTexteOutil\(j\.description\)\) return \{ ok: false, raison: 'blocked' \}/);
  assert.match(corps, /catch \(_\) \{[^}]*repli sur le 4B local/);
});
