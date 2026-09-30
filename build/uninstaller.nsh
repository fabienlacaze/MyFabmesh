; ═══════════════════════════════════════════════════════════════════════════════════════════
; MyFabmesh.AI — DESINSTALLATION COMPLETE (2026-09-30)
; Inclus par electron-builder (package.json > build.nsis.include) en tete de l'installeur ET du
; desinstalleur. Seul le desinstalleur utilise ces fonctions (BUILD_UNINSTALLER).
;
; Demande du user : « vraiment desinstaller tout MyFabmesh (modeles, appli, ...) ». Avant, une
; desinstallation laissait ~65 Go : moteur d'IA (python ~9 Go), modeles (hf_cache ~49 Go), caches ;
; un dossier de donnees DEPLACE sur un autre disque n'etait jamais touche.
;
; CE QUE FAIT UNE DESINSTALLATION (hors mise a jour) :
;   1. arrete les processus lances depuis nos dossiers (moteurs Python orphelins, jobs en pause) ;
;   2. supprime le moteur d'IA, les modeles et les caches, y compris dans les dossiers deplaces
;      (inscrits par l'appli sous HKCU\Software\MyFabmesh.AI\DataDirs) ;
;   3. supprime reglages, journaux, profil Electron, cache de mise a jour, fichiers temporaires et les
;      fichiers laisses dans le dossier personnel par d'anciennes versions ;
;   4. les PROJETS (images, modeles 3D, historique, exports) ne partent que sur demande :
;        - desinstallation normale (Parametres > Applications, menu Demarrer) : question Oui / Non,
;          « Non » par defaut ;
;        - desinstallation silencieuse (/S) : projets GARDES, sauf --delete-projects ;
;        - --keep-projects / --delete-projects : choix impose sans question (utilise par l'appli,
;          Reglages > Remove all MyFabmesh data).
;
; MISE A JOUR : le nouvel installeur (et la mise a jour automatique) lance l'ANCIEN desinstalleur avec
; « /S /KEEP_APP_DATA --updated » (electron-builder, installUtil.nsh > uninstallOldVersion). Dans ce
; cas RIEN n'est supprime : mode « maj » ci-dessous.
;
; SURETE : un dossier deplace doit s'appeler « MyFabmesh-data » (nom impose par l'appli) ET porter le
; temoin « .myfabmesh-data » pose par l'appli ; on n'y supprime QUE les sous-dossiers du moteur, puis le
; dossier s'il est vide. Jamais une racine, jamais un dossier que l'appli n'a pas cree. Les listes
; suivent src/main/desinstallation.js (verifie par build/test-desinstallation.mjs).
; JAMAIS « RMDir /r » : celui de NSIS 3.0.4 TRAVERSE les jonctions et efface le contenu de leur cible
; (constate par le banc build/test-desinstallation.mjs --nsis : une jonction vers un autre dossier a
; vide ce dossier). Un user qui aurait relie hf_cache a un cache de modeles partage l'aurait perdu.
; MfmSupprimerArbre retire un lien sans jamais le parcourir.
; ═══════════════════════════════════════════════════════════════════════════════════════════

!include LogicLib.nsh
!include FileFunc.nsh

!define MFM_CLE_REG "Software\MyFabmesh.AI"
!define MFM_TEMOIN ".myfabmesh-data"

; Supprime une entree (fichier ou dossier, recursivement, sans suivre les liens) et note l'echec dans
; $2 ("0") si elle existe encore. Reserve a MfmSupprimerMoteur.
!macro MFM_SUPPRIMER_SOUS_DOSSIER UN BASE NOM
  Push "${BASE}\${NOM}"
  Call ${UN}MfmSupprimerArbre
  ${If} ${FileExists} "${BASE}\${NOM}"
    StrCpy $2 "0"
  ${EndIf}
!macroend

; Fonctions communes : prefixe « un. » dans le desinstalleur, sans prefixe dans le banc de test
; (build/test-desinstalleur.nsi). Toutes les entrees passent par la pile et sont VERIFIEES (un chemin
; vide ferait viser la racine du disque courant).
!macro MFM_FONCTIONS UN

