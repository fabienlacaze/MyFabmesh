; Banc du desinstalleur (build/test-desinstallation.mjs --nsis, 2026-09-30).
; Applique les fonctions de build/uninstaller.nsh (sans prefixe « un. ») a un FAUX arbre dont la racine
; est passee par MFM_TEST_RACINE. N'installe et ne desinstalle rien ; ne lit le registre que sous la cle
; de test CLE_TEST (creee et effacee par le banc). L'arret des processus n'est pas appele.
Unicode true
!ifndef SORTIE
  !define SORTIE "test-desinstalleur.exe"
!endif
!ifndef DOSSIER_NSH
  !define DOSSIER_NSH "."
!endif
!ifndef CLE_TEST
  !define CLE_TEST "Software\MyFabmesh.AI-TestDesinstalleur\DataDirs"
!endif
Name "MfmTestDesinstalleur"
OutFile "${SORTIE}"
RequestExecutionLevel user
SilentInstall silent

!include "${DOSSIER_NSH}\uninstaller.nsh"
!insertmacro MFM_FONCTIONS ""

!macro MFM_TEST_VALIDE LIBELLE CHEMIN
  Push "${CHEMIN}"
  Call MfmDossierDeplaceValide
  Pop $9
  FileWriteUTF16LE /BOM $8 "${LIBELLE}=$9$\r$\n"
!macroend

Section
  ReadEnvStr $5 "MFM_TEST_RACINE"
  StrLen $6 $5
  ${If} $6 < 10
    Abort
  ${EndIf}
  ReadEnvStr $7 "MFM_TEST_GARDER"
  ${If} $7 != "0"
    StrCpy $7 "1"
  ${EndIf}

  FileOpen $8 "$5\resultats-nsis.txt" w
  !insertmacro MFM_TEST_VALIDE "d1" "$5\D1\MyFabmesh-data"
  !insertmacro MFM_TEST_VALIDE "d1slash" "$5\D1\MyFabmesh-data\"
  !insertmacro MFM_TEST_VALIDE "d2" "$5\D2\MyFabmesh-data"
  !insertmacro MFM_TEST_VALIDE "d3" "$5\D3\Games"
  !insertmacro MFM_TEST_VALIDE "racine" "C:\"
  !insertmacro MFM_TEST_VALIDE "vide" ""
  !insertmacro MFM_TEST_VALIDE "relatif" "MyFabmesh-data"
  !insertmacro MFM_TEST_VALIDE "faux" "$5\D1\NotMyFabmesh-data"
  FileClose $8

  ; Meme sequence que un.MfmDesinstallationComplete (hors arret des processus et registre de l'appli).
  Push "${CLE_TEST}"
  Call MfmNettoyerDossiersDeplaces
  Push $7
  Push "$5\AppData\Roaming\myfabmesh-ai"
  Call MfmViderDossierAppli
  Push $7
  Push "$5\AppData\Roaming\fabmesh"
  Call MfmViderDossierAppli
  Push "$5\AppData\Local\myfabmesh-ai-updater"
  Call MfmSupprimerArbre
  Push "$5\AppData\Local\Temp"
  Call MfmNettoyerTemp
  Push "$5\Users\test"
  Call MfmNettoyerResidusPerso
  ${If} $7 == "0"
    Push "$5\Users\test\Documents"
    Call MfmSupprimerExports
  ${EndIf}
SectionEnd
