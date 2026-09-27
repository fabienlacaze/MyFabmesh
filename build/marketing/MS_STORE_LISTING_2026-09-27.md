# Fiche Microsoft Store — version du 27/09/2026

Remplace `MS_STORE_LISTING_ANONYMIZED.md` (jamais appliquée : la fiche en ligne
nomme encore les moteurs, décrit 3 modes de qualité disparus et une carte de 8 Go).

Partner Center → MyFabmesh.AI → nouvelle soumission → **Store listings** →
English (United States), puis Français (France). Les captures et leurs légendes
sont dans `store-screenshots/2026-09-27/` (voir `LEGENDES.md`).

**Paquet visé : 1.0.36** (construit le 27/09 avec tout le travail du jour : réglages automatiques,
10 M de triangles, ajout / suppression / rattachement des points du squelette, annuler / rétablir).

Faits vérifiés dans le code le 27/09 :
- mode local = carte NVIDIA avec 12 Go de mémoire vidéo ou plus (wizard.js) ; sinon
  mode Cloud, avec tous les outils (images, 3D, rig, animation) ;
- Ultra 8K et jusqu'à 10 M de triangles aussi sur le bureau (index2.html) ;
- exports GLB, FBX, OBJ, STL ; serveur MCP intégré ;
- crédits achetés sur le site (Stripe Checkout), rapports de plantage anonymes et
  désactivables (Sentry, opt-out).

Aucun nom de moteur, et plus de liste de licences : une partie du rig est sous
GPL-3.0, donc « tous les modèles sont MIT/Apache » serait faux.

---

## English (United States)

### Description

```
Create game-ready 3D assets from a text prompt or a picture, then edit everything you generate: the image, the 3D model, the skeleton and the animation. One Windows app for indie game developers, 3D artists and hobbyists.

HOW IT WORKS

1. Image: type a prompt or drop a picture, then perfect it with the image tools.
2. 3D model: one click turns the image into a textured model, with up to 8K textures and 10 million triangles.
3. Rig: an automatic skeleton for any body (humans, animals, insects, creatures) that you can adjust point by point.
4. Animation (beta): add idle, walk, run or attack clips, then export to FBX or Unreal Engine.

EDIT ANYTHING YOU GENERATE

Not happy with a detail? Fix it in a few clicks instead of starting over, directly in the 2D and 3D viewers.

• Image tools. AI: modify from an instruction, auto inpaint, remove background, upscale, restyle, face fix, outfits, recolor, age, multi-views, variants. Manual: mask, clone stamp, crop, auto symmetry.
• 3D tools. AI: texture variants, sharpen texture, re-texture the whole model or one region, segment parts. Automatic: smooth, set the triangle count, subdivide, fix normals, fill holes, watertight for 3D printing. Manual: pivot, sculpt, paint, texture clone, explode, resize, material adjust.
• Rig tools: move, add or remove skeleton points, relink bones, and undo or redo every change.

NOTHING IS LOST

Every step keeps its versions, so you can go back to any earlier image or model at any time. Each project groups its images, models, rigs and animations in one place.

LOCAL OR CLOUD, YOUR CHOICE

• Local mode: with an NVIDIA graphics card that has 12 GB of video memory or more, everything runs on your PC. Generations are unlimited, and the app works offline once the AI models are downloaded (about 20 GB, first launch only).
• Cloud mode: on any other PC (AMD, Intel or a smaller NVIDIA card), the same tools run on the MyFabmesh servers and the results land straight in your projects. You get 50 free credits when you sign up, and the price of every action is shown before you click.

EXPORT

GLB, FBX, OBJ and STL. The Unreal Engine export sets the right scale and axes, so the model lands in your level at the correct size. Also works with Blender, Unity, Godot and any standard 3D pipeline.

AUTOMATE WITH CLAUDE

The built-in MCP server connects the app to Claude Desktop and other MCP-compatible tools, so you can generate batches of assets from text commands.

MARKETPLACE

Browse the MyFabmesh marketplace and share your own images and models, for free or at your own price (paid sales open soon). Every month, five paid items are free to claim and keep, and their creators are still paid.

SECURE PAYMENTS

All payments go through Stripe: buying credits, buying on the marketplace and paying creators. Your card details never reach us.

YOUR CREATIONS ARE YOURS

The images and models you create are yours to use in your own projects, including commercial ones.

PUBLIC BETA

MyFabmesh is free during the public beta. Report issues at github.com/fabienlacaze/MyFabmesh/issues. Crash reports are anonymous (no personal data, no machine identifier) and can be turned off. Privacy policy: https://fabienlacaze.github.io/MyFabmesh/privacy.html

Made in France by Ayros Studio.
```