; Suppression recursive SANS suivre les liens. Un lien symbolique ou une jonction est retire seul
; (RMDir sans /r, Delete), jamais parcouru : sa cible reste intacte. Pile : chemin (fichier ou dossier).
Function ${UN}MfmSupprimerArbre
  Exch $0
  Push $1
  Push $2
  Push $3
  StrLen $1 $0
  ${If} $1 >= 4
    ${If} ${FileExists} "$0\*.*"             ; dossier, ou lien vers un dossier
      System::Call 'kernel32::GetFileAttributesW(w r0) i .r1'
      IntOp $3 $1 & 0x400                    ; FILE_ATTRIBUTE_REPARSE_POINT : lien, jonction
      ${If} $1 <> -1
      ${AndIf} $3 <> 0
        RMDir "$0"                           ; le lien seul, jamais sa cible
      ${Else}
        FindFirst $1 $2 "$0\*"
        ${DoWhile} $2 != ""
          ${If} $2 != "."
          ${AndIf} $2 != ".."
            Push "$0\$2"
            Call ${UN}MfmSupprimerArbre
          ${EndIf}
          FindNext $1 $2
        ${Loop}
        ${If} $1 != ""
          FindClose $1
        ${EndIf}
        RMDir "$0"
      ${EndIf}
    ${Else}
      Delete "$0"                            ; fichier (un lien vers un fichier : le lien seul)
      RMDir "$0"                             ; jonction dont la cible n'existe plus
    ${EndIf}
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Supprime les sous-dossiers du moteur d'IA d'un dossier de donnees.
; Pile : dossier -> "1" si tout est parti, "0" si quelque chose est reste (fichier verrouille).
Function ${UN}MfmSupprimerMoteur
  Exch $0
  Push $1
  Push $2
  StrCpy $2 "1"
  StrLen $1 $0
  ${If} $1 >= 4
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "python"
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "python-rig"
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "python-segment"
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "puppeteer"
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "SkinTokens"
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "SAMPart3D"
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "PartSAM"
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "hf_cache"
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "ai-cache"
    !insertmacro MFM_SUPPRIMER_SOUS_DOSSIER "${UN}" "$0" "ai-tmp"
  ${Else}
    StrCpy $2 "0"
  ${EndIf}
  StrCpy $0 $2
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; Dossier de donnees deplace sur lequel on peut agir : chemin absolu, nom « MyFabmesh-data », temoin
; present. Pile : chemin -> chemin normalise (sans « \ » final), ou "" si refuse.
Function ${UN}MfmDossierDeplaceValide
  Exch $0
  Push $1
  Push $2
  StrCpy $2 ""
  ${Do}
    StrCpy $1 $0 1 -1
    ${If} $1 == "\"
      StrCpy $0 $0 -1
    ${Else}
      ${Break}
    ${EndIf}
  ${Loop}
  StrLen $1 $0
  ${If} $1 >= 17
    StrCpy $1 $0 "" -15
    ${If} $1 == "\MyFabmesh-data"
      StrCpy $1 $0 2 1
      ${If} $1 != ":\"
        StrCpy $1 $0 2
      ${EndIf}
      ${If} $1 == ":\"
      ${OrIf} $1 == "\\"
        ${If} ${FileExists} "$0\${MFM_TEMOIN}"
          StrCpy $2 $0
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  StrCpy $0 $2
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; Nettoie les dossiers deplaces inscrits sous HKCU\<sous-cle>. Pile : sous-cle.
Function ${UN}MfmNettoyerDossiersDeplaces
  Exch $0
  Push $1
  Push $2
  Push $3
  StrCpy $1 0
  ${Do}
    ClearErrors
    EnumRegValue $2 HKCU "$0" $1
    ${If} ${Errors}
    ${OrIf} $2 == ""
      ${Break}
    ${EndIf}
    ReadRegStr $3 HKCU "$0" "$2"
    Push $3
    Call ${UN}MfmDossierDeplaceValide
    Pop $3
    ${If} $3 != ""
      Push $3
      Call ${UN}MfmSupprimerMoteur
      Pop $2
      ${If} $2 == "1"                        ; temoin retire seulement si tout le moteur est parti
        Delete "$3\${MFM_TEMOIN}"
        RMDir "$3"                           ; seulement s'il est vide (fichiers du user gardes)
      ${EndIf}
    ${EndIf}
    IntOp $1 $1 + 1
  ${Loop}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Vide un dossier de l'appli (%APPDATA%\myfabmesh-ai, ancien %APPDATA%\fabmesh).
