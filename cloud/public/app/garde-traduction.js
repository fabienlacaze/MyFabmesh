/* GARDE DE TRADUCTION (2026-10-03, exigence n°1 du proprietaire : « l'image doit correspondre EXACTEMENT au prompt »).
 * Cas constate : « bouteille d'eau avec un liquide fluo bleu » traduit par /api/translate (m2m100) en
 * « water bottle with a blue fluo liquid, a glass bottle with a blue fluo liquid » : une proposition INVENTEE
 * (« glass bottle ») que le moteur d'image dessine en plus (une bouteille ET un verre). Un modele de traduction
 * sequence-a-sequence repete ou varie parfois sa propre sortie sur les textes courts.
 *
 * Script CLASSIQUE, charge apres meshyAPI-cloud.js et avant index2.js : il enveloppe window.meshyAPI.translatePrompt.
 *   garderTraduction(source, traduit) retire d'une traduction les propositions EN TROP (plus que dans le texte source) qui ne sont
 *   qu'une variante d'une proposition precedente (plus de la moitie du lexique en commun). Une traduction qui n'a pas plus de propositions
 *   que le texte d'origine n'est JAMAIS modifiee ; toute erreur rend la traduction telle quelle.
 * Pur et sans dependance : teste par cloud/tests/garde-traduction.test.mjs. */
(function (racine) {
  'use strict';
  const MOTS_VIDES = new Set('a an the of with and in on at to for from by his her its their this that these those is are be as into over under near next'.split(' '));
  const SEPARATEURS = /[,;.\n、。，；،؛।]+/;

  function propositions(texte) {
    return String(texte == null ? '' : texte).split(SEPARATEURS).map((s) => s.trim()).filter(Boolean);
  }
  function lexique(proposition) {
    const mots = String(proposition).toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').split(' ');
    return new Set(mots.filter((m) => m.length > 1 && !MOTS_VIDES.has(m)));
  }
  /** Part de lexique commune (Jaccard) ; 0 si l'une des deux propositions n'a aucun mot plein. */
  function proximite(a, b) {
    if (!a.size || !b.size) return 0;
    let commun = 0;
    for (const m of a) if (b.has(m)) commun++;
    return commun / (a.size + b.size - commun);
  }

  function garderTraduction(source, traduit) {
    const brut = String(traduit == null ? '' : traduit);
    try {
      const nbSource = propositions(source).length || 1;
      const props = propositions(brut);
      if (props.length <= nbSource) return brut;
      const gardees = [];
      let aRetirer = props.length - nbSource;
      for (let i = 0; i < props.length; i++) {
        if (aRetirer > 0 && gardees.length > 0) {
          const lex = lexique(props[i]);
          if (gardees.some((g) => proximite(lexique(g), lex) >= 0.5)) { aRetirer--; continue; }
        }
        gardees.push(props[i]);
      }
      return gardees.length === props.length ? brut : gardees.join(', ');
    } catch (e) {
      return brut;
    }
  }

  function installer() {
    const api = racine.meshyAPI;
    if (!api || typeof api.translatePrompt !== 'function' || api.translatePrompt.__garde) return false;
    const origine = api.translatePrompt.bind(api);
    const enveloppe = async function (args) {
      const r = await origine(args);
      try {
        if (r && typeof r.text === 'string' && args && typeof args.text === 'string') {
          const net = garderTraduction(args.text, r.text);
          if (net !== r.text) return Object.assign({}, r, { text: net, nettoye: true });
        }
      } catch (e) { /* la traduction brute est rendue */ }
      return r;
    };
    enveloppe.__garde = true;
    api.translatePrompt = enveloppe;
    return true;
  }

  racine.garderTraduction = garderTraduction;
  installer();
})(typeof window !== 'undefined' ? window : globalThis);
