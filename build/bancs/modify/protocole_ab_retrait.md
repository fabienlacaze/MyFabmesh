# Protocole A/B — « Modify image » : retrait d'un element (2026-10-20)

**NE PAS LANCER sans accord du proprietaire** : il demande du GPU Modal (quelques euros) et des images. Ce document decrit le banc ; rien n'a
ete execute. Aucun GPU local (le proprietaire travaille sous Unreal).

## Question

Quand la consigne de « Modify image » est un retrait (« remove the wings »), le nouveau chemin (analyse du texte traduit, puis moteur d'Auto
Inpaint : detection de la cible par texte + remplissage) **retire-t-il l'element** et **laisse-t-il le reste de l'image intact**, la ou
l'ancien chemin (img2img) laissait les ailes et redessinait le cochon ?

## Entrees (jamais commitees : le depot est public)

| entree | ou la trouver | usage |
|---|---|---|
| **le cochon aile du proprietaire** | `%APPDATA%\myfabmesh-ai\images\cochon_volant\ref_0.png` (1024 x 1024, genere le 01/10 ; projet « cochon_volant »). A COPIER (lecture seule) vers `C:\tmp\bancs\modify_retrait\entrees\cochon.png`, jamais dans le depot. | ailes, queue, arriere-plan |
| **un personnage a chapeau, lunettes et logo** | N'EXISTE PAS encore. A fournir : soit une image du proprietaire avec ces trois elements, soit UNE generation de reference (prompt propose : `cartoon pig character wearing a red hat and round glasses, a star logo on its t-shirt, plain light grey background, full body, front view` ; ~6 credits ou ~0,10 EUR sur Modal). A ranger sous `C:\tmp\bancs\modify_retrait\entrees\perso.png`. | chapeau, lunettes, logo |

**Ce que le proprietaire a deja fait sur le cochon (point de depart « avant », GRATUIT)** : trois essais du 19/10 au soir, tous depuis `ref_0.png`,
avec l'ancien chemin (img2img local), sidecars `ref_0_refined_<ts>_<n>.png.meta.json` du meme dossier :

| fichier | consigne | force | resultat vu le 20/10 |
|---|---|---|---|
| `ref_0_refined_1792440576429_309361729.png` | `remove wings` | 0,55 | **ailes intactes**, peau et museau redessines (le cochon change) |
| `ref_0_refined_1792440619714_561579754.png` | `remove wings` | 0,74 | **ailes multipliees**, le cochon est devenu un oiseau-griffon : sujet perdu |
| `ref_0_refined_1792440758952_94140722.png` | `remove the wings` | 0,40 | **ailes intactes, cochon redessine** (memes deux ailes ; museau, poil et sabots refaits) |

Resultat constate en regardant les trois images (20/10) : **0 retrait sur 3**. Elles servent de bras « avant » pour la consigne « ailes » (moteur local, meme logique que `modal_app/_modify.py`). Les cinq autres
consignes demandent un bras « avant » neuf.

## Bras

* **A — avant** : `op = modify`, force 0,55 (defaut) et 0,40 (« Subtle »), 3 graines fixes (11, 22, 33) ; consigne telle que tapee.
  Production : `modal_app/_modify.generate(base_pipe, image, prompt, strength, seed)` (celle de `/image_op`, `op: modify`).
* **B1 — apres, retrait pur** : `op = auto_inpaint`, `target_text` = la cible extraite par `analyserRetrait` (voir la table), `prompt = ''`
  (chemin « retrait » du moteur : force 0,85, prompt de remplissage du moteur), `dilate = 15`. Production :
  `modal_app/_auto_inpaint.generate(...)`. **Pas de graine** : le moteur n'en accepte pas (il faudrait un changement Modal) : on repete
  3 fois et on rapporte la variance.