; Pile, dans l'ordre des Push : garder ("1" = garder projets et config), dossier.
Function ${UN}MfmViderDossierAppli
  Exch $0
  Exch
  Exch $1
  Push $2
  Push $3
  Push $4
  StrLen $2 $0
  ${If} $2 >= 4
  ${AndIf} ${FileExists} "$0\*.*"
    ${If} $1 != "1"
      Push $0
      Call ${UN}MfmSupprimerArbre
    ${Else}
      FindFirst $2 $3 "$0\*"
      ${DoWhile} $3 != ""
        ${If} $3 != "."
        ${AndIf} $3 != ".."
          StrCpy $4 "0"
          ${If} $3 == "images"
          ${OrIf} $3 == "meshes"
          ${OrIf} $3 == "previews"
          ${OrIf} $3 == "history"
          ${OrIf} $3 == "projets_vides"
          ${OrIf} $3 == "config.json"
          ${OrIf} $3 == "config.json.bak"
            StrCpy $4 "1"
          ${EndIf}
          ${If} $4 == "0"
            Push "$0\$3"
            Call ${UN}MfmSupprimerArbre
          ${EndIf}
        ${EndIf}
        FindNext $2 $3
      ${Loop}
      ${If} $2 != ""
        FindClose $2
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Supprime les entrees d'un dossier qui correspondent a un motif (« fabmesh_* »).
; Pile, dans l'ordre des Push : motif, dossier.
Function ${UN}MfmSupprimerMotif
  Exch $0
  Exch
  Exch $1
  Push $2
  Push $3
  StrLen $2 $0
  ${If} $2 >= 4
    FindFirst $2 $3 "$0\$1"
    ${DoWhile} $3 != ""
      ${If} $3 != "."
      ${AndIf} $3 != ".."
        Push "$0\$3"
        Call ${UN}MfmSupprimerArbre
      ${EndIf}
      FindNext $2 $3
    ${Loop}
    ${If} $2 != ""
      FindClose $2
    ${EndIf}
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Fichiers temporaires de l'appli et de ses scripts. Pile : dossier temporaire.
Function ${UN}MfmNettoyerTemp
  Exch $0
  Push "fabmesh_*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "myfabmesh*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "rig_complet_*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "skintokens_code_*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "detail_synth_*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "fbxmotion_*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "puppeteer_*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "unirig_*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "anytop_*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "kimodo_*"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Push "_pup_fbx2glb.py"
  Push $0
  Call ${UN}MfmSupprimerMotif
  Pop $0
FunctionEnd

; Fichiers laisses dans le dossier personnel par d'anciennes versions (modeles de detourage et
; d'agrandissement, reglage des noyaux 3D, jeton de l'API de pilotage). Pile : dossier personnel.
Function ${UN}MfmNettoyerResidusPerso
  Exch $0
  Push $1
  StrLen $1 $0
  ${If} $1 >= 4
    Delete "$0\.u2net\u2net.onnx"
    Delete "$0\.u2net\u2net.onnx.part"
    RMDir "$0\.u2net"
    Push "$0\.cache\realesrgan_weights"
    Call ${UN}MfmSupprimerArbre
    Delete "$0\.flex_gemm\autotune_cache.json"
    RMDir "$0\.flex_gemm"
    Delete "$0\.fabmesh\test_api_token.txt"
    RMDir "$0\.fabmesh"
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

; Exports d'animation (Documents\MyFabmesh\exports) : des creations, seulement avec les projets.
; Pile : dossier Documents.
Function ${UN}MfmSupprimerExports
  Exch $0
  Push $1
  StrLen $1 $0
  ${If} $1 >= 4
    Push "$0\MyFabmesh\exports"
    Call ${UN}MfmSupprimerArbre
    RMDir "$0\MyFabmesh"
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

!macroend

