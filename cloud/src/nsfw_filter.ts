/**
 * Filtre de prompt (NSFW / contenus illicites) — cote Worker.
 * Portage de `src/main/main.js:checkPromptSafety`, MAIS refondu le 2026-10-03
 * (constats IA-02, IA-03, IA-04 de l'analyse du 03/10/2026) :
 *
 *  1. PLANCHER illicite (`checkHardFloor`, jamais contournable, evalue AVANT
 *     le drapeau `unrestricted`) : le texte est NORMALISE avant le test
 *     (NFKC, accents, caracteres invisibles, alphabets cyrillique / grec
 *     ressemblants, leet 0->o 1->i/l 3->e 4->a 5->s 7->t @->a $->s, lettres
 *     espacees ou ponctuees "n.u.d.e", lettres repetees) et couvre l'age
 *     ecrit en chiffres ou en lettres ("12 ans", "twelve year old", "12yo")
 *     et le vocabulaire de six langues (fr, en, es, de, pt, it).
 *  2. Filtre GENERAL (`checkPromptSafety`) : correspondance par MOTS ENTIERS
 *     (ou debut de mot pour les racines marquees `*`) au lieu de la simple
 *     sous-chaine, et les mots ambigus du jeu video (blood, hanging, crack,
 *     flesh, slash, strip, breast...) ne bloquent plus qu'en CONTEXTE
 *     (terme sexuel explicite, terme du plancher, ou enfant pour la violence).
 *     Mesure : voir cloud/tests/moderation.test.mjs.
 *
 * 2026-10-13 — AUDIT LANGUE / MODERATION DU 11/10 (constats MODERATION-01, 03, 05, 07, 09, M1, M2, M3 ; SERVEUR-09) :
 *  - NORMALISATION : NFKC, puis EFFACEMENT de tout caractere de categorie C (controle, format, usage prive, non assigne,
 *    demi-substitut), de U+FFFD et des « ignorables » (remplisseurs hangul, braille vide...), de TOUTES les marques
 *    combinantes ; chiffres Unicode (arabes-indiens, devanagari, persans...) ramenes en ASCII ; homoglyphes completes
 *    (petites capitales, lettres barrees, armenien, lettres-emoji). Le tokenizer CLIP efface ces caracteres :
 *    « na<U+0001>ked » est lu « naked » par le modele, il doit l'etre aussi par le filtre.
 *  - PLANCHER : actes sexuels et anatomie explicites en anglais clair, mots COLLES « mineur+nudite » dans un meme mot
 *    (« childnaked » : CLIP le lit comme deux mots), synonymes de mineur et formulations d'age (« 8 years of age »,
 *    « born in 2018 », « 3rd grader »), composes allemands (« halbnackt »), tournures courantes des six langues, et un
 *    lexique pour zh, hi, ar, ru, ja, ko, tr (+ nl, pl, id, vi, uk partiels) lu sur une VUE UNICODE (sans translitteration).
 *  - FAUX POSITIFS : « heroine », age lu dans « aged elf » / « ten thousand years » / « dix ans de guerre », « stable »,
 *    « baby dragon », mots courts d'autres langues (vietnamien « nữ » / « nuôi », « Nudeln », « Nacktschnecke », « Pornic »,
 *    « spogliatoio »), expressions de jeu (« hit points », « scream mask », « toy gun »).
 *  - LONGUEUR et SYNTAXE : `controlerLongueurPrompt` (borne ponderee : hors alphabet latin un caractere compte 3) et
 *    `neutraliserSyntaxePrompt` (jetons speciaux CLIP, poids A1111 hors [0,5 ; 2], caracteres effaces). Le worker les
 *    applique avant d'envoyer un texte a Modal ; Modal refait les memes controles (modal_app/_moderation_texte.py).
 *  CE QUI RESTE (voir AGENT_LOG.md, 2026-10-13 et 2026-10-14) : langues hors de la liste ci-dessus, argot et euphemismes, mots
 *  coupes par un espace (« na ked » : le modele ne lit pas non plus le mot), fautes volontaires, texte inverse, emoji (7 seulement).
 *
 * 2026-10-14 — RELECTURE DU LOT (bloquants B1 a B4) :
 *  - B1 : un mot coupe par la syntaxe de poids (« na()ked », « (na)(ked) », « (na:9)(ked:7) ») est AUSSI lu recolle
 *    (`_sansSyntaxeCollee`) ; le lecteur de poids de l'encodeur SDXL (_sdxl_prompt_utils.py) ne recolle plus deux morceaux.
 *  - B2 : idiomes a fin libre (« Nudeln », « Nacktschnecke ») : seule la RACINE est retiree (`IDIOMES_RACINES`), un mot colle
 *    derriere reste lu.
 *  - B3 : points de code NON ASSIGNES en Unicode 14 effaces quelle que soit la version d'Unicode du moteur (`NON_ASSIGNES_U14`) :
 *    le worker (Node, Unicode 16) et Modal (Python 3.11, Unicode 14) lisent le meme texte.
 *  - B4 : refus a tort retires (calzone, viol, cria, mutando, despidio, infantry, nippers, first grade, paint stripper, Milford,
 *    golf foursome, pupils, erection of a tower, semen gudang, pelada de futebol, dragon menor, mochila escolar...).
 *
 * 2026-10-14 — SECONDE RELECTURE DU LOT :
 *  - AGE : « N ans / anos / anni / mois de X » n'est une duree que si X est dans la liste FERMEE `DUREES_NON_AGE` (guerre,
 *    service, experience...) ; « 10 ans de taille moyenne », « 12 anos de vida », « 10 anni di vita » sont des ages, quoi que
 *    precede le nombre. Avec un mineur ambigu NOMME (fille, girl, garota...) ou un indice, toute duree compte comme un age.
 *  - CHIFFRES COLLES : CLIP coupe entre lettres et chiffres (« 2child » -> 2 | child) ; vues supplementaires coupees (`separees`).
 *  - DOUBLE SENS : « cock » (coq) et « erection » (batiment) ne sont retires que dans une tournure ecrite telle quelle (« a cock
 *    and two hens », « the erection of the tower »), sans possessif ni « with » devant ; avec un mineur ou un age, sinon, lus.
 *  - « una escolar », « a first grade girl » : mineurs sans ambiguite ; maillots au pluriel ; references HTML, mojibake d'un
 *    caractere efface et U+FFFC lus comme ftfy les repare ; « the rape of a woman », « le viol d'une femme » au filtre general.
 *
 * 2026-10-14 — TROISIEME RELECTURE DU LOT (bloquants B1 a B3 ; critere : AUCUN recul par rapport a la production f86208c0) :
 *  - LECTURES (B1, B2) : le filtre ne recolle plus des mots que le tokenizer CLIP lit separes. La lecture principale efface les
 *    caracteres invisibles et les marques, change en lettres les lettres-emoji et les symboles NFKC (mots deguises) ; le texte est
 *    AUSSI lu ou ces caracteres separent les mots (`_lire` : lectures « separee », « clip », « ftfy », « production ») et les vues
 *    de toutes les lectures sont reunies : « a child<U+0489>in<U+0489>the<U+0489>bath », « a child&#8203;in&#8203;the&#8203;bath »,
 *    « a child™in™a™bikini » sont lus comme le modele les lit.
 *  - B3 : la garde des tournures de ferme et de chantier est lue sur les MOTS qui precedent (`_gardeExpression`, blancs et
 *    ponctuation compactes) : « his  <coq> », « his, <coq> », « his big <coq> », « with  the erection » ne la contournent plus.
 *  - Mineurs : durees ajoutees (« 10 ans de mer », « de croisade », « de retraite », « de legion », « d'aventures »...) ; « escolar »
 *    apres un determinant ou un adjectif (« una joven escolar », « mi escolar »), « a grade one girl », « a girl from first
 *    grade » ; la liste plate NSFW_KEYWORDS n'a plus les tournures que l'interface lit sans contexte (« a rape field » : colza).
 *
 * 2026-10-14 — QUATRIEME RELECTURE DU LOT (bloquants R1 a R5 ; meme critere : aucun recul par rapport a f86208c0) :
 *  - R1 : un chiffre qui suit l'age ne l'annule plus (« aged 12, 2 ponytails », « (aged:1.3) 12 ») : seul un groupe de TROIS
 *    chiffres suivi d'une unite (« aged 10 000 years ») fait un grand nombre (`GRANDS_NOMBRES`).
 *  - R2 : chiffres non ASCII entre les mots : separateurs dans les lectures « production » et « separee » (`_chiffresSepares`) ;
 *    la lecture « production » est de nouveau fidele a f86208c0 sur ce point.
 *  - R3 : la vue exacte (« nu », « nue », « nua »...) est assemblee comme les autres : lettres separees ou repetees, leet.
 *  - R4 : expressions sures balisees <mineur> (colza, « pelada », « bottle <nipples> »...) ignorees quand un mineur ou un age est
 *    lu ; R5 : balisees <personne> (decapant, mots sexuels) ignorees dans le filtre general quand une personne est nommee ; garde
 *    du coq durcie (determinant juste avant, aucun verbe ni adjectif de `GARDE_COQ`).
 *  - Racines de la production retablies : « infant* », « rape* », « spogliat* » (« infantry » et « rapeseed » a part).
 *
 * 2026-10-15 — CONTROLE EXHAUSTIF DE NON-RECUL (chaque terme et chaque racine des listes de la production, mot par mot du
 * vocabulaire CLIP ; chaque forme d'age que lit la production ; build/bancs/moderation/banc_non_recul.mjs --exhaustif) :
 *  - AGES : un nombre en lettres a double sens n'est ecarte qu'apres un prefixe ANGLAIS (`PREFIXES_AGE_ANGLAIS` x
 *    `NOMBRES_AMBIGUS` : « aged elf », « ages due », « age um », « Moyen Age, une », « an age once lost ») et sans unite de
 *    temps derriere ; « Alter elf », « edad once », « eta di tre », « idade um », « aged one », « age : un an » sont de nouveau
 *    des ages (la production les lisait).
 *  - TOURNURES DE FERME ET OUTILS : les expressions balisees <coq> et <personne> ne retirent plus leur mot quand le texte a un
 *    contexte sexuel, ou qu'il soit (`CONTEXTE_DESACTIVATION`, termes de contexte sexuel) : « a cock and two hens, a woman sucking
 *    it », « pussy cats, sexy », « paint stripper, sexy pole dance » (la garde ne lisait que les mots qui precedent).
 *  - RACINES de la production retablies : « stabb* » (« stabbings »), « seminu* » (« seminudismo ») ; « seminuovo » et « seminuevo »
 *    (semi-neuf) a part (`IDIOMES_RACINES`).
 *
 * 2026-10-18 / 20 — CINQUIEME RELECTURE DU LOT (bloquants B1 a B5 ; meme critere : AUCUN recul par rapport a f86208c0, pour tous les
 * comptes, `unrestricted` compris) :
 *  - B1 : la lecture « production » (`_nettoyerLecture`) mettait un ESPACE a la place des caracteres que la production laissait en
 *    place ; or pour la production tout caractere hors de [a-z0-9] et hors des blancs etait de la PONCTUATION, que `_joindrePonctue`
 *    employe pour relier les lettres epelees : « n.a<U+061C>k.e.d » y etait « naked ». Ils deviennent un signe « . » (caracteres
 *    effaces, lettres-emoji, marques hors U+0300-036F, chiffres non ASCII, lettres hors des tables de la production, symboles de la
 *    vue exacte).
 *  - B2 : la production recollait les jetons d'UN caractere, chiffres compris (« 9 y r old » -> « 9yr old ») ; le lot ne recolle que
 *    les lettres. Les vues recollees comme la production sont AJOUTEES (`separees`), les autres inchangees.
 *  - B3 : vue exacte (« nu », « nue »...) : une lettre non ASCII restante (autre ecriture) est un separateur, comme en production,
 *    et non plus un « x » : « enfant nu<U+0436> » reste refuse. Les lettres a marque distinctive restent « x » (nữ, nụ, ñu). Le filtre
 *    GENERAL lit en plus la vue exacte SANS translitteration (`exactesSouples`) : la production lisait « nu<U+00F8> » dans son texte
 *    non translittere (`souple`) ; le plancher, lui, ne lisait que les vues translitterees et ne change pas.
 *  - B4 : « torse nus » et « torses nu » (accords que IDIOMES_EXACTS retirait de la vue exacte) rejoignent NU_MOYEN.
 *  - B5 : un mot d'idiome retire laisse un JALON (« -- », un mot de deux signes) et non plus rien : « a snaked c h i l d naked »
 *    ne colle plus l'article « a » aux lettres epelees (`_simple`). Meme regle pour le mot retire d'une EXPRESSION SURE (« viol » de
 *    « play a viol », « bath » de « bath toys ») : un MARQUEUR (`_MARQUEUR_RETRAIT`) prend sa place avant la simplification.
 *  - Reciproquement, les expressions que la PRODUCTION retirait ENTIERES (`IDIOMES_PRODUCTION` : « bath toys », « baby shower »...)
 *    rapprochaient les mots voisins (« age bath toys 1 » = « age 1 ») : quand le texte en contient une, les vues sont AUSSI lues comme
 *    elle (`_simple(..., phrases = true)`), en plus des vues du lot (trouve par les mutations aleatoires des cas du banc).
 *  - La lecture « production » est une fonction a part (`_lectureProduction`) qui suit la normalisation de f86208c0 dans le meme ordre ;
 *    les caracteres que la production laissait en place y restent en place jusqu'aux minuscules (contexte du « Sigma » final).
 *  - Refus a tort : « 积极性交流 » (communication active), « 安全性交易 » (securite des transactions)... : le lexique lit « 性交 » en infixe
 *    sans segmentation ; ces SEULS mots entiers sont retires de la vue Unicode (`IDIOMES_UNICODE`) ; « 儿童性交易 » reste refuse.
 *
 * Le contrat de retour ne change pas : { safe, blocked?, reason? }. Deux
 * champs OPTIONNELS s'y ajoutent (IA-04) pour que l'appelant puisse compter
 * les blocages par compte : `categorie` et `hardFloor`.
 *
 * Le classifieur de texte IA (Falconsai) n'est PAS porte ; le filtrage de
 * l'image produite tourne cote Modal (`modal_app/_nsfw.py`).
 *
 * Bascule : variable `NSFW_FILTER_OFF` = "1" (developpement uniquement).
 *
 * MIROIR BUREAU : la logique est dupliquee dans src/main/main.js (bloc GENERE). Apres toute
 * modification ici : node build/miroir-moderation.mjs --sync ; la meme commande, sans argument,
 * est une garde de construction qui refuse la divergence.
 * MIROIR MODAL : les LISTES (tout `const X: string[] = [...]`) sont extraites par build/moderation_modal/gen_module.py vers
 * modal_app/_moderation_texte.py ; les fonctions y sont portees a la main dans le gabarit (meme ordre, memes regles) et
 * build/bancs/noyaux/test_moderation_modal.py compare les deux implementations sur des milliers de textes.
 */

// ── Categories de blocage (IA-04) ─────────────────────────────────────────
export type CategorieBlocage =
  | 'plancher'            // contenu illicite (mineurs) : jamais contournable
  | 'sexuel'              // nudite / sexe explicite
  | 'violence'            // gore explicite
  | 'drogue'
  | 'extremisme'          // terrorisme, haine organisee
  | 'haine'               // injures racistes
  | 'autoblessure'
  | 'armes'
  | 'mineur_violence'     // enfant + violence (filtre general)
  | 'combinaison'         // personne + nudite (filtre general)
  | 'contexte'            // terme ambigu declenche par son contexte
  | 'longueur';           // texte trop long pour etre envoye au generateur (MODERATION-07)