* **B2 — apres, retrait avec prompt de continuite** (a lancer seulement si B1 invente du decor sur l'animal) : meme chose avec
  `prompt = 'plain background, seamless continuation of the surrounding surface'` (chemin « remplacement » : force 0,99, negatif = cible).
  Le choix B1 / B2 se joue sur UNE ligne de chaque page (`prompt: remplace ? analyse.remplacement : ''` dans `_modLancerRetrait`).

Les deux bras passent par le meme conteneur (`MyFabmeshBackview`) : fait chauffer le conteneur une fois (`/warm`), mesurer a chaud.

## Consignes (6 + 2 facultatives)

| # | image | consigne tapee | cible attendue (module) | element a retirer |
|---|---|---|---|---|
| 1 | cochon | `remove the wings` | `wings` | les DEUX ailes (grande a gauche, petite derriere la tete) |
| 2 | cochon | `remove the tail` | `tail` | la queue en tire-bouchon, a gauche |
| 3 | perso | `remove the hat` | `hat` | le chapeau |
| 4 | perso | `remove the glasses` | `glasses` | les lunettes |
| 5 | cochon | `remove the background` | `background` | tout le fond (le sujet reste) |
| 6 | perso | `remove the logo` | `logo` | le logo du t-shirt |
| 7 (fac.) | cochon | `remove the wings and the tail` | `wings and tail` | cible multiple (CLIPSeg recoit « wings and tail » en UN texte : non mesure) |
| 8 (fac.) | cochon | `replace the wings with a crown` | `wings` + remplacement `a crown` | remplacement explicite |

Chaque cible attendue est celle que `analyserRetrait` rend deja (table `build/retrait_cas.json`) : le banc verifie donc AUSSI l'extraction.

## Mesures (par image, une a une)

Regle du proprietaire : **compter les images une par une AVANT de conclure** (fiche de decompte, une ligne par image).

1. **Element retire : oui / non.** Jugement humain image par image, sur l'image entiere ET sur un zoom du masque. « Oui » = plus aucun
   fragment reconnaissable (plume, bout de queue, cadre de lunettes) ; « partiel » compte comme non. Sur la consigne 1, les deux ailes.
2. **Controle objectif de la detection** : relancer la detection de la cible (meme texte, meme seuil que le moteur) sur l'image obtenue ; surface du
   masque apres / surface avant ; « retire » si le rapport est inferieur a 0,2. Biais connu : meme detecteur que le moteur, donc ce n'est qu'un
   garde-fou, pas la verite.
3. **Reste de l'image inchange** : ecart moyen absolu (niveaux de gris 0-255, image redimensionnee a 1024) entre l'entree et la sortie,
   calcule HORS du masque de detection elargi de 16 px. Un moteur de retrait propre rend un ecart voisin de 0 hors masque ; une img2img
   redessine tout. Seuil propose : **<= 3 / 255** pour B, a recaler sur la premiere image mesuree ; A rapporte tel quel.
4. **Defauts dans la zone remplie** (comptes, pas moyennes) : decor invente (un « mur » sur le dos de l'animal : le prompt de remplissage du
   moteur parle de mur, il a ete ecrit pour des portes et des fenetres), element duplique, halo ou couture au bord du masque, membre en trop.
5. **Cout et duree** par image : duree d'inference a chaud, depense Modal (`_meta/modal_spend`), credits si lance par le site.

## Decision

* **Succes de B** : « element retire » sur au moins 5 des 6 consignes ET au moins 80 % des images (3 repetitions), ecart hors masque <= 3,
  aucun decor invente visible sur le sujet. A attendu : 0 a 1 consigne sur 6 (les trois essais du cochon sont deja a 0 / 3).
* Si B1 echoue par decor invente mais que B2 retire proprement : changer le remplacement par defaut du retrait pur (une ligne par page), refaire les
  tests (`tests/bureau-interface/retrait-modify.test.mjs` fixe `prompt: ''` pour un retrait pur).
* Si la cible multiple (7) ne retire qu'un des deux elements : limiter le routage a UNE cible (`MAX_CIBLES = 1` dans `lib/retrait-image.js`, copie web
  par `node build/check-noyaux-partages.mjs --sync`, table a mettre a jour) et laisser le message de la ligne d'aide dire de proceder en deux fois.
* Si « remove the background » echoue (cible trop grande pour CLIPSeg) : l'outil dedie « Remove background » (1 credit) fait mieux ; retirer « background »
  du routage (liste `NON_OBJET` du module).

## Cout estime

Modal L40S, conteneur image chaud (instantane restaure en 5-25 s, voir CLAUDE.md section 12) :

* A : 6 consignes x 2 forces x 3 graines = 36 images, ~0,03 a 0,07 EUR l'une a chaud => **~1,5 a 2,5 EUR** (le cochon, 3 images, est gratuit : deja fait).
* B1 : 6 consignes x 3 repetitions = 18 images, ~0,10 a 0,15 EUR l'une (CLIPSeg + SDXL Inpaint 40 pas) => **~2 a 2,7 EUR**.
* B2 : 2 consignes x 3 = 6 images, ~0,7 EUR (seulement si besoin).
* Image de reference du personnage : ~0,10 EUR. Demarrages a froid : +0,2 a 0,3 EUR chacun, a eviter par `/warm`.

**Total : ~4 a 6 EUR, ~45 minutes** de GPU. Moins de 1 EUR si l'on se limite aux consignes 1, 2 et 5 sur le cochon, 3 repetitions chacune (la moitie du
verdict, sans image a fournir).

## Mise en oeuvre (quand l'accord est donne)

1. `C:\tmp\bancs\modify_retrait\` : `entrees\`, `sorties\A\`, `sorties\B1\`, `sorties\B2\`, `fiche_decompte.md` (une ligne par image).
2. Banc Modal sur le modele de `modal_app/test_atlas_ops.py` (`modal run`, `@app.function(gpu="L40S")`) : charge les pipelines comme
   `MyFabmeshBackview`, boucle sur les consignes, ecrit les PNG sous `/data` (volume) puis les telecharge. Variables UTF-8 obligatoires
   (`PYTHONUTF8=1 PYTHONIOENCODING=utf-8`). Aucun deploiement.
3. Mesures 2 et 3 en local, CPU seulement (`numpy` + `PIL`, a faire tourner avec `bash /c/tmp/lourd.sh`).
4. Une page HTML locale de comparaison (variantes cote a cote, meme chemin d'image), comme pour les autres bancs.
5. Resultat dans `AGENT_LOG.md` : decompte image par image, ecarts mesures, decision B1 / B2, cout reel.