### Short description

```
Create game-ready 3D assets from a prompt or a picture: textured model, automatic rig for any body, animation. Edit everything you generate. Runs on your NVIDIA card or in the cloud.
```

### What's new in this version

```
A major update of the public beta:
• Projects and versions: every image, model, rig and animation is kept, nothing is lost.
• New image tools: outfits, recolor, age, multi-views, variants, auto inpaint, face fix.
• Auto settings pick the best 3D options for your subject.
• Ultra 8K quality and up to 10 million triangles.
• Automatic rig for any body (humans, animals, insects, creatures) with a point-by-point skeleton editor.
• The rig can run on your own NVIDIA card: the setup assistant downloads it for you.
• Animation clips (beta).
• Cloud mode: PCs without a compatible NVIDIA card can now use every tool.
• Marketplace, with five free items every month.
• Many fixes and speed improvements.
```

### Product features (one per line, 200 characters max each)

```
Text or picture to a textured 3D model, with up to 8K textures and 10 million triangles
Auto settings: picks the best 3D options for your subject before generating
AI image tools: modify, inpaint, remove background, upscale, restyle, outfits, recolor, age, multi-views
Manual image tools: mask, clone stamp, crop and auto symmetry
3D tools: re-texture, sharpen texture, segment parts, smooth, triangle count, fill holes, watertight
Sculpt, paint and resize the model directly in the 3D viewer
Automatic rig for any body: humans, animals, insects and creatures
Edit the skeleton point by point, relink bones, undo and redo every change
Animation clips (beta): idle, walk, run, attack and more
Versions at every step: nothing you generate is ever lost
Projects group your images, models, rigs and animations in one place
Export to GLB, FBX, OBJ and STL, with a dedicated Unreal Engine export
Local mode: unlimited generations on an NVIDIA card with 12 GB+, offline after setup
Cloud mode: works on any PC, with the price of every action shown before you click
Built-in MCP server: generate batches of assets from Claude Desktop
Marketplace: share your assets and claim five free items every month
Secure payments through Stripe for credits, purchases and creator payouts
```

### Additional system requirements

Minimum hardware:
```
Windows 10 or 11, 64-bit
Any graphics card: without a compatible NVIDIA card, the app runs in cloud mode (internet connection required)
8 GB of RAM
1 GB of free disk space
```

Recommended hardware (local mode):
```
NVIDIA graphics card with 12 GB of video memory or more (for example RTX 3060 12 GB, RTX 4070, RTX 5070 or newer)
32 GB of RAM
30 GB of free disk space for the AI models, downloaded on first launch
```

### Search terms (7 max, 30 characters each)

```
3D model generator
image to 3D
text to 3D
auto rig
game assets
Unreal Engine
3D printing
```

---

## Français (France)

### Description

