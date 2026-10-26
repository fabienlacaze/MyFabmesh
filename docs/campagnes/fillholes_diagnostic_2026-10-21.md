# Fill holes : diagnostic du 21/10/2026 et ce qu'il faut pour l'etape suivante

Mesures sur 28 maillages reels (primitives du corpus `build/bancs/fillholes/corpus.json`, 4 600 a 517 000 faces) avec le NOUVEAU noyau
(`scripts/bouchage_trous.py`), outil `build/bancs/fillholes/diagnostic_noyau.py` -> `resultats/noyau_corpus.json`. Les chemins des GLB sont ceux de la
machine du proprietaire ; aucun maillage n'est dans le depot (public).

## 1. Constat chiffre

| question | mesure |
|---|---|
| Combien de maillages reels ont un trou topologique (boucle d'aretes de bord a boucher) ? | **0 sur 28.** Seuls `voiture_500k` (9 aretes) et `portail_500k` (3 aretes) ont des aretes de bord : ce sont 3 + 1 boucles DEGENEREES (T-jonctions, aire nulle), que le noyau ignore. |
| Que repond le noyau a ces 28 maillages ? | « rien a boucher », avec la cause : 27 fois `aretes a plus de deux faces` (de 49 a 105 510 aretes ; 94 434 sur l'orc), 1 fois `faces retournees` (`chevalier_fill_holes_19k`, 4 faces : sortie de l'ancien Fill holes). Refus explique, non facture. |
| Miettes flottantes | de 1 a 530 par maillage (orc : 161 miettes, 19 302 faces). |
| Les « zones sans matiere » vues par le proprietaire sont-elles des trous ? | **Non.** Sur les 7 maillages de generation mesures le 20/10, la visibilite par 26 directions donne 0 pixel « fond visible par un bord ouvert » ; ce qui s'affiche en creux est une face vue par derriere (double peau a 95-100 % sur les gros maillages) ou une texture noire. |
| Le Fill holes d'Unreal ou du bureau les verrait-il ? | Non : tout detecteur d'aretes de bord renvoie 0 boucle sur ces maillages. |

Conclusion : sur les maillages produits par la generation, **Fill holes n'a presque jamais rien a boucher**, et la matiere qui manque n'est pas une
ouverture dans la surface. Le noyau livre dans ce tour ne fait donc que ce qu'un bouche-trou peut honnetement faire, et le dit.

## 2. Ce que corrige ce tour (rien n'est deploye)

Avant (release-1.0.45) l'exemplaire Modal etait destructeur sur les vrais maillages : sur l'orc de 496 242 faces, 11,9 % des faces supprimees
(`broken_faces`), 38 % des coordonnees UV reecrites (`merge_vertices(merge_tex=True)`), 204 boucles ouvertes creees, ou refus a 17 % apres 74 a 160 s.
Mesure `build/bancs/fillholes/avant_apres.py` sur l'orc auquel on ajoute 3 trous (6, 30 et 103 faces retirees : pourtours de 8, 30 et 45
aretes, 82 aretes de bord), MEME maillage pour les deux exemplaires :

| | avant (release-1.0.45) | apres (ce tour) |
|---|---|---|
| resultat | refus apres **55,6 s** : « le bouchage aurait supprime 42 % des faces » | **3 trous sur 3 bouches**, 77 faces ajoutees, 0 arete de bord restante |
| faces d'entree supprimees | (42 % si la garde n'avait pas refuse) | **0 %** |
| UV reecrites / sommets deplaces | — | **0 % / aucun** (901 488 sommets identiques) |
| duree | 55,6 s | **6,8 a 7,1 s** (delai du worker : 120 s) |

Un des trois trous touchait une arete partagee par plus de deux faces (double peau, 94 434 aretes de ce genre sur l'orc) : son pourtour n'est
alors qu'une CHAINE dont les bouts sont relies par une arete existante. La premiere version du noyau la laissait ouverte (44 aretes de bord
restantes) ; le noyau la referme desormais par cette arete (test `TestChaines`), sans jamais doubler une face existante (« ailette »).
Voir `resultats/orc_avant_apres.json` et les entrees du 21/10 de l'AGENT_LOG pour le detail des invariants et des tests.

## 3. Ce qu'il faut au proprietaire pour l'etape suivante

La detection VOLUMIQUE des zones sans matiere (ce que le proprietaire voit comme un manque) n'est PAS construite : sans exemple, tout seuil serait
invente. Il faut :

1. **Un maillage ou le manque est VISIBLE** dans la visionneuse (le GLB lui-meme, a placer hors depot, ex. `C:/tmp/fillholes_mesure/`), avec la
   description : quelle partie du modele, vue de quel cote, avec ou sans texture.
2. **Une capture de la visionneuse** montrant le manque (meme angle), ou le nom du projet dans l'appli.
3. Si possible le **meme maillage dans Unreal** (la zone y apparait-elle vide, ou noire, ou transparente ?), pour distinguer :
   face vue par derriere (materiau a une seule face), texture noire (atlas non couvert), ou vraie absence de surface.
4. Sa reponse a la question de fond : un manque doit-il etre **rempli** (ajout de surface, risque d'inventer de la forme) ou seulement **signale**
   (zone coloree, a retoucher a la main) ?

Avec cela, l'outil `rappel.py --reference visuel` mesure le rappel et la precision de tout detecteur candidat contre les zones de reference
(`diagnostic_matiere.py` les ecrit dans `zones/`), ce qui permet de regler le detecteur sur un cas reel plutot que sur des synthetiques.

## 4. A deployer (non fait)

- Modal : `modal_app/_mesh_op.py` + `modal_app/bouchage_trous.py` (`python -m modal deploy modal_app/app.py`, puis
  `build/rechauffer_apres_deploy.py` ; a grouper avec les autres deploiements Modal).
- Site : `cd cloud && npm run build && npm run deploy` (apercu, libelles des refus, `REFUS_CONNUS` du worker).
- Bureau : nouvelle version (renderer dans `app.asar`, `mesh_tools.py` et `bouchage_trous.py` dans les scripts).
