@echo off
REM ---------------------------------------------------------------------
REM Releve horaire de la facture Modal -> carte « Cout GPU (Modal) » de l'admin.
REM Lance chaque heure (hh:01) par la tache planifiee « MyFabmesh - Modal usage ».
REM
REM 2026-09-30 : le secret n'est plus lu ici. Il vivait dans
REM %USERPROFILE%\.fabmesh, que le nettoyage du disque du 30/09 a efface :
REM la tache sortait en code 2 chaque heure SANS AUCUNE TRACE (le journal
REM etait dans le meme dossier). modal_usage_push.py le lit maintenant dans le
REM registre (HKCU\Software\FabWare\Exploitation), hors de tout dossier
REM qu'un nettoyage efface, et ecrit chaque echec en clair dans le journal.
REM
REM Journal : %LOCALAPPDATA%\FabWare\Exploitation\releve_modal.log
REM           (dossier recree au besoin, borne a 1 Mo).
REM Reparer (secret perdu ou refuse) : scripts\reinitialiser_releve_modal.ps1
REM Codes : 0 ok, 1 inattendu, 2 secret introuvable, 3 cle refusee,
REM         4 facture Modal illisible, 5 site injoignable, 9 python introuvable.
REM ---------------------------------------------------------------------
setlocal

set "REPO=%~dp0.."
set "JDIR=%LOCALAPPDATA%\FabWare\Exploitation"
set "LOG=%JDIR%\releve_modal.log"
if not exist "%JDIR%" mkdir "%JDIR%" >nul 2>&1

set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
cd /d "%REPO%"

where python >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] ECHEC ^(code 9^) : python introuvable dans le PATH de la tache planifiee. >> "%LOG%"
  exit /b 9
)

REM Le script ecrit lui-meme le journal (et le fait tourner) : il ne faut donc
REM PAS que cmd le tienne ouvert. stderr va dans un fichier a part, pour garder
REM la trace d'un plantage de Python avant meme la lecture des arguments.
python scripts\modal_usage_push.py --journal "%LOG%" 1>nul 2>"%JDIR%\releve_modal_stderr.txt"
exit /b %ERRORLEVEL%
