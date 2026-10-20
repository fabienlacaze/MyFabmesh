'use strict';
// OPTION « relief pour moteur de jeu » (case « Game-engine relief (normal map) », 2026-10-15).
//
// Decision du proprietaire apres l'essai GPU A/B du 15/10 : la carte de normales (glTF normalTexture) est utile surtout aux moteurs de
// jeu a lumieres mobiles, son gain est DISCRET en couleur (+22 Mo a 4096, +6,4 Mo a 2048). Elle devient une OPTION PAR GENERATION,
// DESACTIVEE PAR DEFAUT, GRATUITE, plafonnee a 2048 px (scripts/normal_bake.py : PLAFOND_DEFAUT).
//
// Ce petit module est la SEULE regle du processus principal pour cette option :
//   - la page envoie `trellis2NormalMap` (booleen) ; seule la valeur EXACTE `true` active l'option (jamais la chaine "false", jamais 1) ;
//   - mode Cloud : drapeau `normal_map` du formulaire /api/generate (le worker le valide, puis Modal) ;
//   - mode Local : variable d'environnement du pipeline (scripts/trellis2_native_full_pipeline.py -> normal_bake.option_carte_normales).
//     La variable est TOUJOURS posee ('1' ou '0') : le choix de la page l'emporte sur une variable heritee de l'environnement.
// L'interrupteur d'urgence FABMESH_NORMAL_MAP=0 (scripts/normal_bake.py) reste prioritaire sur l'option, dans le pipeline.

/** Meme nom que scripts/normal_bake.py OPTION_ENV (un test de parite le verifie). */
const VARIABLE = 'FABMESH_NORMAL_MAP_OPTION';

/** L'option est-elle demandee ? Booleen STRICT. */
function optionActive(valeur) {
  return valeur === true;
}

/** Variables d'environnement a ajouter au processus du pipeline TRELLIS.2 natif ({ FABMESH_NORMAL_MAP_OPTION: '1' | '0' }). */
function variablesEnv(valeur) {
  const env = {};
  env[VARIABLE] = optionActive(valeur) ? '1' : '0';
  return env;
}

module.exports = { VARIABLE, optionActive, variablesEnv };