export interface PromptSafetyResult {
  safe: boolean;
  blocked?: string;
  reason?: string;
  /** IA-04 : famille du blocage, pour compter les blocages par compte. */
  categorie?: CategorieBlocage;
  /** Vrai pour le plancher illicite (parite avec le bureau). */
  hardFloor?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALISATION (constats IA-02, MODERATION-03, MODERATION-09)
// ═══════════════════════════════════════════════════════════════════════════

/** Toutes les marques combinantes (les vues latines ne gardent que des lettres de base). */
const _MARQUES = /\p{M}/gu;

// Points de code NON ASSIGNES en Unicode 14 (revue du 14/10, B3). Le Python de Modal (3.11) et le tokenizer CLIP qui y tourne
// connaissent Unicode 14 ; le moteur JavaScript du worker, une version plus recente (Node 22 : Unicode 16). Une lettre attribuee
// apres Unicode 14 (« na<U+1E030>ked ») etait GARDEE ici (et meme changee par NFKC en « а » cyrillique) mais EFFACEE par Modal,
// qui envoyait « naked » au generateur. Ces points de code sont effaces des deux cotes, AVANT NFKC, quelle que soit la version
// d'Unicode du moteur. Table GENEREE par build/moderation_modal/gen_non_assignes_u14.py (Python 3.11) : ne pas editer a la main.
const NON_ASSIGNES_U14: string[] = [
  '0378-0379', '0380-0383', '038B', '038D', '03A2', '0530', '0557-0558', '058B-058C', '0590', '05C8-05CF', '05EB-05EE',
  '05F5-05FF', '070E', '074B-074C', '07B2-07BF', '07FB-07FC', '082E-082F', '083F', '085C-085D', '085F', '086B-086F', '088F',
  '0892-0897', '0984', '098D-098E', '0991-0992', '09A9', '09B1', '09B3-09B5', '09BA-09BB', '09C5-09C6', '09C9-09CA',
  '09CF-09D6', '09D8-09DB', '09DE', '09E4-09E5', '09FF-0A00', '0A04', '0A0B-0A0E', '0A11-0A12', '0A29', '0A31', '0A34', '0A37',
  '0A3A-0A3B', '0A3D', '0A43-0A46', '0A49-0A4A', '0A4E-0A50', '0A52-0A58', '0A5D', '0A5F-0A65', '0A77-0A80', '0A84', '0A8E',
  '0A92', '0AA9', '0AB1', '0AB4', '0ABA-0ABB', '0AC6', '0ACA', '0ACE-0ACF', '0AD1-0ADF', '0AE4-0AE5', '0AF2-0AF8', '0B00',
  '0B04', '0B0D-0B0E', '0B11-0B12', '0B29', '0B31', '0B34', '0B3A-0B3B', '0B45-0B46', '0B49-0B4A', '0B4E-0B54', '0B58-0B5B',
  '0B5E', '0B64-0B65', '0B78-0B81', '0B84', '0B8B-0B8D', '0B91', '0B96-0B98', '0B9B', '0B9D', '0BA0-0BA2', '0BA5-0BA7',
  '0BAB-0BAD', '0BBA-0BBD', '0BC3-0BC5', '0BC9', '0BCE-0BCF', '0BD1-0BD6', '0BD8-0BE5', '0BFB-0BFF', '0C0D', '0C11', '0C29',
  '0C3A-0C3B', '0C45', '0C49', '0C4E-0C54', '0C57', '0C5B-0C5C', '0C5E-0C5F', '0C64-0C65', '0C70-0C76', '0C8D', '0C91', '0CA9',
  '0CB4', '0CBA-0CBB', '0CC5', '0CC9', '0CCE-0CD4', '0CD7-0CDC', '0CDF', '0CE4-0CE5', '0CF0', '0CF3-0CFF', '0D0D', '0D11',
  '0D45', '0D49', '0D50-0D53', '0D64-0D65', '0D80', '0D84', '0D97-0D99', '0DB2', '0DBC', '0DBE-0DBF', '0DC7-0DC9', '0DCB-0DCE',
  '0DD5', '0DD7', '0DE0-0DE5', '0DF0-0DF1', '0DF5-0E00', '0E3B-0E3E', '0E5C-0E80', '0E83', '0E85', '0E8B', '0EA4', '0EA6',
  '0EBE-0EBF', '0EC5', '0EC7', '0ECE-0ECF', '0EDA-0EDB', '0EE0-0EFF', '0F48', '0F6D-0F70', '0F98', '0FBD', '0FCD', '0FDB-0FFF',
  '10C6', '10C8-10CC', '10CE-10CF', '1249', '124E-124F', '1257', '1259', '125E-125F', '1289', '128E-128F', '12B1', '12B6-12B7',
  '12BF', '12C1', '12C6-12C7', '12D7', '1311', '1316-1317', '135B-135C', '137D-137F', '139A-139F', '13F6-13F7', '13FE-13FF',
  '169D-169F', '16F9-16FF', '1716-171E', '1737-173F', '1754-175F', '176D', '1771', '1774-177F', '17DE-17DF', '17EA-17EF',
  '17FA-17FF', '181A-181F', '1879-187F', '18AB-18AF', '18F6-18FF', '191F', '192C-192F', '193C-193F', '1941-1943', '196E-196F',
  '1975-197F', '19AC-19AF', '19CA-19CF', '19DB-19DD', '1A1C-1A1D', '1A5F', '1A7D-1A7E', '1A8A-1A8F', '1A9A-1A9F', '1AAE-1AAF',
  '1ACF-1AFF', '1B4D-1B4F', '1B7F', '1BF4-1BFB', '1C38-1C3A', '1C4A-1C4C', '1C89-1C8F', '1CBB-1CBC', '1CC8-1CCF', '1CFB-1CFF',
  '1F16-1F17', '1F1E-1F1F', '1F46-1F47', '1F4E-1F4F', '1F58', '1F5A', '1F5C', '1F5E', '1F7E-1F7F', '1FB5', '1FC5', '1FD4-1FD5',
  '1FDC', '1FF0-1FF1', '1FF5', '1FFF', '2065', '2072-2073', '208F', '209D-209F', '20C1-20CF', '20F1-20FF', '218C-218F',
  '2427-243F', '244B-245F', '2B74-2B75', '2B96', '2CF4-2CF8', '2D26', '2D28-2D2C', '2D2E-2D2F', '2D68-2D6E', '2D71-2D7E',
  '2D97-2D9F', '2DA7', '2DAF', '2DB7', '2DBF', '2DC7', '2DCF', '2DD7', '2DDF', '2E5E-2E7F', '2E9A', '2EF4-2EFF', '2FD6-2FEF',
  '2FFC-2FFF', '3040', '3097-3098', '3100-3104', '3130', '318F', '31E4-31EF', '321F', 'A48D-A48F', 'A4C7-A4CF', 'A62C-A63F',
  'A6F8-A6FF', 'A7CB-A7CF', 'A7D2', 'A7D4', 'A7DA-A7F1', 'A82D-A82F', 'A83A-A83F', 'A878-A87F', 'A8C6-A8CD', 'A8DA-A8DF',
  'A954-A95E', 'A97D-A97F', 'A9CE', 'A9DA-A9DD', 'A9FF', 'AA37-AA3F', 'AA4E-AA4F', 'AA5A-AA5B', 'AAC3-AADA', 'AAF7-AB00',
  'AB07-AB08', 'AB0F-AB10', 'AB17-AB1F', 'AB27', 'AB2F', 'AB6C-AB6F', 'ABEE-ABEF', 'ABFA-ABFF', 'D7A4-D7AF', 'D7C7-D7CA',
  'D7FC-D7FF', 'FA6E-FA6F', 'FADA-FAFF', 'FB07-FB12', 'FB18-FB1C', 'FB37', 'FB3D', 'FB3F', 'FB42', 'FB45', 'FBC3-FBD2',
  'FD90-FD91', 'FDC8-FDCE', 'FDD0-FDEF', 'FE1A-FE1F', 'FE53', 'FE67', 'FE6C-FE6F', 'FE75', 'FEFD-FEFE', 'FF00', 'FFBF-FFC1',
  'FFC8-FFC9', 'FFD0-FFD1', 'FFD8-FFD9', 'FFDD-FFDF', 'FFE7', 'FFEF-FFF8', 'FFFE-FFFF', '1000C', '10027', '1003B', '1003E',
  '1004E-1004F', '1005E-1007F', '100FB-100FF', '10103-10106', '10134-10136', '1018F', '1019D-1019F', '101A1-101CF',
  '101FE-1027F', '1029D-1029F', '102D1-102DF', '102FC-102FF', '10324-1032C', '1034B-1034F', '1037B-1037F', '1039E',
  '103C4-103C7', '103D6-103FF', '1049E-1049F', '104AA-104AF', '104D4-104D7', '104FC-104FF', '10528-1052F', '10564-1056E',
  '1057B', '1058B', '10593', '10596', '105A2', '105B2', '105BA', '105BD-105FF', '10737-1073F', '10756-1075F', '10768-1077F',
  '10786', '107B1', '107BB-107FF', '10806-10807', '10809', '10836', '10839-1083B', '1083D-1083E', '10856', '1089F-108A6',
  '108B0-108DF', '108F3', '108F6-108FA', '1091C-1091E', '1093A-1093E', '10940-1097F', '109B8-109BB', '109D0-109D1', '10A04',
  '10A07-10A0B', '10A14', '10A18', '10A36-10A37', '10A3B-10A3E', '10A49-10A4F', '10A59-10A5F', '10AA0-10ABF', '10AE7-10AEA',
  '10AF7-10AFF', '10B36-10B38', '10B56-10B57', '10B73-10B77', '10B92-10B98', '10B9D-10BA8', '10BB0-10BFF', '10C49-10C7F',
  '10CB3-10CBF', '10CF3-10CF9', '10D28-10D2F', '10D3A-10E5F', '10E7F', '10EAA', '10EAE-10EAF', '10EB2-10EFF', '10F28-10F2F',
  '10F5A-10F6F', '10F8A-10FAF', '10FCC-10FDF', '10FF7-10FFF', '1104E-11051', '11076-1107E', '110C3-110CC', '110CE-110CF',
  '110E9-110EF', '110FA-110FF', '11135', '11148-1114F', '11177-1117F', '111E0', '111F5-111FF', '11212', '1123F-1127F', '11287',
  '11289', '1128E', '1129E', '112AA-112AF', '112EB-112EF', '112FA-112FF', '11304', '1130D-1130E', '11311-11312', '11329',
  '11331', '11334', '1133A', '11345-11346', '11349-1134A', '1134E-1134F', '11351-11356', '11358-1135C', '11364-11365',
  '1136D-1136F', '11375-113FF', '1145C', '11462-1147F', '114C8-114CF', '114DA-1157F', '115B6-115B7', '115DE-115FF',
  '11645-1164F', '1165A-1165F', '1166D-1167F', '116BA-116BF', '116CA-116FF', '1171B-1171C', '1172C-1172F', '11747-117FF',
  '1183C-1189F', '118F3-118FE', '11907-11908', '1190A-1190B', '11914', '11917', '11936', '11939-1193A', '11947-1194F',
  '1195A-1199F', '119A8-119A9', '119D8-119D9', '119E5-119FF', '11A48-11A4F', '11AA3-11AAF', '11AF9-11BFF', '11C09', '11C37',
  '11C46-11C4F', '11C6D-11C6F', '11C90-11C91', '11CA8', '11CB7-11CFF', '11D07', '11D0A', '11D37-11D39', '11D3B', '11D3E',
  '11D48-11D4F', '11D5A-11D5F', '11D66', '11D69', '11D8F', '11D92', '11D99-11D9F', '11DAA-11EDF', '11EF9-11FAF', '11FB1-11FBF',
  '11FF2-11FFE', '1239A-123FF', '1246F', '12475-1247F', '12544-12F8F', '12FF3-12FFF', '1342F', '13439-143FF', '14647-167FF',
  '16A39-16A3F', '16A5F', '16A6A-16A6D', '16ABF', '16ACA-16ACF', '16AEE-16AEF', '16AF6-16AFF', '16B46-16B4F', '16B5A', '16B62',
  '16B78-16B7C', '16B90-16E3F', '16E9B-16EFF', '16F4B-16F4E', '16F88-16F8E', '16FA0-16FDF', '16FE5-16FEF', '16FF2-16FFF',
  '187F8-187FF', '18CD6-18CFF', '18D09-1AFEF', '1AFF4', '1AFFC', '1AFFF', '1B123-1B14F', '1B153-1B163', '1B168-1B16F',
  '1B2FC-1BBFF', '1BC6B-1BC6F', '1BC7D-1BC7F', '1BC89-1BC8F', '1BC9A-1BC9B', '1BCA4-1CEFF', '1CF2E-1CF2F', '1CF47-1CF4F',
  '1CFC4-1CFFF', '1D0F6-1D0FF', '1D127-1D128', '1D1EB-1D1FF', '1D246-1D2DF', '1D2F4-1D2FF', '1D357-1D35F', '1D379-1D3FF',
  '1D455', '1D49D', '1D4A0-1D4A1', '1D4A3-1D4A4', '1D4A7-1D4A8', '1D4AD', '1D4BA', '1D4BC', '1D4C4', '1D506', '1D50B-1D50C',
  '1D515', '1D51D', '1D53A', '1D53F', '1D545', '1D547-1D549', '1D551', '1D6A6-1D6A7', '1D7CC-1D7CD', '1DA8C-1DA9A', '1DAA0',
  '1DAB0-1DEFF', '1DF1F-1DFFF', '1E007', '1E019-1E01A', '1E022', '1E025', '1E02B-1E0FF', '1E12D-1E12F', '1E13E-1E13F',
  '1E14A-1E14D', '1E150-1E28F', '1E2AF-1E2BF', '1E2FA-1E2FE', '1E300-1E7DF', '1E7E7', '1E7EC', '1E7EF', '1E7FF', '1E8C5-1E8C6',
  '1E8D7-1E8FF', '1E94C-1E94F', '1E95A-1E95D', '1E960-1EC70', '1ECB5-1ED00', '1ED3E-1EDFF', '1EE04', '1EE20', '1EE23',
  '1EE25-1EE26', '1EE28', '1EE33', '1EE38', '1EE3A', '1EE3C-1EE41', '1EE43-1EE46', '1EE48', '1EE4A', '1EE4C', '1EE50', '1EE53',
  '1EE55-1EE56', '1EE58', '1EE5A', '1EE5C', '1EE5E', '1EE60', '1EE63', '1EE65-1EE66', '1EE6B', '1EE73', '1EE78', '1EE7D',
  '1EE7F', '1EE8A', '1EE9C-1EEA0', '1EEA4', '1EEAA', '1EEBC-1EEEF', '1EEF2-1EFFF', '1F02C-1F02F', '1F094-1F09F', '1F0AF-1F0B0',
  '1F0C0', '1F0D0', '1F0F6-1F0FF', '1F1AE-1F1E5', '1F203-1F20F', '1F23C-1F23F', '1F249-1F24F', '1F252-1F25F', '1F266-1F2FF',
  '1F6D8-1F6DC', '1F6ED-1F6EF', '1F6FD-1F6FF', '1F774-1F77F', '1F7D9-1F7DF', '1F7EC-1F7EF', '1F7F1-1F7FF', '1F80C-1F80F',
  '1F848-1F84F', '1F85A-1F85F', '1F888-1F88F', '1F8AE-1F8AF', '1F8B2-1F8FF', '1FA54-1FA5F', '1FA6E-1FA6F', '1FA75-1FA77',
  '1FA7D-1FA7F', '1FA87-1FA8F', '1FAAD-1FAAF', '1FABB-1FABF', '1FAC6-1FACF', '1FADA-1FADF', '1FAE8-1FAEF', '1FAF7-1FAFF',
  '1FB93', '1FBCB-1FBEF', '1FBFA-1FFFF', '2A6E0-2A6FF', '2B739-2B73F', '2B81E-2B81F', '2CEA2-2CEAF', '2EBE1-2F7FF',
  '2FA1E-2FFFF', '3134B-E0000', 'E0002-E001F', 'E0080-E00FF', 'E01F0-EFFFF', 'FFFFE-FFFFF', '10FFFE-10FFFF',
];
const _PLAGES_U14 = NON_ASSIGNES_U14.map((p) => p.split('-').map((h) => '\\u{' + h + '}').join('-')).join('');
const _NON_ASSIGNES_U14 = new RegExp('[' + _PLAGES_U14 + ']', 'gu');
/** Caracteres EFFACES (pas remplaces par un espace) : le tokenizer CLIP les supprime lui aussi (categorie C : controle, format,
 *  usage prive, non assigne, demi-substitut ; U+FFFD ; U+FFFC, que ftfy retire avant le tokenizer : 2026-10-14), plus les
 *  « ignorables » qui ne sont pas de categorie C (remplisseurs
 *  hangul, voyelles inherentes khmeres, braille vide), et les points de code non assignes en Unicode 14 (ci-dessus).
 *  \t \n \r sont d'abord changes en espaces. */
const _EFFACES = new RegExp('[\\p{C}\\ufffc\\ufffd\\u115f\\u1160\\u17b4\\u17b5\\u2800\\u3164\\uffa0' + _PLAGES_U14 + ']', 'gu');
/** Marques GARDEES par la vue Unicode : elles portent le sens dans ces ecritures (voyelles et viramas indiens, thai, lao,
 *  tibetain, birman, khmer ; voisement des kana). Les autres (accents latins, harakat arabes, points hebreux, marques
 *  cyrilliques) sont retirees, des deux cotes : texte et lexique. */
const _MARQUES_GARDEES = /[\u0900-\u0dff\u0e00-\u0fff\u1000-\u109f\u1780-\u17ff\u3099\u309a]/u;

// Chiffres decimaux Unicode (categorie Nd) : premier point de code (le zero) de chaque serie de dix. Table FIXE (Unicode 14,
// celle du Python de Modal), identique cote Python : les deux implementations convertissent les memes chiffres. ASCII et
// pleine largeur / mathematiques sont deja traites par NFKC.
const ZEROS_CHIFFRES: string[] = [
  '0660', '06F0', '07C0', '0966', '09E6', '0A66', '0AE6', '0B66', '0BE6', '0C66', '0CE6', '0D66', '0DE6', '0E50', '0ED0',
  '0F20', '1040', '1090', '17E0', '1810', '1946', '19D0', '1A80', '1A90', '1B50', '1BB0', '1C40', '1C50', 'A620', 'A8D0',
  'A900', 'A9D0', 'A9F0', 'AA50', 'ABF0', 'FF10', '104A0', '10D30', '11066', '110F0', '11136', '111D0', '112F0', '11450',
  '114D0', '11650', '116C0', '11730', '118E0', '11950', '11C50', '11D50', '11DA0', '16A60', '16AC0', '16B50', '1D7CE',
  '1D7D8', '1D7E2', '1D7EC', '1D7F6', '1E140', '1E2F0', '1E950', '1FBF0',
];
const _ZEROS = ZEROS_CHIFFRES.map((h) => parseInt(h, 16));

/** « age of ١٠ » -> « age of 10 » : tout chiffre decimal de la table devient le chiffre ASCII de meme valeur. */
function _chiffresAscii(s: string): string {
  return s.replace(/[^\x00-\x7f]/gu, (c) => {
    const cp = c.codePointAt(0) as number;
    for (const z of _ZEROS) if (cp >= z && cp <= z + 9) return String(cp - z);
    return c;
  });
}

/** Chiffres decimaux de la table (hors ASCII) -> `rempl` : un espace pour la lecture « separee » (quatrieme relecture, R2) ; un
 *  signe de PONCTUATION (« . ») pour la lecture « production » (cinquieme relecture, B1) : la production les laissait en place, et
 *  pour `_joindrePonctue` un chiffre non ASCII relie les lettres epelees (« n.a<U+0667>k.e.d »), un espace non. */
function _chiffresSepares(s: string, rempl = ' '): string {
  return s.replace(/[^\x00-\x7f]/gu, (c) => {
    const cp = c.codePointAt(0) as number;
    for (const z of _ZEROS) if (cp >= z && cp <= z + 9) return rempl;
    return c;
  });
}

// CE QUE ftfy REPARE AVANT LE TOKENIZER CLIP (2026-10-14, seconde relecture du lot). Avec ftfy (le tokenizer CLIP l'emploie s'il
// est installe), « &#110;aked », « ＆#110;aked », « &amp;#110;aked » deviennent le mot entier, et un caractere efface ecrit en
// MOJIBAKE (ses octets UTF-8 lus en Windows-1252 : « naï»¿ked » pour U+FEFF) est repare puis retire. Le filtre lit donc le
// texte comme ftfy : references numeriques decodees (et « &amp; », « &num; »), sequences ci-dessous effacees. Ce sont les
// formes Windows-1252 des caracteres que ftfy retire (U+FEFF, U+FFF9 a U+FFFC, U+206A a U+206F), et U+FFFD.
const MOJIBAKE_EFFACES: string[] = ['\u00ef\u00bb\u00bf', '\u00ef\u00bf\u00b9', '\u00ef\u00bf\u00ba', '\u00ef\u00bf\u00bb',
  '\u00ef\u00bf\u00bc', '\u00ef\u00bf\u00bd', '\u00e2\u0081\u00aa', '\u00e2\u0081\u00ab', '\u00e2\u0081\u00ac', '\u00e2\u0081\u00ad',
  '\u00e2\u0081\u00ae', '\u00e2\u0081\u00af'];
const _RE_MOJIBAKE = new RegExp(MOJIBAKE_EFFACES.join('|'), 'g');
const _RE_REF_HTML = /&(?:#(?:x([0-9a-f]+)|([0-9]+));?|(amp|num);?)/gi;

/** « &#110; » -> « n », « &#x6e; » -> « n », « &amp; » -> « & », « &num; » -> « # » ; un numero hors d'Unicode -> U+FFFD. */
function _sansReferencesHtml(s: string): string {
  let r = s;
  for (let passe = 0; passe < 3 && r.includes('&'); passe++) {
    const suivant = r.replace(_RE_REF_HTML, (_m: string, hexa?: string, dec?: string, nom?: string) => {
      if (nom) return nom.toLowerCase() === 'amp' ? '&' : (nom.toLowerCase() === 'num' ? '#' : _m);
      const chiffres = (hexa ?? dec ?? '').replace(/^0+/, '');
      const n = chiffres.length > 7 ? -1 : (chiffres === '' ? 0 : parseInt(chiffres, hexa !== undefined ? 16 : 10));
      return n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '\ufffd' : String.fromCodePoint(n);
    });
    if (suivant === r) break;
    r = suivant;
  }
  return r;
}

/** \t \n \r -> espace, puis effacement (categorie C, ignorables, non assignes en Unicode 14). */
function _effacer(s: string): string { return s.replace(/[\t\n\r]/g, ' ').replace(_EFFACES, ''); }

/** Mojibake d'un caractere efface retire (sur la forme NFC). */
function _sansMojibake(s: string): string {
  if (!/[\u00e2\u00ef\u0302\u0308]/.test(s)) return s;
  let r = s;
  try { r = r.normalize('NFC'); } catch { /* garde */ }
  return r.replace(_RE_MOJIBAKE, '');
}

/** Etape commune a toutes les vues. Points de code non assignes en Unicode 14 effaces AVANT NFKC (sinon un moteur plus recent
 *  les decompose, ex. U+1E030 -> « а »), comme les autres caracteres effaces (le tokenizer CLIP les retire avant de normaliser) ;
 *  mojibake d'un caractere efface retire (sur la forme NFC, avant ET apres l'effacement : U+0081 fait partie de certaines formes,
 *  et un caractere de controle peut etre glisse au milieu) ; NFKC ; references HTML decodees (puis NFKC) ; chiffres en ASCII ;
 *  minuscules. L'effacement est refait apres chaque reparation (ftfy repete les siennes jusqu'a ce que le texte ne change plus :
 *  « &<U+0001>#110; » devient « &#110; », puis « n ») ; pas apres NFKC, qui ne produit aucun caractere efface. */
function _nettoyer(texte: unknown): string {
  const brut = typeof texte === 'string' ? texte : String(texte == null ? '' : texte);
  let s = _effacer(_sansMojibake(brut.replace(_NON_ASSIGNES_U14, '')));
  s = _effacer(_sansMojibake(s));
  try { s = s.normalize('NFKC'); } catch { /* chaine exotique : on garde telle quelle */ }
  if (s.includes('&')) {
    s = _sansReferencesHtml(s).replace(_NON_ASSIGNES_U14, '');
    try { s = s.normalize('NFKC'); } catch { /* garde */ }
    s = _effacer(s);
  }
  return _chiffresAscii(s).toLowerCase();
}

/** NFD puis retrait de TOUTES les marques combinantes (accents latins, mais aussi U+1DC0, U+20D1, U+FE20, U+064B...). */
function _sansMarques(net: string): string {
  let s = net;
  try { s = s.normalize('NFD'); } catch { /* idem */ }
  return s.replace(_MARQUES, '');
}

/** NFKC + effacement + marques retirees + minuscules (SANS translitteration). */
function _base(texte: unknown): string {
  return _sansMarques(_nettoyer(texte));
}

// Lettres latines sans decomposition Unicode (et, 2026-10-13, lettres barrees et petites capitales : MODERATION-09).
const _LATIN_SPECIAUX: Record<string, string> = {
  '\u00df': 'ss', '\u00f8': 'o', '\u00e6': 'ae', '\u0153': 'oe', '\u0111': 'd',
  '\u0142': 'l', '\u0131': 'i', '\u0251': 'a', '\u0261': 'g',
  // lettres barrees
  '\u0127': 'h', '\u0167': 't', '\u0138': 'k', '\u0180': 'b', '\u0268': 'i', '\u0289': 'u', '\u024d': 'r', '\u024f': 'y',
  '\u01b6': 'z', '\u01e5': 'g', '\u0249': 'j', '\u0237': 'j',
  // petites capitales
  '\u1d00': 'a', '\u0299': 'b', '\u1d04': 'c', '\u1d05': 'd', '\u1d07': 'e', '\ua730': 'f', '\u0262': 'g', '\u029c': 'h',
  '\u026a': 'i', '\u1d0a': 'j', '\u1d0b': 'k', '\u029f': 'l', '\u1d0d': 'm', '\u0274': 'n', '\u1d0f': 'o', '\u1d18': 'p',
  '\u0280': 'r', '\ua731': 's', '\u1d1b': 't', '\u1d1c': 'u', '\u1d20': 'v', '\u1d21': 'w', '\u028f': 'y', '\u1d22': 'z',
};

// Lettres cyrilliques / grecques / armeniennes qui ressemblent a une lettre latine.
const _HOMOGLYPHES: Record<string, string> = {
  // cyrillique
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u043a': 'k', '\u043c': 'm',
  '\u043d': 'h', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0442': 't',
  '\u0443': 'y', '\u0445': 'x', '\u0455': 's', '\u0456': 'i', '\u0458': 'j',
  '\u0501': 'd', '\u04bb': 'h', '\u051b': 'q', '\u051d': 'w', '\u04cf': 'l',
  '\u043f': 'n', '\u0433': 'r', '\u04af': 'y',
  // grec
  '\u03b1': 'a', '\u03b2': 'b', '\u03b3': 'y', '\u03b5': 'e', '\u03b7': 'n',
  '\u03b9': 'i', '\u03ba': 'k', '\u03bc': 'u', '\u03bd': 'v', '\u03bf': 'o',
  '\u03c1': 'p', '\u03c2': 's', '\u03c4': 't', '\u03c5': 'u', '\u03c7': 'x',
  '\u03c9': 'w',
  // armenien (2026-10-13)
  '\u0585': 'o', '\u057d': 'u', '\u0578': 'n', '\u0570': 'h', '\u0581': 'g', '\u0566': 'q', '\u0561': 'w',
};

/** Lettres-emoji : indicateurs regionaux, lettres carrees et cerclees NEGATIVES (sans decomposition NFKC). */
function _lettreSymbole(cp: number): string | undefined {
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return String.fromCharCode(97 + cp - 0x1f1e6);
  if (cp >= 0x1f170 && cp <= 0x1f189) return String.fromCharCode(97 + cp - 0x1f170);
  if (cp >= 0x1f150 && cp <= 0x1f169) return String.fromCharCode(97 + cp - 0x1f150);
  return undefined;
}

const _LEET: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

// Mots isoles qui contiennent un terme du filtre sans en etre un (retires du texte simplifie). Fragments d'expression reguliere
// SANS barre oblique inverse (les listes sont extraites telles quelles pour le port Python). 2026-10-13 : chaque ajout a ete
// verifie sur le tokenizer CLIP, qui ne lit pas le terme dans le mot (« nudeln » -> nu|del|n, « snaked » -> sn|aked,
// « pornic » -> por|nic, « nacktschnecke » -> n|ack|t|sch...).
// 2026-10-14 (quatrieme relecture) : « infant* », « rape* » et « spogliat* » redeviennent des RACINES, comme en production (le leet
// « 1nf4n711 », « rapeds » passaient) ; « infantry » est retire ici, « rapeseed » par une expression sure balisee <mineur>.
const IDIOMES: string[] = ['snaked', 'pornic', 'nacktkatzen?', 'infantr(?:y|ies|yman|ymen)', 'infanter(?:ia|ias|ie|ist|isten)', 'infantaria'];
const _IDIOMES = new RegExp('(?:^| )(?:' + IDIOMES.join('|') + ')(?= |$)', 'g');
// Expressions que la PRODUCTION (f86208c0) retirait ENTIERES du texte simplifie (son `_IDIOMES`). Le lot ne retire plus que le mot
// sensible (EXPRESSIONS_SURES : « bath toys » garde « toys ») ; mais la production RAPPROCHAIT ainsi les mots voisins (« age bath toys 1 »
// = « age 1 », « k baby shower idporn » = « kidporn »). Quand le texte en contient une, les vues sont AUSSI lues comme elle le faisait
// (cinquieme relecture, controle des mutations du banc) : `_simple(..., phrases = true)`.
const IDIOMES_PRODUCTION: string[] = ['baby shower', 'bridal shower', 'meteor shower', 'shower of', 'chinks? in', 'bath toys?', 'suicide squad',
  'snuff box(?:es)?', 'snuff bottles?', 'bikini atoll', 'bikini bottom', 'nu metal', 'anal retentive'];
const _IDIOMES_PRODUCTION = new RegExp('(?:^| )(?:' + IDIOMES_PRODUCTION.join('|') + ')(?= |$)', 'g');
const _RE_IDIOMES_PRODUCTION = new RegExp('(?:^| )(?:' + IDIOMES_PRODUCTION.join('|') + ')(?= |$)');
/** Indice rapide (un mot de ces expressions) : evite de simplifier le texte quand il n'en contient aucune. */
const _RE_INDICE_PHRASES = /shower|bath|chink|suicide|snuff|bikini|metal|anal/;
// RACINES d'idiomes suivies d'une fin de mot quelconque (« Nudeln », « Nudelholz », « Nacktschnecken », « spogliatoio ») : SEULE
// la racine est retiree, la fin reste un mot lu (revue du 14/10, B2). Avant, « nudel[a-z]* » effacait le jeton entier, mot colle
// derriere compris : « nudel+<nudite> » passait le plancher, alors que CLIP le decoupe « nu del <nudite> » et lit le mot colle.
// 2026-10-14 (troisieme relecture) : « nudel » seulement devant une fin allemande connue (ou seul) : « nude » colle a un mot en « l »
// (« <nude>littlegirl », « <nude>loli ») commence aussi par « nudel », et la racine retiree emportait la nudite (la production le
// refusait). Une fin inconnue garde le mot entier, lu par les termes « *nude* ».
const IDIOMES_RACINES: string[] = [
  'nudel(?=(?:n|holz|holzer|suppe|suppen|salat|salate|teig|auflauf|gericht|gerichte|maschine|walker|sieb|topf|topfe|toepfe|nest|nester|pfanne|pfannen|brett|platte|sorte|sorten|wasser|form|formen|bar|laden|rezept|rezepte|chen)?(?![a-z]))',
  'nacktschneck', 'nacktmull', 'nacktsamer', 'nackthund', 'naaktslak', 'spogliatoi',
  // 2026-10-15 : « seminu* » redevient une racine (comme en production) ; « seminuovo » (it) et « seminuevo » (es) = semi-neuf
  'seminuov', 'seminuev'];
// La fin du mot est CAPTUREE (groupe 1) : `_simple` la remet entre deux jalons, pour qu'une fin d'une seule lettre (« o » de
// « spogliatoio », « n » de « nudeln ») ne se recolle pas aux lettres isolees voisines.
const _IDIOMES_RACINES = new RegExp('(?:^| )(?:' + IDIOMES_RACINES.join('|') + ')([a-z]*)(?= |$)', 'g');

// EXPRESSIONS SURES : expressions courantes qui contiennent un terme du filtre sans en etre un. 2026-10-13 : le mot marque « ! »
// est le SEUL retire, les autres restent lus (« naked baby shower » garde « baby » : avant, l'expression entiere disparaissait et
// le plancher ne voyait plus de mineur ; « a kid with a knife and fork » garde « kid ») ; et l'expression n'est reconnue
// qu'ECRITE TELLE QUELLE (mots separes par des espaces, tirets ou soulignes) : dans « a baby, shower » ou « fillette, pieds, nus »
// la ponctuation n'est plus effacee avant la recherche, chaque mot reste lu. Sans groupe capturant dans les fragments.
const EXPRESSIONS_SURES: string[] = [
  'baby !shower', 'bridal !shower', 'meteor !shower',
  '!showers? of (?:arrows?|sparks?|rain|meteors?|stars?|petals?|flowers?|coins?|gold|confetti|bullets?|debris|rocks?|stones?|fire|embers?|light|glass|leaves|snow|ice|ash|ashes|hail|gifts?)',
  '!chinks? in', '!chinks? of light', '!bath toys?', '!suicide squad', '!snuff box(?:es)?', '!snuff bottles?', '!bikini atoll',
  '!bikini bottom', '!nu metal', '!anal retentive',
  // 2026-10-13 (MODERATION-05) : vocabulaire de jeu et objets
  '!hit points?', '!hit box(?:es)?', 'critical !hits?', '!scream masks?', '!attack (?:pose|poses|animation|animations|stance|move|moves)',
  'toy !(?:guns?|swords?|knife|knives|weapons?|bows?)', 'water !guns?', 'nerf !guns?', 'squirt !guns?', 'cap !guns?',
  '!bedroom (?:furniture|set|sets|decor|decoration|lamp|wallpaper|interior|design)', '!suicide doors?', '!opium popp(?:y|ies)',
  '!gore tex', 'counter !terrorists?', 'counter !terrorism', 'anti !terrorists?', '!(?:knife|knives) and forks?', 'bunk !beds?',
  'hospital !beds?',
  // mot retire SEXUEL que la production lisait (quatrieme relecture du 14/10) : balises <mineur> (pas avec un mineur ou un age :
  // « a 9 year old, bottle <nipples> » etait refuse au plancher par la production) et <personne> (pas dans le filtre general avec
  // une personne nommee : « a woman licking <pussy> cats ») ; seulement la ou la production lisait le mot (« sperm », « spanking »
  // n'etaient dans aucune de ses listes)
  '!spanking new', '!sperm whales?', '<mineur><personne> bottle !nipples?',
  '<mineur><personne> !pussy cats?', '<mineur><personne> !pussy willows?', '<personne> moby !dick',
  '<personne> !dick whittington', '<personne> !anal fins?', '<mineur><personne> !cum laude',
  '<personne> wild !ass(?:es)?', '<mineur><personne> !senos? paranasal[a-z]*', '<mineur> !rapeseeds?',
  // francais, portugais, italien : « nu » au sens de « a decouvert », sans personne denudee (« pieds nus », « tete nue »)
  'pieds? !nu(?:e|s|es)?', '!nus? pieds?', 'mains? !nues?', 'tetes? !nues?', 'oeil !nu', 'bras !nus?', 'jambes? !nues?',
  'arbres? !nus?', 'branches? !nues?', 'murs? !nus?', 'sols? !nus?', 'lames? !nues?', 'epees? !nues?', 'fils? !nus?', 'cables? !nus?',
  '!culottes? courtes?', 'ciels? !nus?', 'pieces? !nues?', 'paredes? !nuas?', 'stanz[ae] !nud[ae]', 'mur[io] !nud[oi]',
  'paret[ei] !nud[ae]',
  // 2026-10-14 (revue, B4) : decapant, pupilles de l'oeil, Asie Mineure, ciment (indonesien), « pelada » (football, portugais)
  // decapant, outil (quatrieme relecture du 14/10, R5) : « floor stripper », « wallpaper stripper » retires (aussi un metier) ; balise
  // <personne> : pas dans le filtre general quand une personne ou un mineur est nomme (« a woman with paint stripper »)
  '<personne> (?:paint|varnish|wire) !strippers?',
  // seulement des mots qui designent l'oeil (« small pupils », « black pupils » peuvent etre des eleves : « pupils » y reste lu)
  '(?:blank|dilated|slit|vertical|glowing|red|golden|gold|green|blue|empty|cat|catlike|feline|reptilian|snake|goat|pinpoint|eye|eyes) !pupils?',
  '!pupils? of (?:the|his|her|its|their|an|a) eyes?', '!pupils? of eyes?', '!pupils? dilat(?:ed|ing|ion|es|e)', '!pupil dilation',
  // « menor » adjectif (« dragon menor » = dragon inferieur, « Osa Menor ») : pas apres « menor de edad / idade / 18 », qui reste
  // un mineur ; « hermano menor », « hija menor » (cadet) ne sont pas dans la liste et restent lus
  '(?:asia|osa|ursa|dragon|dragones|dragao|dragoes|demonio|demonios|dios|dioses|deus|deuses|deidad|deidades|golem|golems|elemental|elementales|espiritu|espiritus|espirito|espiritos|pocion|pociones|pocao|pocoes|hechizo|hechizos|feitico|feiticos|reliquia|reliquias|artefacto|artefactos|artefato|artefatos|bestia|bestias|monstruo|monstruos|monstro|monstros|jefe|jefes|chefe|chefes|enemigo|enemigos|inimigo|inimigos|arcano|arcanos|nivel|niveles|rango|rangos|grado|grados|clase|clases|calidad|nobleza|orden|liga|ligas|escala|tono|acorde|tercera|septima|sexta) !menor(?:es)?(?![^a-z0-9]+de[^a-z0-9]+(?:edad|idade|18))',
  // « escolar » adjectif apres un objet ou un lieu (« mochila escolar », « autobus escolar ») ; « uniforme escolar » reste lu
  '(?:mochila|mochilas|bolsa|bolsas|material|materiales|materiais|util|utiles|libro|libros|livro|livros|autobus|autobuses|bus|buses|onibus|transporte|transportes|edificio|edificios|predio|predios|patio|patios|comedor|comedores|refeitorio|refeitorios|bano|banos|banheiro|banheiros|aula|aulas|sala|salas|ano|anos|curso|cursos|calendario|calendarios|mesa|mesas|pupitre|pupitres|cuaderno|cuadernos|caderno|cadernos|biblioteca|bibliotecas|gimnasio|gimnasios|quadra|quadras|estuche|estuches|estojo|estojos|excursion|excursiones|sistema|sistemas|centro|centros|mapa|mapas|globo|globos) !escolar(?:es)?',
  // instrument (« a young bard playing a viol », « viol da gamba ») ; « un viol » (francais) reste lu
  '(?:play|plays|playing|played) (?:a|the|his|her|their|its) !viols?',
  '(?:bass|treble|tenor|alto|renaissance|baroque|antique|wooden) !viols?', '!viols? (?:da|de) gambas?',
  '!viols? (?:player|players|bow|bows|consort|consorts|strings|case|cases|music|instrument|instruments|maker|makers)',
  // portugais « cria » = cree (imperatif) devant un article ou un pronom (« cria um guerreiro ») ; l'espagnol « una cria » (une
  // gamine, un petit) reste un mineur ambigu
  '!cria (?:um|uma|uns|umas|o|os|as|me|nos|isto|isso|outro|outra)',
  // golf, bridge (« golf foursome trophy »)
  '(?:golf|golfing|golfers?|mixed|bridge|tennis) !foursomes?', '!foursomes? of (?:golfers|players|knights|heroes|adventurers|friends)',
  // « erection » d'un batiment : seulement « the erection of <ouvrage> » ecrit tel quel (2026-10-14, seconde relecture : « a little
  // boy with an erection of the tower », « with the erection of the frame », « 9 year old kid, erection of stone » retiraient le mot
  // malgre le mineur). Garde <chantier> (troisieme relecture, B3) : pas de « with / has / showing / his / her » parmi les deux MOTS
  // qui precedent, lus sans blancs ni ponctuation (« with  the », « with, the », « showing off the » : `_gardeExpression`).
  '<chantier> the !erections? of (?:the|a|an|this|that|these|those|its|their|our|new|great|huge|giant|stone|steel|wooden|iron) (?:tower|towers|wall|walls|castle|castles|monument|monuments|statue|statues|structure|structures|temple|temples|bridge|bridges|church|churches|cathedral|cathedrals|pyramid|pyramids|obelisk|obelisks|scaffold|scaffolds|scaffolding|tent|tents|fort|forts|fortress|barricade|barricades|palisade|palisades|fence|fences|mast|masts|pillar|pillars|column|columns|gate|gates|house|houses|building|buildings|steel|steelwork|frame|frames|framework|totem|totems|maypole|maypoles|memorial|memorials|shrine|shrines|altar|altars|arch|arches|dam|dams|dome|domes|spire|spires|stone|stones|menhir|menhirs|statuary)',
  '<chantier> the !erections? of (?:tower|towers|wall|walls|castle|castles|monument|monuments|statue|statues|structure|structures|temple|temples|bridge|bridges|church|churches|cathedral|cathedrals|pyramid|pyramids|obelisk|obelisks|scaffold|scaffolds|scaffolding|tent|tents|fort|forts|fortress|barricade|barricades|palisade|palisades|fence|fences|mast|masts|pillar|pillars|column|columns|gate|gates|house|houses|building|buildings|frame|frames|framework|totem|totems|maypole|maypoles|memorial|memorials|shrine|shrines|altar|altars|arch|arches|dam|dams|dome|domes|spire|spires|menhir|menhirs)',
  '<chantier> the !erections? (?:crew|crews|site|sites|works|team|teams|crane|cranes|phase|phases|plan|plans|stage|stages|drawing|drawings)',
  '!semen (?:gudang|bangunan|putih|abu|cor|dinding|lantai|tembok|pabrik|karung|truk|sak|beton|portland|instan|mortar)',
  '(?:pabrik|karung|sak|dinding|lantai|tembok|campuran|adukan|truk|toko|harga|gudang) !semen',
  // « cock » = coq (2026-10-14) : seulement dans une tournure de basse-cour ecrite telle quelle, sans possessif devant (ni « 's »)
  // (« a farm kid feeding a cock and two hens », « hens and a cock », « a crowing cock ») ; « a boy, cock, hens » reste lu. Garde
  // <coq> (troisieme relecture, B3) lue sur les MOTS qui precedent la tournure : mot juste avant termine par « s » (« his », « boy's »,
  // « boys »), ou possessif dans le groupe nominal (« his big <coq> »), quels que soient les blancs et la ponctuation.
  '<coq> !cocks? (?:and|or|with|among|beside|near) (?:hens?|chickens?|chicks?|pullets?|poultry|roosters?|ducks?|geese|turkeys?|goats?|pigs?|cows?|sheep)',
  '<coq> !cocks? (?:and|or|with|among|beside|near) (?:a|an|the|two|three|four|five|six|some|many|several|its|their|[0-9]+) (?:hens?|chickens?|chicks?|pullets?|poultry|roosters?|ducks?|geese|turkeys?|goats?|pigs?|cows?|sheep)',
  '<coq> (?:hens?|chickens?|chicks?|pullets?|poultry|ducks?|geese|turkeys?) (?:and|or|with) !cocks?', '<coq> (?:hens?|chickens?|chicks?|pullets?|poultry|ducks?|geese|turkeys?) (?:and|or|with) (?:a|an|the|one|two|its|their) !cocks?',
  '<coq> !cocks? (?:crowing|crows|crowed|crow)', '<coq> (?:crowing|crowed) !cocks?', '<coq> weather !cocks?', '<coq> !cock a doodle doo',
  // colza (« oilseed rape », « a field of rape ») : le mot reste lu partout ailleurs
  // balise <mineur> (quatrieme relecture du 14/10, R4) : expression ignoree quand un mineur ou un age est lu (« child rape fields »)
  '<mineur> oilseed !rapes?', '<mineur> !rape (?:field|fields|flower|flowers|plant|plants|crop|crops|seed|seeds|oil|blossom|blossoms)',
  '<mineur> fields? of !rape', '<mineur> yellow !rape',
  '<mineur> !peladas? de (?:futebol|futsal|bola|rua|praia|varzea|domingo)', '<mineur> (?:jogo|jogos) de !peladas?',
  '<mineur> (?:jogar|jogando|jogamos|joga) !peladas?',
];
const _SEPARATEUR_EXPRESSION = '[ _-]+';
/** Cle LITTERALE d'une expression : la plus longue suite de lettres en tete d'un de ses mots, que toute correspondance contient
 *  (« showers? » donne « shower » ; un mot comme « (?:knife|knives) » ne donne rien). Une expression dont la cle n'est pas dans
 *  le texte est ecartee sans lancer son expression reguliere (meme resultat, plus rapide sur un long texte). */
function _cleExpression(e: string): string {
  let cle = '';
  for (const mot of e.split(' ')) {
    const m = /^!?([a-z]*)(.?)/.exec(mot) as RegExpExecArray;
    const lettres = m[2] === '?' || m[2] === '*' ? m[1].slice(0, -1) : m[1];
    if (lettres.length > cle.length) cle = lettres;
  }
  return cle;
}
// GARDES des tournures de ferme et de chantier (2026-10-14, troisieme relecture, B3). Avant, des regards arriere d'UN caractere
// (« (?<!his.) ») : deux espaces, une virgule ou un adjectif les contournaient (« his  <coq> and two hens », « his, <coq> », « boy's
// <coq> », « with  the erection of the tower »). La garde est desormais lue sur les MOTS qui precedent la tournure (tout ce qui
// n'est pas [a-z0-9] les separe : blancs et ponctuation sont compactes). Une expression marquee « <coq> » ou « <chantier> » n'est
// PAS retiree si sa garde trouve un de ces mots (`_gardeExpression`).
// <coq> : mot juste avant termine par « s » (« his », « its », « boy's » -> « boy s », « boys »), ou POSSESSIF dans le groupe
// nominal : en remontant au plus 6 mots, jusqu'a un article ou une preposition (« his big red <coq> » : garde ; « a big <coq> » : non).
const GARDE_POSSESSIFS: string[] = ['his', 'her', 'my', 'your', 'their', 'our', 'its', 'whose', 'thy', 's'];
const GARDE_ARRETS: string[] = ['a', 'an', 'the', 'this', 'that', 'these', 'those', 'and', 'or', 'with', 'near', 'beside', 'among', 'by',
  'of', 'in', 'on', 'at', 'from', 'to', 'for', 'behind', 'under', 'over', 'between', 'around', 'next'];
// <chantier> : un de ces mots parmi les DEUX qui precedent (« with the erection », « showing off the erection »).
const GARDE_CHANTIER: string[] = ['with', 'has', 'had', 'having', 'got', 'gets', 'get', 'showing', 'shows', 'show', 'his', 'her'];
// <coq>, quatrieme relecture du 14/10 (R5) : une queue fixe (« ... and two hens ») ne neutralise plus un terme sexuel.
//  - le mot JUSTE AVANT la tournure doit etre un determinant, un nombre, une preposition ou un adjectif de basse-cour
//    (`GARDE_DEBUTS_COQ`) : « a woman, <coq> and a hen », « a teen floor <coq> » ne sont pas des tournures de ferme ;
//  - aucun verbe ni adjectif sexuel ou d'action (`GARDE_COQ`) dans le groupe nominal ni dans les deux mots qui precedent son article
//    (« a woman sucking a <coq> and two hens », « a teen with a <coq> », « a woman holding a <coq> and a hen », « with a big <coq> ») ;
//  la politique de la ferme (« a farm kid feeding a <coq> and two hens », accepte) reste une decision du proprietaire.
const GARDE_DEBUTS_COQ: string[] = ['a', 'an', 'the', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'some', 'many', 'several', 'few', 'this', 'that', 'these', 'those', 'each', 'every', 'another', 'and', 'or', 'near', 'beside',
  'among', 'of', 'in', 'on', 'at', 'from', 'to', 'for', 'behind', 'under', 'over', 'between', 'around', 'next', 'by', 'into', 'onto',
  'red', 'brown', 'golden', 'gold', 'speckled', 'proud', 'old', 'farm', 'barnyard', 'domestic', 'wild'];
const GARDE_COQ: string[] = ['with', 'has', 'had', 'have', 'having', 'got', 'holding', 'holds', 'hold', 'held', 'sucking', 'sucks', 'suck',
  'sucked', 'licking', 'licks', 'lick', 'licked', 'stroking', 'strokes', 'stroke', 'stroked', 'touching', 'touches', 'touch', 'touched',
  'grabbing', 'grabs', 'grab', 'grabbed', 'rubbing', 'rubs', 'rub', 'rubbed', 'riding', 'rides', 'ride', 'rode', 'showing', 'shows',
  'show', 'showed', 'shown', 'kissing', 'kisses', 'kiss', 'kissed', 'eating', 'eats', 'eat', 'ate', 'tasting', 'tastes', 'taste',
  'playing', 'plays', 'play', 'played', 'jerking', 'jerks', 'jerk', 'jerked', 'pulling', 'pulls', 'pull', 'pulled', 'fondling',
  'fondles', 'fondle', 'worshipping', 'worshiping', 'gagging', 'choking', 'chokes', 'deepthroating', 'blowing', 'blows', 'blow',
  'squeezing', 'squeezes', 'squeeze', 'massaging', 'massages', 'massage', 'swallowing', 'swallows', 'swallow', 'milking', 'milks',
  'pumping', 'sitting', 'sits', 'sat', 'bouncing', 'inside', 'into', 'big', 'bigger', 'huge', 'hard', 'large', 'long', 'giant',
  'massive', 'thick', 'fat', 'erect', 'throbbing', 'veiny', 'enormous', 'monster', 'juicy', 'wet', 'hairy', 'black', 'white', 'naked',
  'nude', 'sexy'];
// <mineur> et <personne> (quatrieme relecture du 14/10, R4, R5) : balises de DESACTIVATION, pas de garde locale. Une expression
// balisee n'est pas retiree quand le texte nomme un mineur ou un age (<mineur> : plancher et filtre general), ou une personne
// (<personne> : filtre general) ; voir `_vuesSansExpressionsSensibles`.
const _RE_GARDE_EXPRESSION = /^((?:<[a-z]+>)+) /;

/** Vrai si la garde `garde` refuse l'expression : `avant` est le texte qui la precede (avec son separateur). */
function _gardeExpression(garde: string, avant: string): boolean {
  const mots = avant.split(/[^a-z0-9]+/).filter((m) => m !== '');
  if (!mots.length) return false;
  if (garde === 'chantier') return mots.slice(-2).some((m) => GARDE_CHANTIER.includes(m));
  const dernier = mots[mots.length - 1];
  if (dernier.endsWith('s')) return true;
  if (!GARDE_DEBUTS_COQ.includes(dernier) && !/^[0-9]+$/.test(dernier)) return true;
  for (let i = mots.length - 1, n = 0; i >= 0 && n < 6; i--, n++) {
    if (GARDE_POSSESSIFS.includes(mots[i]) || GARDE_COQ.includes(mots[i])) return true;
    if (GARDE_ARRETS.includes(mots[i])) return mots.slice(Math.max(0, i - 2), i).some((m) => GARDE_COQ.includes(m));
  }
  return false;
}

/** Marqueur laisse, avant simplification, a la place d'un mot d'expression sure retire (cinquieme relecture, B5 etendu) : `_simple` en
 *  fait un jalon. Un caractere de controle : `_nettoyer` les a deja tous remplaces dans le texte de l'utilisateur, il ne peut donc venir
 *  que d'ici. Sans lui, « play a viol y o u n g » rapprochait l'article « a » des lettres epelees (« ayoung ») alors que la production,
 *  qui gardait « viol », les separait. */
const _MARQUEUR_RETRAIT = '\u0001';

const _RE_EXPRESSIONS_SURES: { cle: string; garde: string; balises: string[]; ordre: boolean[]; re: RegExp }[] = EXPRESSIONS_SURES.map((e) => {
  const g = _RE_GARDE_EXPRESSION.exec(e);
  const corps = g ? e.slice(g[0].length) : e;
  const balises = g ? g[1].slice(1, -1).split('><') : [];
  return {
    cle: _cleExpression(corps),
    garde: balises.find((b) => b === 'coq' || b === 'chantier') ?? '',
    balises,
    ordre: corps.split(' ').map((m) => m.startsWith('!')),
    re: new RegExp('(^|[^a-z0-9])'
      + corps.split(' ').map((m) => (m.startsWith('!') ? '(?:' + m.slice(1) + ')' : '(' + m + ')')).join(_SEPARATEUR_EXPRESSION)
      + '(?![a-z0-9])', 'g'),
  };
});

// « baby dragon » se lit « young dragon » (MODERATION-05 : « a baby dragon taking a bath » etait refuse comme illicite) :
// mineur AMBIGU, comme « young » ou « girl » : le plancher refuse encore avec une nudite ou une tenue minimale, plus avec le
// bain seul. Seulement quand les deux mots se suivent (« a baby, dragon » garde le mineur) et sans vetement apres l'animal
// (« baby bunny costume » est un bebe deguise).
const VETEMENTS_ANIMAL: string[] = ['costume', 'onesie', 'outfit', 'suit', 'pajama', 'pyjama', 'romper', 'sleeper', 'jumpsuit',
  'hoodie', 'hat', 'mask', 'dress', 'clothes', 'clothing', 'slipper'];
const ANIMAUX_BEBE: string[] = [
  'dragon', 'dino', 'dinosaur', 'dinosaure', 'dinosaurio', 'drache', 'drago', 'animal', 'animaux', 'beast', 'creature', 'monster',
  'monstre', 'bird', 'oiseau', 'chick', 'duck', 'goose', 'owl', 'eagle', 'hawk', 'penguin', 'parrot', 'cat', 'chat', 'gato',
  'dog', 'chien', 'perro', 'wolf', 'loup', 'lobo', 'fox', 'renard', 'zorro', 'bear', 'ours', 'oso', 'panda', 'koala', 'lion',
  'leon', 'tiger', 'tigre', 'leopard', 'cheetah', 'elephant', 'elefante', 'giraffe', 'girafe', 'zebra', 'hippo', 'rhino',
  'horse', 'cheval', 'caballo', 'pony', 'poney', 'unicorn', 'licorne', 'unicornio', 'donkey', 'cow', 'pig', 'sheep', 'goat',
  'deer', 'rabbit', 'lapin', 'conejo', 'bunny', 'squirrel', 'mouse', 'rat', 'hamster', 'monkey', 'singe', 'gorilla', 'sloth',
  'otter', 'seal', 'phoque', 'walrus', 'whale', 'baleine', 'ballena', 'dolphin', 'dauphin', 'delfin', 'shark', 'requin',
  'tiburon', 'fish', 'poisson', 'pez', 'octopus', 'turtle', 'tortue', 'tortuga', 'tortoise', 'frog', 'toad', 'lizard', 'snake',
  'serpent', 'serpiente', 'crocodile', 'alligator', 'spider', 'bat', 'griffin', 'gryphon', 'griffon', 'phoenix', 'hydra',
  'wyvern', 'yeti', 'slime', 'alien', 'robot', 'golem', 'kraken', 'chimera', 'mammoth', 'raptor', 'insect', 'butterfly', 'bee',
  'ant', 'crab', 'lobster', 'kangaroo', 'camel', 'llama', 'alpaca', 'moose', 'elk', 'buffalo', 'bison', 'boar', 'hedgehog',
  'raccoon', 'beaver', 'badger', 'weasel', 'ferret',
];
const _RE_BEBE_ANIMAL = new RegExp('(^|[^a-z0-9])(?:baby|bebe)' + _SEPARATEUR_EXPRESSION + '(?=(?:' + ANIMAUX_BEBE.join('|')
  + ')(?:s|es)?(?![a-z0-9])(?!' + _SEPARATEUR_EXPRESSION + '(?:' + VETEMENTS_ANIMAL.join('|') + ')(?:s|es)?(?![a-z0-9])))', 'g');

/** Expressions sures (mot marque retire, les autres gardes) et « baby <animal> » -> « young <animal> ». Sur le texte AVANT
 *  simplification : la ponctuation y separe encore les mots. Une expression qui porte une balise de `desactivees` (« mineur »,
 *  « personne ») est laissee telle quelle. */
function _sansExpressionsSures(s: string, desactivees: string[] = []): string {
  let r = s.includes('baby') || s.includes('bebe') ? s.replace(_RE_BEBE_ANIMAL, '$1young ') : s;
  for (const { cle, garde, balises, ordre, re } of _RE_EXPRESSIONS_SURES) {
    if (!r.includes(cle) || balises.some((b) => desactivees.includes(b))) continue;
    // a = [expression, separateur avant, mots gardes..., position, texte] ; une expression gardee est laissee telle quelle ;
    // un marqueur occupe la place de chaque mot retire (les voisins ne se rapprochent pas)
    r = r.replace(re, (...a: unknown[]) => {
      const sep = String(a[1]);
      if (garde && _gardeExpression(garde, String(a[a.length - 1]).slice(0, (a[a.length - 2] as number) + sep.length))) return String(a[0]);
      let k = 2;
      return sep + ordre.map((retire) => (retire ? ' ' + _MARQUEUR_RETRAIT + ' ' : String(a[k++]))).join(' ') + ' ';
    });
  }
  return r;
}

/** Remplace les lettres cyrilliques / grecques / armeniennes ressemblantes, les lettres latines speciales et les lettres-emoji. */
function _translit(s: string): string {
  return s.replace(/[^\x00-\x7f]/gu, (c) => _LATIN_SPECIAUX[c] ?? _HOMOGLYPHES[c] ?? _lettreSymbole(c.codePointAt(0) as number) ?? c);
}

/** Jalon laisse a la place d'un mot d'idiome retire (cinquieme relecture, B5). Retirer le mot SANS rien laisser rapprochait ses
 *  voisins : l'article « a » de « a snaked c h i l d naked » se collait aux lettres epelees (« achild »), et la production, qui
 *  gardait « snaked » comme un mot, lisait « child » (plancher). Le jalon est un MOT de DEUX signes : il separe les voisins, ne
 *  se recolle pas a une lettre ou a un chiffre isole (`_joindre` ne recolle que les jetons d'UN caractere), et aucun terme ne
 *  contient de signe (les termes passent par `_simple` aussi, sans jalon : `jalon = false`). */
const _JALON_IDIOME = '--';

/** Tout ce qui n'est pas [a-z0-9] devient un espace ; espaces compactes ; idiomes retires (racines : la fin du mot reste, entre deux
 *  jalons), un jalon a leur place sauf pour les termes des listes (`jalon = false`). Avec `phrases`, les expressions que la production
 *  retirait entieres (`IDIOMES_PRODUCTION`) le sont aussi, sans rien laisser : les mots voisins se rapprochent comme chez elle. */
function _simple(s: string, jalon = true, phrases = false): string {
  const j = ' ' + _JALON_IDIOME + ' ';
  // un marqueur de retrait d'expression sure (`_MARQUEUR_RETRAIT`) devient un jalon, comme un mot d'idiome retire
  const corps = s.split(_MARQUEUR_RETRAIT).map((p) => p.replace(/[^a-z0-9]+/g, ' ')).join(jalon ? j : ' ');
  let r = (' ' + corps.trim() + ' ').replace(_IDIOMES, jalon ? j : ' ')
    .replace(_IDIOMES_RACINES, (_m: string, fin: string) => (jalon ? j + (fin ? fin + j : '') : ' ' + fin));
  if (phrases) r = r.replace(_IDIOMES_PRODUCTION, ' ');
  return r.replace(/\s+/g, ' ').trim();
}

/** "n u d e" -> "nude" : au moins 3 LETTRES isolees de suite sont recollees (2026-10-13 : un chiffre isole ne se recolle plus,
 *  sinon « a 8 y/o » devenait « a8yo » et l'age n'etait plus lu). Avec `chiffres`, tout jeton d'UN caractere se recolle, chiffres
 *  compris : c'est la jonction de la PRODUCTION (« 9 y r old » -> « 9yr old »), lue en plus de l'autre (cinquieme relecture, B2). */
function _joindre(s: string, chiffres = false): string {
  const t = s.split(' ');
  const sortie: string[] = [];
  const lettre = (x: string) => x.length === 1 && (chiffres || (x >= 'a' && x <= 'z'));
  let i = 0;
  while (i < t.length) {
    if (lettre(t[i])) {
      let j = i;
      while (j < t.length && lettre(t[j])) j++;
      if (j - i >= 3) sortie.push(t.slice(i, j).join(''));
      else for (let k = i; k < j; k++) sortie.push(t[k]);
      i = j;
    } else { sortie.push(t[i]); i++; }
  }
  return sortie.join(' ');
}

/** "n.u.d.e" / "n-u-d-e" -> "nude" : au moins 3 caracteres isoles separes par de la ponctuation, dans un meme mot. */
function _joindrePonctue(s: string): string {
  return s.replace(/(?<![a-z0-9])[a-z0-9](?:[^a-z0-9\s]+[a-z0-9]){2,}(?![a-z0-9])/g, (m) => m.replace(/[^a-z0-9]+/g, ''));
}

/** Series de lettres isolees recollees (>= 6 lettres) : "c h i l d n u d e" -> "childnude". */
function _series(simple: string): string[] {
  const sortie: string[] = [];
  const t = simple.split(' ');
  let i = 0;
  while (i < t.length) {
    if (t[i].length === 1) {
      let j = i;
      while (j < t.length && t[j].length === 1) j++;
      if (j - i >= 6) sortie.push(_ecraser(t.slice(i, j).join('')));
      i = j;
    } else i++;
  }
  return sortie;
}

/** "nuuuude" -> "nude" : une lettre repetee 3 fois ou plus est ramenee a une seule. */
function _ecraser(s: string): string { return s.replace(/([a-z])\1{2,}/g, '$1'); }

/** Leet : seulement dans les jetons qui contiennent deja une lettre (un nombre seul reste un nombre). */
function _leet(translit: string, unVers: 'i' | 'l'): string {
  return translit.split(/\s+/).map((jeton) => {
    if (!/[a-z]/.test(jeton)) return jeton;
    return jeton.replace(/[0134578@$]/g, (c) => (c === '1' ? unVers : (_LEET[c] ?? c)));
  }).join(' ');
}

// Vue exacte : une lettre qui porte un crochet, un point souscrit, une corne (vietnamien) ou un tilde (espagnol « ñu » = gnou)
// n'est PAS ramenee a sa lettre de base ; les accents francais, eux, sont retires (« epee nue » reste un idiome).
const _MARQUES_DISTINCTIVES = /[\u0303\u0309\u031b\u0323]/u;
// « torse nu » est une tenue (comme « shirtless », liste NU_MOYEN) : il ne compte pas comme le mot « nu » de la vue exacte.
const IDIOMES_EXACTS: string[] = ['torses? nus?'];
const _RE_IDIOMES_EXACTS = new RegExp('(?:^| )(?:' + IDIOMES_EXACTS.join('|') + ')(?= |$)', 'g');

/** VUE EXACTE (2026-10-13, MODERATION-05) pour les mots COURTS « nu », « nue », « nua »... : le vietnamien « nữ » (femme),
 *  « nụ » (bouton), « nữa », « nửa » et l'espagnol « ñu » se lisaient « nu » / « nua » une fois les accents retires. Une lettre
 *  a marque distinctive devient « x » : « nx » n'est plus « nu ». Toute AUTRE lettre non ASCII est un separateur, comme dans la
 *  production (cinquieme relecture, B3 : « nu<U+0436> » reste le mot « nu »). Avec `translit` faux, les lettres des tables de
 *  translitteration (cyrillique, grec, « ø », « ß »...) sont elles aussi des separateurs : c'est le texte NON translittere que la
 *  production lisait pour le filtre general (`souple`), ou « nu<U+00F8> » etait le mot « nu ». */
function _vueExacte(net: string, desactivees: string[] = [], translit = true): string[] {
  let s = net;
  try { s = s.normalize('NFD'); } catch { /* garde */ }
  s = s.replace(/(\P{M})(\p{M}+)/gu, (_m, lettre: string, marques: string) => (_MARQUES_DISTINCTIVES.test(marques) ? 'x' : lettre));
  // Tout caractere non ASCII qui reste (lettre d'une autre ecriture, symbole, ponctuation) est un SEPARATEUR, comme dans la
  // production, ou il n'etait ni lettre ni chiffre : « nu<U+0436> », « nue<U+4E2D> », « nua<U+05D0> » restent le mot « nu » (cinquieme
  // relecture, B3 ; avant, une lettre restante devenait « x » et « enfant nu<U+0436> » passait) et ce separateur est de la PONCTUATION
  // (« . »), qui relie les lettres epelees (« n.u<U+0436>e »). Les lettres a marque distinctive sont deja « x » plus haut.
  // Un BLANC non ASCII (U+2028, U+2029, U+1680 : `\s` pour JavaScript) reste un espace, comme dans la production : il coupe les series de
  // lettres epelees (« n u<U+2013>e<U+2028>s » = « nues », trouve par le fuzz differentiel du 20/10).
  const avantExpressions = (translit ? _translit(s) : s).replace(/[^\x00-\x7f]/gu, (c) => (/\s/.test(c) ? ' ' : '.'));
  s = _sansExpressionsSures(avantExpressions, desactivees);
  // Assemblee comme les autres vues du plancher (quatrieme relecture du 14/10, R3) : lettres separees par de la ponctuation ou des
  // espaces recollees (« n.u.e », « n-u-e », « n_u_s »), lettres repetees ecrasees (« nuuue »), leet (« nu3 ») ; la production
  // lisait ces formes (« nu », « nue » etaient des termes de ses vues ordinaires).
  const sortie: string[] = [];
  for (const x of [s, _leet(s, 'i'), _leet(s, 'l')]) {
    const v = _ecraser(_joindre(_simple(_joindrePonctue(x)))).replace(_RE_IDIOMES_EXACTS, ' ').replace(/ +/g, ' ').trim();
    if (!sortie.includes(v)) sortie.push(v);
  }
  // Sixieme passe (21/10, trouve par les mutations aleatoires du banc : « child n baby shower u s » refuse par la production, accepte
  // ensuite) : la production retirait ENTIERE l'expression d'`IDIOMES_PRODUCTION` (« baby shower ») et rapprochait ainsi les lettres
  // epelees qui l'entouraient (« n  u s » = « nus ») ; le lot ne retire que le mot sensible, et un jalon separe les voisins. Quand le
  // texte contient une de ces expressions, la vue exacte est AUSSI lue comme la production (meme regle que `separees`, dans `_vues`).
  for (const x of [avantExpressions, _leet(avantExpressions, 'i'), _leet(avantExpressions, 'l')]) {
    const j = _simple(_joindrePonctue(x));
    if (!_RE_INDICE_PHRASES.test(j) || !_RE_IDIOMES_PRODUCTION.test(j)) continue;
    const v = _ecraser(_joindre(_simple(_joindrePonctue(x), true, true))).replace(_RE_IDIOMES_EXACTS, ' ').replace(/ +/g, ' ').trim();
    if (!sortie.includes(v)) sortie.push(v);
  }
  return sortie;
}

/** VUE UNICODE (2026-10-13, MODERATION-01) : pour les lexiques des ecritures non latines. Marques retirees sauf celles qui
 *  portent le sens (_MARQUES_GARDEES), arabe ramene a une forme simple (tatweel retire ; ی ى -> ي ; ک -> ك ; ة -> ه ; ٱ -> ا),
 *  katakana -> hiragana, teintes de peau des emoji retirees ; tout ce qui n'est ni lettre, ni chiffre, ni marque, ni symbole
 *  (emoji) devient un espace. Le lexique passe par la MEME fonction : texte et termes ont la meme forme. */
function _vueUnicode(net: string): string {
  let s = net;
  try { s = s.normalize('NFD'); } catch { /* garde */ }
  s = s.replace(/\p{M}/gu, (m) => (_MARQUES_GARDEES.test(m) ? m : ''));
  try { s = s.normalize('NFC'); } catch { /* garde */ }
  s = s.replace(/\u0640/g, '').replace(/[\u06cc\u0649]/g, '\u064a').replace(/\u06a9/g, '\u0643').replace(/\u0629/g, '\u0647')
    .replace(/\u0671/g, '\u0627');
  s = s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  s = s.replace(/[\u{1f3fb}-\u{1f3ff}]/gu, '');
  s = s.replace(/[^\p{L}\p{N}\p{M}\p{So}]+/gu, ' ');
  return s.replace(/ +/g, ' ').trim();
}

interface VuesPlancher {
  /** texte translittere, chiffres conserves (les ages passent par la) */
  chiffres: string;
  /** idem avec leet (1 -> i) */
  leetI: string;
  /** idem avec leet (1 -> l) */
  leetL: string;
  /** lettres seules, sans separateur, lettres repetees ecrasees (une vue par leet) */
  collees: string[];
  /** series de lettres isolees recollees, ex. "childnude" (mineur ET nudite ecrits lettre par lettre) */
  series: string[];
  /** les trois premieres vues SANS lettres repetees ecrasees : un mot colle « toplessschoolgirl » y garde ses trois « s » */
  nonEcrasees: string[];
  /** les trois premieres vues coupees entre lettres et chiffres (« 2child » -> « 2 child ») puis sans chiffre colle a une lettre
   *  (« little1girl » -> « little girl ») ; seulement celles qui different ; puis (cinquieme relecture, B2) les trois vues recollees
   *  COMME LA PRODUCTION, chiffres compris (« 9 y r old » -> « 9yr old »), si elles different des trois premieres */
  separees: string[];
  /** vue exacte (accents gardes) pour les mots courts « nu », « nue », « nua »... ; puis sa version coupee si elle differe */
  exactes: string[];
  /** la meme SANS translitteration, seulement celles qui different : lue par le filtre GENERAL (jamais par le plancher, qui ne lisait
   *  pas le texte non translittere), comme la production lisait « nu<U+00F8> » dans `souple` (cinquieme relecture, B3) */
  exactesSouples: string[];
  /** vue Unicode (sans translitteration) pour les termes non latins et les emoji, coupee entre chiffres et autres caracteres ;
   *  puis, si elle differe, la meme SANS les espaces entre deux ideogrammes han (troisieme relecture du 14/10 : le tokenizer CLIP
   *  de Modal, sans ftfy, lit chaque ideogramme seul ; « 儿 童 » et « 儿童 » lui donnent les memes jetons) */
  unicode: string[];
}

// Ideogrammes han, comme BasicTokenizer._is_chinese_char (tokenizer CLIP sans ftfy) : CJK unifies et extensions A a F,
// compatibilite (et son supplement).
const _RE_ESPACE_HAN = new RegExp('(?<=[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u{20000}-\\u{2a6df}\\u{2a700}-\\u{2ceaf}\\u{2f800}-\\u{2fa1f}]) '
  + '(?=[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u{20000}-\\u{2a6df}\\u{2a700}-\\u{2ceaf}\\u{2f800}-\\u{2fa1f}])', 'gu');

// CHIFFRES COLLES A UN MOT (2026-10-14, seconde relecture du lot) : le tokenizer CLIP coupe entre une lettre et un chiffre
// (« 2child » -> 2 | child ; « little1girl » -> little | 1 | girl ; « child2naked » -> child | 2 | naked) : le modele lit le
// mineur. Le filtre lisait [a-z0-9] d'un seul tenant et n'y trouvait aucun mot. Vues SUPPLEMENTAIRES : chaque frontiere
// lettre / chiffre devient un espace (« 2 child », « little 1 girl ») ; et les chiffres colles a une lettre sont retires
// (« little girl ») : un chiffre glisse entre deux mots ne les separe plus. Les vues d'origine restent lues (« 3rd grader »,
// « 12yo », « n4ked » par le leet).
const _RE_FRONTIERE_CHIFFRE = /(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/g;
const _RE_CHIFFRES_COLLES = /(?<=[a-z])[0-9]+|[0-9]+(?=[a-z])/g;
const _RE_FRONTIERE_CHIFFRE_UNICODE = /(?<=[^ 0-9])(?=[0-9])|(?<=[0-9])(?=[^ 0-9])/gu;

/** Vues coupees entre lettres et chiffres, puis sans les chiffres colles a une lettre ; sans doublon, seulement celles qui
 *  different de leur vue d'origine (un texte sans chiffre colle n'en a aucune). */
function _separees(vues: string[]): string[] {
  const sortie: string[] = [];
  for (const v of vues) {
    for (const s of [v.replace(_RE_FRONTIERE_CHIFFRE, ' '), v.replace(_RE_CHIFFRES_COLLES, ' ').replace(/ +/g, ' ').trim()]) {
      if (s !== v && !sortie.includes(s)) sortie.push(s);
    }
  }
  return sortie;
}

/** Vues du plancher a partir du texte NETTOYE (`_nettoyer`). */
function _vuesPlancher(net: string, desactivees: string[] = []): VuesPlancher {
  const t0 = _translit(_sansMarques(net));
  const t = _sansExpressionsSures(t0, desactivees);
  const assembler = (x: string) => _joindre(_simple(_joindrePonctue(x)));
  const nonEcrasees = [assembler(t), assembler(_leet(t, 'i')), assembler(_leet(t, 'l'))];
  const [chiffres, leetI, leetL] = nonEcrasees.map(_ecraser);
  // Vues recollees COMME LA PRODUCTION (cinquieme relecture, B2) : tout jeton d'UN caractere, chiffre compris, se recolle (« 9 y r
  // old » -> « 9yr old » : un age que la production lisait). AJOUTEES aux vues ci-dessus (qu'on ne touche pas : « a 8 y o » y reste
  // un age), sans doublon, dans `separees`.
  const assemblerCh = (x: string) => _ecraser(_joindre(_simple(_joindrePonctue(x)), true));
  const avecChiffres = [assemblerCh(t), assemblerCh(_leet(t, 'i')), assemblerCh(_leet(t, 'l'))]
    .filter((x, i, l) => ![chiffres, leetI, leetL].includes(x) && l.indexOf(x) === i);
  const coller = (v: string) => v.replace(/[^a-z]/g, '').replace(/([a-z])\1+/g, '$1');
  // La vue collee part du texte sans jonction (les jonctions sont deja des lettres collees).
  const collees = [coller(_simple(_leet(t, 'i'))), coller(_simple(_leet(t, 'l')))];
  const series = [
    ..._series(_simple(_joindrePonctue(t))), ..._series(_simple(_joindrePonctue(_leet(t, 'i')))),
    ..._series(_simple(_joindrePonctue(_leet(t, 'l')))),
  ];
  // Quand le texte contient une expression que la PRODUCTION retirait ENTIERE (`IDIOMES_PRODUCTION`), toutes les vues sont AUSSI lues
  // comme elle (mots voisins rapproches : « age bath toys 1 » = « age 1 », « k baby shower idporn » = « kidporn ») ; texte sans les
  // exceptions du lot (hors idiomes), qu'elle n'avait pas.
  const separeesPhrases: string[] = [];
  // (le declencheur est teste sur CHAQUE variante — telle quelle, leet i, leet l — apres jonction par la ponctuation : la production retirait l'expression de chacune de
  //  ses vues, « k bath t0ys id... », « age b.a.t.h t.o.y.s 12 » ; cinquieme relecture, controle d'inclusion des vues)
  const variantes0 = [t0, _leet(t0, 'i'), _leet(t0, 'l')];
  if (variantes0.some((x) => { const j = _simple(_joindrePonctue(x)); return _RE_INDICE_PHRASES.test(j) && _RE_IDIOMES_PRODUCTION.test(j); })) {
    const vp = (x: string) => _simple(_joindrePonctue(x), true, true);
    const existantes = [chiffres, leetI, leetL, ...avecChiffres];
    for (const x of [t0, _leet(t0, 'i'), _leet(t0, 'l')]) {
      for (const v of [_ecraser(_joindre(vp(x))), _ecraser(_joindre(vp(x), true))]) {
        if (!existantes.includes(v) && !separeesPhrases.includes(v)) separeesPhrases.push(v);
      }
    }
    for (const x of [_leet(t0, 'i'), _leet(t0, 'l')]) {
      const c = coller(_simple(x, true, true));
      if (!collees.includes(c)) collees.push(c);
    }
    for (const x of [t0, _leet(t0, 'i'), _leet(t0, 'l')]) for (const v of _series(vp(x))) if (!series.includes(v)) series.push(v);
  }
  const exactes = _vueExacte(net, desactivees);
  const exactesSouples = _vueExacte(net, desactivees, false).filter((x) => !exactes.includes(x));
  const uni = _vueUnicode(net);
  const unicode = [uni, uni.replace(_RE_ESPACE_HAN, '')].filter((x, i, l) => l.indexOf(x) === i)
    .map((x) => x.replace(_RE_FRONTIERE_CHIFFRE_UNICODE, ' ').replace(_RE_IDIOMES_UNICODE, ' '));
  return { chiffres, leetI, leetL, collees, series, nonEcrasees, separees: [..._separees([chiffres, leetI, leetL]), ...avecChiffres, ...separeesPhrases],
    exactes: [...exactes, ..._separees(exactes).filter((x) => !exactes.includes(x))],
    exactesSouples: [...exactesSouples, ..._separees(exactesSouples).filter((x) => !exactes.includes(x) && !exactesSouples.includes(x))], unicode };
}

// SYNTAXE DE POIDS COLLEE dans un mot (revue du 14/10, B1) : « na()ked », « na[]ked », « (na)(ked) », « (na:1)(ked:1) ». Le
// lecteur de poids de l'encodeur SDXL recollait les morceaux voisins de meme poids et le modele recevait le mot ENTIER, que le
// filtre lisait en deux mots (corrige a la source dans _sdxl_prompt_utils.py : la syntaxe y separe desormais les mots). Defense
// en profondeur : le plancher et les termes explicites sont AUSSI lus sur une seconde vue ou cette syntaxe, prise entre deux
// caracteres de mot, est retiree SANS espace. Le texte tel quel reste lu (« (sex:1.2)(scene:1.3) » y garde ses deux mots).
const _RE_SYNTAXE_POIDS = /(?:[()[\]]|:[+-]?[0-9.]*\))+/g;
const _RE_CAR_MOT = /^[\p{L}\p{N}\p{M}]$/u;

/** Caractere (point de code entier) juste avant la position `i`, ou chaine vide. */
function _carAvant(s: string, i: number): string {
  if (i <= 0) return '';
  const bas = s.charCodeAt(i - 1);
  if (bas >= 0xdc00 && bas <= 0xdfff && i >= 2) {
    const haut = s.charCodeAt(i - 2);
    if (haut >= 0xd800 && haut <= 0xdbff) return s.slice(i - 2, i);
  }
  return s.slice(i - 1, i);
}

/** Texte nettoye sans la syntaxe de poids prise entre deux caracteres de mot (meme texte s'il n'y en a pas). */
function _sansSyntaxeCollee(net: string): string {
  if (!/[()[\]]/.test(net)) return net;
  return net.replace(_RE_SYNTAXE_POIDS, (m: string, pos: number) => {
    const cp = net.codePointAt(pos + m.length);
    const apres = cp === undefined ? '' : String.fromCodePoint(cp);
    return _RE_CAR_MOT.test(_carAvant(net, pos)) && _RE_CAR_MOT.test(apres) ? '' : m;
  });
}

// LECTURES DU TEXTE (2026-10-14, troisieme relecture du lot : B1, B2). La lecture principale (`_nettoyer`) EFFACE les caracteres
// invisibles et les marques combinantes, change en lettres les lettres-emoji et les symboles que NFKC decompose (™ -> « tm »), et
// decode les references HTML : elle lit les mots DEGUISES (« na<U+200B>ked »). Mais places ENTRE deux mots, ces caracteres les
// recollaient (« a child<U+0489>in<U+0489>the<U+0489>bath » -> « childinthebath » ; « child&#8203;in » -> « childin ») alors que le
// tokenizer CLIP coupe le mot sur une marque restee seule apres NFC, un symbole, une lettre-emoji, une reference HTML laissee
// cassee dans le texte envoye au generateur (motif [\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+) : le modele lisait le mineur, pas le filtre.
// Le texte est donc AUSSI lu en traitant ces caracteres comme des SEPARATEURS, et les vues de toutes les lectures sont reunies (le
// mineur peut venir d'une lecture, la nudite d'une autre : « a child<U+0489>sitting na<U+200B>ked »).
//   separee    : tout caractere efface ou change par la lecture principale est un separateur (dans le doute) ;
//   clip       : le tokenizer CLIP SANS ftfy (image Modal) : categorie C, U+FFFD et non assignes effaces (BasicTokenizer), lettres
//                hangul vides collees (ce sont des lettres) ; references HTML non decodees, comme le texte envoye au generateur ;
//   ftfy       : le tokenizer CLIP AVEC ftfy (Python du bureau) : mojibake repare, references HTML decodees (« &#8203; » donne
//                U+200B, que ftfy garde : un separateur) ; seuls les caracteres de controle que ftfy retire sont effaces ;
//   production : la normalisation de la production f86208c0 (invisibles et marques U+0300-036F effaces, symboles NFKC changes en
//                lettres, tout autre caractere hors de ses tables un separateur) : aucun contournement qu'elle bloquait ne passe.
type ModeLecture = 'separee' | 'clip' | 'ftfy' | 'production';
const _MODES_LECTURE: ModeLecture[] = ['separee', 'clip', 'ftfy', 'production'];
/** Caracteres de `_EFFACES` que chaque lecture COLLE (efface) ; les autres y separent les mots. */
const _COLLES_CLIP = new RegExp('[\\p{C}\\ufffd\\u115f\\u1160\\u3164\\uffa0' + _PLAGES_U14 + ']', 'u');
const _COLLES_FTFY = /[\x00-\x08\x0b\x0e-\x1f\x7f\u115f\u1160\u206a-\u206f\u3164\ufeff\ufff9-\ufffc\uffa0]/;
const _COLLES_PRODUCTION = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060\ufeff]/;
// Lettres que les tables de translitteration du lot ont AJOUTEES a celles de la production (cyrillique, armenien, lettres
// barrees, petites capitales) : la production les lisait comme des separateurs.
const TRANSLIT_HORS_PRODUCTION: string[] = [
  '\u04af', '\u0585', '\u057d', '\u0578', '\u0570', '\u0581', '\u0566', '\u0561',
  '\u0127', '\u0167', '\u0138', '\u0180', '\u0268', '\u0289', '\u024d', '\u024f', '\u01b6', '\u01e5', '\u0249', '\u0237',
  '\u1d00', '\u0299', '\u1d04', '\u1d05', '\u1d07', '\ua730', '\u0262', '\u029c', '\u026a', '\u1d0a', '\u1d0b', '\u029f', '\u1d0d',
  '\u0274', '\u1d0f', '\u1d18', '\u0280', '\ua731', '\u1d1b', '\u1d1c', '\u1d20', '\u1d21', '\u028f', '\u1d22',
];

/** Ce que la lecture « production » met a la place d'un caractere que la production LAISSAIT EN PLACE (cinquieme relecture, B1) : de
 *  la PONCTUATION (« . »), pas un espace. Pour la production tout caractere hors de [a-z0-9] et hors des blancs etait de la
 *  ponctuation, et `_joindrePonctue` relie par de la ponctuation les lettres epelees d'un meme mot : « n.a<U+061C>k.e.d » y etait
 *  « naked » ; un espace coupait la serie et le mot n'etait plus lu. Un caractere qui est un blanc pour JavaScript (`\s`) reste un
 *  espace. */
function _ponctuationProduction(c: string): string { return /\s/.test(c) ? ' ' : '.'; }

/** \t \n \r -> espace ; caracteres de `_EFFACES` : effaces si la lecture les colle, sinon un espace (de la ponctuation pour la
 *  lecture « production »). */
function _effacerLecture(s: string, mode: ModeLecture): string {
  const colle = mode === 'clip' ? _COLLES_CLIP : mode === 'ftfy' ? _COLLES_FTFY : mode === 'production' ? _COLLES_PRODUCTION : null;
  return s.replace(/[\t\n\r]/g, ' ').replace(_EFFACES, (c: string) => (colle !== null && colle.test(c) ? ''
    : (mode === 'production' ? _ponctuationProduction(c) : ' ')));
}

const _CACHE_SYMBOLES = new Map<string, boolean>();
/** Caractere qui n'est pas une lettre mais que NFKC change en lettre (™, ℡, Ⓧ, ⓧ, Ⅹ, ㎏...), ou lettre-emoji (indicateur regional,
 *  lettre carree ou cerclee negative) : le tokenizer CLIP, qui n'applique pas NFKC, coupe le mot sur ce caractere. */
function _symboleLettre(c: string): boolean {
  let r = _CACHE_SYMBOLES.get(c);
  if (r === undefined) {
    let nfkc = c;
    try { nfkc = c.normalize('NFKC'); } catch { /* garde */ }
    r = !/\p{L}/u.test(c) && (_lettreSymbole(c.codePointAt(0) as number) !== undefined || /\p{L}/u.test(nfkc));
    if (_CACHE_SYMBOLES.size >= 4096) _CACHE_SYMBOLES.clear();
    _CACHE_SYMBOLES.set(c, r);
  }
  return r;
}

/** Lettres-emoji et symboles NFKC -> espace (la production ne changeait en espace que les lettres-emoji, absentes de ses tables ;
 *  pour elle c'etaient de la ponctuation : un signe « . » dans la lecture « production », cinquieme relecture, B1). */
function _symbolesSepares(s: string, mode: ModeLecture): string {
  return s.replace(/[^\x00-\x7f]/gu, (c: string) => (_symboleLettre(c)
    && (mode !== 'production' || _lettreSymbole(c.codePointAt(0) as number) !== undefined) ? (mode === 'production' ? '.' : ' ') : c));
}

/** LECTURE « PRODUCTION » : la normalisation de f86208c0 (NFKC, minuscules), puis les seules adaptations que la version de travail exige.
 *  Les caracteres exotiques restent EN PLACE jusqu'aux minuscules (cinquieme relecture, B1) : le contexte du « Σ » final (« ς » donne la
 *  lettre « s » a la production, « σ » rien) depend de ce qui suit, et un signe de ponctuation mis a la place d'un caractere que la
 *  production laissait aurait change ce contexte. Ensuite : les invisibles de la production sont effaces, les autres caracteres effaces,
 *  les lettres-emoji, les marques hors U+0300-036F, les chiffres non ASCII et les lettres que les tables du lot ont AJOUTEES a celles de
 *  la production deviennent de la PONCTUATION (« . »), ce qu'ils etaient pour elle (`_ponctuationProduction`). Seuls les points de code
 *  non assignes en Unicode 14 sont traites AVANT NFKC, comme dans toutes les lectures (le worker et Modal lisent le meme texte). */
function _lectureProduction(brut: string): string {
  // (« / » et non « . » : un point est « case-ignorable » pour les minuscules, un caractere non assigne ne l'est pas)
  let s = brut.replace(/[\t\n\r]/g, ' ').replace(_NON_ASSIGNES_U14, '/');
  try { s = s.normalize('NFKC'); } catch { /* garde */ }
  s = s.toLowerCase();
  s = _effacerLecture(s, 'production');
  s = _symbolesSepares(s, 'production');
  // marques restees apres la composition : la production effacait celles de U+0300-036F et laissait les autres en place
  s = s.replace(/\p{M}/gu, (m: string) => (m >= '\u{300}' && m <= '\u{36f}' ? '' : '.'));
  // chiffres non ASCII : la production les lisait comme des separateurs (hors de [a-z0-9])
  s = _chiffresSepares(s, '.');
  // lettres des tables du lot absentes de celles de la production (« Ħ » et « Ա » sont devenues « ħ » et « ա » par les minuscules)
  return s.replace(/[^\x00-\x7f]/gu, (c: string) => (TRANSLIT_HORS_PRODUCTION.includes(c) ? '.' : c));
}

/** Texte nettoye d'une lecture ou les caracteres effaces ou changes par la lecture principale separent les mots (voir plus haut). */
function _nettoyerLecture(brut: string, mode: ModeLecture): string {
  if (mode === 'production') return _lectureProduction(brut);
  let s = mode === 'ftfy' ? _sansMojibake(brut) : brut;
  s = _effacerLecture(s, mode);
  if (mode === 'ftfy') s = _effacerLecture(_sansMojibake(s), mode);
  s = _symbolesSepares(s, mode);
  try { s = s.normalize('NFKC'); } catch { /* garde */ }
  if (mode === 'ftfy' && s.includes('&')) {
    s = _symbolesSepares(_effacerLecture(_sansReferencesHtml(s), mode), mode);
    try { s = s.normalize('NFKC'); } catch { /* garde */ }
  }
  // marques restees seules apres la composition : le tokenizer CLIP (apres NFC) coupe le mot sur elles
  s = s.replace(/\p{M}/gu, ' ');
  // chiffres non ASCII (\u00ab \u0667 \u00bb, \u00ab \u06f7 \u00bb, \u00ab \u0967 \u00bb) : la lecture \u00ab separee \u00bb les change en espaces (dans le doute) ; les lectures \u00ab clip \u00bb et
  // \u00ab ftfy \u00bb les changent en chiffres ASCII, comme la principale (quatrieme relecture du 14/10, R2 : \u00ab a<U+0667>12yo<U+0667>person \u00bb devenait
  // \u00ab a712yo7person \u00bb) ; la lecture \u00ab production \u00bb est a part (`_lectureProduction`)
  return (mode === 'separee' ? _chiffresSepares(s) : _chiffresAscii(s)).toLowerCase();
}

interface Lecture { nets: string[]; vues: VuesPlancher[] }

/** Toutes les lectures du texte (la principale, puis celles ou les caracteres effaces ou changes separent les mots), chacune
 *  aussi sans la syntaxe de poids collee dans un mot ; sans doublon. Un texte ASCII imprimable sans « & » n'a qu'une lecture. */
function _lire(prompt: unknown): Lecture {
  const brut = typeof prompt === 'string' ? prompt : String(prompt == null ? '' : prompt);
  const lectures = [_nettoyer(brut)];
  if (!/^[\t\n\r\x20-\x25\x27-\x7e]*$/.test(brut)) {
    for (const mode of _MODES_LECTURE) {
      const n = _nettoyerLecture(brut, mode);
      if (!lectures.includes(n)) lectures.push(n);
    }
  }
  const nets: string[] = [];
  for (const n of lectures) for (const x of [n, _sansSyntaxeCollee(n)]) if (!nets.includes(x)) nets.push(x);
  return { nets, vues: nets.map((n) => _vuesPlancher(n)) };
}

// Expressions chinoises / japonaises ou « 裸 » (nu) ne designe personne : pieds nus, oeil nu, couleur chair, seigle, plantes
// gymnospermes, fil denude, ampoule nue, « sans le sou ». Retirees du texte (vue Unicode) avant la recherche du lexique.
const IDIOMES_UNICODE: string[] = ['裸足', '裸眼', '裸色', '裸辞', '裸婚', '裸麦', '裸子植物', '裸线', '裸機', '裸机', '裸電球', '裸一貫',
  '脱衣所', '脱衣場', '脱衣室', '脱衣间', '脱衣間',
  // 2026-10-20 (cinquieme relecture, refus a tort) : mots dont le « 性 » finit le mot precedent et dont « 交 » commence le suivant
  // (積極性 / 积极性 + 交流 : « 儿童的积极性交流 » = la communication active des enfants). Le lexique lit « 性交 » en infixe, sans
  // segmentation : ces SEULS mots entiers sont retires de la vue Unicode ; « 儿童性交易 » (commerce sexuel) reste refuse.
  '积极性交流', '積極性交流', '主动性交流', '主動性交流', '创造性交流', '創造性交流', '安全性交易', '安全性交流', '稳定性交易', '穩定性交易',
  '可靠性交易'];
const _RE_IDIOMES_UNICODE = new RegExp(IDIOMES_UNICODE.join('|'), 'g');

// ═══════════════════════════════════════════════════════════════════════════
// TERMES. Syntaxe : « mot » = mot entier ; « mot* » = debut de mot ; « *mot* » (2026-10-13) = n'importe ou dans un mot.
// Les termes sont normalises comme le texte avant compilation : accents et ponctuation sans effet.
// ═══════════════════════════════════════════════════════════════════════════

interface Terme { src: string; re: RegExp; cat: CategorieBlocage }
/** Liste compilee. `rapide` (2026-10-13) : UNE expression qui accepte tout texte ou au moins un terme de la liste peut se
 *  trouver (meme debut de mot, sans la borne de fin) ; quand elle ne trouve rien, la liste est ecartee sans essayer ses
 *  termes un par un. Le resultat ne change pas, seul le temps baisse (la liste compte plusieurs centaines de termes). */
interface Liste { termes: Terme[]; bornes: string[]; infixes: string[]; rapide: RegExp | null }

function _echapper(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function _noyauSource(src: string): string { return src.replace(/^\*/, '').replace(/\*$/, ''); }
function _formeTerme(src: string): string { return _simple(_translit(_base(_noyauSource(src))), false); }
function _formeUnicode(src: string): string { return _vueUnicode(_nettoyer(_noyauSource(src))); }

function _liste(termes: Terme[], bornes: string[], infixes: string[]): Liste {
  const parties: string[] = [];
  if (bornes.length) parties.push('(?:^| )(?:' + bornes.join('|') + ')');
  if (infixes.length) parties.push('(?:' + infixes.join('|') + ')');
  return { termes, bornes, infixes, rapide: parties.length ? new RegExp(parties.join('|')) : null };
}
function _fusionner(...listes: Liste[]): Liste {
  return _liste(listes.flatMap((l) => l.termes), listes.flatMap((l) => l.bornes), listes.flatMap((l) => l.infixes));
}

function _compilerAvec(liste: string[], cat: CategorieBlocage, forme: (s: string) => string): Liste {
  const termes: Terme[] = [];
  const bornes: string[] = [];
  const infixes: string[] = [];
  for (const src of liste) {
    const infixe = src.startsWith('*');
    const prefixe = src.endsWith('*');
    const noyau = _echapper(forme(src));
    if (!noyau) continue;   // terme vide apres normalisation (idiome) : jamais compile en expression qui accepte tout
    termes.push({ src, cat, re: new RegExp((infixe ? '' : '(?:^| )') + noyau + (prefixe ? '' : '(?= |$)')) });
    (infixe ? infixes : bornes).push(noyau);
  }
  return _liste(termes, bornes, infixes);
}
function _compiler(liste: string[], cat: CategorieBlocage): Liste { return _compilerAvec(liste, cat, _formeTerme); }
function _compilerUnicode(liste: string[], cat: CategorieBlocage): Liste { return _compilerAvec(liste, cat, _formeUnicode); }

function _chercher(vues: string[], l: Liste): Terme | null {
  const rapide = l.rapide;
  if (!rapide || !vues.some((v) => rapide.test(v))) return null;
  for (const t of l.termes) for (const v of vues) if (t.re.test(v)) return t;
  return null;
}

function _nom(t: Terme): string { return _noyauSource(t.src); }

// ── Mineurs (A) ────────────────────────────────────────────────────────────
// Sans ambiguite : un seul de ces mots suffit a parler d'un mineur.
const MINEURS_FORT: string[] = [
  // anglais
  'child', 'children', 'childlike', 'child like', 'kid', 'kids', 'kiddo', 'kiddie', 'kiddy', 'infant*', 'baby', 'babies',
  'toddler*', 'preteen*', 'pre teen*', 'tween*', 'teen', 'teens', 'teenage*', 'teenager*', 'minor', 'minors', 'underage',
  'under age', 'juvenile*', 'prepubescent', 'pubescent', 'schoolgirl*', 'schoolboy*', 'school girl*', 'school boy*',
  'schoolchild*', 'little girl*', 'little boy*', 'small girl*', 'small boy*', 'young girl*', 'young boy*', 'young lad*', 'young teen*', 'young looking', 'looks young', 'looking young',
  'kindergarten*', 'preschool*', 'elementary school', 'primary school', 'middle school', 'junior high', 'high school',
  'highschool', 'under 18', 'below 18', 'less than 18', 'younger than 18', 'under eighteen', 'under 16', 'under 14',
  // anglais, 2026-10-13 (M3) : synonymes, classes d'ecole, formulations de l'age
  'newborn*', 'new born*', 'neonat*', 'youngster*', 'tots', 'schoolkid*', 'school kid*', 'little one', 'little ones',
  'youngling*', 'bairn*', 'tyke*', 'moppet*', 'rugrat*', 'street urchin*', 'underaged', 'under aged', 'little sister*',
  'little brother*', 'baby sister*', 'baby brother*', 'sweet sixteen', 'middle schooler*', 'high schooler*', 'grade school*',
  'sprog', 'sprogs',
  'elementary schooler*', 'kindergartner*', 'nursery school*', 'cub scout*', 'girl scout*', 'boy scout*',
  // 2026-10-14 (revue, B4) : l'eleve (« first grader ») ; la classe seule (« first grade ») est un INDICE : « first grade steel »
  // est aussi une qualite
  'first grader*', 'second grader*', 'third grader*', 'fourth grader*', 'fifth grader*', 'sixth grader*', 'seventh grader*',
  'eighth grader*', 'ninth grader*', 'tenth grader*', 'eleventh grader*', 'twelfth grader*', '1st grader*', '2nd grader*',
  '3rd grader*', '4th grader*', '5th grader*', '6th grader*', '7th grader*', '8th grader*', '9th grader*', '10th grader*',
  '11th grader*', '12th grader*',
  'below the age of 18', 'under the age of 18', 'not yet 18', 'not yet eighteen',
  // 2026-10-14 (revue, mineurs) : pluriels et graphies familieres
  'childs', 'kidz', 'kiddos', 'babys', 'lil girl*', 'lil boy*',
  // francais
  'enfant*', 'bebe*', 'gamin', 'gamine', 'gamins', 'gamines', 'gosse*', 'fillette*', 'garconnet*', 'mineur*', 'adolescent*', 'ado', 'ados', 'ecolier*',
  'ecoliere*', 'collegien*', 'lyceen*', 'nourrisson*', 'petite fille*', 'petit garcon*', 'jeune fille*', 'jeune garcon*',
  'moins de 18', 'marmot', 'marmots', 'mome', 'momes', 'petiot*', 'pitchoun*', 'nouveau ne*', 'nouveaux nes', 'preado*', 'pre ado*',
  // espagnol
  'nino*', 'nina*', 'nene', 'nena', 'menor', 'menores', 'adolescente*', 'chiquill*', 'preadolescente*', 'colegial*',
  'menos de 18', 'recien nacid*',
  // 2026-10-14 (seconde relecture) : « escolar » NOM (avec un article : « una escolar en la ducha ») ; seul, il reste ambigu
  'una escolar', 'un escolar', 'la escolar', 'el escolar', 'las escolares', 'los escolares', 'unas escolares', 'unos escolares',
  // allemand
  'kinder*', 'kleinkind*', 'madchen*', 'maedchen*', 'minderjahrig*', 'jugendlich*', 'schulmadchen*', 'unter 18', 'saugling*', 'teenie*',
  // portugais
  'crianca*', 'menino*', 'menina*', 'garotinho*', 'garotinha*', 'menininh*', 'nenem*', 'menor de idade',
  // italien
  'bambin*', 'ragazzin*', 'minorenn*', 'neonat*', 'fanciull*', 'sotto i 18', 'bimba', 'bimbe', 'bimbi', 'scolar*',
  // commun
  'infantil*', 'infante', 'infantes',
  // turc, neerlandais, polonais, indonesien, vietnamien (ecriture latine, 2026-10-13 : MODERATION-01)
  'cocuk*', 'cocug*', 'bebek*', 'kucuk kiz*', 'kucuk oglan*', 'resit olmayan', 'ergen*', 'ilkokul*',
  'peuter*', 'kleuter*', 'minderjarig*', 'jongetje*',
  'dziecko', 'dzieci*', 'dziecka', 'dziecku', 'dzieckiem', 'dziewczynk*', 'chlopczyk*', 'niemowl*', 'nieletni*',
  'anak', 'anak anak', 'balita', 'bayi', 'di bawah umur',
  'tre em', 'be gai', 'be trai', 'em be', 'thieu nhi', 'vi thanh nien', 'dua tre', 'tre con', 'con nit', 'cau be', 'co be',
  // allemand : « Kind » au singulier avec un determinant allemand n'est plus l'adjectif anglais « kind »
  'ein kind', 'das kind', 'dem kind', 'einem kind', 'kleines kind', 'kleinen kind', 'kindes', 'een kind', 'het kind',
];
// Ambigus : peuvent designer un adulte (ex. "young woman", "girl in a bikini").
const MINEURS_AMBIGUS: string[] = [
  'boy', 'boys', 'girl', 'girls', 'young', 'youth', 'youthful', 'lass', 'jeune', 'jeunes', 'fille', 'filles', 'garcon', 'garcons',
  'junge', 'junges', 'jungen', 'chico', 'chica', 'chicos', 'chicas', 'muchacho', 'muchacha', 'joven', 'jovenes',
  'ragazzo', 'ragazza', 'ragazzi', 'ragazze', 'garoto', 'garota', 'rapaz', 'rapariga',
  // Relecture 2026-10-03 : « Kind » (allemand, singulier) + nudite passait le plancher alors que « Kinder » / « Maedchen » / « Junge » le declenchaient. Ambigu avec l'adjectif anglais
  // « kind » : comme girl / boy il ne declenche donc le plancher qu'AVEC une nudite explicite.
  'kind',
  // 2026-10-13 : autres langues
  'chaval*', 'cria', 'crias', 'escolar', 'escolares', 'schuler*', 'kiz', 'kizlar*', 'oglan*', 'meisje*', 'jongen*', 'dziewczyn*', 'chlopiec', 'chlopc*', 'gadis',
  'remaja',
];
// INDICES (2026-10-13, M3) : le plus souvent des adultes. Declenchent le plancher seulement avec une nudite ou un acte
// EXPLICITE, jamais avec une tenue (« mother and daughter in swimsuits » reste permis).
const MINEURS_INDICES: string[] = ['daughter*', 'niece*', 'nephew*', 'little miss', 'lolita*', 'pupil', 'pupils', 'stepdaughter*', 'stepson*',
  // 2026-10-14 (revue, B4) : « nippers » (pinces), « first grade » (qualite) ; l'eleve « first grader » reste un mineur sur
  'nipper', 'nippers', 'first grade', 'second grade', 'third grade', 'fourth grade', 'fifth grade', 'sixth grade', 'seventh grade',
  'eighth grade', 'ninth grade', 'tenth grade', 'eleventh grade', 'twelfth grade', '1st grade', '2nd grade', '3rd grade', '4th grade',
  '5th grade', '6th grade', '7th grade', '8th grade', '9th grade', '10th grade', '11th grade', '12th grade'];
// « <classe> grade <eleve> » (« a first grade girl », « 3rd grade boys ») : mineur SANS ambiguite (2026-10-14, seconde relecture) ;
// la classe seule reste un indice. Termes construits : CLASSES_ORDINAUX x ELEVES_CLASSE (meme construction cote Python).
const CLASSES_ORDINAUX: string[] = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const ELEVES_CLASSE: string[] = ['girl*', 'boy*', 'student*', 'pupil*'];
// Mineurs pour les combinaisons de VIOLENCE du filtre general ("minor character" est un terme de jeu).
const MINEURS_VIOLENCE: string[] = [
  'child', 'children', 'kid', 'kids', 'baby', 'babies', 'infant*', 'toddler*', 'enfant*', 'bebe*', 'nino*', 'nina*', 'kinder*',
  'crianca*', 'bambin*',
];

// ── Nudite / sexe (B) ─────────────────────────────────────────────────────
// FORT : explicite. Avec n'importe quel mineur (ou age < 18), meme ambigu : plancher.
const NU_FORT: string[] = [
  // anglais
  '*nude*', 'nudity', '*naked*', '*nsfw*', 'porn*', 'xxx', 'erotic*', '*topless*', 'bottomless', 'undress*', 'unclothed', 'disrobe*',
  'unclad', 'wearing nothing', 'wears nothing', 'wear nothing', 'without clothes', 'without clothing', 'without any clothes',
  'without any clothing', 'no clothes', 'no clothing', 'wearing no clothes', 'in the nude', 'birthday suit', 'full frontal',
  'fully exposed', 'bare chest*', 'bare breast*', 'bare skin', 'bare butt', 'bare bottom', 'bare torso', 'barely clothed',
  'barely dressed', 'scantily clad', 'scantily dressed', 'sex', 'sexy', 'sexual*', 'sexually', 'sexualized', 'sexualised',
  'sensual*', 'seductive', 'provocative', 'suggestive', 'lingerie', 'underwear', 'panties', 'thong', 'fetish', 'bdsm', 'bondage',
  'nipple*', 'breasts', 'boobs', 'tits', 'genital*', 'vagina', 'penis', 'pussy', 'crotch', 'upskirt', 'cleavage', 'lewd', '*hentai*',
  'ecchi', 'orgasm*', 'masturb*', 'cum', 'ahegao',
  // anglais, 2026-10-13 (M1) : actes et anatomie explicites ; un seul de ces mots avec un mineur = plancher
  'blowjob*', 'blow job*', 'handjob*', 'hand job*', 'footjob*', 'foot job*', 'titjob*', 'titfuck*', 'rimjob*', 'fellat*',
  'cunniling*', 'anilingus', 'intercourse', 'coitus', 'copulat*', 'sodomy', 'sodomiz*', 'sodomis*', 'semen', 'sperm',
  'ejaculat*', 'cumshot*', 'cum shot*', 'creampie*', 'bukkake', 'gangbang*', 'gang bang*', 'orgy', 'orgies', 'threesome*',
  'bestiality', 'zoophil*', 'incest*', 'fisting', 'dildo*', 'butt plug*', 'buttplug*', 'vulva*', 'labia', 'clitor*',
  'clit', 'clits', 'areola*', 'scrotum*', 'testicle*', 'phallus*', 'pubic hair', 'pubes', 'private parts', 'intimate parts',
  'molest*', 'raped', 'raping', 'rapist*', 'prostitut*', 'stripper*', 'striptease*', 'strip tease*',
  'lap dance*', 'making love', 'make love', 'touching himself', 'touching herself', 'touching themselves', 'lifting her skirt',
  'lifts her skirt', 'lifted her skirt', 'skirt lift*', 'camel toe', 'nip slip', 'skinny dipping', 'in the buff', 'nudis*',
  'naturist*', 'milf', 'milfs', 'slut*', 'whore*', 'futanari', 'shemale*', 'dominatrix', 'ball gag*', 'ballgag*', 'anal', 'anus',
  // francais (« nu », « nue », « nus », « nues » sont dans NU_EXACTS : vue exacte)
  'nudite', 'denud*', 'deshabill*', 'sans vetement*', 'sans habit*', 'a poil', 'seins nus',
  'sein nu', 'sexe', 'sexuel*', 'erotique*', '*pornograph*', '*pornograf*', 'sensuel*', 'seducteur', 'provocant*', 'soutien gorge',
  'seins', 'tout nu', 'toute nue',
  'sous vetement*', 'en culotte', 'en string', 'en slip', 'en calecon', 'en petite tenue', 'devetu*', 'tenue d eve',
  'tenue d adam', 'plus simple appareil', 'sans rien sur le dos', 'nuisette*', 'sodomie', 'fellation', 'violee', 'violees',
  'attouchement*', 'partouze*',
  // espagnol
  '*desnud*', 'sin ropa', 'en cueros', 'sexo', 'lenceria', 'ropa interior', 'bragas', 'tanga', 'provocativ*',
  'senos', 'tetas', 'calzon', 'calzoncillo*', 'calzoncito*', 'en pelotas', 'sin nada puesto', 'ropa intima', 'follar', 'follando', 'abuso sexual',
  // allemand
  '*nackt*', 'ausgezogen', 'entkleidet', 'unbekleidet', 'oben ohne', 'ohne kleidung', 'ohne kleider', 'erotisch*', 'sexuell*',
  'unterwasche', 'sinnlich*', 'verfuhrerisch*', 'busen', 'titten', 'unterhose*', 'schlupfer*', 'reizwasche', 'entblosst*',
  'barbusig*', 'nackig*', 'fkk', 'geschlechtsverkehr', 'vergewaltig*', 'ficken', 'fickt', 'gefickt',
  // portugais (« nua », « nuas » : NU_EXACTS)
  'seminu*', 'sem roupa*', 'calcinha*',
  'roupa intima', 'peitos', 'seios', 'pelad*', 'de cueca', 'de cuecas', 'em cueca', 'em cuecas', 'despido', 'despida', 'despidos', 'despidas', 'nuazinh*',
  'trajes intimos', 'estupr*',
  // italien
  'nudo', 'nudi', 'nudita', 'spogliat*', 'spogliarsi', 'spogliarell*', 'svestit*',
  'senza vestiti', 'senza vestito', 'senza abiti', 'seno nudo', 'seni nudi',
  'nuda', 'sessuale', 'sesso', 'mutande', 'mutandin*', 'mutandon*', 'provocante', 'seni', 'tette', 'biancheria intima', 'perizoma', 'seno scoperto',
  'senza niente addosso', 'nudin*', 'in slip',
  // turc, neerlandais, polonais, indonesien, vietnamien (ecriture latine, 2026-10-13 : MODERATION-01)
  '*ciplak*', 'soyunmus', 'soyunuk', 'seks', 'seksi', 'seksuel*', 'erotik*', 'ic camasir*', 'kulot*', 'tecavuz*', 'taciz*',
  'cinsel*', 'mustehcen*',
  'naakt*', 'ontkleed*', 'ondergoed*', 'seksueel*',
  'nagie', 'nago', 'nagich', 'nagosc*', 'rozebran*', 'bielizn*', 'seksualn*',
  'telanjang', 'bugil', 'cabul*', 'pakaian dalam', 'pemerkosa*', 'mesum',
  'khoa than', 'khieu dam', 'do lot', 'hiep dam',
];
// Mots COURTS (« nu », « nue », « nua »...) : lus sur la VUE EXACTE (accents gardes, MODERATION-05) — le vietnamien « nữ »
// (femme) ou « nữa » se ramenait a « nu » / « nua » une fois les accents retires.
const NU_EXACTS: string[] = ['nu', 'nue', 'nus', 'nues', 'nua', 'nuas'];
// MOYEN : tenue minimale. Avec un mineur ou un age (et un mineur ambigu aussi).
const NU_MOYEN: string[] = [
  'bikini*', 'swimsuit', 'swim suit', 'bra', 'brassiere', 'shirtless', 'without a shirt', 'without shirt', 'no shirt', 'no top',
  'without top', 'without a top', 'without pants', 'no pants', 'without underwear', 'no underwear', 'diaper only',
  'sin camisa', 'sin camiseta', 'sin blusa', 'sans haut', 'sans t shirt', 'sans tee shirt', 'maillot de bain', 'ohne hemd',
  'ohne oberteil', 'badeanzug', 'sem camisa', 'sem blusa', 'biquini', 'senza maglia', 'senza maglietta', 'costume da bagno',
  // 2026-10-13 (M3)
  'without a skirt', 'without skirt', 'no skirt', 'see through dress', 'see through shirt', 'see through top', 'see through clothes',
  'see through clothing', 'see through outfit', 'transparent clothes', 'transparent clothing', 'transparent dress', 'wet t shirt',
  'wet tshirt', 'wet shirt', 'exposed chest', 'exposed torso', 'exposed body', 'boxer shorts', 'boxer briefs', 'in boxers',
  'tighty whities', 'couche culotte*', 'tenue legere', 'tenue transparente', 'poca ropa', 'traje de bano', 'sujetador*', 'sosten',
  // 'torse nu' et ses trois autres accords : IDIOMES_EXACTS les retire tous les quatre de la vue exacte, la production refusait le
  // mot « nu » / « nus » seul avec un mineur (cinquieme relecture, B4 : « enfant torse nus », « enfant torses nu »)
  'torse nu', 'torses nus', 'torse nus', 'torses nu',
  'badehose*', 'ohne hose', 'sutia', 'roupa transparente', 'sem camiseta', 'reggiseno', 'pigiama trasparente',
  // 2026-10-14 (revue) : « calzones » (espagnol : culotte ; anglais : pluriel de calzone) ; sous-vetements et maillots
  'calzones', 'underpants', 'undies', 'swimwear', 'swim trunks', 'swimming trunks', 'speedo', 'speedos', 'in briefs',
  'in his briefs', 'in her briefs', 'in their briefs',
  // 2026-10-14 (seconde relecture) : le pluriel manquait (« kids in swimsuits » passait, « kids in swimwear » non)
  'swimsuits', 'swim suits', 'bathing suit', 'bathing suits', 'swimming costume*',
];
// FAIBLE : vocabulaire de scene, seulement avec un mineur SANS ambiguite (plancher).
const NU_FAIBLE_PLANCHER: string[] = ['bath', 'bathing', 'shower', 'showering', 'intimate', 'revealing', 'bain', 'banho', 'bano',
  'badewanne', 'bagno',
  // 2026-10-13
  'douche', 'ducha', 'dusche', 'doccia', 'chuveiro', 'changing clothes', 'getting changed', 'only a towel',
  'only in a towel', 'just a towel', 'solo con una toalla', 'solo una toalla',
  // 2026-10-14 (revue, B4) : « in a towel », « wrapped in a towel » et « getting dressed » retires (« a kid in a towel after
  // swimming », « a kid getting dressed for school ») ; restent les tournures qui disent qu'il n'y a RIEN d'autre que la serviette
  'nothing but a towel', 'towel only', 'knickers'];
// FAIBLE, filtre general seulement.
const NU_FAIBLE_GENERAL: string[] = ['bed', 'bedroom'];
// SEXUEL AMBIGU (2026-10-13, M1) : argot et mots a double sens ; plancher seulement avec un mineur SANS ambiguite ou un age.
// 2026-10-14 (revue, B4) : « viol » (instrument en anglais), « brothel », « foursome » (golf) passent ici depuis NU_FORT, ou un
// mineur ambigu suffisait (« a young bard playing a viol », « a young knight in a brothel tavern »).
const SEXE_MINEUR_FORT: string[] = ['dick', 'dicks', 'erection*', 'boner*', 'hardon*', 'penetrating her', 'penetrating him',
  'being penetrated', 'spread legs', 'spreading her legs', 'spread her legs', 'legs spread', 'viol', 'brothel*', 'foursome*', 'cock',
  'cocks'];
// « cock » : avec un mineur sans ambiguite ou un age, toujours lu (plancher) ; le coq est reconnu par les EXPRESSIONS_SURES (« a
// cock and two hens », « a crowing cock »), seulement ecrites telles quelles (2026-10-14, seconde relecture du lot).

// Violence EXERCEE sur un enfant (plancher). Volontairement etroit : "kid with a knife"
// ou "child hero hit by a rock" ne sont pas des contenus illicites.
const VIOLENCE_ENFANT_PLANCHER: string[] = [
  'abuse*', 'abusing', 'hurt', 'hurting', 'beaten', 'beating', 'beat up', 'punch*', 'slap*', 'whip*', 'torture*', 'tortur*', 'rape*',
  'raped', 'raping', 'molest*', 'strangl*', 'suffocat*', 'mutilat*', 'dismember*', 'murder*',
  'frapp*', 'battu*', 'maltrait*', 'viole', 'violee', 'violer', 'agress*', 'abus', 'abuso*', 'misshandl*', 'missbrauch*',
  // 2026-10-13
  'spank*', 'gagged', 'istismar*',
];

// ── Termes illicites en soi (plancher) ────────────────────────────────────
const PLANCHER_MOTS: string[] = [
  'pedophil*', 'paedophil*', 'pedofil*', 'pedoporn*', 'pedocrim*', 'pedopornograf*', 'padophil*', 'lolicon*', 'loli', 'lolis',
  'shota', 'shotas', 'shotacon*', 'child abuse', 'child porn*', 'childporn*', 'child sex*', 'child rape', 'child exploitation',
  'kid porn*', 'kiddie porn*', 'kiddy porn*', 'baby porn*', 'underage porn*', 'underage sex*', 'underage nude*', 'csam',
  'jailbait', 'toddler abuse', 'infant abuse', 'toddlercon', 'babycon',
  'kinderporno*', 'kindesmissbrauch', 'kinderschander', 'pornografia infantil', 'porno infantil', 'pornoinfantil',
  'abuso infantil', 'abuso sexual infantil', 'pornographie enfantine', 'pornografia minorile',
  // 2026-10-13 (MODERATION-01)
  'cocuk porno*', 'cocuk istismari', 'pornografia dziecieca', 'pornografi anak', 'khieu dam tre em', 'kindermisbruik', 'pedofiel*',
  'nymphet*',
  // composes « enfant + pornographie » d'autres langues (sv, da, fi, hu, cs, pl) : le mineur est DANS le mot
  'barnporr*', 'barnporn*', 'borneporno*', 'lapsiporno*', 'gyermekporno*', 'detska pornografie', 'detske porno*', 'dziecieca pornografia',
];
// Versions "collees" (lettres seules) pour les separateurs exotiques : substring, donc seulement des termes longs.
const PLANCHER_COLLES: string[] = [
  'pedophil', 'paedophil', 'pedofil', 'lolicon', 'shotacon', 'childporn', 'childabuse', 'childsexualabuse', 'toddlerabuse',
  'infantabuse', 'kidporn', 'kiddieporn', 'kiddyporn', 'childsex', 'kinderporno', 'kindesmissbrauch', 'kinderschander',
  'pornoinfantil', 'pornografiainfantil', 'pedopornograph', 'pedopornograf', 'pedocriminel', 'jailbait', 'underageporn',
  'underagesex',
];
// Termes non latins (vue Unicode ; « *x* » = n'importe ou dans un mot). Illicites en soi.
const PLANCHER_UNICODE: string[] = [
  '*педофил*',                                   // pedofil (russe)
  '*детское порно*',     // detskoe porno
  '*детская порно*',     // detskaya porno
  '*детского порно*', // detskogo porno
  '*ロリコン*', '*ショタコン*',                   // lolicon, shotacon (japonais)
  '*児童ポルノ*', '*兒童色情*', '*儿童色情*', // pornographie enfantine
  // 2026-10-13 (MODERATION-01) : pedophilie (zh), pornographie enfantine (ko, ar, hi), abus sexuel d'enfant (hi)
  '*恋童*', '*戀童*', '*아동 포르노*', '*아동포르노*', '*아동 음란물*', '*아동음란물*', '*اباحية الاطفال*', '*اباحية اطفال*',
  '*बाल पोर्न*', '*बाल अश्लील*', '*बाल यौन शोषण*',
];

// ── Lexique des ecritures NON LATINES (vue Unicode, 2026-10-13 : MODERATION-01) ─────────────────────────────────
// Langues de l'interface (zh, hi, ar) et les plus courantes (ru, ja, ko ; tr, nl, pl, id, vi sont en ecriture latine,
// plus haut). Formes ecrites telles qu'on les tape : la normalisation (marques, katakana, alef...) s'applique au texte ET au
// terme. Sans locuteur natif : chaque terme est un mot courant et non ambigu ; les mots trop courts ou a double sens
// (coreen « 아이 » dans « 아이템 », arabe « جنس » = nationalite) sont ecrits sous leurs seules formes sures.
const MINEURS_FORT_UNICODE: string[] = [
  // chinois (simplifie et traditionnel)
  '*儿童*', '*兒童*', '*孩子*', '*小孩*', '*幼女*', '*幼童*', '*幼儿*', '*幼兒*', '*婴儿*', '*嬰兒*', '*宝宝*', '*寶寶*', '*未成年*',
  '*小学生*', '*小學生*', '*中学生*', '*中學生*', '*初中生*', '*小女孩*', '*小男孩*', '*萝莉*', '*蘿莉*', '*正太*',
  // japonais
  '*子供*', '*子ども*', '*こども*', '*児童*', '*幼児*', '*乳児*', '*赤ちゃん*', '*赤ん坊*', 'ロリ', '*ロリっ子*', '*ショタ*', '*十代*', '*園児*',
  // coreen
  '*어린이*', '*아동*', '*어린아이*', '*여자아이*', '*남자아이*', '*아기*', '*유아*', '*미성년*', '*초등학생*', '*중학생*', '로리',
  '쇼타', '아이', '아이가', '아이는', '아이를', '아이의', '아이와', '아이들*',
  // arabe
  '*طفل*', '*أطفال*', '*رضيع*', '*قاصر*', '*مراهق*', 'صبي', 'الصبي', 'صبية',
  // hindi
  'बच्च*', 'बालक', 'बालकों', 'बालिका', 'बालिकाएं', 'बालिकाएँ', 'बालिकाओं', 'शिशु*', 'नाबालिग*',
  // russe, ukrainien
  'ребёнок', 'ребёнк*', 'ребенок', 'ребенк*', 'дети', 'детей', 'детям', 'детьми', 'детях', 'детск*', 'детишк*', 'малыш*',
  'младен*', 'девочк*', 'мальчик*', 'школьниц*', 'школьник*', 'подрост*', 'несовершеннолетн*', 'малолетн*', 'дитя', 'дитин*',
  'дитяч*', 'діти',
  'дітей', 'дівчинк*', 'хлопчик*',
  // emoji (bebe, enfant)
  '*\u{1F476}*', '*\u{1F9D2}*',
];
const MINEURS_AMBIGUS_UNICODE: string[] = [
  '*女孩*', '*男孩*', '*少女*', '*少年*', '*女の子*', '*男の子*', '*소녀*', '*소년*', 'فتاة', 'الفتاة', 'بنت', 'البنت', 'بنات',
  'ولد', 'الولد', 'أولاد', 'الأولاد',
  'البنات', 'लड़क*', 'लडक*', 'किशोर*',
  // emoji (fille, garcon)
  '*\u{1F467}*', '*\u{1F466}*',
];
// Nudite / sexe EXPLICITES (plancher avec n'importe quel mineur ; filtre general : bloque seul).
const NU_FORT_UNICODE: string[] = [
  // chinois
  '*裸体*', '*裸體*', '*全裸*', '*半裸*', '*裸露*', '*裸照*', '*裸女*', '*裸男*', '*裸身*', '*赤裸*', '*一丝不挂*', '*一絲不掛*',
  '*没穿衣服*', '*沒穿衣服*', '*不穿衣服*', '*脱光*', '*脫光*', '*色情*', '*情色*', '*内衣*', '*內衣*', '*内裤*', '*內褲*', '*性交*',
  '*做爱*', '*做愛*', '*口交*', '*强奸*', '*強姦*', '*強暴*', '*猥亵*', '*猥褻*', '*自慰*', '*阴道*', '*陰道*', '*阴茎*', '*陰莖*',
  '*乳头*', '*乳頭*', '*淫*', '*裸*',
  // japonais
  '*裸の*', '*裸で*', '*裸に*', '*はだか*', '*ヌード*', '*セックス*', '*ポルノ*', '*エロい*', '*エロ画*', '*エロ漫*', '*エロ同人*',
  '*エッチな*', '*下着*', '*パンティ*', '*性的な*', '*性的に*', '*おっぱい*', '*乳首*', '*レイプ*', '*痴漢*', '*援交*', '*援助交際*', '*脱衣*',
  '*服を着ていない*',
  // coreen
  '*벌거벗*', '*알몸*', '*나체*', '*누드*', '*섹스*', '*성관계*', '*성행위*', '*음란*', '*포르노*', '*야동*', '*속옷*', '*팬티*',
  '*강간*', '*성폭행*', '*성추행*', '*자위하*', '*자위행위*', '*젖꼭지*', '*생식기*',
  // arabe
  '*عاري*', 'عار', '*عريان*', '*عراة*', '*متعري*', 'التعري', 'عري', '*بدون ملابس*', '*بلا ملابس*', '*ملابس داخلية*',
  '*ممارسة الجنس*', '*اعتداء جنسي*', '*جنسيا*', '*إباحي*', '*بورنو*', 'بورن', '*اغتصاب*', '*تحرش*', '*عورة*', '*مهبل*',
  '*استمناء*', 'سكس',
  // hindi
  'नग्न*', 'नंगा', 'नंगी', 'नंगे', 'निर्वस्त्र*', 'बिना कपड*', 'कपड़े नहीं', 'कपडे नहीं', '*अश्लील*', '*पोर्न*', 'सेक्स*', 'यौन*',
  '*बलात्कार*', '*अंतर्वस्त्र*', 'कामुक*', '*हस्तमैथुन*',
  // russe, ukrainien
  'голый', 'голая', 'голое', 'голые', 'голого', 'голой', 'голым', 'голую', 'голых', 'голыми', 'голеньк*', 'голышом', 'обнажённ*',
  'нагой', 'нагая', 'нагое', 'нагие', 'нагую', 'нагишом', 'раздет*', 'раздевается', 'раздеваться', 'раздевающ*', 'без одежды', 'секс', 'секса', 'сексом', 'сексу',
  'сексуальн*', 'порн*', 'эрот*', 'нижнее бельё', 'нижнем белье', 'нижнего белья', 'трусик*', 'в трусах', 'минет*',
  'изнасил*', 'мастурб*', 'половой акт', 'половые органы', 'половых органов', 'гениталии', 'пенис*', 'вагин*', 'совокупле*', 'совокупля*',
  'растлен*', 'голий', 'голе', 'голі', 'оголен*',
  // emoji (« reserve aux adultes »)
  '*\u{1F51E}*',
];
// SUGGESTIF (« sexy ») : plancher avec un mineur ; le filtre general ne le bloque pas seul (comme l'anglais « sexy »).
const NU_SUGGESTIF_UNICODE: string[] = ['*性感*', '*セクシー*', '*섹시*', '야한', 'секси', 'сексапильн*', '*مثيرة جنسيا*'];
// Tenue minimale (plancher avec un mineur, meme ambigu, ou un age).
const NU_MOYEN_UNICODE: string[] = [
  '*比基尼*', '*泳装*', '*泳裝*', '*泳衣*', '*ビキニ*', '*水着*', '*スク水*', '*비키니*', '*수영복*', '*بكيني*', '*مايوه*',
  '*ملابس السباحة*', 'बिकिनी*', 'स्विमसूट*', 'चड्डी*', 'бикини', 'купальник*',
  '*\u{1F459}*', '*\u{1FA72}*', '*\u{1FA71}*',     // emoji : bikini, slip, maillot une piece
];
// Scene (bain, douche) : plancher seulement avec un mineur SANS ambiguite ou un age.
const NU_FAIBLE_UNICODE: string[] = ['*洗澡*', '*淋浴*', '*お風呂*', '*入浴*', '*シャワー*', '*목욕*', '*샤워*', '*استحمام*', 'नहा*',
  'душ', 'душе', 'в ванне', 'купа*'];
// Violence exercee sur un enfant (plancher, mineur sans ambiguite ou age).
const VIOLENCE_UNICODE: string[] = ['*虐待*', '*殴打*', '*毆打*', '*학대*', '*폭행*', '*تعذيب*', 'शोषण*', 'मारपीट*', 'избиени*',
  'насили*', 'истязан*'];

// Dans une serie de lettres isolees ("c h i l d n u d e") on ne sait pas ou finissent les mots : on cherche
// un mineur ET une nudite comme sous-chaines de la serie (une serie de 6 lettres isolees est tres rare).
const SERIE_MINEURS: string[] = ['kind', 'child', 'kid', 'girl', 'boy', 'teen', 'baby', 'infant', 'toddler', 'schoolgirl', 'young', 'preteen',
  'minor', 'enfant', 'fille', 'garcon', 'nino', 'nina', 'kinder', 'madchen', 'bambin', 'crianca', 'menina', 'menino'];
const SERIE_NUDITE: string[] = ['nude', 'naked', 'topless', 'undress', 'sexy', 'porn', 'bikini', 'lingerie', 'panties', 'underwear',
  'nsfw', 'erotic', 'sensual', 'seductive', 'shirtless', 'desnud', 'nackt', 'nuda', 'nudo', 'nua', 'sexual', 'withoutclothes', 'noclothes',
  'wearingnothing'];

// Mots COLLES (2026-10-13, M2) : un mineur et une nudite dans UN SEUL mot, l'un juste apres l'autre (« childnaked »,
// « nakedchild », « kidnude », « ChildNaked »). CLIP decoupe ces mots exactement a la frontiere (child|naked) : le modele lit
// les deux. Les nudites COURTES (« nu », « sex »...) seulement au bord du mot (« enfantnu », mais pas « babynurse »).
const COLLE_MINEURS: string[] = ['child', 'children', 'childs', 'kid', 'kids', 'kiddie', 'kiddy', 'baby', 'babies', 'toddler',
  'toddlers', 'infant', 'infants', 'preteen', 'preteens', 'teen', 'teens', 'teenage', 'teenager', 'schoolgirl', 'schoolgirls',
  'schoolboy', 'schoolboys', 'girl', 'girls', 'boy', 'boys', 'littlegirl', 'littleboy', 'younggirl', 'youngboy', 'loli', 'shota',
  'underage', 'minor', 'minors', 'enfant', 'enfants', 'fillette', 'fillettes', 'gamin', 'gamine', 'bebe', 'bebes', 'nino', 'nina',
  'ninos', 'ninas', 'nene', 'nena', 'kinder', 'kind', 'madchen', 'maedchen', 'bambino', 'bambina', 'bambini', 'bambine', 'bimba',
  'garcon', 'garcons', 'garconnet', 'fille', 'filles',
  'crianca', 'criancas', 'menina', 'menino', 'meninas', 'meninos', 'ragazzina', 'ragazzino', 'cocuk', 'dziecko'];
const COLLE_NUDITE: string[] = ['naked', 'nude', 'nudes', 'nudity', 'nackt', 'nackte', 'nackter', 'nacktes', 'nackten', 'desnudo',
  'desnuda', 'desnudos', 'desnudas', 'topless', 'bottomless', 'undressed', 'undressing', 'undress', 'lingerie', 'panties', 'bikini',
  'porn', 'porno', 'sexy', 'sexual', 'erotic', 'erotica', 'hentai', 'nsfw', 'nipple', 'nipples', 'genitals', 'vagina', 'penis',
  'pussy', 'blowjob', 'handjob', 'footjob', 'fellatio', 'cunnilingus', 'semen', 'sperm', 'orgasm', 'masturbating', 'masturbation',
  'molested', 'raped', 'ciplak', 'naakt', 'pelada', 'pelado', 'pelados', 'seminua', 'seminude', 'nudo', 'nuda', 'nudi'];
const COLLE_NUDITE_BORD: string[] = ['nu', 'nue', 'nus', 'nues', 'nua', 'nuas', 'sex'];
const _ALT_M = '(?:' + COLLE_MINEURS.join('|') + ')';
const _ALT_N = '(?:' + COLLE_NUDITE.join('|') + ')';
const _ALT_B = '(?:' + COLLE_NUDITE_BORD.join('|') + ')';
const _RE_COLLE = new RegExp(_ALT_M + _ALT_N + '|' + _ALT_N + _ALT_M + '|' + _ALT_M + _ALT_B + '$|^' + _ALT_B + _ALT_M);

/** Un mot de la vue contient un mineur et une nudite colles (et n'est pas lui-meme un terme connu : ce cas passe ailleurs). */
function _colle(vue: string): boolean {
  for (const jeton of vue.split(' ')) if (jeton.length >= 5 && _RE_COLLE.test(jeton)) return true;
  return false;
}

// ── Ages (plancher) ────────────────────────────────────────────────────────
const _NOMBRES_LETTRES: string[] = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen',
  'un', 'une', 'deux', 'trois', 'quatre', 'cinq', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze',
  'seize', 'dix sept',
  'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce',
  'quince', 'dieciseis', 'diecisiete', 'diez y seis', 'diez y siete',
  'ein', 'eine', 'eins', 'zwei', 'drei', 'vier', 'funf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwolf', 'dreizehn',
  'vierzehn', 'funfzehn', 'sechzehn', 'siebzehn', 'fuenf', 'zwoelf', 'fuenfzehn',
  'um', 'uma', 'dois', 'duas', 'sete', 'oito', 'dez', 'doze', 'treze', 'catorze', 'dezesseis', 'dezasseis', 'dezessete', 'dezassete',
  'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici',
  'sedici', 'diciassette',
];
// Nombres en lettres qui sont AUSSI des mots courants apres un prefixe ANGLAIS (« aged elf », « the age of elf », « ages due »,
// « age um bikini », « Moyen Age, une epee », « an age once forgotten ») : pas lus comme un age apres `PREFIXES_AGE_ANGLAIS`
// (2026-10-13, MODERATION-05) ; toujours lus devant une unite (« elf Jahre alt »). 2026-10-15 (controle exhaustif des ages de
// la production) : la liste valait
// pour TOUS les prefixes et comptait aussi « one », « once », « tres », « otto »... : « eine Person, Alter elf », « edad once »,
// « eta di tre », « idade um », « a person aged one » perdaient l'age (la production les lisait) ; apres un prefixe d'une autre
// langue, tout nombre est lu.
const NOMBRES_AMBIGUS: string[] = ['elf', 'due', 'um', 'un', 'une', 'once'];
// ... sauf suivis d'une unite de temps (« age : un an », « aged elf Jahre ») : alors un age, comme en production.
const UNITES_APRES_AMBIGU: string[] = ['an', 'ans', 'annees?', 'mois', 'semaines?', 'jours?', 'anos?', 'ann[oi]', 'jahre?', 'years?', 'months?',
  'mes', 'meses', 'mesi', 'mese', 'monate?', 'weeks?', 'wochen?'];
const PREFIXES_AGE_ANGLAIS: string[] = ['aged?', 'age of', 'ages', 'just turned'];
// Ce qui suit un nombre et en fait un GRAND nombre (« aged ten thousand years », « aged 10 000 years ») : pas un age < 18.
// 2026-10-14 (quatrieme relecture, R1) : en chiffres, seulement un groupe de TROIS chiffres suivi d'une unite ; avant, un chiffre
// quelconque suffisait et « aged 12, 2 ponytails » ou « (aged:1.3) 12 » perdaient l'age (la production les lisait).
const GRANDS_NOMBRES: string[] = [
  '[0-9]{3}(?: [0-9]{3})* (?:years?|yrs?|ans|anos|anni|annees|anys|jahre|jahren|mois|months?|meses|mesi|siecles?|centuries|century)',
  'thousands?', 'hundreds?', 'millions?', 'billions?', 'dozens?', 'mille', 'milles', 'cents?',
  'milliers?', 'milliards?', 'mil', 'miles', 'millones', 'millon', 'tausend', 'hundert', 'millionen', 'milliarden', 'mila', 'cento',
  'centinaia', 'milioni', 'centenas?', 'centenares', 'milhares', 'milhoes', 'milhao'];
const UNITES_AGE: string[] = ['yo', 'y o', 'yr old', 'yrs old', 'yr o', 'years? old', 'year olds?', 'yearold', 'yrold', 'years? of age',
  'yrs? of age', 'years? young', 'yrs? young', 'months? old', 'jahre alt', 'jahrig[a-z]*', 'j alt', 'monate alt', 'yasinda[a-z]*',
  'jaar oud', 'jarig[a-z]*', 'letni[a-z]*', 'lat', 'tahun', 'tuoi'];
// « ans », « anos », « anni », « mois » : TOUJOURS un age, SAUF suivis de « de <duree> » ou <duree> est dans la liste FERMEE
// DUREES_NON_AGE (« dix ans de guerre », « 10 ans d'experience »). 2026-10-14 (seconde relecture, B2) : l'exception valait pour
// tout nom apres « de » et « une fille, 10 ans de taille moyenne, dans le bain », « 12 anos de vida », « 10 anni di vita »
// perdaient leur age (la production les bloquait) ; c'est desormais la liste des durees qui est fermee, pas celle des ages.
const UNITES_AGE_ROMANES: string[] = ['ans', 'anos', 'anni', 'mois', 'meses', 'mesi'];
const COMPLEMENTS_DE: string[] = ['de', 'd', 'du', 'des', 'del', 'di', 'da', 'do', 'della', 'dei', 'dos', 'das'];
// Complements qui font de « N ans de X » une DUREE (fr, es, pt, it ; sans accents). « vie », « vida », « vita », « existence »,
// « taille », « age », « edad » n'y sont PAS : « 10 ans de vie » est un age. Avec un mineur ambigu NOMME (fille, girl, garota...)
// ou un indice, meme une duree de la liste compte comme un age (`_RE_AGE_ROMAN_LARGE`) : « une fille, 10 ans de guerre, au bain ».
const DUREES_NON_AGE: string[] = [
  // francais
  'guerres?', 'services?', 'travail', 'travaux', 'experiences?', 'carrieres?', 'mariage', 'prison', 'captivite', 'exil', 'paix',
  'regne', 'combats?', 'batailles?', 'conflits?', 'luttes?', 'siege', 'entrainement', 'pratique', 'metier', 'apprentissage',
  'formation', 'etudes?', 'recherches?', 'voyages?', 'errance', 'retard', 'absence', 'silence', 'sommeil', 'garantie', 'anciennete',
  'activite', 'chantier', 'construction', 'restauration', 'occupation', 'dictature', 'crise', 'attente', 'amitie', 'labeur',
  'solitude', 'emprisonnement', 'detention', 'isolement', 'campagnes?', 'missions?', 'quete', 'navigation', 'patrouilles?',
  'commandement', 'pouvoir', 'tyrannie', 'esclavage', 'servitude', 'resistance', 'souffrance', 'misere', 'famine', 'secheresse',
  'hiver', 'nuit', 'tenebres', 'malediction', 'hibernation', 'exploitation', 'vieillissement', 'loyaux', 'bons',
  // espagnol
  'guerras?', 'servicio', 'trabajo', 'experiencia', 'carrera', 'matrimonio', 'prision', 'carcel', 'cautiverio', 'exilio', 'paz',
  'reinado', 'combates?', 'batallas?', 'conflictos?', 'luchas?', 'asedio', 'entrenamiento', 'practica', 'oficio', 'aprendizaje',
  'estudios?', 'investigacion', 'viajes?', 'retraso', 'ausencia', 'silencio', 'garantia', 'antiguedad', 'dictadura', 'crisis',
  'espera', 'amistad', 'soledad', 'esclavitud', 'campanas?', 'mision', 'busqueda', 'mando', 'tirania', 'sufrimiento', 'invierno',
  'oscuridad', 'maldicion', 'construccion', 'obras?',
  // portugais
  'servico', 'trabalho', 'carreira', 'casamento', 'prisao', 'cadeia', 'cativeiro', 'cerco', 'treino', 'treinamento', 'pratica',
  'aprendizado', 'estudos?', 'pesquisa', 'viagens?', 'atraso', 'solidao', 'escravidao', 'campanhas?', 'missao', 'busca',
  'comando', 'sofrimento', 'inverno', 'escuridao', 'maldicao', 'construcao',
  // italien
  'servizio', 'lavoro', 'esperienza', 'carriera', 'prigione', 'prigionia', 'carcere', 'esilio', 'pace',
  'regno', 'combattimenti?', 'battaglie?', 'battaglia', 'conflitti?', 'conflitto', 'lotta', 'lotte', 'assedio', 'allenamento',
  'mestiere', 'apprendistato', 'studi', 'studio', 'ricerche?', 'ricerca', 'viaggi', 'viaggio', 'ritardo', 'assenza', 'silenzio',
  'garanzia', 'anzianita', 'dittatura', 'crisi', 'attesa', 'amicizia', 'solitudine', 'schiavitu', 'campagna', 'missione',
  'potere', 'tirannia', 'sofferenza', 'costruzione', 'lavori',
  // 2026-10-14 (troisieme relecture) : durees de personnages adultes refusees a tort comme un age (« un pirate torse nu, 10 ans de
  // mer », « 12 ans de croisade », « 10 ans de retraite », « 10 ans de legion », « 10 ans d'aventures », « 12 anos de aventuras »)
  'mers?', 'croisades?', 'retraites?', 'legions?', 'aventures?', 'gladiature', 'forets?', 'piraterie', 'brigandage', 'chasses?',
  'expeditions?', 'explorations?', 'bagne', 'galeres?', 'pelerinages?', 'meditation', 'prieres?', 'monastere', 'couvent', 'cachot',
  'forge', 'magie', 'sorcellerie', 'alchimie', 'marine', 'mercenariat', 'vagabondage', 'contrebande', 'routes?',
  'mar', 'mares', 'cruzadas?', 'retiro', 'legion', 'legiones', 'aventuras?', 'bosques?', 'selvas?', 'pirateria', 'caza',
  'expedicion', 'expediciones', 'exploracion', 'peregrinacion', 'meditacion', 'oracion', 'monasterio', 'convento', 'calabozo',
  'mazmorras?', 'fragua', 'magia', 'hechiceria', 'alquimia', 'navegacion', 'marina', 'contrabando',
  'legiao', 'florestas?', 'pirataria', 'expedicao', 'exploracao', 'peregrinacao', 'meditacao', 'oracao', 'mosteiro',
  'masmorras?', 'forja', 'feiticaria', 'navegacao', 'marinha',
  'mare', 'mari', 'crociate', 'crociata', 'ritiro', 'legione', 'avventure', 'avventura', 'foreste', 'foresta', 'boschi', 'bosco',
  'caccia', 'spedizioni', 'spedizione', 'esplorazione', 'pellegrinaggio', 'meditazione', 'preghiera', 'monastero', 'segrete',
  'fucina', 'stregoneria', 'alchimia', 'navigazione', 'contrabbando',
];
// Mineurs ambigus qui sont des ADJECTIFS (« un jeune guerrier, dix ans de guerre ») : ils ne font pas lire une duree comme un age.
const ADJECTIFS_JEUNESSE: string[] = ['young', 'youth', 'youthful', 'jeune', 'jeunes', 'joven', 'jovenes', 'kind'];
// Prefixes des autres langues (fr, es, de, it, pt) : tout nombre de 0 a 17, en chiffres ou en lettres, est lu apres eux.
const PREFIXES_AGE: string[] = ['age de', 'agee de', 'agee', 'edad de', 'edad', 'alter von', 'alter', 'eta di', 'idade de', 'idade'];
// Allemand compose : « zehnjaehrig », « elfjaehrige » (le nombre colle a l'unite).
const NOMBRES_COMPOSES_DE: string[] = ['ein', 'zwei', 'drei', 'vier', 'funf', 'fuenf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf',
  'zwolf', 'zwoelf', 'dreizehn', 'vierzehn', 'funfzehn', 'fuenfzehn', 'sechzehn', 'siebzehn'];
// « born in 2018 », « ne en 2015 » : mineur si l'annee est a moins de 18 ans de l'annee en cours.
const PREFIXES_NAISSANCE: string[] = ['born', 'born in', 'ne en', 'nee en', 'nacido en', 'nacida en', 'geboren', 'geboren im jahr',
  'nato nel', 'nata nel', 'nascido em', 'nascida em'];
// Ecritures non latines (vue Unicode) : unites apres un nombre (ecrites sous leur forme normalisee : ة -> ه, sans ё ni й),
// et prefixes (« عمرها 10 »).
const UNITES_AGE_UNICODE: string[] = ['岁', '歲', '歳', '才', '살(?:의|짜리)?(?![가-힣])', '세(?:의|짜리)?(?![가-힣])', 'лет', 'года',
  'годик', 'летн', 'годовал', 'років', 'роки', 'річн', 'سنوات', 'سنه', 'سنين', 'عام', 'اعوام', 'साल', 'वर्ष'];
const PREFIXES_AGE_UNICODE: string[] = ['عمره', 'عمرها', 'بعمر', 'उम्र'];

const _alt = (l: string[]) => '(?:' + l.join('|') + ')';
const _parLongueur = (l: string[]) => Array.from(new Set(l)).sort((a, b) => b.length - a.length);
const _NB_LETTRES = '(?<![a-z])' + _alt(_parLongueur(_NOMBRES_LETTRES).map(_echapper)) + '(?![a-z])';
const _NB_LETTRES_SURS = '(?<![a-z])(?:' + _alt(_parLongueur(_NOMBRES_LETTRES.filter((x) => !NOMBRES_AMBIGUS.includes(x))).map(_echapper))
  + '|' + _alt(NOMBRES_AMBIGUS) + '(?= ' + _alt(UNITES_APRES_AMBIGU) + '(?![a-z])))(?![a-z])';
const _NB_CHIFFRES = '(?<![0-9])(?:1[0-7]|0?[0-9])(?![0-9])';
const _PAS_GRAND = '(?! ?' + _alt(GRANDS_NOMBRES) + '(?![a-z]))';
const _NB = '(?:' + _NB_CHIFFRES + '|' + _NB_LETTRES + ')' + _PAS_GRAND;
const _NB_APRES_PREFIXE_ANGLAIS = '(?:' + _NB_CHIFFRES + '|' + _NB_LETTRES_SURS + ')' + _PAS_GRAND;
const _UNITE_ROMANE = _alt(UNITES_AGE_ROMANES) + '(?![a-z])(?! ' + _alt(COMPLEMENTS_DE) + ' ' + _alt(DUREES_NON_AGE) + '(?![a-z]))';
const _UNITE = '(?:' + _alt(UNITES_AGE) + '(?![a-z])|' + _UNITE_ROMANE + ')';
const _RE_AGE = new RegExp('(?:^| )' + _NB + ' ?' + _UNITE
  + '|(?:^| )' + _alt(PREFIXES_AGE_ANGLAIS) + ' ?' + _NB_APRES_PREFIXE_ANGLAIS + '(?![a-z0-9])'
  + '|(?:^| )' + _alt(PREFIXES_AGE) + ' ?' + _NB + '(?![a-z0-9])'
  + '|(?:^| )' + _alt(NOMBRES_COMPOSES_DE) + 'jahrig');
/** « N ans / anos / anni / mois » quel que soit le complement (durees comprises) : lu comme un age quand un mineur ambigu NOMME
 *  ou un indice est dans le texte (2026-10-14, seconde relecture B2). */
const _RE_AGE_ROMAN_LARGE = new RegExp('(?:^| )' + _NB + ' ?' + _alt(UNITES_AGE_ROMANES) + '(?![a-z])');
const _RE_NAISSANCE = new RegExp('(?:^| )' + _alt(_parLongueur(PREFIXES_NAISSANCE)) + ' ((?:19|20)[0-9][0-9])(?![0-9])', 'g');
const _NB_CHIFFRES_U = '(?<![0-9])(?:1[0-7]|0?[0-9])(?! ?[0-9])';
const _NB_HAN = '(?<![一二三四五六七八九十百千两兩])(?:十[一二三四五六七]?|[一二三四五六七八九两兩])';
const _RE_AGE_UNICODE = new RegExp(_NB_CHIFFRES_U + ' ?' + _alt(UNITES_AGE_UNICODE) + '|' + _NB_HAN + '(?:岁|歲|歳|才)|'
  + _alt(PREFIXES_AGE_UNICODE) + ' ?' + _NB_CHIFFRES_U);

// MINEURS CONSTRUITS (2026-10-14, troisieme relecture) : mineurs SANS ambiguite reconnus a leur construction.
// « escolar » NOM apres un determinant, un possessif, un demonstratif ou un adjectif (« una joven escolar », « mi escolar », « esta
// escolar ») ; les emplois adjectifs apres un objet ou un lieu (« mochila escolar ») sont retires avant par les EXPRESSIONS_SURES,
// « escolar » seul reste ambigu. La classe ecrite autrement : « a grade one girl », « a girl from first grade », « boys in the 3rd
// grade » (« a first grade girl » : termes CLASSES_ORDINAUX x ELEVES_CLASSE).
const AVANT_ESCOLAR: string[] = [
  'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'nuestra', 'nuestro', 'nuestras',
  'nuestros', 'vuestra', 'vuestro', 'vuestras', 'vuestros', 'esta', 'este', 'estas', 'estos', 'esa', 'ese', 'esas', 'esos',
  'aquella', 'aquel', 'aquellas', 'aquellos', 'otra', 'otro', 'otras', 'otros', 'cada', 'alguna', 'algun', 'algunas', 'algunos',
  'varias', 'varios', 'muchas', 'muchos', 'pocas', 'pocos', 'dos', 'tres', 'cuatro', 'cinco',
  'joven', 'jovenes', 'pequena', 'pequeno', 'pequenas', 'pequenos', 'pequenita', 'pequenito', 'jovencita', 'jovencito', 'nueva',
  'nuevo', 'nuevas', 'nuevos', 'linda', 'lindo', 'lindas', 'lindos', 'guapa', 'guapo', 'guapas', 'guapos', 'bonita', 'bonito',
  'bonitas', 'bonitos', 'hermosa', 'hermoso', 'hermosas', 'hermosos', 'tierna', 'tierno', 'timida', 'timido', 'dulce', 'dulces',
  'inocente', 'inocentes', 'traviesa', 'travieso', 'adorable', 'adorables', 'pobre', 'pobres', 'buena', 'buen', 'buenas', 'buenos',
  'primera', 'primer', 'mejor', 'mejores', 'sola', 'solo', 'triste', 'feliz', 'curiosa', 'curioso', 'aplicada', 'aplicado', 'sexy',
];
const NOMBRES_CLASSE: string[] = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const _RE_MINEURS_CONSTRUITS = new RegExp('(?:^| )' + _alt(AVANT_ESCOLAR) + ' escolar(?:es)?(?= |$)'
  + '|(?:^| )grade ' + _alt(NOMBRES_CLASSE) + ' (?:girl|boy|student|pupil)'
  + '|(?:^| )(?:girl|boy|student|pupil)s? (?:from|in|of) (?:the )?' + _alt(CLASSES_ORDINAUX) + ' grade(?= |$)');

/** « born in 2018 » : vrai si l'annee de naissance est a moins de 18 ans de l'annee en cours (horloge UTC). */
function _ageParNaissance(vue: string): boolean {
  const an = new Date().getUTCFullYear();
  for (const m of vue.matchAll(_RE_NAISSANCE)) {
    const y = Number(m[1]);
    if (y > an - 18 && y <= an) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTRE GENERAL — listes
// ═══════════════════════════════════════════════════════════════════════════

// Explicite : bloque seul (toujours teste sur la version normalisee aussi).
const GENERAL_SEXUEL_DUR: string[] = [
  '*nude*', 'nudity', '*naked*', '*nsfw*', 'porn*', 'xxx', 'sex', 'sexual*', 'sexually', 'sexe', 'sexuel*', 'sexo', 'sesso', 'sessuale',
  'erotic*', 'erotique*', '*hentai*', 'lewd', '*topless*', 'bottomless', 'lingerie', 'bikini*', 'underwear', 'undress*', 'stripper*',
  'striptease', 'orgasm*', 'fetish', 'bdsm', 'bondage', 'prostitut*', 'brothel*', 'genital*', 'penis', 'vagina', 'nipple*',
  'buttock*', 'anus', 'anal', 'oral sex', 'fellat*', 'cunniling*', 'masturb*', 'ejaculat*', 'cum shot', 'creampie', 'gangbang',
  'threesome', 'orgy', 'sextoy', 'dildo', 'vibrator', 'furry nsfw', 'rule34', 'rule 34', 'ahegao', 'ecchi', 'yaoi',
  'seins', 'couille*', 'chatte', 'nichon*', 'enculer', 'foutre', 'salope', 'pute', 'putain',
  'sodomie', 'fellation', 'cunnilingus', 'orgasme', 'underage',
  'dick', 'cock', 'pussy', 'ass', 'tits', 'boobs', 'cum', 'slut', 'whore', 'breasts',
  // phrases de nudite et autres langues (IA-02)
  'wearing nothing', 'wears nothing', 'full frontal', 'birthday suit', 'in the nude', 'unclad', 'bare chest*', 'bare breast*',
  'only body paint', 'scantily clad', 'barely clothed',
  '*desnud*', '*nackt*', 'nudo', 'nuda', 'nudi', 'nudita', 'seminu*', 'denud*', 'deshabill*',
  '*pornograf*', '*pornograph*', 'erotisch*', 'sinnlich*', 'senos', 'titten', 'tetas', 'tette', 'spogliat*',
  'spogliarsi', 'spogliarell*', 'svestit*',
  // 2026-10-13 (M1, MODERATION-01) : actes et anatomie explicites, nudite d'autres langues
  'blowjob*', 'blow job*', 'handjob*', 'hand job*', 'footjob*', 'foot job*', 'titjob*', 'titfuck*', 'rimjob*', 'anilingus',
  'intercourse', 'coitus', 'copulat*', 'sodomy', 'sodomiz*', 'sodomis*', 'semen', 'sperm', 'cumshot*', 'bukkake', 'gang bang*',
  'bestiality', 'zoophil*', 'necrophil*', 'incest*', 'fisting', 'butt plug*', 'buttplug*', 'vulva*', 'labia',
  'clitor*', 'clit', 'clits', 'areola*', 'scrotum*', 'testicle*', 'phallus*', 'pubic hair', 'pubes', 'private parts',
  'intimate parts', 'molest*', 'raped', 'raping', 'rapist*', 'rape scene*', 'striptease*', 'strip tease*', 'strip club*',
  'lap dance*', 'making love', 'make love', 'kama sutra', 'doggy style', 'doggystyle', 'missionary position', 'camel toe',
  'nip slip', 'skinny dipping', 'in the buff', 'nudis*', 'milf', 'milfs', 'futanari', 'shemale*', 'dominatrix', 'ball gag*', 'ballgag*',
  'panties', 'touching himself', 'touching herself', 'lifting her skirt', 'upskirt',
  'sous vetement*', 'en petite tenue', 'devetu*', 'tenue d eve', 'plus simple appareil', 'sans rien sur le dos', 'partouze*',
  'calzon', 'calzoncillo*', 'calzoncito*', 'en pelotas', 'sin nada puesto', 'follar', 'follando', 'unterhose*', 'schlupfer*', 'reizwasche', 'entblosst*',
  'barbusig*', 'nackig*', 'fkk', 'geschlechtsverkehr', 'vergewaltig*', 'ficken', 'gefickt', 'pelad*', 'despida', 'despidas', 'estupr*',
  'mutande', 'mutandin*', 'mutandon*', 'perizoma', 'senza niente addosso', 'nudin*',
  '*ciplak*', 'soyunmus', 'tecavuz*', 'mustehcen*', 'naakt*', 'ontkleed*', 'nagie', 'rozebran*', 'telanjang', 'bugil',
  'pemerkosa*', 'khoa than', 'khieu dam', 'hiep dam',
  // 2026-10-14 (seconde relecture) : « the rape of a woman », « le viol d'une femme », « une femme violee » passaient. Seulement
  // ces tournures : « rape » seul est aussi le colza, la lotte (es), des navets (it) et, sans accent, « fromage rape » (fr) ;
  // « viol » seul est un instrument, « violee » une tombe pillee
  'the rape', 'a rape', 'rape of', 'rapes of', 'gang rape*', 'rape victim*', 'le viol', 'un viol', 'du viol', 'au viol', 'les viols', 'des viols', 'viol collectif', 'viols collectifs', 'violeur*',
  'femme violee', 'femmes violees', 'fille violee', 'filles violees', 'stupr*',
];
// Ambigu, SEXUEL : bloque seulement avec un terme sexuel explicite ou un contexte sexuel faible.
const GENERAL_CTX_SEXUEL: string[] = [
  'strip', 'breast', 'poitrine', 'bite', 'queue', 'baiser', 'jouir', 'dominat*', 'submissi*', 'sadis*', 'masoch*', 'escort', 'yuri',
  'tied up', 'chained', 'whipped', 'on knees', 'bent over',
  // 2026-10-13 : double sens (« erection » d'une tour, « penetrating » une armure)
  'erection*', 'erect', 'boner*', 'penetrat*', 'spread legs',
  // 2026-10-14 (revue, B4) : « golf foursome »
  'foursome*',
];
const CONTEXTE_SEXUEL_FAIBLE: string[] = ['sexy', 'sensual*', 'seductive', 'provocative', 'suggestive', 'busty', 'kinky', 'big breast*',
  'large breast*', 'huge breast*', 'her breast*'];
// Ambigu, VIOLENCE / drogue / jeu : bloque seulement avec un enfant, un terme sexuel explicite ou un terme du plancher.
const GENERAL_CTX_VIOLENCE: string[] = [
  'blood', 'bloody', 'bleed*', 'murder*', 'kill*', 'torture*', 'torturer', 'cannibal*', 'flesh', 'corpse*', 'cadaver*', 'dead body',
  'death scene', 'execution', 'hanging', 'strangul*', 'suffocate', 'drown*', 'stab', 'stabs', 'stabb*',
  'slash*', 'wound*', 'injury', 'brutal*',
  'savage*', 'slaughter*', 'meurtre*', 'tuer', 'mort', 'cadavre*', 'sang', 'sanglant*', 'violence', 'violent*', 'cruaut*',
  'drug', 'drugs', 'crack', 'snort', 'overdose', 'drogue*', 'stupefi*', 'bomb', 'bombing', 'isis', 'jump off',
];
// Bloques seuls, par famille.
const GENERAL_VIOLENCE_DUR: string[] = [
  'gore', 'gory', 'dismember*', 'decapitat*', 'mutilat*', 'eviscerat*', 'disembowel*', 'snuff', 'graphic violence', 'massacre*',
  'bloodbath', 'carnage',
];
// 2026-10-13 (MODERATION-05) : « heroine » retire (heroine de jeu, et l'anglais issu de la traduction de « heroine »).
const GENERAL_DROGUE_DUR: string[] = [
  'cocaine', 'heroin', 'fentanyl', 'methamphet*', 'meth', 'opium', 'inject drug*', 'crack cocaine',
];
const GENERAL_EXTREMISME_DUR: string[] = [
  'terrorist*', 'terrorism', 'terroris*', 'mass shooting', 'genocide', 'ethnic cleansing', 'hate crime', 'white supremac*', 'nazi',
  'nazis', 'swastika', 'al qaeda', 'jihad', 'radicali*', 'extremis*', 'attentat*', 'daesh', 'isis flag', 'isis fighter',
  'isis militant', 'isis terrorist',
];
const GENERAL_AUTOBLESSURE_DUR: string[] = ['suicide', 'self harm', 'cut myself', 'slit wrist*', 'hang myself'];
const GENERAL_HAINE_DUR: string[] = [
  'racial slur', 'nigger*', 'faggot*', 'retard', 'retards', 'retarded', 'kike', 'kikes', 'spic', 'spics', 'chink', 'chinks', 'wetback*',
  'hate speech',
];
const GENERAL_ARMES_DUR: string[] = ['how to make bomb', 'how to make gun', 'weapon tutorial', 'build explosive', 'poison recipe'];

// Combinaisons du filtre general.
const PERSONNES: string[] = ['woman', 'man', 'person', 'girl', 'boy', 'female', 'male', 'lady', 'femme', 'homme', 'mujer', 'hombre',
  'persona', 'frau', 'mann', 'donna', 'uomo', 'mulher', 'homem'];
// Personnes qui DESACTIVENT les expressions sures balisees <personne> (quatrieme relecture du 14/10, R5), en plus de PERSONNES.
const PERSONNES_DESACTIVATION: string[] = ['women', 'men', 'people', 'persons', 'someone', 'somebody', 'he', 'she', 'him', 'her',
  'his', 'hers', 'herself', 'himself', 'guy', 'guys', 'gal', 'gals', 'ladies', 'females', 'males', 'dancer*', 'model', 'models',
  'wife', 'husband', 'girlfriend', 'boyfriend', 'mother', 'father', 'mom', 'dad', 'sister', 'brother', 'teacher', 'nurse', 'maid',
  'waitress', 'farmer*', 'worker*', 'elle', 'il', 'ella', 'el', 'sie', 'er', 'ela', 'ele', 'lei', 'lui'];
// CONTEXTE SEXUEL qui desactive les expressions sures balisees <coq>, <chantier> et <personne> (2026-10-15) : la garde du coq ne
// lisait que les mots qui PRECEDENT la tournure ; « a cock and two hens, a woman sucking it », « pussy cats, sexy », « paint stripper,
// sexy pole dance » passaient (la production refusait le mot partout). Un de ces mots, OU QU'IL SOIT, ou un terme de contexte sexuel
// (GENERAL_CTX_SEXUEL, CONTEXTE_SEXUEL_FAIBLE), et la tournure ne retire plus rien. Les scenes de ferme sans ces mots restent
// une question de politique (« a farm kid feeding a <coq> and two hens »).
const CONTEXTE_DESACTIVATION: string[] = ['suck*', 'lick*', 'stroking', 'jerking', 'jerk off', 'jerks off', 'jerked off', 'fondl*',
  'deepthroat*', 'deep throat*', 'gagging', 'swallowing', 'throbbing', 'veiny', 'horny', 'aroused', 'moaning', 'moans', 'worshipping',
  'worshiping', 'pole', 'poles', 'pole danc*', 'dancing', 'dance', 'dances', 'dancer*', 'twerk*', 'naughty', 'slutty', 'steamy',
  'lustful', 'lust', 'orgasmic', 'erotically', 'sexually', 'oiled', 'wet t shirt'];
const NUDITE_EXTREME: string[] = ['without clothes', 'no clothes', 'without clothing', 'no clothing', 'unclothed', 'fully exposed',
  'spread legs', 'spanked', 'sans vetement*', 'sans habit*', 'sin ropa', 'ohne kleidung', 'ohne kleider', 'senza vestiti',
  'sem roupa*'];
const VIOLENCE_ENFANT_GENERAL: string[] = ['hurt', 'hit', 'beat', 'punch', 'slap', 'abuse', 'attack', 'weapon', 'knife', 'gun',
  'shoot', 'bleed', 'cry', 'scream', 'pain', 'suffer', 'frapper', 'battre', 'blesser'];

// ── Compilation (une fois par isolat) ──────────────────────────────────────
const T_MINEURS_FORT = _fusionner(_compiler(MINEURS_FORT, 'plancher'),
  _compiler(CLASSES_ORDINAUX.flatMap((o) => ELEVES_CLASSE.map((e) => o + ' grade ' + e)), 'plancher'));
const T_MINEURS_AMBIGUS = _compiler(MINEURS_AMBIGUS, 'plancher');
const T_MINEURS_AMBIGUS_NOMS = _compiler(MINEURS_AMBIGUS.filter((x) => !ADJECTIFS_JEUNESSE.includes(x)), 'plancher');
const T_MINEURS_INDICES = _compiler(MINEURS_INDICES, 'plancher');
const T_MINEURS_VIOLENCE = _compiler(MINEURS_VIOLENCE, 'mineur_violence');
const T_NU_FORT = _compiler(NU_FORT, 'plancher');
const T_NU_EXACTS = _compiler(NU_EXACTS, 'plancher');
const T_NU_MOYEN = _compiler(NU_MOYEN, 'plancher');
const T_NU_FAIBLE_PLANCHER = _compiler(NU_FAIBLE_PLANCHER, 'plancher');
const T_NU_FAIBLE_GENERAL = _compiler(NU_FAIBLE_GENERAL, 'mineur_violence');
const T_SEXE_MINEUR_FORT = _compiler(SEXE_MINEUR_FORT, 'plancher');
const T_VIOLENCE_ENFANT_PLANCHER = _compiler(VIOLENCE_ENFANT_PLANCHER, 'plancher');
const T_PLANCHER_MOTS = _compiler(PLANCHER_MOTS, 'plancher');
const T_PLANCHER_UNICODE = _compilerUnicode(PLANCHER_UNICODE, 'plancher');
const T_MINEURS_FORT_UNICODE = _compilerUnicode(MINEURS_FORT_UNICODE, 'plancher');
const T_MINEURS_AMBIGUS_UNICODE = _compilerUnicode(MINEURS_AMBIGUS_UNICODE, 'plancher');
const T_NU_FORT_UNICODE = _compilerUnicode(NU_FORT_UNICODE, 'plancher');
const T_NU_SUGGESTIF_UNICODE = _compilerUnicode(NU_SUGGESTIF_UNICODE, 'plancher');
const T_NU_MOYEN_UNICODE = _compilerUnicode(NU_MOYEN_UNICODE, 'plancher');
const T_NU_FAIBLE_UNICODE = _compilerUnicode(NU_FAIBLE_UNICODE, 'plancher');
const T_VIOLENCE_UNICODE = _compilerUnicode(VIOLENCE_UNICODE, 'plancher');
const T_SEXUEL_DUR = _compiler(GENERAL_SEXUEL_DUR, 'sexuel');
const T_SEXUEL_EXACTS = _compiler(NU_EXACTS, 'sexuel');
const T_SEXUEL_UNICODE = _compilerUnicode(NU_FORT_UNICODE, 'sexuel');
const T_CTX_SEXUEL = _compiler(GENERAL_CTX_SEXUEL, 'contexte');
const T_CTX_SEXUEL_FAIBLE = _compiler(CONTEXTE_SEXUEL_FAIBLE, 'contexte');
const T_CTX_VIOLENCE = _compiler(GENERAL_CTX_VIOLENCE, 'contexte');
const T_DURS_AUTRES: Liste = _fusionner(
  _compiler(GENERAL_VIOLENCE_DUR, 'violence'), _compiler(GENERAL_DROGUE_DUR, 'drogue'),
  _compiler(GENERAL_EXTREMISME_DUR, 'extremisme'), _compiler(GENERAL_AUTOBLESSURE_DUR, 'autoblessure'),
  _compiler(GENERAL_HAINE_DUR, 'haine'), _compiler(GENERAL_ARMES_DUR, 'armes'),
);
const T_PERSONNES = _compiler(PERSONNES, 'combinaison');
const T_PERSONNES_DESACTIVATION = _fusionner(T_PERSONNES, _compiler(PERSONNES_DESACTIVATION, 'combinaison'));
const T_CONTEXTE_DESACTIVATION = _fusionner(T_CTX_SEXUEL, T_CTX_SEXUEL_FAIBLE, _compiler(CONTEXTE_DESACTIVATION, 'contexte'));
const T_NUDITE_EXTREME = _compiler(NUDITE_EXTREME, 'combinaison');
const T_VIOLENCE_ENFANT_GENERAL = _compiler(VIOLENCE_ENFANT_GENERAL, 'mineur_violence');
const _PLANCHER_COLLES_ECRASES = PLANCHER_COLLES.map((s) => s.replace(/([a-z])\1+/g, '$1'));

/** Liste a plat des termes DURS du filtre (pour l'affichage cote bureau, `get-nsfw-keywords` : fenetre « New project », grille des projets).
 *  Essais reels du 2026-10-03 : les termes de CONTEXTE (GENERAL_CTX_SEXUEL / GENERAL_CTX_VIOLENCE : blood, kill, wound, strip...) y figuraient aussi
 *  et le bureau les testait en mots entiers SANS contexte : « An orc warrior covered in blood » etait refuse a la creation du projet alors que la
 *  generation (checkPromptSafety) l'accepte. Ces termes ne bloquent qu'en contexte : ils ne font pas partie de la liste a plat.
 *  2026-10-14 (troisieme relecture) : l'interface cherche aussi chaque terme SANS les expressions sures et sans retirer les accents
 *  (« \b » s'arrete sur une lettre accentuee) ; les tournures du viol ajoutees au filtre general par le lot y signalaient « a rape
 *  field » (colza), « the rape flowers », « un violín » (espagnol). Elles restent dans le filtre general (HORS_LISTE_PLATE). */
const HORS_LISTE_PLATE: string[] = ['the rape', 'a rape', 'un viol'];
// 2026-10-15 : mots ENTIERS que l'interface lisait en production (« masturbat », « semidesnud ») ou avant le retour de la racine
// « seminu* » (« seminua », « seminude »...) : la liste plate ne lit pas les racines comme des debuts de mot (« \b...\b »).
const AJOUTS_LISTE_PLATE: string[] = ['masturbat', 'masturbation', 'masturbating', 'semidesnud', 'semidesnudo', 'semidesnuda',
  'semidesnudos', 'semidesnudas', 'seminus', 'seminua', 'seminuas', 'seminude', 'seminudes', 'seminudo', 'seminuda', 'seminudi'];
export const NSFW_KEYWORDS: string[] = Array.from(new Set([
  ...GENERAL_SEXUEL_DUR, ...NU_EXACTS, ...GENERAL_VIOLENCE_DUR, ...GENERAL_DROGUE_DUR, ...GENERAL_EXTREMISME_DUR,
  ...GENERAL_AUTOBLESSURE_DUR, ...GENERAL_HAINE_DUR, ...GENERAL_ARMES_DUR, ...AJOUTS_LISTE_PLATE,
].map(_noyauSource))).filter((k) => !HORS_LISTE_PLATE.includes(k));

// ═══════════════════════════════════════════════════════════════════════════
// PLANCHER ILLICITE
// ═══════════════════════════════════════════════════════════════════════════

const _MSG_PLANCHER = 'Blocked: this content is illegal and cannot be generated under any setting.';
const _MSG_PLANCHER_MINEUR = 'Blocked: depicting minors in this context is illegal and cannot be generated under any setting.';

/** Conseil ajoute aux refus du filtre general (le bureau le remplace par son propre libelle). */
const _CONSEIL_REFUS = 'Modify your prompt or contact support to request unrestricted access.';

// HARD FLOOR — contenu illicite (mineurs) qu'AUCUN reglage, `unrestricted` compris, ne peut lever.
// Evalue AVANT le court-circuit `unrestricted`. Plus strict que le filtre general sur les formes
// (normalisation, ages, six langues), mais sans vocabulaire de jeu video ("kid friendly", "young hero",
// "teen titans style" passent).
export function checkHardFloor(prompt: string | null | undefined): PromptSafetyResult {
  // Toutes les lectures du texte, sans la syntaxe de poids collee dans un mot comprise (« na()ked » : revue du 14/10, B1).
  return _plancherLecture(_lire(prompt));
}

/** Vues de la lecture SANS les expressions sures portant une balise de `desactivees` (quatrieme relecture du 14/10, R4, R5) ;
 *  les vues d'origine quand aucune de ces expressions n'est dans le texte. */
function _vuesDesactivees(lecture: Lecture, desactivees: string[]): VuesPlancher[] {
  if (!desactivees.length) return lecture.vues;
  const textes = lecture.nets.map((n) => _translit(_sansMarques(n)));
  const touche = _RE_EXPRESSIONS_SURES.some((e) => e.balises.some((b) => desactivees.includes(b))
    && textes.some((t) => t.includes(e.cle)));
  return touche ? lecture.nets.map((n) => _vuesPlancher(n, desactivees)) : lecture.vues;
}

/** Vrai si le texte a un contexte sexuel (termes de contexte, ou qu'ils soient) : les expressions balisees <coq>, <chantier> et
 *  <personne> ne retirent plus leur mot (2026-10-15). */
function _contexteSexuel(vs: VuesPlancher[]): boolean {
  return !!_chercher(vs.flatMap((v) => [v.chiffres, v.leetI, v.leetL, ...v.separees]), T_CONTEXTE_DESACTIVATION);
}

/** Plancher d'une lecture : quand un mineur ou un age est lu, les expressions balisees <mineur> (colza, « pelada de praia ») ne
 *  retirent plus leur mot (« child rape fields », « uma menina pelada de praia » : la production les refusait au plancher) ; avec
 *  un contexte sexuel en plus, ni les tournures de ferme ou de chantier, ni celles balisees <personne> (2026-10-15). */
function _plancherLecture(lecture: Lecture): PromptSafetyResult {
  const r = _plancher(lecture.vues);
  if (!r.safe || !_mineurLu(lecture.vues)) return r;
  const vs = _vuesDesactivees(lecture, _contexteSexuel(lecture.vues) ? ['mineur', 'coq', 'chantier', 'personne'] : ['mineur']);
  return vs === lecture.vues ? r : _plancher(vs);
}

/** Signaux de mineur du plancher, sur les vues reunies. */
function _signauxMineur(vs: VuesPlancher[]): { mineurFort: boolean; mineurAmbigu: boolean; indice: boolean; age: boolean } {
  const vues = vs.flatMap((v) => [v.chiffres, v.leetI, v.leetL, ...v.separees]);
  const uni = vs.flatMap((v) => v.unicode);
  const mineurFort = !!(_chercher(vues, T_MINEURS_FORT) || _chercher(uni, T_MINEURS_FORT_UNICODE)
    || vues.some((x) => _RE_MINEURS_CONSTRUITS.test(x)));
  const mineurAmbigu = !!(_chercher(vues, T_MINEURS_AMBIGUS) || _chercher(uni, T_MINEURS_AMBIGUS_UNICODE));
  const indice = !!_chercher(vues, T_MINEURS_INDICES);
  // « une fille, 10 ans de guerre, au bain » : avec un mineur ambigu NOMME ou un indice, « N ans de <duree> » compte aussi
  const ageLarge = (indice || _chercher(vues, T_MINEURS_AMBIGUS_NOMS)) ? vues.some((x) => _RE_AGE_ROMAN_LARGE.test(x)) : false;
  const age = ageLarge || vues.some((x) => _RE_AGE.test(x) || _ageParNaissance(x)) || uni.some((x) => _RE_AGE_UNICODE.test(x));
  return { mineurFort, mineurAmbigu, indice, age };
}

/** Vrai si un mineur (sans ambiguite, ambigu ou indice) ou un age est lu. */
function _mineurLu(vs: VuesPlancher[]): boolean {
  const s = _signauxMineur(vs);
  return s.mineurFort || s.mineurAmbigu || s.indice || s.age;
}

/** Plancher sur les vues REUNIES de toutes les lectures (troisieme relecture du 14/10 : le mineur peut etre lu dans une lecture
 *  et la nudite dans une autre). */
function _plancher(vs: VuesPlancher[]): PromptSafetyResult {
  const vues = vs.flatMap((v) => [v.chiffres, v.leetI, v.leetL, ...v.separees]);
  const uni = vs.flatMap((v) => v.unicode);
  const exactes = vs.flatMap((v) => v.exactes);
  const bloquer = (blocked: string, reason: string): PromptSafetyResult =>
    ({ safe: false, blocked, reason, categorie: 'plancher', hardFloor: true });

  // 1. Termes illicites en soi.
  const u = _chercher(uni, T_PLANCHER_UNICODE);
  if (u) return bloquer(_nom(u), _MSG_PLANCHER);
  const mot = _chercher(vues, T_PLANCHER_MOTS);
  if (mot) return bloquer(_nom(mot), _MSG_PLANCHER);
  const collees = vs.flatMap((v) => v.collees);
  for (let i = 0; i < PLANCHER_COLLES.length; i++) {
    if (collees.some((c) => c.includes(_PLANCHER_COLLES_ECRASES[i]))) return bloquer(PLANCHER_COLLES[i], _MSG_PLANCHER);
  }

  for (const serie of vs.flatMap((v) => v.series)) {
    if (SERIE_MINEURS.some((x) => serie.includes(x)) && SERIE_NUDITE.some((x) => serie.includes(x))) {
      return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
    }
  }
  // 1b. Mineur et nudite COLLES dans un meme mot (« childnaked ») : CLIP les lit comme deux mots (M2).
  if (vues.some(_colle) || vs.some((v) => v.nonEcrasees.some(_colle))) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);

  // 2. Mineur x nudite / sexe, mineur x violence exercee sur lui.
  const { mineurFort, mineurAmbigu, indice, age } = _signauxMineur(vs);
  if (mineurFort || age || mineurAmbigu || indice) {
    const explicite = _chercher(vues, T_NU_FORT) || _chercher(exactes, T_NU_EXACTS) || _chercher(uni, T_NU_FORT_UNICODE)
      || _chercher(uni, T_NU_SUGGESTIF_UNICODE);
    if (explicite) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
    if (mineurFort || age || mineurAmbigu) {
      if (_chercher(vues, T_NU_MOYEN) || _chercher(uni, T_NU_MOYEN_UNICODE)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
    }
    if (mineurFort || age) {
      if (_chercher(vues, T_SEXE_MINEUR_FORT)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
      if (_chercher(vues, T_NU_FAIBLE_PLANCHER) || _chercher(uni, T_NU_FAIBLE_UNICODE)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
      if (_chercher(vues, T_VIOLENCE_ENFANT_PLANCHER) || _chercher(uni, T_VIOLENCE_UNICODE)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
    }
  }
  return { safe: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTRE GENERAL
// ═══════════════════════════════════════════════════════════════════════════

export function checkPromptSafety(
  prompt: string | null | undefined,
  unrestricted = false,
): PromptSafetyResult {
  const lecture = _lire(prompt);
  const floor = _plancherLecture(lecture);
  if (!floor.safe) return floor;            // plancher illicite — jamais contournable
  if (unrestricted) return { safe: true };  // `unrestricted` ne leve que les filtres SOUPLES

  // Expressions sures balisees (quatrieme relecture du 14/10, R4, R5) : <mineur> ignorees quand un mineur ou un age est lu,
  // <personne> (decapant, mots sexuels) quand une personne ou un mineur est nomme (« a woman with paint <stripper> » : la production
  // les refusait) ; <coq>, <chantier> et <personne> quand le texte a un contexte sexuel, ou qu'il soit (2026-10-15 : « a <coq> and
  // two hens, a woman sucking it », « pussy cats, sexy »).
  const mineurLu = _mineurLu(lecture.vues);
  const contexte = _contexteSexuel(lecture.vues);
  const personneLue = mineurLu || contexte
    || !!_chercher(lecture.vues.flatMap((v) => [v.chiffres, v.leetI, v.leetL, ...v.separees]), T_PERSONNES_DESACTIVATION);
  const desactivees = [...(mineurLu ? ['mineur'] : []), ...(personneLue ? ['personne'] : []), ...(contexte ? ['coq', 'chantier'] : [])];

  // Toutes les lectures du texte (troisieme relecture du 14/10) : la principale, celles ou les caracteres effaces ou changes
  // separent les mots, et chacune sans la syntaxe de poids collee dans un mot (revue du 14/10, B1).
  const vs = _vuesDesactivees(lecture, desactivees);
  // textes tels quels (sans translitteration), et coupes entre lettres et chiffres (« a child<U+0667>with<U+0667>a<U+0667>gun » :
  // la production lisait un chiffre arabe-indien comme un separateur ; il devient « 7 », que CLIP lit seul, comme un mot)
  const bruts = lecture.nets.map((n) => _simple(_sansExpressionsSures(_sansMarques(n), desactivees)));
  // texte lu aussi comme la production quand il contient une expression qu'elle retirait ENTIERE (`IDIOMES_PRODUCTION`)
  for (const n of lecture.nets) {
    const sp = _sansMarques(n);
    if (!_RE_INDICE_PHRASES.test(sp)) continue;   // (sans les marques : « sh<U+0301>ower » cachait le mot au declencheur)
    if (_RE_IDIOMES_PRODUCTION.test(_simple(sp))) { const v = _simple(sp, true, true); if (!bruts.includes(v)) bruts.push(v); }
  }
  const souples = [...bruts, ..._separees(bruts).filter((x) => !bruts.includes(x))];
  // l'explicite est teste sur les formes deguisees aussi
  const toutes = [...souples, ...vs.flatMap((v) => [v.chiffres, v.leetI, v.leetL, ...v.separees])];
  const refus = (t: Terme): PromptSafetyResult => ({
    safe: false, blocked: _nom(t), categorie: t.cat,
    reason: `Content filter: "${_nom(t)}" is blocked. ${_CONSEIL_REFUS}`,
  });

  // 1. Termes explicites (sexe, nudite) : mots entiers, y compris deguises ("n u d e", "nud3", cyrillique), mots courts sur la
  //    vue exacte, autres ecritures sur la vue Unicode.
  const sexuel = _chercher(toutes, T_SEXUEL_DUR) || _chercher(vs.flatMap((v) => [...v.exactes, ...v.exactesSouples]), T_SEXUEL_EXACTS)
    || _chercher(vs.flatMap((v) => v.unicode), T_SEXUEL_UNICODE);
  if (sexuel) return refus(sexuel);
  // 2. Autres familles bloquees seules (gore explicite, drogues dures, terrorisme, haine, auto-agression, armes).
  const autre = _chercher(souples, T_DURS_AUTRES);
  if (autre) return refus(autre);

  // 3. Termes AMBIGUS (vocabulaire de jeu) : seulement en contexte.
  const ctxSexuel = _chercher(souples, T_CTX_SEXUEL);
  if (ctxSexuel && _chercher(toutes, T_CTX_SEXUEL_FAIBLE)) return refus(ctxSexuel);
  const ctxViolence = _chercher(souples, T_CTX_VIOLENCE);
  if (ctxViolence && _chercher(souples, T_MINEURS_VIOLENCE)) return refus(ctxViolence);

  // 4. Combinaisons.
  // 4a. mineur sans ambiguite x vocabulaire de chambre (le plancher a deja traite le reste)
  const mineur = _chercher(toutes, T_MINEURS_FORT);
  if (mineur) {
    const b = _chercher(souples, T_NU_FAIBLE_GENERAL);
    if (b) return { safe: false, blocked: `${_nom(mineur)} + ${_nom(b)}`, categorie: 'combinaison',
      reason: `Content filter: combination "${_nom(mineur)}" + "${_nom(b)}" is blocked. This type of content is not allowed.` };
  }
  // 4b. personne x nudite explicite par periphrase
  const a2 = _chercher(souples, T_PERSONNES);
  const b2 = a2 ? _chercher(souples, T_NUDITE_EXTREME) : null;
  if (a2 && b2) return { safe: false, blocked: `${_nom(a2)} + ${_nom(b2)}`, categorie: 'combinaison',
    reason: `Content filter: combination "${_nom(a2)}" + "${_nom(b2)}" is blocked. This type of content is not allowed.` };
  // 4c. enfant x violence
  const a3 = _chercher(souples, T_MINEURS_VIOLENCE);
  const b3 = a3 ? _chercher(souples, T_VIOLENCE_ENFANT_GENERAL) : null;
  if (a3 && b3) return { safe: false, blocked: `${_nom(a3)} + ${_nom(b3)}`, categorie: 'mineur_violence',
    reason: `Content filter: combination "${_nom(a3)}" + "${_nom(b3)}" is blocked. This type of content is not allowed.` };

  return { safe: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// LONGUEUR ET SYNTAXE DU TEXTE ENVOYE AU GENERATEUR (2026-10-13 : MODERATION-07, SERVEUR-09)
// ═══════════════════════════════════════════════════════════════════════════
//
// Mesures du 11/10 : un prompt de 1 000 000 de caracteres traversait le worker (facture 6 credits) ; cote Modal, l'epuration
// de fin de demande et le lecteur de poids sont quadratiques (32 000 blancs = 12,6 s, 32 000 « (a » = 19 s) sous le verrou GPU ;
// « <|endoftext|> » etait lu comme le VRAI jeton de fin ; « (x:99999) » donnait un poids infini, « (x:-5) » un poids negatif.

/** Description de l'utilisateur (texte brut). */
export const PROMPT_MAX_CARACTERES = 2000;
/** Prompt complet (gabarits compris) et textes d'outils. */
export const PROMPT_MAX_ENRICHI = 4000;
/** Bornes des poids « (mot:1.4) » : les gabarits du produit vont de 1,2 a 1,8. */
export const POIDS_PROMPT_MIN = 0.5;
export const POIDS_PROMPT_MAX = 2;

/** Longueur PONDEREE : un caractere de l'alphabet latin (jusqu'a U+024F) compte 1, tout autre 3 (CLIP decoupe ces ecritures
 *  en 2 a 3 jetons : 5 000 ideogrammes = 15 000 jetons). Les caracteres effaces ne comptent pas. */
export function longueurPonderee(texte: unknown): number {
  const s = (typeof texte === 'string' ? texte : String(texte == null ? '' : texte)).replace(_EFFACES, '');
  let n = 0;
  for (const c of s) n += (c.codePointAt(0) as number) <= 0x24f ? 1 : 3;
  return n;
}

/** Refuse un texte plus long que `max` (longueur ponderee). Meme contrat que checkPromptSafety ; categorie « longueur ». */
export function controlerLongueurPrompt(texte: unknown, max: number = PROMPT_MAX_CARACTERES): PromptSafetyResult {
  const brut = typeof texte === 'string' ? texte : String(texte == null ? '' : texte);
  const n = brut.length > max * 8 ? brut.length : longueurPonderee(brut);
  if (n <= max) return { safe: true };
  return {
    safe: false, blocked: 'length', categorie: 'longueur',
    reason: `Prompt too long (${n} / ${max}): please shorten your description. Characters outside the Latin alphabet count as 3.`,
  };
}

const _RE_POIDS = /:\s*([+-]?[0-9.]*)\s*\)/g;
const _RE_NOMBRE = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

/** Texte tel qu'il part au generateur : caracteres effaces retires (\t \n \r -> espace), jetons speciaux du tokenizer
 *  (« <|endoftext|> », « <|startoftext|> ») casses, references de caractere HTML cassees (« &#110; » -> « & #110; » :
 *  revue du 14/10 ; avec ftfy, le tokenizer CLIP les decode, « &#110;aked » y devient le mot entier ; « & » et « # » en pleine
 *  chasse ou en petite forme aussi, ftfy les ramene en ASCII avant de decoder : seconde relecture), poids A1111 « (mot:x) » ramenes dans [POIDS_PROMPT_MIN, POIDS_PROMPT_MAX] (un poids mal forme est retire).
 *  Un poids deja dans les bornes est laisse tel quel, a l'octet pres. */
export function neutraliserSyntaxePrompt(texte: unknown): string {
  const s = (typeof texte === 'string' ? texte : String(texte == null ? '' : texte))
    .replace(/[\t\n\r]/g, ' ').replace(_EFFACES, '')
    .replace(/<\s*\|/g, ' ').replace(/\|\s*>/g, ' ')
    .replace(/[&\uff06\ufe60](?=[#\uff03\ufe5fA-Za-z\uff21-\uff3a\uff41-\uff5a])/g, '$& ');
  return s.replace(_RE_POIDS, (m: string, nb: string) => {
    const v = _RE_NOMBRE.test(nb) ? Number(nb) : NaN;
    if (!Number.isFinite(v)) return ')';
    if (v < POIDS_PROMPT_MIN) return ':' + POIDS_PROMPT_MIN + ')';
    if (v > POIDS_PROMPT_MAX) return ':' + POIDS_PROMPT_MAX + ')';
    return m;
  });
}
