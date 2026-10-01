// Banc d'essai de src/main/claude_desktop.js : reconnaissance par le CHEMIN, script PowerShell valide, et detection reelle SANS rien fermer.
// Le point critique : Claude Code (editeur / terminal) s'appelle aussi claude.exe et ne doit JAMAIS faire partie des cibles.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const cd = require('../src/main/claude_desktop.js');

let echecs = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  ECHEC ') + m); if (!c) echecs++; };

// 1) reconnaissance par chemin
ok(cd.estClaudeDesktop('C:\\Program Files\\WindowsApps\\Claude_2.16120.0.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe'), 'paquet Store reconnu');
ok(cd.estClaudeDesktop('C:\\Users\\x\\AppData\\Local\\AnthropicClaude\\app-0.9.1\\claude.exe'), 'installation classique reconnue');
ok(cd.estClaudeDesktop('c:/Users/x/AppData/Local/AnthropicClaude/claude.exe'), 'barres obliques normalisees');
for (const code of [
  'c:\\Users\\x\\.vscode\\extensions\\anthropic.claude-code-2.1.285-win32-x64\\resources\\native-binary\\claude.exe',
  'C:\\Users\\x\\.local\\bin\\claude.exe',
  'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
  'C:\\Program Files\\WindowsApps\\ClaudeCode_1.0_x64__abc\\claude.exe',
  '', null, undefined,
]) ok(!cd.estClaudeDesktop(code), 'Claude Code / vide NON cible : ' + String(code).slice(-60));

// 2) le script PowerShell se lit sans erreur (les deux modes)
for (const mode of ['etat', 'relancer']) {
  const script = cd.scriptPowerShell(mode);
  const sortie = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseInput($env:SCRIPT_A_LIRE,[ref]$t,[ref]$e);if($e){$e|ForEach-Object{$_.Message}}else{"SYNTAXE_OK"}'],
  { env: { ...process.env, SCRIPT_A_LIRE: script }, encoding: 'utf8' }).trim();
  ok(sortie === 'SYNTAXE_OK', 'script PowerShell (' + mode + ') : ' + sortie.slice(0, 120));
  ok(mode === 'relancer' || !/Stop-Process/.test(script), mode === 'etat' ? 'le mode etat ne contient AUCUN arret de processus' : 'le mode relancer arrete bien des processus');
}

// 3) detection reelle, lecture seule : aucune cible ne doit etre un claude.exe hors Claude Desktop
const etat = await cd.etat();
ok(etat && etat.ok === true, 'etat() repond : ' + JSON.stringify({ enCours: etat.enCours, nPids: (etat.pids || []).length, lancement: etat.lancement && etat.lancement.type }));
const tous = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'claude.exe' } | Select-Object ProcessId, ExecutablePath | ConvertTo-Json -Compress"], { encoding: 'utf8' }) || '[]');
const liste = Array.isArray(tous) ? tous : [tous];
const cibles = new Set(etat.pids || []);
const horsDesktop = liste.filter((p) => p.ExecutablePath && !cd.estClaudeDesktop(p.ExecutablePath));
ok(horsDesktop.every((p) => !cibles.has(p.ProcessId)), horsDesktop.length + ' claude.exe hors Claude Desktop (Claude Code...), aucun n\'est cible');
ok(liste.filter((p) => cd.estClaudeDesktop(p.ExecutablePath)).every((p) => cibles.has(p.ProcessId)), 'tous les processus de Claude Desktop sont bien cibles');

console.log(echecs ? '\n' + echecs + ' ECHEC(S)' : '\nTOUT PASSE');
process.exit(echecs ? 1 : 0);