; Fonctions du desinstalleur : definies dans « customHeader », qu'electron-builder insere APRES ses
; « !addplugindir ». Placees directement dans ce fichier (en tete du script), elles arrivaient avant la
; declaration des greffons, dans un ordre variable : « Plugin not found, cannot call
; StdUtils::TestParameter » a la construction du 2026-09-30.
!macro customHeader
!ifdef BUILD_UNINSTALLER
  !insertmacro MFM_FONCTIONS "un."

  ; "maj" = mise a jour (rien n'est supprime), "garder" = projets gardes, "tout" = projets supprimes.
  Var MfmMode

  Function un.MfmChoisirMode
    Push $0
    Push $1
    StrCpy $MfmMode "garder"
    ${If} ${isUpdated}
      StrCpy $MfmMode "maj"
      Goto mfm_fin
    ${EndIf}
    ${StdUtils.TestParameter} $0 "KEEP_APP_DATA"
    ${If} $0 == "true"
      StrCpy $MfmMode "maj"
      Goto mfm_fin
    ${EndIf}
    ${StdUtils.TestParameter} $0 "delete-projects"
    ${If} $0 == "true"
      StrCpy $MfmMode "tout"
      Goto mfm_fin
    ${EndIf}
    ${StdUtils.TestParameter} $0 "keep-projects"
    ${If} $0 == "true"
      Goto mfm_fin
    ${EndIf}
    ; Lance par le user (Parametres > Applications, menu Demarrer) et non en silencieux : on demande.
    ; La boite s'affiche meme apres le SetSilent du mode un clic (MessageBox sans /SD).
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "/S" $1
    ${IfNot} ${Errors}
      Goto mfm_fin
    ${EndIf}
    StrCpy $1 "MyFabmesh.AI, its AI engine and the downloaded AI models will be removed from this PC.$\r$\n$\r$\nAlso delete your projects and creations (images, 3D models, history, exports)?$\r$\n$\r$\nYes: delete everything.$\r$\nNo: keep your projects (they will be found again if you reinstall MyFabmesh.AI)."
    ${If} $LANGUAGE == 1036
      StrCpy $1 "MyFabmesh.AI, son moteur d'IA et les modèles d'IA téléchargés vont être supprimés de ce PC.$\r$\n$\r$\nSupprimer aussi vos projets et créations (images, modèles 3D, historique, exports) ?$\r$\n$\r$\nOui : tout supprimer.$\r$\nNon : garder vos projets (ils seront retrouvés si vous réinstallez MyFabmesh.AI)."
    ${EndIf}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$1" IDNO mfm_fin
    StrCpy $MfmMode "tout"
  mfm_fin:
    Pop $1
    Pop $0
  FunctionEnd

  ; Arrete les processus dont l'executable est dans un de nos dossiers (python du moteur, jobs mis en
  ; pause) ou qui executent un de nos scripts. Meme script que SCRIPT_ARRET (src/main/desinstallation.js) ;
  ; les chemins passent par l'environnement : aucune injection, et un chemin court ne peut rien viser.
  Function un.MfmArreterProcessus
    Push $0
    Push $1
    Push $2
    Push $3
    StrCpy $0 "$APPDATA\myfabmesh-ai|$APPDATA\fabmesh"
    StrCpy $1 0
    ${Do}
      ClearErrors
      EnumRegValue $2 HKCU "${MFM_CLE_REG}\DataDirs" $1
      ${If} ${Errors}
      ${OrIf} $2 == ""
        ${Break}
      ${EndIf}
      ReadRegStr $3 HKCU "${MFM_CLE_REG}\DataDirs" "$2"
      Push $3
      Call un.MfmDossierDeplaceValide
      Pop $3
      ${If} $3 != ""
        StrCpy $0 "$0|$3"
      ${EndIf}
      IntOp $1 $1 + 1
    ${Loop}
    System::Call 'Kernel32::SetEnvironmentVariable(t "MFM_DOSSIERS", t r0)'
    StrCpy $1 "$INSTDIR\resources\scripts"
    System::Call 'Kernel32::SetEnvironmentVariable(t "MFM_SCRIPTS", t r1)'
    nsExec::Exec /TIMEOUT=30000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d=@($$env:MFM_DOSSIERS -split '\|'|?{$$_.Length -gt 6}|%{$$_.TrimEnd('\')+'\'}); $$s=[string]$$env:MFM_SCRIPTS; if($$s.Length -gt 6){$$s=$$s.TrimEnd('\')+'\'}else{$$s=$$null}; Get-CimInstance Win32_Process | ?{ $$p=$$_.ExecutablePath; $$c=$$_.CommandLine; ($$_.ProcessId -ne $$PID) -and ((($$p) -and (@($$d|?{$$p.StartsWith($$_,[StringComparison]::OrdinalIgnoreCase)}).Count -gt 0)) -or ($$s -and $$c -and $$c.IndexOf($$s,[StringComparison]::OrdinalIgnoreCase) -ge 0)) } | %{ Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $1
    Sleep 1000
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function un.MfmDesinstallationComplete
    ${If} $MfmMode != "garder"
    ${AndIf} $MfmMode != "tout"
      Return                                 ; mise a jour (ou mode inconnu) : on ne touche a rien
    ${EndIf}
    Push $0
    ${If} $installMode == "all"
      SetShellVarContext current             ; les donnees d'Electron sont toujours par utilisateur
    ${EndIf}
    StrCpy $0 "1"
    ${If} $MfmMode == "tout"
      StrCpy $0 "0"
    ${EndIf}
    Call un.MfmArreterProcessus
    Push "${MFM_CLE_REG}\DataDirs"
    Call un.MfmNettoyerDossiersDeplaces
    Push $0
    Push "$APPDATA\myfabmesh-ai"
    Call un.MfmViderDossierAppli
    Push $0
    Push "$APPDATA\fabmesh"
    Call un.MfmViderDossierAppli
    Push "$LOCALAPPDATA\myfabmesh-ai-updater"
    Call un.MfmSupprimerArbre
    Push $TEMP
    Call un.MfmNettoyerTemp
    Push $PROFILE
    Call un.MfmNettoyerResidusPerso
    ${If} $0 == "0"
      Push $DOCUMENTS
      Call un.MfmSupprimerExports
    ${EndIf}
    DeleteRegKey HKCU "${MFM_CLE_REG}"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\${APP_ID}"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
    Pop $0
  FunctionEnd
!endif
!macroend

!macro customUnInit
  Call un.MfmChoisirMode
!macroend

!macro customUnInstall
  Call un.MfmDesinstallationComplete
!macroend
