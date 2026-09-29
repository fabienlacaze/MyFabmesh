/* ============================================================================
 * FabMesh i18n — lightweight, framework-free, shared desktop + cloud.
 *
 * English is the SOURCE language (the UI is authored in English). Each other
 * language is a dictionary mapping the exact English string -> translation.
 * applyLang() walks the DOM (text nodes + placeholder/title/aria-label attrs),
 * caches each node's original English, and swaps it for the active language —
 * so switching back to English restores the originals. Dynamically-added
 * content is re-translated by a childList MutationObserver (debounced).
 *
 * Untranslated strings simply stay English (graceful fallback), so the
 * dictionaries can grow incrementally without ever breaking the UI.
 *
 * Add a language: extend I18N below + add an <option> to #lang-select.
 * Add strings:    add "English": "Traduction" pairs to the language map.
 * In JS code:     wrap user-facing strings with FabI18n.t('English text').
 * ========================================================================== */
(function () {
  'use strict';

  const I18N = {
    fr: {
      'Skin weights': 'Poids de peau',
      'Skeleton': 'Squelette',
      'Spread / shrink the zone': 'Propager / contracter la zone', 'Shrink': 'Contracter', 'Spread': 'Propager',
      'Clean far zones': 'Nettoyer les zones lointaines', 'close': 'près', 'far': 'loin',
      'Remove zones farther than this': 'Retirer les zones plus loin que ça',
      'all bones': 'tous les os', 'this bone': 'cet os',
      'Step': 'Pas',
      'Fixed': 'Fixe',
      'Paints the zone: it will move with the chosen bone.': "Peint la zone : elle bougera avec l'os choisi.",
      'Erases the zone: it stops following the chosen bone.': "Efface la zone : elle ne suit plus l'os choisi.",
      'Makes the zone fixed: it only follows the body, not the limbs.': 'Rend la zone fixe : elle ne suit que le corps, pas les membres.',
      'vertices would change': 'sommets seraient modifiés', 'Magenta zones would be removed': 'Les zones magenta seraient retirées',
      '(hold Alt = Remove)': '(Alt maintenu = Retirer)',
      'Latest changes': 'Dernières modifications', 'changes in progress, not yet saved': 'modifications en cours, pas encore enregistrées',
      'Auto-skin': 'Peau automatique', 'Blend': 'Transition', 'Recalculate all bones': 'Recalculer tous les os',
      'Computing…': 'Calcul…', 'Weights recomputed': 'Poids recalculés',
      'Recomputes, for every bone, the part of the mesh that makes sense to move (nearest bone, its neighbours in the skeleton only).': "Recalcule, pour chaque os, la partie du maillage qui est logique de bouger (os le plus proche, et seulement ses voisins dans le squelette).",
      'Front': 'Face', 'Right': 'Droite', 'Back': 'Dos', 'Left': 'Gauche', 'Top': 'Dessus', 'Bottom': 'Dessous',
      'Apply to this bone': 'Appliquer à cet os', 'vertices changed': 'sommets modifiés',
      'Center the view on the bone': "Centrer la vue sur l'os",
      'Left drag = paint · right drag = rotate · middle drag or Shift + right drag = move · wheel = zoom': 'Clic gauche = peindre · clic droit = tourner · clic milieu ou Maj + clic droit = déplacer · molette = zoom',
      'Colors show what each bone moves. Paint to change it.': 'Les couleurs montrent ce que bouge chaque os. Peignez pour le changer.',
      'Bone': 'Os', 'This bone': 'Cet os', 'All bones': 'Tous les os', 'Brush': 'Pinceau',
      'Add': 'Ajouter', 'Remove': 'Retirer', 'Static': 'Statique', 'Pick': 'Choisir',
      'moves with this bone': 'bouge avec cet os', 'stops following it': 'ne le suit plus',
      'follows the body only': 'suit seulement le corps', 'click = choose the bone': "clic = choisir l'os",
      'Or pick it with the Pick brush, by clicking the mesh.': 'Ou choisissez-le avec le pinceau Choisir, en cliquant sur le maillage.',
      'Test the bone': "Tester l'os", 'Save as new rig version': 'Enregistrer comme nouvelle version du rig',
      'Left drag = paint · right drag = rotate · wheel = zoom': 'Clic gauche = peindre · clic droit = tourner · molette = zoom',
      'Skin weights saved as a new rig version.': 'Poids de peau enregistrés comme nouvelle version du rig.',
      'Generate a rig first.': "Générez d'abord un rig.", 'This file has no skin weights.': "Ce fichier n'a pas de poids de peau.",
      'Parameters': 'Paramètres',
      'Generation prompt': 'Prompt de génération',
      'Which part?': 'Quelle partie ?',
      '(the AI finds it)': "(l'IA la trouve)",
      '(optional: paint to refine)': '(facultatif : peindre pour affiner)',
      // ---- Textes d'aide raccourcis (2026-09-29) ----
      'Live preview. Save creates a new version of the mesh.': 'Aperçu en direct. Enregistrer crée une nouvelle version du maillage.',
      'Drag to rotate · wheel to zoom': 'Glisser pour tourner · molette pour zoomer',
      'Align the photo on the mesh, then Re-project.': 'Alignez la photo sur le maillage, puis Reprojeter.',
      'Paint on the mesh. Left-drag to paint, right-drag to orbit.': 'Peignez sur le maillage. Clic gauche pour peindre, clic droit pour tourner.',
      'Name the part and describe its new look. The shape is kept.': 'Nommez la partie et décrivez son nouvel aspect. La forme est conservée.',
      'Paint on the texture. The shape is kept.': 'Peignez sur la texture. La forme est conservée.',
      'Pick the animations to add. One new version per click.': 'Choisissez les animations à ajouter. Une nouvelle version par clic.',
      'Share with the community, free or paid. An admin reviews it before it goes live.': 'Partagez avec la communauté, gratuit ou payant. Un admin le vérifie avant la mise en ligne.',
      '⚠ Free items can be downloaded by anyone once approved. Buying paid items is coming soon.': "⚠ Un article gratuit est téléchargeable par tous une fois validé. L'achat des articles payants arrive bientôt.",
      'Breaks the mesh into shards. The new version has a slider to blow them apart.': 'Brise le maillage en éclats. La nouvelle version a un curseur pour les écarter.',
      'About 5 s. More fragments = finer pieces. Fill interior = solid shards.': "Environ 5 s. Plus de fragments = morceaux plus fins. Remplir l'intérieur = éclats pleins.",
      'Tell us what is wrong with this result. An admin reviews every report.': 'Dites-nous ce qui ne va pas. Un admin examine chaque signalement.',
      'The prompt and a link to the file are attached.': 'Le prompt et un lien vers le fichier sont joints.',
      'Drag the gizmo or type sizes and angles. Apply creates a new version.': 'Tirez le gizmo ou saisissez tailles et angles. Appliquer crée une nouvelle version.',
      "In the mesh's own units.": 'Dans les unités du maillage.',
      'Builds the 3D construction stages (frame, scaffolding…). The final mesh stays the last stage.': 'Construit les étapes 3D du chantier (charpente, échafaudage…). Le maillage final reste la dernière étape.',
      'Flat material colours on the web (textured in the desktop app).': "Couleurs de matériau unies sur le web (texturées dans l'application de bureau).",
      'Builds a construction timeline from the image. The image stays the last stage.': "Construit une chronologie de chantier à partir de l'image. L'image reste la dernière étape.",
      '2 to 20 stages, about 5–15 s each.': '2 à 20 étapes, environ 5 à 15 s chacune.',
      // ---- Fenetres Age, Modify, Auto Inpaint, Resolution, Brightness (2026-09-29) ----
      'Younger or older — the shape and pose are kept.': "Plus jeune ou plus âgé — la forme et la pose sont conservées.",
      'Younger': 'Plus jeune',
      'Older': 'Plus âgé',
      'e.g. grey beard, smooth skin': 'ex. barbe grise, peau lisse',
      'Describe the changes. The composition is kept.': 'Décrivez les changements. La composition est conservée.',
      'What to change': 'Que changer',
      'Keeps the original': "Garde l'original",
      'Redraws more': 'Redessine davantage',
      'Name what to replace — it is found and repainted.': 'Nommez ce qu’il faut remplacer — c’est trouvé et repeint.',
      'Find': 'Trouver',
      'Replace with': 'Remplacer par',
      '(empty = remove)': '(vide = supprimer)',
      'Padding': 'Marge',
      'Tight': 'Serré',
      'Wide': 'Large',
      'Size': 'Taille',
      'Change': 'Changer',
      'Upscale 2x': 'Agrandir x2',
      'Downscale 0.5x': 'Réduire x0,5',
      'Sharper (AI)': 'Plus net (IA)',
      'Lighter file': 'Fichier plus léger',
      'Brightness / Contrast': 'Luminosité / Contraste',
      'Reset': 'Réinitialiser',
      'Close': 'Fermer',
      // ---- Fenetre de lancement (2026-09-29) ----
      'A new version is created — the original is kept.': "Une nouvelle version est créée — l'original est conservé.",
      'Remove background': "Retirer l'arrière-plan",
      'Cuts the subject out, on a transparent background.': 'Détoure le sujet, sur fond transparent.',
      "Sharpens the face, or an animal's head.": "Affine le visage, ou la tête d'un animal.",
      'Fix the face': 'Retoucher le visage',
      'Auto symmetry': 'Symétrie auto',
      'Mirrors the left half of the image onto the right half.': "Reproduit la moitié gauche de l'image sur la moitié droite.",
      'Symmetrize': 'Symétriser',
      'Adds a margin around the image (15 % on each side).': "Ajoute une marge autour de l'image (15 % de chaque côté).",
      'Add a margin around the image (15 % on each side)': "Ajouter une marge autour de l'image (15 % de chaque côté)",
      'Sharpen texture (x2)': 'Texture plus nette (x2)',
      'Doubles the texture resolution, without inventing detail.': 'Double la résolution de la texture, sans inventer de détail.',
      'Sharpen': 'Affiner',
      'Adds fine AI detail to the texture.': 'Ajoute des détails fins à la texture (IA).',
      'Add detail': 'Ajouter du détail',
      'Repaints the image in this style.': "Repeint l'image dans ce style.",
      'Apply the style': 'Appliquer le style',
      'Loading mesh…': 'Chargement du maillage…',
      'Current': 'Actuel',
      'Mesh not loaded yet': 'Maillage pas encore chargé',
      'New variation': 'Nouvelle variation',
      'Opens the colour picker on the image.': "Ouvre la pipette de couleur sur l'image.",
      'Opens the skeleton points editor.': "Ouvre l'éditeur des points du squelette.",
      'Open': 'Ouvrir',
      // ---- Multi-vues, Habits seuls, Recolorier simplifies (2026-09-29) ----
      'Multi-views': 'Multi-vues',
      'Your image is copied first: the original stays untouched.': "Votre image est d'abord copiée : l'original reste intact.",
      '2 views': '2 vues',
      '6 views': '6 vues',
      'Front + back': 'Face + dos',
      'Desktop app only': "Application de bureau seulement",
      'All around, top and bottom': 'Tout autour, dessus et dessous',
      'Harmonize the style': 'Harmoniser le style',
      'Recommended · +30 s': 'Recommandé · +30 s',
      'Sharper views (1024 px)': 'Vues plus nettes (1024 px)',
      'Outfit only': 'Habits seuls',
      'The character’s clothes alone, on a transparent background.': 'Les vêtements du personnage seuls, sur fond transparent.',
      'Output': 'Sortie',
      'Whole outfit': 'Toute la tenue',
      'One image': 'Une image',
      'Piece by piece': 'Pièce par pièce',
      'One image each': 'Une image par pièce',
      'Both': 'Les deux',
      'Pieces to look for': 'Pièces à chercher',
      'Armor': 'Armure',
      'Upper body': 'Haut',
      'Lower body': 'Bas',
      'Boots': 'Bottes',
      'Gloves': 'Gants',
      'Belt': 'Ceinture',
      'Helmet': 'Casque',
      'Missing pieces are skipped, never invented.': 'Une pièce absente est ignorée, jamais inventée.',
      'Options': 'Options',
      'Fill hidden areas': 'Compléter les zones cachées',
      'Small gaps only, e.g. behind an arm': "Petits manques seulement, ex. derrière un bras",
      'Crop to the piece': 'Recadrer sur la pièce',
      'Leave off to keep it aligned on the character': 'Décoché : reste aligné sur le personnage',
      'Extract': 'Extraire',
      'Extracting…': 'Extraction…',
      'What to change': 'Que changer',
      'Whole image': "Toute l'image",
      'One colour': 'Une couleur',
      'One part': 'Une partie',
      'Named part': 'Partie nommée',
      'From a prompt': "D'après un texte",
      'Only the named part changes colour.': 'Seule la partie nommée change de couleur.',
      'The whole image is repainted from your prompt.': "Toute l'image est repeinte d'après votre texte.",
      'The whole image is tinted, lighting kept.': "Toute l'image est teintée, éclairage conservé.",
      // ---- Fenetre Variant simplifiee (2026-09-29) ----
      'What should change?': 'Que faut-il changer ?',
      'Colours & materials': 'Couleurs et matières',
      'Same shape': 'Même forme',
      'Everything': 'Tout',
      'The shape can change too': 'La forme peut aussi changer',
      'How different?': 'À quel point différent ?',
      'Close to the original': "Proche de l'original",
      'Very different': 'Très différent',
      '(optional)': '(facultatif)',
      'e.g. golden armor, spotted coat': 'ex. armure dorée, pelage tacheté',
      'Subtle': 'Léger',
      'Moderate': 'Net',
      'Strong': 'Fort',
      'Very strong': 'Très fort',
      // ---- Libelles du 27/09/2026 (audit 1.0.36 : sans traduction ecrite) ----
      "Log out": "Se déconnecter",
      "+ Top up": "+ Recharger",
      "Every job, its cost and its result": "Chaque tâche, son coût et son résultat",
      "Usage history": "Historique",
      "Marketplace earnings": "Gains Marketplace",
      "Replies from support": "Réponses du support",
      "Two-factor authentication": "Double authentification",
      "Privacy & data": "Données personnelles",
      "Download every piece of data we hold about you, or permanently delete your account and all of its data.": "Téléchargez toutes les données que nous détenons sur vous, ou supprimez définitivement votre compte et toutes ses données.",
      "Download my data (JSON)": "Télécharger mes données (JSON)",
      "Delete my account": "Supprimer mon compte",
      "Delete forever": "Supprimer définitivement",
      "items sold": "articles vendus",
      "credits earned": "crédits gagnés",
      "Receive my earnings as": "Recevoir mes gains en",
      "Resume Stripe setup": "Reprendre l'inscription Stripe",
      "Open Stripe dashboard": "Ouvrir le tableau de bord Stripe",
      "Enable two-factor authentication": "Activer la double authentification",
      "Not signed in": "Non connecté",
      "Sign in to manage two-factor authentication.": "Connectez-vous pour gérer la double authentification.",
      "No replies yet. When we answer a message you sent with Contact us, the reply appears here.": "Aucune réponse pour l'instant. Quand nous répondons à un message envoyé avec « Nous contacter », la réponse apparaît ici.",
      "A 6-digit code from your phone (Microsoft Authenticator, Google Authenticator, Authy…) on top of your password. Strongly recommended.": "Un code à 6 chiffres depuis votre téléphone (Microsoft Authenticator, Google Authenticator, Authy…) en plus du mot de passe. Fortement conseillé.",
      "paid to your bank through Stripe": "versé sur votre compte bancaire via Stripe",
      "Each container warms up on its own. A cold one takes a few minutes on the first call, then stays warm for a few minutes after each use. When many people use MyFabmesh, the containers are called all the time and stay warm: no waiting.": "Chaque conteneur démarre séparément. Un conteneur froid met quelques minutes au premier appel, puis reste chaud quelques minutes après chaque utilisation. Quand beaucoup de monde utilise MyFabmesh, les conteneurs sont appelés en permanence et restent chauds : plus d'attente.",
      "Get paid in": "Être payé en",
      "Money": "Argent",
      "Set up Stripe payouts": "S'inscrire aux versements Stripe",
      "Finish Stripe payouts setup": "Terminer l'inscription Stripe",
      "Added to your credit balance after each sale.": "Ajouté à votre solde de crédits après chaque vente.",
      "Paid to your bank account through Stripe.": "Versé sur votre compte bancaire via Stripe.",
      "To receive money, set up Stripe payouts. Until then, sales are paid in credits.": "Pour recevoir de l'argent, inscrivez-vous aux versements Stripe. En attendant, les ventes sont payées en crédits.",
      "Stripe is still verifying your account: sales are paid in credits until it is active.": "Stripe vérifie encore votre compte : les ventes sont payées en crédits jusqu'à son activation.",
      "Outfits": "Tenues",
      "Recolor": "Recolorer",
      "Extracts each piece of clothing on a transparent background (characters)": "Extrait chaque vêtement sur fond transparent (personnages)",
      "Finds a part automatically and recolours it, keeping its shape (e.g. a red cape)": "Détecte une partie et la recolore en gardant sa forme (ex. : une cape rouge)",
      "Max triangles": "Triangles max",
      "Auto settings": "Réglages automatiques",
      "Picks the best settings for this image and asset type. Changing an option yourself turns it off.": "Choisit les meilleurs réglages pour cette image et ce type d'asset. Modifier une option vous-même le désactive.",
      "Sharp edges": "Arêtes nettes",
      "Sharper geometry on edges (panel gaps, grilles).": "Géométrie plus nette sur les arêtes (joints de panneaux, grilles).",
      "Smart tools": "Outils intelligents",
      "SMART TOOLS": "OUTILS INTELLIGENTS",
      "Refine mesh": "Affiner le maillage",
      "Harmonize": "Harmoniser",
      "Stop engine": "Arrêter le moteur",
      "Custom…": "Personnalisé…",
      "1 K (very low poly)": "1 K (très bas polygone)",
      "2 K (low poly)": "2 K (bas polygone)",
      "5 K (RTS units)": "5 K (unités RTS)",
      "25 K (distant LOD)": "25 K (LOD lointain)",
      "50 K (crowds, mobile)": "50 K (foules, mobile)",
      "100 K (game units)": "100 K (unités de jeu)",
      "500 K (default)": "500 K (par défaut)",
      "3 M (ultra detailed)": "3 M (ultra détaillé)",
      "10 M (maximum · very large file, ~400 MB)": "10 M (maximum · fichier très lourd, ~400 Mo)",
      "Show bones": "Afficher les os",
      "Skeleton": "Squelette",
      "Skeleton point (drag to move)": "Point du squelette (à glisser)",
      "Link you set": "Lien choisi",
      "after": "après",
      "before": "avant",
      "Stick to the mesh": "Coller au maillage",
      "Centre in the thickness": "Centrer dans l'épaisseur",
      "On: the point lands on the mesh under the cursor. Off: it lands where you click, even outside the mesh.": "Activé : le point se pose sur le maillage sous le curseur. Désactivé : il se pose là où vous cliquez, même hors du maillage.",
      "On: the point goes to the middle of the mesh under the cursor. Off: it stays on the surface.": "Activé : le point va au milieu du maillage sous le curseur. Désactivé : il reste en surface.",
      "Drag any point. Right-drag pans, wheel zooms.": "Glissez un point. Clic droit glissé : déplacer la vue ; molette : zoomer.",
      "Manual bone adjustment": "Réglage manuel des os",
      "All bones": "Tous les os",
      "Freeze mesh while dragging (align bone, don't deform)": "Figer le maillage pendant le glissement (aligne l'os sans déformer)",
      "Save adjusted rig": "Enregistrer le rig ajusté",
      "Adjusted rig saved": "Rig ajusté enregistré",
      "Recenter view (fit)": "Recentrer la vue",
      "Step 1": "Étape 1",
      "Step 2": "Étape 2",
      "Step 3": "Étape 3",
      "Step 4": "Étape 4",
      "Model": "Modèle",
      "Generate animation clips for your rig": "Générez des clips d'animation pour votre rig",
      "Name the zones": "Nommer les zones",
      "Clone stamp": "Tampon de clonage",
      "Clone one area of the texture onto another, directly on the model": "Clone une zone de la texture vers une autre, directement sur le modèle",
      "Detail++": "Détail++",
      "Adds real detail to the texture": "Ajoute du vrai détail sur la texture",
      "Runs the 6 views through the harmonizer to recover the photorealistic style. Recommended. +30 s.": "Passe les 6 vues dans l'harmoniseur pour retrouver le style photoréaliste. Recommandé. +30 s.",
      "Re-texture only one part (detected automatically)": "Retexturer une seule partie (détectée automatiquement)",
      "Construction stages (3 versions)": "Étapes de construction (3 versions)",
      "Construction stages (3 progressive versions)": "Étapes de construction (3 versions progressives)",
      "My usage history": "Mon historique d'utilisation",
      "Export Excel": "Exporter en Excel",
      "Local job — click to open it": "Travail local — cliquez pour l'ouvrir",
      "Click for full details": "Cliquez pour le détail",
      "local": "local",
      "Sign in to your MyFabmesh account to see your cloud usage too.": "Connectez-vous à votre compte MyFabmesh pour voir aussi votre usage cloud.",
      "Cloud history unavailable": "Historique cloud indisponible",
      "History exported": "Historique exporté",
      "No generations yet.": "Aucune génération pour le moment.",
      // ---- Generation history popup ----
      'AI': 'IA',
      'Generation history': 'Historique de génération',
      'View generation history': "Voir l'historique de génération",
      'Source image': 'Image source',
      'Mesh generated': 'Mesh généré',
      'Modification': 'Modification',
      'Parameters not tracked (generated before history tracing)':
        "Paramètres non tracés (généré avant le traçage d'historique)",
      'No history available for this item.': 'Aucun historique disponible pour cet élément.',
      // ---- Version lineage badge (mesh versions strip) ----
      'Version — from {x} after {y}': 'Version — issue de {x} après {y}',
      'Version — after {x}': 'Version — après {x}',
      'View the source image that generated this mesh': "Voir l'image source qui a généré ce mesh",
      'Segmented into parts (AI)': 'Segmenté en parties (IA)',
      'part segmentation': 'segmentation en parties',
      'smoothing': 'lissage',
      'decimation': 'décimation',
      'subdivision': 'subdivision',
      'hole filling': 'bouchage des trous',
      'normals fix': 'correction des normales',
      'recentering': 'recentrage',
      'pivot adjustment': 'réglage du pivot',
      'watertight sealing': 'étanchéification',
      'texture variation': 'variation de texture',
      'editing': 'édition',
      'upscale': 'upscale',
      'refinement': 'affinage',
      'augmentation': 'augmentation',
      'vertex colors': 'couleurs de sommets',
      're-texture': 're-texture',
      // ---- Top bar / nav ----
      'Projects': 'Projets',
      'New project': 'Nouveau projet',
      'New Project': 'Nouveau projet',
      'Marketplace': 'Marketplace',
      'Settings': 'Paramètres',
      'Open Cloud': 'Ouvrir le Cloud',
      // ---- Workspace steps ----
      'Image': 'Image',
      'Mesh': 'Maillage',
      '3D Mesh': 'Maillage 3D',
      'Rig': 'Squelette',
      'Animation': 'Animation',
      'In progress': 'En cours',
      'IN PROGRESS': 'EN COURS',
      'Done': 'Terminé',
      'DONE': 'TERMINÉ',
      'Generating': 'Génération',
      'GENERATING': 'GÉNÉRATION',
      'Create new': 'Créer',
      'CREATE NEW': 'CRÉER',
      'EDIT SELECTED': 'ÉDITER LA SÉLECTION',
      'Edit selected': 'Éditer la sélection',
      'Generate a new image from a text prompt': 'Générer une nouvelle image depuis un texte',
      // ---- Create-new form ----
      'Asset type': "Type d'asset",
      'ASSET TYPE': "TYPE D'ASSET",
      'Style': 'Style',
      'STYLE': 'STYLE',
      'Describe your asset': 'Décrivez votre asset',
      'Description (prompt)': 'Description (prompt)',
      'Count': 'Nombre',
      'COUNT': 'NOMBRE',
      'Quality': 'Qualité',
      'QUALITY': 'QUALITÉ',
      'Engine': 'Moteur',
      'Construction stages (3 progressive versions)': 'Étapes de construction (3 versions progressives)',
      'Copy': 'Copier',
      'Enhance': 'Améliorer',
      'Generate': 'Générer',
      'Generate new version': 'Générer une nouvelle version',
      'Generate Rig': 'Générer le squelette',
      'Generate variant': 'Générer une variante',
      'Live progress of jobs running for this step': 'Progression en direct des tâches de cette étape',
      // ---- Asset type options ----
      'Character / Unit (RTS, RPG)': 'Personnage / Unité (RTS, RPG)',
      'Building / Structure': 'Bâtiment / Structure',
      'Animal': 'Animal',
      'Vehicle': 'Véhicule',
      'Custom (no preset)': 'Personnalisé (sans préréglage)',
      // ---- Common buttons / actions ----
      'Cancel': 'Annuler',
      'Apply': 'Appliquer',
      'Close': 'Fermer',
      'Save': 'Enregistrer',
      'Delete': 'Supprimer',
      'Create project': 'Créer le projet',
      'Unlock': 'Déverrouiller',
      'Check my PC first': "Vérifier mon PC d'abord",
      // ---- Auto Inpaint modal ----
      'Auto Inpaint': 'Retouche auto',
      'Describe what to replace — the AI finds and repaints it.':
        "Décrivez quoi remplacer — l'IA le trouve et le repeint.",
      'Target (what to find)': 'Cible (quoi trouver)',
      'TARGET (WHAT TO FIND)': 'CIBLE (QUOI TROUVER)',
      'Replace with (leave empty = remove)': 'Remplacer par (vide = supprimer)',
      'REPLACE WITH (LEAVE EMPTY = REMOVE)': 'REMPLACER PAR (VIDE = SUPPRIMER)',
      'Detection padding': 'Marge de détection',
      'DETECTION PADDING': 'MARGE DE DÉTECTION',
      'Preview mask': 'Aperçu du masque',
      'Detecting target…': 'Détection de la cible…',
      // ---- Variant modal ----
      'Create variant': 'Créer une variante',
      'Variant': 'Variante',
      'Variation amount': 'Niveau de variation',
      'Number of variants': 'Nombre de variantes',
      // ---- Paint tools ----
      'Select': 'Sélection',
      'Draw': 'Dessin',
      'Color': 'Couleur',
      'Brush': 'Brosse',
      'Opacity': 'Opacité',
      'Hardness': 'Dureté',
      'Tolerance': 'Tolérance',
      'Pen': 'Stylo',
      'Spray': 'Aérographe',
      'Ink': 'Encre',
      'Line': 'Ligne',
      'Smudge': 'Étaler',
      'Fill': 'Remplir',
      'Eraser': 'Gomme',
      'Rect': 'Rectangle',
      'Lasso': 'Lasso',
      'Wand': 'Baguette',
      'Invert': 'Inverser',
      'None': 'Aucune',
      // ---- Misc ----
      'Requirements': 'Configuration requise',
      'Free': 'Gratuit',
      'Language': 'Langue',
      // ---- Update toast ----
      'Update ready': 'Mise à jour prête',
      'A new version is downloaded and ready to install.': 'Une nouvelle version est téléchargée et prête à installer.',
      'Dismiss': 'Ignorer',
      // ---- Drop overlay ----
      'Drop image or mesh file to import': 'Déposez une image ou un fichier de maillage à importer',
      // ---- Top bar (icons / tooltips) ----
      'Back to projects': 'Retour aux projets',
      'Refresh': 'Actualiser',
      'My usage history': "Mon historique d'utilisation",
      'Parental control': 'Contrôle parental',
      'About MyFabmesh.AI': 'À propos de MyFabmesh.AI',
      'Server warming up': 'Serveur en préchauffage',
      'Back views of the subject (6 views: desktop app)': "Vues de dos du sujet (6 vues : application de bureau)",
      "Free daily capacity reached": "Capacité gratuite du jour atteinte",
      "Free daily limit reached": "Limite gratuite du jour atteinte",
      "Daily capacity reached": "Capacité du jour atteinte",
      "Free accounts share a daily cloud capacity, which has been used up for today. It reopens at {x} (your time), in {y}. Your credits are safe and you were not charged.": "Les comptes gratuits partagent une capacité cloud quotidienne, épuisée pour aujourd'hui. Elle revient à {x} (heure locale), dans {y}. Vos crédits sont intacts et rien ne vous a été facturé.",
      "You have reached today's generation limit for free accounts. It resets at {x} (your time), in {y}. Your credits are safe and you were not charged.": "Vous avez atteint la limite de génération du jour des comptes gratuits. Elle se réinitialise à {x} (heure locale), dans {y}. Vos crédits sont intacts et rien ne vous a été facturé.",
      "The service has reached its daily capacity. It resets at {x} (your time), in {y}. Your credits are safe and you were not charged.": "Le service a atteint sa capacité du jour. Elle revient à {x} (heure locale), dans {y}. Vos crédits sont intacts et rien ne vous a été facturé.",
      "Accounts that have bought credits are never limited.": "Les comptes qui ont acheté des crédits ne sont jamais limités.",
      'Server starting': 'Serveur en démarrage',
      'starting': 'démarrage',
      'unavailable': 'indisponible',
      'Cloud GPU services': 'Services GPU cloud',
      'Each container has its own warm-up. Cold = first call takes ~2 min, then warm for ~9 min idle.':
        'Chaque conteneur a son propre préchauffage. À froid = le premier appel prend ~2 min, puis reste chaud ~9 min en veille.',
      // ---- Projects home ----
      'Your projects': 'Vos projets',
      'Search projects...': 'Rechercher des projets...',
      'Select all visible projects': 'Sélectionner tous les projets visibles',
      'Select all': 'Tout sélectionner',
      'Import': 'Importer',
      'Images': 'Images',
      'Meshes': 'Maillages',
      'Rigs': 'Squelettes',
      'No projects yet': 'Aucun projet pour le moment',
      'Create your first 3D character in 3 simple steps.': 'Créez votre premier personnage 3D en 3 étapes simples.',
      '+ Create a project': '+ Créer un projet',
      '+ New project': '+ Nouveau projet',
      // ---- Workspace step statuses ----
      'Pending': 'En attente',
      // ---- Image step (Create new) ----
      'MyFabmesh.AI Image Engine (local)': 'Moteur image MyFabmesh.AI (local)',
      // ---- Asset type options ----
      'Living': 'Vivant',
      'Creature / Beast': 'Créature / Bête',
      'Vehicles': 'Véhicules',
      'Plane': 'Avion',
      'Boat': 'Bateau',
      'Built': 'Construit',
      'Environment piece': "Élément d'environnement",
      'Items': 'Objets',
      'Weapon': 'Arme',
      'Prop / Item': 'Accessoire / Objet',
      'UI Icon (app, button, Unreal widget)': "Icône d'interface (app, bouton, widget Unreal)",
      'Other': 'Autre',
      'Animal (creature)': 'Animal (créature)',
      // ---- Style options ----
      'Realistic': 'Réaliste',
      'PBR (high detail)': 'PBR (haute définition)',
      'Stylized': 'Stylisé',
      'Stylized (mid-poly)': 'Stylisé (mid-poly)',
      'Stylized PBR': 'PBR stylisé',
      'Hand-painted': 'Peint à la main',
      'Cartoon': 'Cartoon',
      'Anime': 'Anime',
      'Painterly': 'Pictural',
      'Comic book': 'Bande dessinée',
      'Ghibli': 'Ghibli',
      'Pixar 3D': 'Pixar 3D',
      'Concept art': 'Concept art',
      'Genre': 'Genre',
      'Dark Fantasy': 'Dark Fantasy',
      'Cyberpunk': 'Cyberpunk',
      'Steampunk': 'Steampunk',
      'Synthwave': 'Synthwave',
      'Horror': 'Horreur',
      'Retro': 'Rétro',
      'Low-poly': 'Low-poly',
      'Pixel art': 'Pixel art',
      'Voxel': 'Voxel',
      'Minecraft': 'Minecraft',
      'Material': 'Matériau',
      'Chrome': 'Chrome',
      'Marble': 'Marbre',
      'Carved wood': 'Bois sculpté',
      'Stained glass': 'Vitrail',
      'Holographic': 'Holographique',
      'Figurine': 'Figurine',
      'Artistic': 'Artistique',
      'Watercolor': 'Aquarelle',
      'Sketch': 'Croquis',
      'Claymation': 'Pâte à modeler',
      'Graffiti': 'Graffiti',
      'Art deco': 'Art déco',
      // ---- Prompt area ----
      'Copy prompt to clipboard': 'Copier le prompt dans le presse-papiers',
      'Enhance the prompt with style and quality keywords': 'Améliorer le prompt avec des mots-clés de style et de qualité',
      'An orc warrior with leather armor...': 'Un guerrier orc en armure de cuir...',
      '30 steps': '30 étapes',
      // ---- Image edit / preview ----
      'No image yet': 'Aucune image pour le moment',
      'View image fullscreen': "Voir l'image en plein écran",
      'Previous version': 'Version précédente',
      'Next version': 'Version suivante',
      'Pick a version, preview it, modify or convert': 'Choisissez une version, prévisualisez-la, modifiez ou convertissez',
      'Copy the prompt used to generate this image': 'Copier le prompt utilisé pour générer cette image',
      'Copy prompt': 'Copier le prompt',
      'Use this image for 3D →': 'Utiliser cette image pour la 3D →',
      // ---- Tool group labels ----
      'File': 'Fichier',
      'AI tools': 'Outils IA',
      'Manual tools': 'Outils manuels',
      'Playback': 'Lecture',
      // ---- Image tools ----
      'Export': 'Exporter',
      'Publish to marketplace': 'Publier sur la marketplace',
      'Modify': 'Modifier',
      'Remove BG': 'Supprimer le fond',
      'Resolution': 'Résolution',
      'Style...': 'Style...',
      'Face Fix': 'Correction du visage',
      'Sym. Auto': 'Sym. auto',
      'Multi-Views': 'Multi-vues',
      'Create variants of the current image — re-roll seed or img2img with controlled strength':
        "Créer des variantes de l'image actuelle — nouvelle seed ou img2img avec une intensité contrôlée",
      'Clone Stamp': 'Tampon de clonage',
      'Draw Mask': 'Dessiner un masque',
      'Crop': 'Rogner',
      'Brightness': 'Luminosité',
      'Color Pick': 'Pipette',
      'Blur Brush': 'Pinceau de flou',
      'Symmetrize': 'Symétriser',
      'Paint': 'Peinture',
      // ---- Mesh step (Create new) ----
      'Convert the selected image into a 3D mesh': "Convertir l'image sélectionnée en maillage 3D",
      'MyFabmesh.AI 3D Native (mesh + PBR in one shot, ~100s, recommended)':
        'MyFabmesh.AI 3D natif (maillage + PBR en une passe, ~100s, recommandé)',
      'Texture': 'Texture',
      'Target triangles': 'Triangles cibles',
      'Construction stages (3 versions)': 'Étapes de construction (3 versions)',
      'Advanced texture options': 'Options de texture avancées',
      'Quality preset': 'Préréglage de qualité',
      'Multi-reference (use front + back photo · +1 cr)': 'Multi-référence (photo avant + arrière · +1 cr)',
      'Detail refine (+~90s · +2 cr · sharper micro-details)': 'Affinage des détails (+~90s · +2 cr · micro-détails plus nets)',
      'Auto-rectify source view (+~36s · +1 cr · better mesh proportions)':
        'Rectification auto de la vue source (+~36s · +1 cr · meilleures proportions de maillage)',
      'Texture smooth (+~12s · free · CPU only, no AI)': "Lissage de texture (+~12s · gratuit · CPU seulement, pas d'IA)",
      'Quality+ (sharper edges · +~30s · +1 cr)': 'Qualité+ (arêtes plus nettes · +~30s · +1 cr)',
      'Ultra Quality (+~50s · +2 cr · fine face detail)': 'Ultra qualité (+~50s · +2 cr · détail fin du visage)',
      'Ultra HD 8K texture (+~5min · +3 cr)': 'Texture Ultra HD 8K (+~5min · +3 cr)',
      'Face fix (+~60s · +2 cr)': 'Correction du visage (+~60s · +2 cr)',
      'PBR baseColor + roughness + metallic exported in the GLB automatically.':
        'baseColor + roughness + metallic PBR exportés automatiquement dans le GLB.',
      'Generate 3D': 'Générer la 3D',
      'Source image for 3D (front)': 'Image source pour la 3D (face)',
      'No image selected': 'Aucune image sélectionnée',
      'Optional back photo (2-view mode)': 'Photo arrière optionnelle (mode 2 vues)',
      'Click to add a back photo for true-back texture': 'Cliquez pour ajouter une photo arrière pour une vraie texture de dos',
      '+ Add back photo': '+ Ajouter une photo arrière',
      'Remove back photo': 'Supprimer la photo arrière',
      'Multi-views (6) — used by texture bake': 'Multi-vues (6) — utilisées par le bake de texture',
      // ---- Mesh edit / preview ----
      'No mesh yet': 'Aucun maillage pour le moment',
      'View 3D fullscreen': 'Voir la 3D en plein écran',
      'Reset camera': 'Réinitialiser la caméra',
      'Camera view': 'Vue caméra',
      'Iso': 'Iso',
      'Front': 'Face',
      'Back': 'Arrière',
      'Left': 'Gauche',
      'Right': 'Droite',
      'Top': 'Dessus',
      'Bottom': 'Dessous',
      'Pivot point': 'Point de pivot',
      'Pivot: bottom': 'Pivot : bas',
      'Pivot: center': 'Pivot : centre',
      'Pivot: top': 'Pivot : haut',
      'Show pivot axes': 'Afficher les axes du pivot',
      'Wireframe': 'Fil de fer',
      'Wire': 'Fil',
      'Toggle PBR / matcap': 'Basculer PBR / matcap',
      'Grid': 'Grille',
      'X-Ray (semi-transparent mesh)': 'Rayons X (maillage semi-transparent)',
      'X-Ray': 'Rayons X',
      'Background': 'Arrière-plan',
      'Dark': 'Sombre',
      'Studio': 'Studio',
      'Black': 'Noir',
      'Gray': 'Gris',
      'Toggle shadows': 'Basculer les ombres',
      'Shadows': 'Ombres',
      'Light intensity': 'Intensité de la lumière',
      'Pick a mesh version, preview, refine or export': 'Choisissez une version de maillage, prévisualisez, affinez ou exportez',
      'Use this mesh for Rig →': 'Utiliser ce maillage pour le squelette →',
      // ---- Mesh tools ----
      'Export...': 'Exporter...',
      'Open in Blender': 'Ouvrir dans Blender',
      'Show in folder': 'Afficher dans le dossier',
      'Smooth': 'Lisser',
      'Reduce the mesh triangle count': 'Réduire le nombre de triangles du maillage',
      'Triangle count': 'Nombre de triangles',
      'Subdivide': 'Subdiviser',
      'Fix Normals': 'Corriger les normales',
      'Fill Holes': 'Boucher les trous',
      'Watertight': 'Étanche',
      'Pivot': 'Pivot',
      'Re-Texture': 'Re-texturer',
      'Sculpt': 'Sculpter',
      'Manually align source photos onto mesh': 'Aligner manuellement les photos source sur le maillage',
      'Align Texture': 'Aligner la texture',
      'Paint Mesh': 'Peindre le maillage',
      'Material adjust': 'Réglage du matériau',
      // ---- Rig step ----
      'Bind a skeleton to your mesh for animation': "Lier un squelette à votre maillage pour l'animation",
      'MyFabmesh.AI Rig (cloud GPU)': 'Squelette MyFabmesh.AI (GPU cloud)',
      'Source mesh for rig': 'Maillage source pour le squelette',
      'No mesh selected': 'Aucun maillage sélectionné',
      'Pick a rig, test animation or export': "Choisissez un squelette, testez l'animation ou exportez",
      'No animation': 'Aucune animation',
      'Play': 'Lire',
      'No rig yet': 'Aucun squelette pour le moment',
      'View rig fullscreen': 'Voir le squelette en plein écran',
      'Show skeleton': 'Afficher le squelette',
      "Save moved joints (no AI)": "Enregistrer les articulations déplacées (sans IA)",
      "Save the rig with the joints where you dragged them. The mesh and its skinning stay exactly as they are — no AI.": "Enregistre le rig avec les articulations là où vous les avez placées. Le maillage et sa peau restent exactement en place — sans IA.",
      "Save moved joints": "Enregistrer les articulations déplacées",
      "You changed how the joints are linked: only \"Re-generate rig with these points\" can apply that.": "Vous avez modifié les liens entre articulations : seule la régénération du rig peut en tenir compte.",
      "Nothing to save yet: drag a pink skeleton point (a joint). Green and orange points are targets for the AI.": "Rien à enregistrer : déplacez un point rose du squelette (une articulation). Les points verts et orange sont des cibles pour l'IA.",
      "Yellow and green points are targets: only \"Re-generate rig with these points\" can make the skeleton reach them. This button saves the pink joints you moved by hand.": "Les points jaunes et verts sont des cibles : seul « Régénérer le rig avec ces points » peut faire que le squelette les atteigne. Ce bouton enregistre les articulations roses que vous avez déplacées à la main.",
      "On: a point you add or drag lands on the mesh under the cursor. Off: it goes where you point, even outside the mesh.": "Coché : un point ajouté ou glissé se pose sur le maillage sous le curseur. Décoché : il va là où vous pointez, même hors du maillage.",
      "On: a point you add or drag goes to the middle of the mesh under the cursor. Off: it stays on the surface.": "Coché : un point ajouté ou glissé va au milieu du maillage sous le curseur. Décoché : il reste à la surface.",
      "No pink joint moved yet. To reach the yellow points, use \"Re-generate rig\".": "Aucune articulation rose déplacée. Pour atteindre les points jaunes, utilisez « Régénérer le rig ».",
      "Drag a skeleton point first.": "Déplacez d'abord un point du squelette.",
      "Could not save the rig:": "Impossible d'enregistrer le rig :",
      "Rig saved with the moved joints": "Rig enregistré avec les articulations déplacées",
      'Bones': 'Os',
      'Use this rig for Animation →': "Utiliser ce squelette pour l'animation →",
      'Export to Unreal': 'Exporter vers Unreal',
      'Edit in Blender': 'Éditer dans Blender',
      'Re-skin only': 'Re-skin uniquement',
      'Landmarks': 'Repères',
      'Test animation': "Tester l'animation",
      // ---- Animation step ----
      'Generate animation clips for your rig via AI': "Générer des clips d'animation pour votre squelette via IA",
      'Generative motion (skeleton-adaptive)': 'Mouvement génératif (adaptatif au squelette)',
      'Animations': 'Animations',
      '(check 1+ types — each becomes a new version)': '(cochez 1+ types — chacun devient une nouvelle version)',
      'Prompt': 'Prompt',
      'e.g. dragon breathes fire': 'ex. le dragon crache du feu',
      'Generate Animation': "Générer l'animation",
      'Import reference animation (.fbx)': 'Importer une animation de référence (.fbx)',
      'Auto-detect skeleton': 'Détection auto du squelette',
      'UE5 Mannequin': 'Mannequin UE5',
      'Apovivor ORC_M1': 'Apovivor ORC_M1',
      'Pick an .fbx reference animation': 'Choisir une animation de référence .fbx',
      'Pick .fbx': 'Choisir .fbx',
      'No file': 'Aucun fichier',
      'Retarget the chosen FBX onto your rig': 'Recibler le FBX choisi sur votre squelette',
      'Retarget FBX onto rig': 'Recibler le FBX sur le squelette',
      'Source rig': 'Squelette source',
      'No rig selected': 'Aucun squelette sélectionné',
      'Pick a clip, preview or export': 'Choisissez un clip, prévisualisez ou exportez',
      'No animation selected': 'Aucune animation sélectionnée',
      'Play / Pause': 'Lire / Pause',
      'Loop': 'Boucle',
      'Playback speed': 'Vitesse de lecture',
      'Exposure': 'Exposition',
      'Export FBX': 'Exporter en FBX',
      'Add Animation': 'Ajouter une animation',
      'Import an animated GLB as a new version': 'Importer un GLB animé comme nouvelle version',
      'Import GLB': 'Importer un GLB',
      // ---- New project modal ----
      'Give your project a name and describe what you want to create.':
        'Donnez un nom à votre projet et décrivez ce que vous voulez créer.',
      'Project name': 'Nom du projet',
      // ---- Landmarks fullscreen ----
      'Front view': 'Vue de face',
      'Back view': 'Vue arrière',
      'Left side': 'Côté gauche',
      'Right side': 'Côté droit',
      'Top view': 'Vue de dessus',
      'Bottom view': 'Vue de dessous',
      'Isometric': 'Isométrique',
      'Click a body part on the right, then click on either view to place its marker.':
        "Cliquez sur une partie du corps à droite, puis cliquez sur l'une des vues pour placer son repère.",
      'Undo (Ctrl+Z)': 'Annuler (Ctrl+Z)',
      'Undo': 'Annuler',
      'Redo (Ctrl+Y)': 'Rétablir (Ctrl+Y)',
      'Redo': 'Rétablir',
      'Auto-detect': 'Détection auto',
      'Read bone positions from the currently selected rig': 'Lire les positions des os depuis le squelette sélectionné',
      'From rig': 'Depuis le squelette',
      'Guided': 'Guidé',
      'Clear all': 'Tout effacer',
      "🔒 Freeze mesh while dragging (align bone, don't deform)":
        "🔒 Figer le maillage pendant le glissement (aligner l'os, ne pas déformer)",
      'Re-generate rig with these landmarks': 'Régénérer le squelette avec ces repères',
      'FRONT': 'FACE',
      'SIDE': 'CÔTÉ',
      'RIGHT': 'DROITE',
      'BACK': 'ARRIÈRE',
      'LEFT': 'GAUCHE',
      'TOP': 'DESSUS',
      'BOTTOM': 'DESSOUS',
      // ---- 3D lightbox ----
      'Previous (←)': 'Précédent (←)',
      'Next (→)': 'Suivant (→)',
      'Use this for next step →': "Utiliser ceci pour l'étape suivante →",
      'Show landmarks': 'Afficher les repères',
      // ---- 2D lightbox toolbox ----
      'AI TOOLS': 'OUTILS IA',
      'MANUAL': 'MANUEL',
      'Modify with AI': "Modifier avec l'IA",
      'Remove background': "Supprimer l'arrière-plan",
      'Change resolution': 'Changer la résolution',
      'Fix face details': 'Corriger les détails du visage',
      'Auto symmetry': 'Symétrie auto',
      // ---- Auto Inpaint modal ----
      'hat, shirt, background, sword...': 'chapeau, chemise, arrière-plan, épée...',
      'leather helmet, plain background...': 'casque de cuir, fond uni...',
      'How far to expand the detected mask around the target. 0px = tight to the object; higher widens it to cover edges, shadows or halos. ~15px recommended.':
        "De combien étendre le masque détecté autour de la cible. 0px = collé à l'objet ; plus haut élargit pour couvrir bords, ombres ou halos. ~15px recommandé.",
      'Detect the mask (1 credit per check)': 'Détecter le masque (1 crédit par vérification)',
      // ---- Multi-view options modal ----
      'Generate Multi-Views': 'Générer les multi-vues',
      'A new image version will be created so the original stays untouched.':
        "Une nouvelle version de l'image sera créée afin que l'originale reste intacte.",
      'Mode': 'Mode',
      'Auto 2-view (back photo, ~25s)': 'Auto 2 vues (photo arrière, ~25s)',
      '6 views (front/right/back/left/top/bottom, ~70s)': '6 vues (face/droite/arrière/gauche/dessus/dessous, ~70s)',
      'Start': 'Démarrer',
      // ---- Mesh tool modal ----
      'Mesh tool': 'Outil de maillage',
      'Drag to rotate · wheel to zoom': 'Glissez pour pivoter · molette pour zoomer',
      // ---- Material adjust modal ----
      'Material Adjust': 'Réglage du matériau',
      'Saturation': 'Saturation',
      'Contrast': 'Contraste',
      'Emissive': 'Émissif',
      'Metallic': 'Métallique',
      'Roughness': 'Rugosité',
      'Tint (hue °)': 'Teinte (°)',
      'Reset': 'Réinitialiser',
      'Save as new version': 'Enregistrer comme nouvelle version',
      // ---- Align texture modal ----
      'Translate X': 'Translation X',
      'Translate Y': 'Translation Y',
      'Translate Z': 'Translation Z',
      'Scale': 'Échelle',
      'Rotation Y': 'Rotation Y',
      'Visibility threshold': 'Seuil de visibilité',
      'Overlay opacity': 'Opacité de la superposition',
      'Live project on mesh': 'Projection en direct sur le maillage',
      'Show overlay plane': 'Afficher le plan de superposition',
      'Auto-fit silhouette': 'Ajuster auto à la silhouette',
      'Reset defaults': 'Réinitialiser les valeurs par défaut',
      'Re-project': 'Re-projeter',
      // ---- Paint Mesh modal ----
      'Pen': 'Stylo',
      'Spray': 'Aérographe',
      'Ink': 'Encre',
      'Eraser': 'Gomme',
      'Pipette': 'Pipette',
      'Brush': 'Brosse',
      'Opacity': 'Opacité',
      'Falloff': 'Atténuation',
      'Reset texture': "Réinitialiser la texture",
      'Save new version': 'Enregistrer une nouvelle version',
      // ---- Paint Emissive modal ----
      'Emissive color': 'Couleur émissive',
      'Intensity': 'Intensité',
      'Brush size (px)': 'Taille de brosse (px)',
      'Brush opacity': 'Opacité de la brosse',
      'Soft falloff': 'Atténuation douce',
      'Erase': 'Effacer',
      'Apply (free)': 'Appliquer (gratuit)',
      // ---- Settings modal ----
      'Interface language': "Langue de l'interface",
      'English': 'Anglais',
      'AI Assistant': 'Assistant IA',
      'Token': 'Jeton',
      'Recent requests': 'Requêtes récentes',
      'Hardware': 'Matériel',
      'Loading...': 'Chargement...',
      'Reset all limits to defaults': 'Réinitialiser toutes les limites aux valeurs par défaut',
      'Parental Control': 'Contrôle parental',
      'Content Filter': 'Filtre de contenu',
      'System': 'Système',
      'Processes': 'Processus',
      'Open logs folder': 'Ouvrir le dossier des journaux',
      'Installation': 'Installation',
      'Calibration': 'Calibration',
      'Pipeline test': 'Test du pipeline',
      'Run calibration': 'Lancer la calibration',
      'Open last report': 'Ouvrir le dernier rapport',
      'No run yet.': 'Aucune exécution.',
      // ---- Calibration modals ----
      'Reload': 'Recharger',
      'Live logs': 'Journaux en direct',
      'Auto-scroll': 'Défilement auto',
      'Pause': 'Pause',
      'Clear': 'Effacer',
      'disconnected': 'déconnecté',
      // ---- Confirm modal ----
      'Confirm': 'Confirmer',
      // ---- Refine mesh modal ----
      'Modification': 'Modification',
      'Output format': 'Format de sortie',
      'AI model': 'Modèle IA',
      'Claude (best)': 'Claude (meilleur)',
      'GPT-4o': 'GPT-4o',
      'Local LLM': 'LLM local',
      'Refine': 'Affiner',
      // ---- Export mesh modal ----
      'Export 3D mesh': 'Exporter le maillage 3D',
      'Pick a format and where to save the file.': "Choisissez un format et l'emplacement de sauvegarde du fichier.",
      'Format': 'Format',
      'Licence': 'Licence',
      'Personal use only': 'Usage personnel uniquement',
      'Public domain (CC0)': 'Domaine public (CC0)',
      'Attribution required (CC-BY 4.0)': 'Attribution requise (CC-BY 4.0)',
      'Non-commercial only (CC-BY-NC 4.0)': 'Non commercial uniquement (CC-BY-NC 4.0)',
      'Royalty-free commercial': 'Commercial libre de droits',
      'Output path': 'Chemin de sortie',
      'Browse...': 'Parcourir...',
      // ---- Signalement de contenu genere par l'IA (politique 11.16 du Store) ----
      // Entrees EXPLICITES : sans elles, le repli automatique traduisait
      // « Report content » par « Contenu du rapport » — il lisait « report »
      // comme un nom au lieu d'un verbe, ce qui rendait le bouton
      // incomprehensible dans la langue de l'utilisateur.
      'Signed in as': 'Connecté en tant que',
      'click to top up': 'cliquez pour recharger',
      'Open the MyFabmesh website': 'Ouvrir le site MyFabmesh',
      'Privacy policy': 'Politique de confidentialité',
      'Report content': 'Signaler le contenu',
      'Cancel "{x}"? The computation will be stopped. Credits for work already started are not refunded.': 'Annuler « {x} » ? Le calcul sera arrêté. Les crédits d’un travail déjà commencé ne sont pas rendus.',
      'Stopped in the app. This short operation cannot be interrupted on the server: it finishes within a few minutes at most.': 'Arrêté dans l’appli. Cette opération courte ne peut pas être interrompue sur le serveur : elle se termine en quelques minutes au plus.',
      'The server refused the cancellation:': 'Le serveur a refusé l’annulation :',
      'unknown reason': 'raison inconnue',
      'Cancelled, but the server did not confirm the stop: the result may still arrive.': 'Annulé, mais le serveur n’a pas confirmé l’arrêt : le résultat peut encore arriver.',
      'Stopped. The computation has been interrupted.': 'Arrêté. Le calcul a été interrompu.',
      'The cancellation could not reach the server.': 'L’annulation n’a pas pu être transmise au serveur.',
      // « Report » seul : le repli automatique l'avait rendu par
      // « Rapport annuel » sur le bouton place sous l'image.
      'Report': 'Signaler',
      'Report an issue': 'Signaler un problème',
      'Delete this content': 'Supprimer ce contenu',
      'Delete reported content': 'Supprimer le contenu signalé',
      'Delete this content from your project? The copy attached to your report is kept so an admin can review it.':
        'Supprimer ce contenu de votre projet ? La copie jointe à votre signalement est conservée pour que l’admin puisse l’examiner.',
      'Content deleted. Your report was kept.': 'Contenu supprimé. Votre signalement est conservé.',
      'Reported content deleted.': 'Contenu signalé supprimé.',
      'Report AI content': 'Signaler un contenu IA',
      'Report inappropriate AI-generated content': 'Signaler un contenu inapproprié généré par l’IA',
      'AI content & safety': 'Contenu IA et sécurité',
      'Send report': 'Envoyer le signalement',
      'Sending…': 'Envoi…',
      'Sent': 'Envoyé',
      'Reason': 'Motif',
      'Details (optional)': 'Précisions (facultatif)',
      'What is wrong with this result?': "Qu'est-ce qui ne va pas avec ce résultat ?",
      'Tell us what is wrong with this AI-generated result. Reports are reviewed by an admin. You do not need an account to report.':
        "Dites-nous ce qui ne va pas avec ce résultat généré par l’IA. Les signalements sont examinés par un admin. Aucun compte n’est nécessaire.",
      'The prompt used and a link to the generated file are attached so we can review the report.':
        'Le prompt utilisé et un lien vers le fichier généré sont joints pour permettre l’examen du signalement.',
      'Results are generated by AI models and may occasionally be inappropriate or inaccurate. If you see a generated result that should not have been produced, please tell us — reports are reviewed by an admin.':
        'Les résultats sont générés par des modèles d’IA et peuvent parfois être inappropriés ou inexacts. Si vous voyez un résultat qui n’aurait pas dû être produit, signalez-le — les signalements sont examinés par un admin.',
      'Sending your report…': 'Envoi de votre signalement…',
      'Report sent. Thank you — an admin will review it.':
        'Signalement envoyé. Merci — il sera examiné par un admin.',
      'Could not reach the server — your e-mail app has been opened instead.':
        'Serveur injoignable — votre messagerie a été ouverte à la place.',
      'Sexual or adult content': 'Contenu sexuel ou pour adultes',
      'Violent or graphic content': 'Contenu violent ou choquant',
      'Hateful or discriminatory content': 'Contenu haineux ou discriminatoire',
      'Harassment or bullying': 'Harcèlement ou intimidation',
      'Content that appears to involve a minor': 'Contenu semblant impliquer un mineur',
      'Illegal or dangerous content': 'Contenu illégal ou dangereux',
      'Misleading or deceptive content': 'Contenu trompeur',
      'Copyright or trademark concern': 'Question de droit d’auteur ou de marque',
      'Something else': 'Autre chose',
      // ---- Export image modal ----
      'Export image': "Exporter l'image",
      'Saved as a sibling LICENSE.txt next to your image.': 'Enregistré dans un LICENSE.txt voisin à côté de votre image.',
      // ---- Publish to marketplace modal ----
      'Title': 'Titre',
      'Description': 'Description',
      'Submit for review': 'Soumettre pour examen',
      // ---- Test rig animation modal ----
      'Test rig animation': "Tester l'animation du squelette",
      'Idle': 'Repos',
      'Walk': 'Marche',
      'Run': 'Course',
      // ---- Job details modal ----
      'Running task': 'Tâche en cours',
      'Status': 'Statut',
      'Running': 'En cours',
      'Started': 'Démarrée',
      'Elapsed': 'Écoulé',
      'Estimated': 'Estimé',
      'Project': 'Projet',
      'Go to step': "Aller à l'étape",
      'Open Settings': 'Ouvrir les paramètres',
      'Cancel task': 'Annuler la tâche',
      // ---- Modify image modal ----
      'Modify image': "Modifier l'image",
      'Describe the changes you want. The AI keeps the composition.':
        "Décrivez les changements souhaités. L'IA conserve la composition.",
      'Modification prompt': 'Prompt de modification',
      'make it red, add more details, anime style...': 'le rendre rouge, ajouter des détails, style anime...',
      'Strength': 'Intensité',
      // ---- Variant modal ----
      'Create variant': 'Créer une variante',
      'Generate a variation of the current image — same subject, you control how different it is.':
        "Générez une variation de l'image actuelle — même sujet, vous contrôlez son degré de différence.",
      'Variation amount': 'Niveau de variation',
      'Number of variants': 'Nombre de variantes',
      'Generate variant': 'Générer une variante',
      // ---- Draw Mask modal ----
      'Magnifier': 'Loupe',
      'Replace with:': 'Remplacer par :',
      'Apply Inpaint': 'Appliquer la retouche',
      // ---- Clone Stamp modal ----
      'Flip mode': 'Mode miroir',
      'Clear all paint': 'Effacer toute la peinture',
      'No source point set': 'Aucun point source défini',
      // ---- Jobs panel ----
      'Show running jobs': 'Afficher les tâches en cours',
      'Running jobs': 'Tâches en cours',
      'Collapse jobs panel': 'Réduire le panneau des tâches',
      // ---- Resolution modal ----
      'Downscale 0.5x': 'Réduire 0,5x',
      'Upscale 2x': 'Agrandir 2x',
      // ---- Brightness / Contrast modal ----
      'Brightness / Contrast': 'Luminosité / Contraste',
      'Sharpness': 'Netteté',
      // ---- Color Picker modal ----
      'Color Picker': 'Sélecteur de couleur',
      'Click anywhere on the image to pick a color.': "Cliquez n'importe où sur l'image pour prélever une couleur.",
      'Copy HEX': 'Copier le HEX',
      // ---- Blur Brush modal ----
      'Blur / Sharpen Brush': 'Pinceau flou / netteté',
      'Blur': 'Flou',
      'Sharpen': 'Accentuer',
      // ---- Crop modal ----
      'Auto center': 'Centrage auto',
      'Apply Crop': 'Appliquer le rognage',
      // ---- Symmetrize modal ----
      'Direction:': 'Direction :',
      'Mode:': 'Mode :',
      'Full': 'Complet',
      'Mask': 'Masque',
      'Apply Symmetrize': 'Appliquer la symétrie',
      // ---- Paint Tools modal ----
      'Paint Tools': 'Outils de peinture',
      'Rect': 'Rectangle',
      'Lasso': 'Lasso',
      'Wand': 'Baguette',
      'Invert selection': 'Inverser la sélection',
      'Invert': 'Inverser',
      'Deselect (edit everywhere)': 'Désélectionner (éditer partout)',
      'None': 'Aucune',
      'Line': 'Ligne',
      'Smudge': 'Étaler',
      'Fill': 'Remplir',
      'Pick color': 'Choisir une couleur',
      'Pick from image': "Prélever depuis l'image",
      'Hardness': 'Dureté',
      'Tolerance': 'Tolérance',
      // ---- Mesh Edit modal ----
      'Mesh Edit': 'Édition du maillage',
      'Push': 'Pousser',
      'Pull': 'Tirer',
      'Flatten': 'Aplatir',
      'Grab': 'Saisir',
      'Inflate': 'Gonfler',
      'Symmetry mirror': 'Miroir de symétrie',
      'Selection': 'Sélection',
      'Grow': 'Étendre',
      'Shrink': 'Rétrécir',
      'View': 'Vue',
      'Isolate': 'Isoler',
      'Hide': 'Masquer',
      'Edit': 'Éditer',
      'Duplicate': 'Dupliquer',
      'Flip normals': 'Inverser les normales',
      'Radius': 'Rayon',
      // ---- About modal ----
      'public beta': 'bêta publique',
      "What's this?": "Qu'est-ce que c'est ?",
      'Updates': 'Mises à jour',
      'Check for updates': 'Vérifier les mises à jour',
      'Resources': 'Ressources',
      'Website': 'Site web',
      'Privacy': 'Confidentialité',
      'Terms': 'Conditions',
      'Contact us': 'Nous contacter',
      'Crafted by': 'Réalisé par',
      // ---- Contact modal ----
      'Name': 'Nom',
      'Email': 'E-mail',
      'Subject': 'Sujet',
      'Your message…': 'Votre message…',
      'Send': 'Envoyer',
      // ---- Usage history modal ----
      'Export Excel': 'Exporter en Excel',
      'Date': 'Date',
      'Type': 'Type',
      'Duration': 'Durée',
      'Credits': 'Crédits',
      'Event details': "Détails de l'événement",
      'Loading…': 'Chargement…',
      'Detecting target…': 'Détection de la cible…',
      // ---- Cloud account / auth / parental (some are JS-rendered) ----
      'Account': 'Compte',
      'Session': 'Session',
      'Sign out': 'Se déconnecter',
      'Sign out of MyFabmesh.AI Cloud on this device.': 'Se déconnecter de MyFabmesh.AI Cloud sur cet appareil.',
      'Blocks NSFW, violent, and illegal content in prompts. Disable with a PIN code for unrestricted adult use.':
        'Bloque les contenus NSFW, violents et illégaux dans les prompts. Désactivez avec un code PIN pour un usage adulte sans restriction.',
      'Unrestricted': 'Sans restriction',
      'Restricted (safe)': 'Restreint (sûr)',
      'Unrestricted mode — click to lock': 'Mode sans restriction — cliquez pour verrouiller',
      'Parental control active — click to unlock': 'Contrôle parental actif — cliquez pour déverrouiller',
      'Lock': 'Verrouiller',
      'Locked': 'Verrouillé',
      'Unrestricted mode enabled.': 'Mode sans restriction activé.',
      // ---- Projects grid (JS-rendered) ----
      'No image': 'Aucune image',
      'No images yet.': 'Aucune image pour le moment.',
      'Create a new project': 'Créer un nouveau projet',
      'Server warming up ({n} services)': 'Serveur en préchauffage ({n} services)',
      'Server starting ({n} services)': 'Serveur en démarrage ({n} services)',
      'No generation in progress': 'Aucune génération en cours',
      // ---- Desktop Settings (Claude / control-plane / hardware / system / calibration) ----
      'Claude Desktop': 'Claude Desktop',
      'Let Claude generate batches of assets for you via text commands.': "Laissez Claude générer des lots d'assets pour vous via des commandes texte.",
      'Connect to Claude Desktop': 'Se connecter à Claude Desktop',
      'Disconnect': 'Déconnecter',
      'Disconnecting...': 'Déconnexion...',
      'Connecting...': 'Connexion...',
      'Connected': 'Connecté',
      'Not connected': 'Non connecté',
      'Disconnected': 'Déconnecté',
      'Restart Claude Desktop to activate.': 'Redémarrez Claude Desktop pour activer.',
      'Failed': 'Échec',
      'Error': 'Erreur',
      'Unknown error': 'Erreur inconnue',
      'Control API · checking...': 'API de contrôle · vérification...',
      'Local HTTP control plane on 127.0.0.1:7331. Drive MyFabmesh.AI from scripts (Claude Code, batch generators, CI...).': 'Plan de contrôle HTTP local sur 127.0.0.1:7331. Pilotez MyFabmesh.AI depuis des scripts (Claude Code, générateurs par lots, CI...).',
      'Disabled (no token)': 'Désactivé (aucun jeton)',
      'Set FABMESH_CONTROL_API=1 (or just relaunch MyFabmesh.AI) to enable.': 'Définissez FABMESH_CONTROL_API=1 (ou relancez simplement MyFabmesh.AI) pour activer.',
      'Unreachable': 'Injoignable',
      '(no requests yet)': '(aucune requête pour le moment)',
      'local': 'local',
      'Temp': 'Temp.',
      'Drag markers to set limits. Jobs queue until all limits are met.': 'Glissez les marqueurs pour définir les limites. Les tâches attendent que toutes les limites soient respectées.',
      'active': 'actif',
      'AI engine': 'Moteur IA',
      'running': 'en cours',
      'stopped': 'arrêté',
      'No active process.': 'Aucun processus actif.',
      'Kill AI engine': 'Arrêter le moteur IA',
      'Kill Processes': 'Arrêter les processus',
      'Kill All': 'Tout arrêter',
      'Kill': 'Arrêter',
      'Go to': 'Aller à',
      'Live logs viewer': 'Visionneuse de journaux en direct',
      'Reconfigure MyFabmesh.AI': 'Reconfigurer MyFabmesh.AI',
      'Re-run the first-time setup wizard to change install mode (Lite / Standard / Full) or re-download a missing model. Your projects and generated meshes are kept.': "Relancez l'assistant de configuration initiale pour changer le mode d'installation (Lite / Standard / Complet) ou re-télécharger un modèle manquant. Vos projets et maillages générés sont conservés.",
      'Uninstall MyFabmesh.AI': 'Désinstaller MyFabmesh.AI',
      "Remove MyFabmesh.AI from your computer. You'll be asked whether to also delete the AI models (~17 GB) and your settings. Your generated meshes folder is never touched.": "Supprimez MyFabmesh.AI de votre ordinateur. On vous demandera si vous souhaitez aussi supprimer les modèles IA (~17 Go) et vos paramètres. Votre dossier de maillages générés n'est jamais touché.",
      'Reconfigure': 'Reconfigurer',
      'Uninstall': 'Désinstaller',
      'Generates a textured mesh from the calibration cube and scores how many of the 6 painted faces end up on the correct axis.': 'Génère un maillage texturé à partir du cube de calibration et évalue combien des 6 faces peintes se retrouvent sur le bon axe.',
      'Ground truth: 6 painted cube faces': 'Vérité terrain : 6 faces de cube peintes',
      'docs': 'docs',
      'Last run loaded.': 'Dernière exécution chargée.',
      'Resume': 'Reprendre',
      // ---- Dynamic JS strings (toasts / errors / status) ----
      'Pick an image first.': 'Choisissez d\'abord une image.',
      'Pick a mesh first.': 'Choisissez d\'abord un maillage.',
      'Pick a source image first.': 'Choisissez d\'abord une image source.',
      'Pick a clip first': 'Choisissez d\'abord un clip',
      'Pick a rig template.': 'Choisissez un modèle de squelette.',
      'Open a project first': 'Ouvrez d\'abord un projet',
      'Type a description first.': 'Saisissez d\'abord une description.',
      'Type a modification first.': 'Saisissez d\'abord une modification.',
      'No prompt to copy': 'Aucun prompt à copier',
      'No selection to invert.': 'Aucune sélection à inverser.',
      'Select faces first': 'Sélectionnez d\'abord des faces',
      'Select an animation first': 'Sélectionnez d\'abord une animation',
      'Select a clip first': 'Sélectionnez d\'abord un clip',
      'Pick at least one animation type': 'Choisissez au moins un type d\'animation',
      'Image imported!': 'Image importée !',
      'Import failed': 'Échec de l\'import',
      'Prompt copied!': 'Prompt copié !',
      'Copy failed': 'Échec de la copie',
      'Prompt already enhanced. Edit manually or clear it.': 'Prompt déjà amélioré. Modifiez-le manuellement ou effacez-le.',
      'Back photo added': 'Photo arrière ajoutée',
      'Back photo ready': 'Photo arrière prête',
      'Generating back photo...': 'Génération de la photo arrière...',
      'Generating 6 multi-views...': 'Génération de 6 multi-vues...',
      'Multi-views generated!': 'Multi-vues générées !',
      'Generating back photos...': 'Génération des photos arrière...',
      'Back photos ready': 'Photos arrière prêtes',
      'Generating 6 views...': 'Génération de 6 vues...',
      '6 views ready': '6 vues prêtes',
      'Regenerating back view...': 'Régénération de la vue arrière...',
      'Back view regenerated.': 'Vue arrière régénérée.',
      'No front image to regenerate from.': 'Aucune image avant pour régénérer.',
      'Symmetrized!': 'Symétrisé !',
      'Cannot load image': 'Impossible de charger l\'image',
      'Crop area too small.': 'Zone de rognage trop petite.',
      'Style applied!': 'Style appliqué !',
      'Saved!': 'Enregistré !',
      'Painted version saved!': 'Version peinte enregistrée !',
      'Paint Mesh saved!': 'Peinture du maillage enregistrée !',
      'Edited mesh saved!': 'Maillage modifié enregistré !',
      'Texture re-projected': 'Texture re-projetée',
      'Need both a mesh and a source image': 'Un maillage et une image source sont requis',
      'Failed to read mesh file': 'Échec de la lecture du fichier de maillage',
      'Failed to load mesh in preview': "Échec du chargement du maillage dans l'aperçu",
      'Selected faces deleted': 'Faces sélectionnées supprimées',
      'Flipped selected faces': 'Faces sélectionnées inversées',
      'Smoothed selection': 'Sélection lissée',
      'Duplicated selection': 'Sélection dupliquée',
      'Kept the rest': 'Reste conservé',
      'Cropped to selection': 'Rogné sur la sélection',
      'No animation tracks in this GLB — nothing to play.': 'Aucune piste d\'animation dans ce GLB — rien à lire.',
      'Imported as new version': 'Importé comme nouvelle version',
      'Pick a .glb or .gltf file': 'Choisissez un fichier .glb ou .gltf',
      'Check at least one type to generate.': 'Cochez au moins un type à générer.',
      'Type what to find first (e.g. "hat", "background")': 'Indiquez d\'abord quoi trouver (ex. « chapeau », « arrière-plan »)',
      'Parental control re-enabled.': 'Contrôle parental réactivé.',
      'PIN must be at least 4 digits.': 'Le code PIN doit comporter au moins 4 chiffres.',
      'AI engine killed. VRAM freed.': 'Moteur IA arrêté. VRAM libérée.',
      'Processes killed. AI engine preserved.': 'Processus arrêtés. Moteur IA préservé.',
      'All processes + AI engine killed. VRAM freed.': 'Tous les processus + le moteur IA arrêtés. VRAM libérée.',
      'This image is blocked by parental control.': 'Cette image est bloquée par le contrôle parental.',
      'Title is required.': 'Le titre est obligatoire.',
      'No mesh selected — close and pick a mesh first.': 'Aucun maillage sélectionné — fermez et choisissez d\'abord un maillage.',
      'No image selected — close and pick an image first.': 'Aucune image sélectionnée — fermez et choisissez d\'abord une image.',
      '✓ Submitted for review — an admin will approve it shortly.': '✓ Soumis pour examen — un administrateur l\'approuvera sous peu.',
      'This mesh has no job ID — cannot publish.': 'Ce maillage n\'a pas d\'identifiant de tâche — publication impossible.',
      'OK': 'OK',
      'Sign in': 'Se connecter',
      'Sending…': 'Envoi…',
      'Submitting…': 'Soumission…',
      'Saving…': 'Enregistrement…',
      'Projecting…': 'Projection…',
      'Re-projecting...': 'Re-projection...',
      'Restarting…': 'Redémarrage…',
      'Cancelling...': 'Annulation...',
      'Loading mesh...': 'Chargement du maillage...',
      'Move cursor over image': "Déplacez le curseur sur l'image",
      'Update check not available in this build.': 'Vérification des mises à jour indisponible dans cette version.',
      'Checking GitHub for updates…': 'Recherche de mises à jour sur GitHub…',
      'You are running the latest version.': 'Vous utilisez la dernière version.',
      'GPU info unavailable': 'Infos GPU indisponibles',
      'Re-skin': 'Re-skin',
      'No mesh available — generate or pick one first.': 'Aucun maillage disponible — générez-en un ou choisissez-en un d\'abord.',
      'Rigging bridge not available.': 'Le pont de rigging n\'est pas disponible.',
      'I understand and accept responsibility': 'Je comprends et j\'accepte la responsabilité',
      // ---- Converted from FR-hardcoded source ----
      'Filter disabled — re-running the action…': 'Filtre désactivé — relance de l\'action…',
      'The job will start automatically once the limits are met.': 'Le job sera lancé automatiquement quand les limites seront satisfaites.',
      'You can adjust the sliders in Settings.': 'Vous pouvez ajuster les sliders dans Settings.',
      'Job queued': 'Job mis en file d\'attente',
    },
  };

  /* LANGUE PAR DEFAUT : CELLE DU VISITEUR, PAS L'ANGLAIS EN DUR.
   *
   * `localStorage.getItem(...) || 'en'` : au tout premier chargement rien
   * n'est stocke, donc TOUT LE MONDE arrivait en anglais. La vitrine est
   * en francais, les fiches de magasin sont en francais, et le produit
   * lui-meme s'ouvrait en anglais — y compris pour un visiteur dont le
   * navigateur ne demande que du francais. Les dictionnaires existaient
   * pourtant deja et etaient complets : rien n'etait a traduire, il n'y
   * avait qu'a les choisir.
   *
   * Un choix explicite de l'utilisateur reste prioritaire pour toujours :
   * on ne regarde le navigateur que faute de preference enregistree. */
  const LANGUES_CONNUES = ['fr', 'es', 'zh', 'hi', 'ar'];

  function _langueDuNavigateur() {
    try {
      const brutes = (navigator.languages && navigator.languages.length)
        ? navigator.languages : [navigator.language];
      for (const b of brutes) {
        if (!b) continue;
        const court = String(b).toLowerCase().split('-')[0];
        if (court === 'en') return 'en';
        if (LANGUES_CONNUES.indexOf(court) !== -1) return court;
      }
    } catch (_) { /* pas de navigator (test, worker) */ }
    return 'en';
  }

  /* « ENREGISTRE » NE VEUT PAS DIRE « CHOISI » — corrige le 2026-08-23.
   *
   * `applyLang` ecrit `fabmesh.lang` a CHAQUE appel, y compris a l'ouverture.
   * Tout navigateur ayant ouvert l'application avant le correctif ci-dessus
   * a donc 'en' fige, et la detection ne s'executerait jamais pour lui : le
   * correctif ne servait qu'aux nouveaux visiteurs.
   *
   * On note desormais separement le choix EXPLICITE de l'utilisateur (via le
   * selecteur). En son absence, un 'en' herite est reevalue une fois — mais
   * seulement si le navigateur ne demande PAS l'anglais, sinon rien ne
   * change. Le seul cas touche est donc exactement celui que le defaut
   * lesait, et il reste rattrapable d'un clic sur le selecteur. */
  const CLE_CHOIX = 'fabmesh.lang.choisi';

  let _lang = 'en';
  try {
    const explicite = localStorage.getItem(CLE_CHOIX);
    const enregistre = localStorage.getItem('fabmesh.lang');
    if (explicite) {
      _lang = explicite;
    } else if (enregistre && enregistre !== 'en') {
      _lang = enregistre;
    } else {
      _lang = _langueDuNavigateur();
    }
  } catch (_) { _lang = _langueDuNavigateur(); }

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'MODEL-VIEWER', 'CANVAS', 'svg', 'SVG']);

  function _dict() { return _lang === 'en' ? null : (I18N[_lang] || null); }

  function _translateText(root, dict) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const pn = n.parentNode;
        if (pn && SKIP_TAGS.has(pn.nodeName)) return NodeFilter.FILTER_REJECT;
        return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const nodes = [];
    let n;
    while ((n = tw.nextNode())) nodes.push(n);
    nodes.forEach((node) => _translateNodeValue(node, dict));
  }

  // Translate a single text node, caching its original English on the node so
  // switching back to English restores it. Fallback: if the full trimmed label
  // has no entry, strip a leading icon/emoji run ("💾 Export" -> "💾 " + "Export")
  // and translate the word remainder, so icon-prefixed buttons translate too.
  function _translateNodeValue(node, dict) {
    if (node.__i18n === undefined) node.__i18n = node.nodeValue;
    const orig = node.__i18n;
    const key = orig.trim();
    if (!key) return;
    let translated = orig;  // dict null = English (source) -> restore the cached original
    if (dict) {
      // Already-translated text (a curated VALUE for this lang) must be left as-is
      // — re-translating t()'s French output mangled it ("trafic d'histoire" bug).
      if (_curatedValues[_lang] && _curatedValues[_lang].has(key)) return;
      // Match the icon-STRIPPED core FIRST so curated (icon-less) dict entries beat any
      // stale full-string auto cache entry that used to shadow them ('Sharpen'->'épingle').
      // Core may start with a LETTER or DIGIT ("🏗️ 3D construction stages"):
      // requiring a letter made the match fail on digit-led labels, so the FULL
      // string (icon included) fell through to auto-translate → icon lost.
      const m = key.match(/^([^\p{L}\p{N}]+)([\p{L}\p{N}][\s\S]*)$/u);
      const core = m ? m[2] : key;
      const prefix = m ? m[1] : '';
      if (dict[core]) {
        translated = orig.replace(key, prefix + dict[core]);
      } else if (dict[key]) {
        translated = orig.replace(key, dict[key]);
      } else {
        _queueAuto(core);   // cache by the icon-stripped core so it shares the dict key space
      }
    }
    if (node.nodeValue !== translated) node.nodeValue = translated;
  }

  function _translateAttrs(root, dict) {
    ['placeholder', 'title', 'aria-label'].forEach((attr) => {
      root.querySelectorAll('[' + attr + ']').forEach((el) => {
        const ck = '__i18n_' + attr;
        if (el[ck] === undefined) el[ck] = el.getAttribute(attr);
        const orig = el[ck];
        let translated = orig;
        if (dict && dict[orig]) translated = dict[orig];
        else if (orig && orig.trim()) _queueAuto(orig.trim());
        if (el.getAttribute(attr) !== translated) el.setAttribute(attr, translated);
      });
    });
  }

  // Small country flags next to the selector. Windows doesn't render flag
  // EMOJI (shows "FR"/"GB" letters), so we use inline SVG images instead.
  const _FLAG_SVG = {
    en: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 30'><clipPath id='ujs'><path d='M0,0 v30 h60 v-30 z'/></clipPath><clipPath id='ujt'><path d='M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z'/></clipPath><g clip-path='url(#ujs)'><path d='M0,0 v30 h60 v-30 z' fill='#012169'/><path d='M0,0 L60,30 M60,0 L0,30' stroke='#fff' stroke-width='6'/><path d='M0,0 L60,30 M60,0 L0,30' clip-path='url(#ujt)' stroke='#C8102E' stroke-width='4'/><path d='M30,0 v30 M0,15 h60' stroke='#fff' stroke-width='10'/><path d='M30,0 v30 M0,15 h60' stroke='#C8102E' stroke-width='6'/></g></svg>",
    fr: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 2'><rect width='3' height='2' fill='#fff'/><rect width='1' height='2' fill='#002654'/><rect x='2' width='1' height='2' fill='#CE1126'/></svg>",
    es: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 2'><rect width='3' height='2' fill='#AA151B'/><rect y='0.5' width='3' height='1' fill='#F1BF00'/></svg>",
    zh: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 30 20'><rect width='30' height='20' fill='#DE2910'/><path d='M5 2.6 6.12 6.05 9.75 6.05 6.81 8.18 7.94 11.63 5 9.5 2.06 11.63 3.19 8.18 0.25 6.05 3.88 6.05 Z' fill='#FFDE00'/></svg>",
    hi: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 6'><rect width='9' height='6' fill='#fff'/><rect width='9' height='2' fill='#FF9933'/><rect y='4' width='9' height='2' fill='#138808'/><circle cx='4.5' cy='3' r='0.9' fill='none' stroke='#000080' stroke-width='0.16'/><circle cx='4.5' cy='3' r='0.12' fill='#000080'/></svg>",
    ar: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 6'><rect width='12' height='6' fill='#fff'/><rect width='12' height='2' fill='#00732F'/><rect y='4' width='12' height='2' fill='#000'/><rect width='3' height='6' fill='#FF0000'/></svg>",
  };
  function _flagSrc(code) {
    const svg = _FLAG_SVG[code];
    return svg ? 'data:image/svg+xml,' + encodeURIComponent(svg) : '';
  }
  function _updateFlag(lang) {
    const src = _flagSrc(lang);
    const f = document.getElementById('lang-flag');
    if (f) {
      // The custom dropdown (once built) carries the flag in its button, so the
      // standalone left flag is hidden to avoid showing it twice.
      if (_langDD) f.style.display = 'none';
      else if (src) { f.src = src; f.style.display = ''; }
      else f.style.display = 'none';
    }
    if (_langDD && _langDD.bimg) {
      if (src) { _langDD.bimg.src = src; _langDD.bimg.style.display = ''; }
      else _langDD.bimg.style.display = 'none';
    }
  }

  // Custom language dropdown so each option can show its flag — native <select>
  // <option> elements can't contain <img>. It mirrors the hidden #lang-select
  // (kept as the source of truth, so change events + value reads still work).
  let _langDD = null;
  function _mkFlagImg(code) {
    const im = document.createElement('img');
    im.alt = '';
    const s = _flagSrc(code);
    if (s) im.src = s; else im.style.display = 'none';
    im.style.cssText = 'width:22px;height:15px;border-radius:2px;object-fit:cover;box-shadow:0 0 0 1px rgba(255,255,255,0.14);flex:none;';
    return im;
  }
  function _buildLangDropdown() {
    const sel = document.getElementById('lang-select');
    if (!sel || sel.__fabCustom) return;
    sel.__fabCustom = true;
    sel.style.display = 'none';
    const opts = Array.from(sel.options).map((o) => ({ value: o.value, label: o.textContent.trim() }));
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative; display:inline-block; min-width:160px;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'display:flex; align-items:center; gap:8px; width:100%; padding:6px 10px; background:var(--bg-2,#1a1a24); color:var(--text-0,#fff); border:1px solid var(--border,#3a3a4a); border-radius:6px; cursor:pointer; font-size:13px;';
    const bimg = _mkFlagImg(sel.value);
    const blab = document.createElement('span'); blab.style.cssText = 'flex:1; text-align:start;';
    const chev = document.createElement('span'); chev.textContent = '▾'; chev.style.cssText = 'opacity:0.6; font-size:11px;';
    btn.appendChild(bimg); btn.appendChild(blab); btn.appendChild(chev);
    const menu = document.createElement('div');
    menu.style.cssText = 'position:absolute; top:calc(100% + 4px); left:0; right:0; background:var(--bg-1,#15151d); border:1px solid var(--border,#3a3a4a); border-radius:6px; box-shadow:0 10px 28px rgba(0,0,0,0.55); z-index:99999; overflow:hidden auto; max-height:60vh; display:none;';
    opts.forEach((o) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:pointer; color:var(--text-0,#fff); font-size:13px;';
      const lab = document.createElement('span'); lab.textContent = o.label;
      row.appendChild(_mkFlagImg(o.value)); row.appendChild(lab);
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(124,77,255,0.28)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        sel.value = o.value;
        sel.dispatchEvent(new Event('change'));
        menu.style.display = 'none';
      });
      menu.appendChild(row);
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = (menu.style.display === 'none') ? 'block' : 'none';
    });
    document.addEventListener('click', () => { menu.style.display = 'none'; });
    wrap.appendChild(btn); wrap.appendChild(menu);
    sel.parentNode.insertBefore(wrap, sel.nextSibling);
    _langDD = { btn, bimg, blab, menu };
    _syncLangDropdownButton();
  }
  function _syncLangDropdownButton() {
    const sel = document.getElementById('lang-select');
    if (!sel || !_langDD) return;
    const o = sel.options[sel.selectedIndex];
    const s = _flagSrc(sel.value);
    if (s) { _langDD.bimg.src = s; _langDD.bimg.style.display = ''; } else _langDD.bimg.style.display = 'none';
    _langDD.blab.textContent = o ? o.textContent.trim() : sel.value;
  }

  // --- Runtime auto-translate fallback -------------------------------------
  // Any English UI string with no dict entry is sent to the local Argos worker
  // (EN -> current language) and cached persistently, so the UI is never left in
  // English even for strings we didn't pre-translate. No-ops gracefully when the
  // IPC bridge is absent (e.g. the web/cloud build has no local worker).
  const _AUTO_KEY = 'fabmesh.i18n.auto.v3.';   // v3: cache keyed by icon-stripped core; drop stale full-string caches that shadowed curated entries
  const _curated = {};   // per-lang Set of register()'d keys — the auto cache must never override these
  // VALUES of every curated translation (computed BEFORE any auto-cache merge). Text
  // that is ALREADY a curated translation must never be re-translated by the DOM
  // walker: t() emits correct French, then the walker treated that French as English
  // and mangled it via a self-referential auto-cache entry keyed by the FR.
  const _curatedValues = {};
  for (const _lg in I18N) { _curatedValues[_lg] = new Set(Object.values(I18N[_lg])); }
  const _autoCache = {};
  const _pendingAuto = new Set();
  const _triedAuto = new Set();
  let _autoTimer = null;
  function _loadAutoCache(lang) {
    if (_autoCache[lang]) return _autoCache[lang];
    let m = {};
    try { m = JSON.parse(localStorage.getItem(_AUTO_KEY + lang) || '{}') || {}; } catch (_) { m = {}; }
    _autoCache[lang] = m;
    const _base = I18N[lang] || (I18N[lang] = {});
    let _purged = false;
    for (const _k in m) {
      if (_curated[lang] && _curated[lang].has(_k)) continue;
      // Self-referential garbage: the KEY is itself a curated FR translation (the
      // walker mis-translated t()'s output). Drop it from the cache for good.
      if (_curatedValues[lang] && _curatedValues[lang].has(_k)) { delete m[_k]; _purged = true; continue; }
      _base[_k] = m[_k];
    }
    if (_purged) { try { localStorage.setItem(_AUTO_KEY + lang, JSON.stringify(m)); } catch (_) {} }
    return m;
  }
  function _shouldAutoTranslate(key) {
    if (!key || key.length > 200) return false;
    if (!/[A-Za-z]/.test(key)) return false;                 // needs letters
    if (/^https?:\/\//i.test(key)) return false;             // url
    if (!/\s/.test(key) && /[._/\\()]|[a-z][A-Z]/.test(key)) return false;  // code-ish token
    // Value-like strings (durations/sizes/measures: "18s", "~19s", "10m 48s",
    // "2.5 GB", "47°C") — NEVER translate (argos turned "18s" into "18 ans").
    // Heuristic: short, starts with a digit (after optional ~/</>), no real 4+ letter word.
    if (key.length <= 24 && !/[A-Za-z]{4,}/.test(key) && /^[~≈<>]?\s*\d/.test(key)) return false;
    return true;
  }
  function _queueAuto(key) {
    if (_lang === 'en' || !key) return;
    if (typeof window === 'undefined' || !window.meshyAPI || !window.meshyAPI.i18nAutoTranslate) return;
    const tk = _lang + '|' + key;
    if (_triedAuto.has(tk) || _pendingAuto.has(key)) return;
    const d = _dict();
    if (d && d[key]) return;
    if (!_shouldAutoTranslate(key)) return;
    _pendingAuto.add(key);
    if (!_autoTimer) _autoTimer = setTimeout(_flushAuto, 450);
  }
  async function _flushAuto() {
    _autoTimer = null;
    if (_lang === 'en' || !_pendingAuto.size) return;
    if (typeof window === 'undefined' || !window.meshyAPI || !window.meshyAPI.i18nAutoTranslate) { _pendingAuto.clear(); return; }
    const lang = _lang;
    const texts = Array.from(_pendingAuto).slice(0, 60);
    texts.forEach((t) => { _pendingAuto.delete(t); _triedAuto.add(lang + '|' + t); });
    let res = null;
    try { res = await window.meshyAPI.i18nAutoTranslate({ texts, to: lang }); } catch (_) { res = null; }
    if (res && typeof res === 'object') {
      const cache = _loadAutoCache(lang);
      let added = 0;
      for (const en of Object.keys(res)) {
        const tr = res[en];
        if (_curated[lang] && _curated[lang].has(en)) continue;  // never override a curated entry
        if (tr && typeof tr === 'string' && tr !== en) { cache[en] = tr; I18N[lang][en] = tr; added++; }
      }
      if (added) {
        try { localStorage.setItem(_AUTO_KEY + lang, JSON.stringify(cache)); } catch (_) {}
        if (lang === _lang) { try { applyLang(lang); } catch (_) {} }
      }
    }
    if (_pendingAuto.size && !_autoTimer) _autoTimer = setTimeout(_flushAuto, 450);
  }
  // -------------------------------------------------------------------------

  function applyLang(lang) {
    _lang = lang || 'en';
    try { localStorage.setItem('fabmesh.lang', _lang); } catch (_) {}
    try { window.meshyAPI && window.meshyAPI.setSpellcheckLang && window.meshyAPI.setSpellcheckLang(_lang); } catch (_) {}
    if (_lang !== 'en') _loadAutoCache(_lang);
    const dict = _dict();
    try {
      _translateText(document.body, dict);
      _translateAttrs(document.body, dict);
    } catch (e) { try { console.warn('[i18n]', e); } catch (_) {} }
    document.documentElement.setAttribute('lang', _lang);
    document.documentElement.setAttribute('dir', _lang === 'ar' ? 'rtl' : 'ltr');
    const sel = document.getElementById('lang-select');
    if (sel && sel.value !== _lang) sel.value = _lang;
    _updateFlag(_lang);
    _syncLangDropdownButton();
  }

  // t(): translate a single string (for JS-built / dynamic UI text).
  function t(s) {
    const dict = _dict();
    return (dict && dict[s]) || s;
  }

  // tf(): translate a TEMPLATE that contains {x}/{y} placeholders, then fill them
  // with args in order. The dict key is the template WITH the placeholders (e.g.
  // 'Generate 3D: {x}'). Falls back to the English template filled in.
  function tf(template, ...args) {
    const dict = _dict();
    const s = (dict && dict[template]) || template;
    let i = 0;
    return s.replace(/\{[xy]\}/g, () => (i < args.length ? String(args[i++]) : ''));
  }

  // Re-translate dynamically-added content SYNCHRONOUSLY (inside the observer
  // callback, before the browser paints) so freshly-rendered English never
  // flashes on screen — fixes the EN<->FR flicker when panels re-render every
  // second during generation. We only walk the newly-added subtrees (not the
  // whole body), so it stays cheap. childList only (NOT characterData) so our
  // own nodeValue swaps never re-trigger us -> no loop.
  const _mo = new MutationObserver((muts) => {
    if (_lang === 'en') return;
    const dict = _dict();
    if (!dict) return;
    for (const mut of muts) {
      if (!mut.addedNodes) continue;
      mut.addedNodes.forEach((node) => {
        if (node.nodeType === 3) {                                   // text node
          _translateNodeValue(node, dict);
        } else if (node.nodeType === 1 && !SKIP_TAGS.has(node.nodeName)) {  // element subtree
          _translateText(node, dict);
          _translateAttrs(node, dict);
        }
      });
    }
  });

  window.FabI18n = {
    applyLang,
    t,
    tf,
    get lang() { return _lang; },
    register(lang, map) {
      I18N[lang] = Object.assign(I18N[lang] || {}, map);
      (_curated[lang] = _curated[lang] || new Set());
      for (const k in map) _curated[lang].add(k);
      (_curatedValues[lang] = _curatedValues[lang] || new Set());
      for (const k in map) _curatedValues[lang].add(map[k]);
    },
    languages() { return ['en'].concat(Object.keys(I18N)); },
  };

  function _init() {
    // Wire the Settings language <select> if present.
    const sel = document.getElementById('lang-select');
    if (sel) {
      sel.value = _lang;
      sel.addEventListener('change', () => {
        // Choix EXPLICITE : il prime a jamais sur la detection.
        try { localStorage.setItem(CLE_CHOIX, sel.value); } catch (_) {}
        applyLang(sel.value);
      });
      _buildLangDropdown();
    }
    applyLang(_lang);
    try { _mo.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();
}());
