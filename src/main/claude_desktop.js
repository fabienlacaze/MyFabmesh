'use strict';
/* RELANCER CLAUDE DESKTOP depuis l'aide de l'Assistant (2026-10-01, user : « rajoute un bouton pour relancer Claude Desktop »).
 *
 * POURQUOI : Claude ne relit la liaison avec MyFabmesh.AI qu'au DEMARRAGE, et fermer la fenetre ne le quitte pas (il reste dans la zone de
 * notification). La consigne « clic droit sur l'icone, Quit, rouvrir » etait la partie la moins claire de l'aide.
 *
 * LE PIEGE A NE PAS REPRODUIRE : Claude CODE (l'extension de l'editeur, ou le terminal) s'appelle AUSSI claude.exe. Fermer « tous les claude.exe »
 * couperait la session de code du user. On ne cible donc que les executables dont le CHEMIN est celui de Claude Desktop :
 *   - paquet Store : ...\WindowsApps\Claude_<version>_x64__<editeur>\app\Claude.exe
 *   - installation classique : %LOCALAPPDATA%\AnthropicClaude\...
 * jamais par le nom seul. Aucun argument ne vient de l'appelant. */
const { execFile } = require('child_process');

// Reconnaissance par le CHEMIN (jamais par le nom). Exportee pour le banc d'essai.
function estClaudeDesktop(cheminExe) {
  const c = String(cheminExe || '').replace(/\//g, '\\');
  return /\\WindowsApps\\Claude_[^\\]+\\/i.test(c) || /\\AnthropicClaude\\/i.test(c);
}

// mode : 'etat' (ne touche a rien) ou 'relancer' (ferme puis rouvre).
function scriptPowerShell(mode) {
  const agir = mode === 'relancer';
  return [
    "$ErrorActionPreference = 'Stop'",
    "$cibles = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'claude.exe' -and $_.ExecutablePath -and (",
    "  $_.ExecutablePath -like '*\\WindowsApps\\Claude_*' -or $_.ExecutablePath -like '*\\AnthropicClaude\\*') })",
    "$pids = @($cibles | ForEach-Object { [int]$_.ProcessId })",
    "$lancement = $null",
    "$pkg = Get-AppxPackage -Name 'Claude' -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if ($pkg) {",
    "  $id = 'Claude'",
    "  try { $id = @((Get-AppxPackageManifest $pkg).Package.Applications.Application)[0].Id } catch {}",
    "  $lancement = @{ type = 'store'; cible = ('shell:AppsFolder\\' + $pkg.PackageFamilyName + '!' + $id) }",
    "} else {",
    "  $sq = Join-Path $env:LOCALAPPDATA 'AnthropicClaude\\claude.exe'",
    "  if (Test-Path $sq) { $lancement = @{ type = 'exe'; cible = $sq } }",
    "}",
    "$res = @{ ok = $true; enCours = ($pids.Count -gt 0); pids = $pids; lancement = $lancement; ferme = $false; ouvert = $false }",
    agir ? [
      "if (-not $lancement -and $pids.Count -eq 0) { $res.ok = $false; $res.erreur = 'not_installed' }",
      "else {",
      "  foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }",
      "  if ($pids.Count -gt 0) {",
      "    for ($i = 0; $i -lt 40; $i++) { if (-not (Get-Process -Id $pids -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 200 }",
      "  }",
      "  $res.ferme = $pids.Count -gt 0",
      "  if ($lancement) {",
      "    Start-Sleep -Milliseconds 800",
      "    if ($lancement.type -eq 'store') { Start-Process 'explorer.exe' -ArgumentList $lancement.cible } else { Start-Process $lancement.cible }",
      "    $res.ouvert = $true",
      "  } else { $res.ok = $false; $res.erreur = 'cannot_reopen' }",
      "}",
    ].join('\n') : '',
    "$res | ConvertTo-Json -Compress -Depth 4",
  ].join('\n');
}

function _lancer(mode) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', scriptPowerShell(mode)],
      { timeout: 45000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out) => {
        const lignes = String(out || '').trim().split(/\r?\n/).filter(Boolean);
        try { resolve(JSON.parse(lignes[lignes.length - 1])); }
        catch (_) { resolve({ ok: false, erreur: err ? String(err.message || err) : 'sortie illisible' }); }
      });
  });
}

const etat = () => _lancer('etat');
const relancer = () => _lancer('relancer');

module.exports = { estClaudeDesktop, scriptPowerShell, etat, relancer };
