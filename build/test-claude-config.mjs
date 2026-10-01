// Banc d'essai de src/main/claude_config.js : installation classique ET paquet Store de Claude Desktop (copie privee dans Packages\Claude_*).
// Tout se passe dans des dossiers temporaires : la vraie configuration du user n'est jamais touchee.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const cc = require('../src/main/claude_config.js');

let echecs = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  ECHEC ') + m); if (!c) echecs++; };
const entree = { command: 'C:\\App\\python.exe', args: ['C:\\App\\scripts\\mcp_server.py'] };
const ailleurs = { command: 'D:\\Autre\\python.exe', args: ['D:\\Autre\\scripts\\mcp_server.py'] };

function bac() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-claude-'));
  const env = { APPDATA: path.join(racine, 'Roaming'), LOCALAPPDATA: path.join(racine, 'Local') };
  fs.mkdirSync(env.APPDATA, { recursive: true });
  fs.mkdirSync(path.join(env.LOCALAPPDATA, 'Packages'), { recursive: true });
  return { racine, env, classique: path.join(env.APPDATA, 'Claude'), store: path.join(env.LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude') };
}
const ecrire = (dossier, obj) => { fs.mkdirSync(dossier, { recursive: true }); fs.writeFileSync(path.join(dossier, 'claude_desktop_config.json'), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); };
const lireJ = (dossier) => JSON.parse(fs.readFileSync(path.join(dossier, 'claude_desktop_config.json'), 'utf8'));

// 1) installation classique seule
{
  const b = bac(); ecrire(b.classique, { theme: 'dark', mcpServers: { autre: { command: 'x' } } });
  const r = cc.relier(entree, b.env);
  ok(r.ok && r.ecrits === 1, 'classique seule : 1 fichier ecrit');
  const j = lireJ(b.classique);
  ok(j.mcpServers.fabmesh.command === entree.command && j.mcpServers.autre.command === 'x' && j.theme === 'dark', 'autres serveurs et reglages conserves');
  ok(cc.etat(entree, b.env).ici === true, 'etat : relie ici');
}
// 2) paquet Store seul (le cas de CE PC) : il faut ecrire la copie privee, pas %APPDATA%
{
  const b = bac(); ecrire(b.store, { mcpServers: {} });
  const r = cc.relier(entree, b.env);
  ok(r.ok && r.ecrits === 1, 'Store seul : 1 fichier ecrit');
  ok(lireJ(b.store).mcpServers.fabmesh.command === entree.command, 'l\'entree est dans la copie privee du paquet Store');
  ok(!fs.existsSync(path.join(b.classique, 'claude_desktop_config.json')), 'rien n\'est cree dans %APPDATA%\\Claude quand seul le Store existe');
}
// 3) les deux
{
  const b = bac(); ecrire(b.store, {}); ecrire(b.classique, {});
  const r = cc.relier(entree, b.env);
  ok(r.ecrits === 2, 'Store + classique : 2 fichiers ecrits');
}
// 4) aucune installation : « Connect » cree le dossier classique (comportement d'origine), le demarrage automatique ne cree RIEN
{
  const b = bac();
  ok(cc.assurerSiPresent(entree, b.env) === 0 && !fs.existsSync(b.classique), 'automatique au demarrage : Claude Desktop absent -> rien cree');
  ok(cc.relier(entree, b.env).ok && fs.existsSync(b.classique), 'bouton Connect sans Claude Desktop : dossier classique cree (comportement d\'origine)');
}
// 5) fichier illisible : jamais ecrase
{
  const b = bac(); ecrire(b.classique, '{ pas du json');
  const r = cc.relier(entree, b.env);
  ok(!r.ok && fs.readFileSync(path.join(b.classique, 'claude_desktop_config.json'), 'utf8') === '{ pas du json', 'JSON illisible : refus et contenu intact');
}
// 6) etat : une entree qui vise une AUTRE copie (meme dans un seul des deux fichiers) n'est pas « ici »
{
  const b = bac(); ecrire(b.store, { mcpServers: { fabmesh: entree } }); ecrire(b.classique, { mcpServers: { fabmesh: ailleurs } });
  const e = cc.etat(entree, b.env);
  ok(e.connecte && !e.ici, 'Store ici + classique ailleurs : connecte mais pas « ici »');
  cc.relier(entree, b.env);
  ok(cc.etat(entree, b.env).ici, 'apres Connect : relie ici partout');
}
// 6b) une installation (le paquet Store) SANS l'entree alors que l'autre l'a : pas « reliee » (Claude n'y verrait rien)
{
  const b = bac(); ecrire(b.store, { mcpServers: {} }); ecrire(b.classique, { mcpServers: { fabmesh: entree } });
  const e = cc.etat(entree, b.env);
  ok(!e.connecte && !e.ici, 'Store sans entree + classique relie : NON connecte (l appli propose Connect)');
  cc.relier(entree, b.env);
  ok(cc.etat(entree, b.env).ici, 'apres Connect : les deux sont relies');
}
// 7) paquets au nom voisin ignores ; automatique corrige seulement ce qui differe
{
  const b = bac(); ecrire(b.store, { mcpServers: { fabmesh: ailleurs } });
  fs.mkdirSync(path.join(b.env.LOCALAPPDATA, 'Packages', 'ClaudeCode_xyz', 'LocalCache', 'Roaming', 'Claude'), { recursive: true });
  ok(cc.cheminsConfig(b.env).every((c) => !/ClaudeCode_/.test(c.fichier)), 'un paquet ClaudeCode_* n\'est pas pris pour Claude Desktop');
  ok(cc.assurerSiPresent(entree, b.env) === 1 && lireJ(b.store).mcpServers.fabmesh.command === entree.command, 'automatique : entree perimee corrigee (1 fichier)');
  ok(cc.assurerSiPresent(entree, b.env) === 0, 'automatique : deja a jour -> aucune ecriture');
}
// 8) delier : seul fabmesh part
{
  const b = bac(); ecrire(b.store, { mcpServers: { fabmesh: entree, garde: { command: 'g' } } });
  cc.delier(b.env);
  const j = lireJ(b.store);
  ok(!j.mcpServers.fabmesh && j.mcpServers.garde.command === 'g', 'Disconnect : fabmesh retire, les autres serveurs restent');
}
console.log(echecs ? '\n' + echecs + ' ECHEC(S)' : '\nTOUT PASSE');
process.exit(echecs ? 1 : 0);
