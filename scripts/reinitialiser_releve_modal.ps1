<#
.SYNOPSIS
  Reinitialise le releve horaire de la facture Modal (carte "Cout GPU (Modal)" de l'admin).

.DESCRIPTION
  POURQUOI (2026-09-30). Le nettoyage du disque du 30/09 a supprime
  %USERPROFILE%\.fabmesh, qui contenait le secret partage avec le site
  (MODAL_USAGE_SECRET). Cloudflare ne permet pas de relire un secret : il faut
  en creer un nouveau, le declarer au site ET le ranger sur ce PC.

  A lancer sur le PC du releve, DEPUIS LE DEPOT PRINCIPAL (pas depuis une copie
  .claude\worktrees : la tache planifiee pointerait vers un dossier temporaire) :

    powershell -ExecutionPolicy Bypass -File scripts\reinitialiser_releve_modal.ps1

  Etapes :
    1. nouveau secret : 32 octets aleatoires, base64url (43 caracteres) ;
    2. declaration au site : npx wrangler secret put MODAL_USAGE_SECRET, dans cloud\
       (le secret passe par l'entree standard, jamais sur une ligne de commande ;
       wrangler met a jour le worker en service, sans republier le site) ;
    3. ecriture locale : registre HKCU\Software\FabWare\Exploitation, valeur
       ReleveModalSecret (hors de tout dossier qu'un nettoyage de disque efface) ;
    4. re-enregistrement de la tache planifiee "MyFabmesh - Modal usage" :
       toutes les heures a hh:01, rattrapage au demarrage si le PC etait eteint,
       aussi sur batterie, 15 min au plus ;
    5. releve immediat, puis fin du journal.
  Si l'etape 2 echoue, RIEN n'est change sur ce PC.

  Options :
    -SansSite   saute l'etape 2 (le secret doit alors etre declare autrement :
                a eviter, il n'est affiche nulle part) ;
    -SansTache  ne touche pas a la tache planifiee (le releve de l'etape 5 est
                alors lance directement).

  Si un jour la releve GitHub (.github\workflows\modal-usage-push.yml) est
  activee, son secret MODAL_USAGE_SECRET devra recevoir la MEME valeur :
  relancer ce script la rend obsolete.
#>
param([switch]$SansSite, [switch]$SansTache)

$ErrorActionPreference = 'Stop'
$Depot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ($Depot -match '\\\.claude\\worktrees\\') {
  Write-Host "ARRET : script lance depuis une copie de travail ($Depot)." -ForegroundColor Red
  Write-Host 'Lance-le depuis le depot principal, sinon la tache planifiee pointerait vers un dossier temporaire.'
  exit 1
}
$Cmd = Join-Path $Depot 'scripts\push_modal_usage.cmd'
if (-not (Test-Path $Cmd)) { Write-Host "ARRET : introuvable : $Cmd" -ForegroundColor Red; exit 1 }
$CleReg = 'HKCU:\Software\FabWare\Exploitation'
$NomValeur = 'ReleveModalSecret'
$Tache = 'MyFabmesh - Modal usage'
$Journal = Join-Path $env:LOCALAPPDATA 'FabWare\Exploitation\releve_modal.log'

# 1. Nouveau secret -----------------------------------------------------------
Write-Host '1/5 Nouveau secret...'
$octets = New-Object byte[] 32
$alea = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$alea.GetBytes($octets)
$alea.Dispose()
$secret = [Convert]::ToBase64String($octets).TrimEnd('=').Replace('+', '-').Replace('/', '_')

# 2. Declaration au site ------------------------------------------------------
if ($SansSite) {
  Write-Host '2/5 Declaration au site : SAUTEE (-SansSite).' -ForegroundColor Yellow
} else {
  Write-Host '2/5 Declaration au site (npx wrangler secret put MODAL_USAGE_SECRET)...'
  Push-Location (Join-Path $Depot 'cloud')
  try {
    # npx.cmd (et non npx.ps1) : l'entree standard passe telle quelle ;
    # wrangler retire le saut de ligne final.
    $secret | & npx.cmd wrangler secret put MODAL_USAGE_SECRET
    $rc = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($rc -ne 0) {
    Write-Host "ECHEC de wrangler (code $rc) : rien n'a ete change sur ce PC." -ForegroundColor Red
    Write-Host "Verifier la connexion Cloudflare : cd cloud ; npx wrangler whoami"
    exit 2
  }
}

# 3. Ecriture locale (registre) ------------------------------------------------
Write-Host '3/5 Ecriture locale (registre HKCU\Software\FabWare\Exploitation)...'
if (-not (Test-Path $CleReg)) { New-Item -Path $CleReg -Force | Out-Null }
Set-ItemProperty -Path $CleReg -Name $NomValeur -Value $secret -Type String
$relu = (Get-ItemProperty -Path $CleReg -Name $NomValeur).$NomValeur
if ($relu -ne $secret) { Write-Host 'ECHEC : le registre ne rend pas la valeur ecrite.' -ForegroundColor Red; exit 3 }
$ancien = Join-Path $env:USERPROFILE '.fabmesh\modal_usage_secret.txt'
if (Test-Path $ancien) {
  Write-Host "   (ancien fichier present, desormais ignore : $ancien)" -ForegroundColor DarkGray
}

# 4. Tache planifiee ------------------------------------------------------------
if ($SansTache) {
  Write-Host '4/5 Tache planifiee : non modifiee (-SansTache).' -ForegroundColor Yellow
} else {
  Write-Host "4/5 Tache planifiee '$Tache' (toutes les heures a hh:01)..."
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $maintenant = Get-Date
  $debut = $maintenant.Date.AddHours($maintenant.Hour + 1).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
  $cmdXml = [System.Security.SecurityElement]::Escape('"' + $Cmd + '"')
  $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Releve horaire de la facture Modal pour l'admin MyFabmesh (scripts\push_modal_usage.cmd, journal %LOCALAPPDATA%\FabWare\Exploitation\releve_modal.log).</Description>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>$sid</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit>
  </Settings>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>$debut</StartBoundary>
      <Repetition>
        <Interval>PT1H</Interval>
      </Repetition>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>$cmdXml</Command>
    </Exec>
  </Actions>
</Task>
"@
  try {
    Register-ScheduledTask -TaskName $Tache -Xml $xml -Force | Out-Null
  } catch {
    # Pas bloquant : l'ancienne tache lance le MEME .cmd, qui lit le registre.
    Write-Host "   Tache non re-enregistree ($($_.Exception.Message)) : l'ancienne reste en place." -ForegroundColor Yellow
  }
}

# 5. Releve immediat -------------------------------------------------------------
Write-Host '5/5 Releve immediat...'
$tachePresente = $false
if (-not $SansTache) { $tachePresente = [bool](Get-ScheduledTask -TaskName $Tache -ErrorAction SilentlyContinue) }
if (-not $tachePresente) {
  & cmd.exe /c "`"$Cmd`""
  $code = $LASTEXITCODE
} else {
  Start-ScheduledTask -TaskName $Tache
  $limite = (Get-Date).AddMinutes(4)
  Start-Sleep -Seconds 3
  while (((Get-ScheduledTask -TaskName $Tache).State -eq 'Running') -and ((Get-Date) -lt $limite)) {
    Start-Sleep -Seconds 3
  }
  $code = (Get-ScheduledTaskInfo -TaskName $Tache).LastTaskResult
}
if (Test-Path $Journal) {
  Write-Host "--- fin du journal ($Journal) ---"
  Get-Content -Path $Journal -Tail 4 -Encoding UTF8
}
$sens = @{ 0 = 'OK'; 1 = 'erreur inattendue (voir le journal)'; 2 = 'secret introuvable'; 3 = 'cle refusee par le site';
           4 = 'facture Modal illisible (jeton Modal ?)'; 5 = 'site injoignable'; 9 = 'python introuvable' }
if ($code -eq 0) {
  Write-Host 'OK : releve envoye. La carte "Cout GPU (Modal)" doit afficher "Facture relevee a HH:MM".' -ForegroundColor Green
  exit 0
}
$libelle = $sens[[int]$code]
if (-not $libelle) { $libelle = 'code inconnu' }
Write-Host "ECHEC du releve (code $code : $libelle)." -ForegroundColor Red
exit 4