```
Créez des assets 3D prêts pour le jeu à partir d'un texte ou d'une image, puis modifiez tout ce que vous générez : l'image, le modèle 3D, le squelette et l'animation. Une seule application Windows, pour les développeurs de jeux indépendants, les artistes 3D et les passionnés.

COMMENT ÇA MARCHE

1. Image : écrivez une description ou déposez une image, puis peaufinez-la avec les outils d'image.
2. Modèle 3D : un clic transforme l'image en modèle texturé, jusqu'à des textures 8K et 10 millions de triangles.
3. Rig : un squelette automatique pour tout corps (humains, animaux, insectes, créatures), ajustable point par point.
4. Animation (bêta) : ajoutez des clips de repos, marche, course ou attaque, puis exportez en FBX ou vers Unreal Engine.

MODIFIEZ TOUT CE QUE VOUS GÉNÉREZ

Un détail ne vous plaît pas ? Corrigez-le en quelques clics au lieu de tout recommencer, directement dans les visionneuses 2D et 3D.

• Outils d'image. IA : modifier à partir d'une consigne, retouche automatique, détourage, agrandissement, changement de style, correction du visage, tenues, recoloration, âge, multi-vues, variantes. Manuels : masque, tampon, recadrage, symétrie automatique.
• Outils 3D. IA : variantes de texture, texture plus nette, retexturer tout le modèle ou une zone, découpe en parties. Automatiques : lissage, nombre de triangles, subdivision, correction des normales, bouchage des trous, maillage étanche pour l'impression 3D. Manuels : pivot, sculpture, peinture, tampon de texture, éclatement, dimensions, réglage des matériaux.
• Outils de rig : déplacer, ajouter ou supprimer des points du squelette, rattacher les os, annuler ou rétablir chaque modification.

RIEN N'EST PERDU

Chaque étape garde ses versions : revenez à n'importe quelle image ou modèle précédent à tout moment. Chaque projet regroupe ses images, modèles, squelettes et animations au même endroit.

LOCAL OU CLOUD, AU CHOIX

• Mode local : avec une carte graphique NVIDIA de 12 Go de mémoire vidéo ou plus, tout tourne sur votre PC. Générations illimitées, et l'application fonctionne hors ligne une fois les modèles d'IA téléchargés (environ 20 Go, au premier lancement seulement).
• Mode cloud : sur tout autre PC (AMD, Intel ou carte NVIDIA plus modeste), les mêmes outils tournent sur les serveurs MyFabmesh et les résultats arrivent directement dans vos projets. 50 crédits offerts à l'inscription, et le prix de chaque action est affiché avant le clic.

EXPORT

GLB, FBX, OBJ et STL. L'export Unreal Engine règle l'échelle et les axes : le modèle arrive dans votre niveau à la bonne taille. Compatible aussi avec Blender, Unity, Godot et tout pipeline 3D standard.

AUTOMATISEZ AVEC CLAUDE

Le serveur MCP intégré relie l'application à Claude Desktop et aux autres outils compatibles MCP : générez des séries d'assets à partir de commandes écrites.

MARKETPLACE

Parcourez la marketplace MyFabmesh et partagez vos images et modèles, gratuitement ou au prix que vous fixez (ventes payantes bientôt ouvertes). Chaque mois, cinq articles payants sont offerts, à récupérer et à garder, et leurs créateurs sont quand même payés.

PAIEMENTS SÉCURISÉS

Tous les paiements passent par Stripe : achat de crédits, achats sur la marketplace et rémunération des créateurs. Vos coordonnées bancaires ne nous parviennent jamais.

VOS CRÉATIONS VOUS APPARTIENNENT

Les images et modèles que vous créez sont à vous, y compris pour un usage commercial.

BÊTA PUBLIQUE

MyFabmesh est gratuit pendant la bêta publique. Signalez les problèmes sur github.com/fabienlacaze/MyFabmesh/issues. Les rapports de plantage sont anonymes (aucune donnée personnelle, aucun identifiant de machine) et désactivables. Politique de confidentialité : https://fabienlacaze.github.io/MyFabmesh/privacy.html

Conçu en France par Ayros Studio.
```

### Description courte

```
Créez des assets 3D prêts pour le jeu à partir d'un texte ou d'une image : modèle texturé, rig automatique pour tout corps, animation. Modifiez tout ce que vous générez. Sur votre carte NVIDIA ou dans le cloud.
```

### Nouveautés de cette version

```
Une grande mise à jour de la bêta publique :
• Projets et versions : chaque image, modèle, squelette et animation est conservé, rien n'est perdu.
• Nouveaux outils d'image : tenues, recoloration, âge, multi-vues, variantes, retouche automatique, correction du visage.
• Les réglages automatiques choisissent les meilleures options 3D pour votre sujet.
• Qualité Ultra 8K et jusqu'à 10 millions de triangles.
• Rig automatique pour tout corps (humains, animaux, insectes, créatures) avec éditeur du squelette point par point.
• Le rig peut tourner sur votre carte NVIDIA : l'assistant d'installation le télécharge pour vous.
• Clips d'animation (bêta).
• Mode cloud : les PC sans carte NVIDIA compatible ont désormais accès à tous les outils.
• Marketplace, avec cinq articles offerts chaque mois.
• De nombreux correctifs et gains de vitesse.
```

### Fonctionnalités du produit (une par ligne, 200 caractères au plus)

```
Du texte ou d'une image à un modèle 3D texturé, jusqu'à des textures 8K et 10 millions de triangles
Réglages automatiques : les meilleures options 3D pour votre sujet, choisies avant la génération
Outils d'image IA : modifier, retoucher, détourer, agrandir, changer de style, tenues, couleurs, âge, multi-vues
Outils d'image manuels : masque, tampon, recadrage et symétrie automatique
Outils 3D : retexturer, texture plus nette, découpe en parties, lissage, nombre de triangles, trous, maillage étanche
Sculptez, peignez et redimensionnez le modèle directement dans la visionneuse 3D
Rig automatique pour tout corps : humains, animaux, insectes et créatures
Modifiez le squelette point par point, rattachez les os, annulez et rétablissez chaque changement
Clips d'animation (bêta) : repos, marche, course, attaque et plus
Des versions à chaque étape : rien de ce que vous générez n'est perdu
Les projets regroupent vos images, modèles, squelettes et animations au même endroit
Export GLB, FBX, OBJ et STL, avec un export dédié à Unreal Engine
Mode local : générations illimitées sur une carte NVIDIA de 12 Go ou plus, hors ligne après l'installation
Mode cloud : fonctionne sur tout PC, avec le prix de chaque action affiché avant le clic
Serveur MCP intégré : générez des séries d'assets depuis Claude Desktop
Marketplace : partagez vos assets et récupérez cinq articles offerts chaque mois
Paiements sécurisés par Stripe pour les crédits, les achats et la rémunération des créateurs
```

### Configuration supplémentaire

Matériel minimal :
```
Windows 10 ou 11, 64 bits
Toute carte graphique : sans carte NVIDIA compatible, l'application passe en mode cloud (connexion Internet requise)
8 Go de RAM
1 Go d'espace disque libre
```

Matériel recommandé (mode local) :
```
Carte graphique NVIDIA avec 12 Go de mémoire vidéo ou plus (par exemple RTX 3060 12 Go, RTX 4070, RTX 5070 ou plus récente)
32 Go de RAM
30 Go d'espace disque libre pour les modèles d'IA, téléchargés au premier lancement
```

### Termes de recherche

```
générateur 3D
image vers 3D
texte vers 3D
rig automatique
assets de jeu
Unreal Engine
impression 3D
```

---

## Hors fiche : section « Properties » de la même soumission

Les cases « System requirements » affichent aujourd'hui 12 Go de RAM minimum et 6 Go
de mémoire vidéo, ce qui contredit le mode cloud. À régler :
- Memory : minimum 8 GB, recommandé 32 GB ;
- Video memory : aucun minimum (le mode cloud n'en a pas besoin), recommandé 12 GB.
