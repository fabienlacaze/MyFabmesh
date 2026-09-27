//
// Langue de l'enveloppe Next (2026-09-28, user : « ce n'est pas dans la langue
// de l'appli »). L'appli /app/ choisit sa langue dans i18n.js et la range dans
// localStorage (fabmesh.lang, fabmesh.lang.choisi). Les pages Next (barre du
// haut, pied de page, tarifs, pages legales) etaient en francais en dur.
//
// Elles portent desormais les deux versions, balisees .lang-fr / .lang-en, et
// SCRIPT_LANGUE (pose dans le <head> par layout.tsx, donc execute avant le
// premier rendu : aucun eclair de la mauvaise langue) regle html[lang] ; les
// regles de globals.css cachent l'autre version. L'enveloppe n'existe qu'en
// francais et en anglais : toute autre langue de l'appli donne l'anglais.
//
// Module NEUTRE (ni 'use client' ni code serveur) : le layout serveur lit la
// constante, la barre du haut (client) utilise <T>.
//

// Meme ordre de decision que i18n.js : choix explicite, puis langue enregistree
// (hors 'en' herite), puis langue du navigateur.
export const SCRIPT_LANGUE = `(function(){var l=null;try{var c=localStorage.getItem('fabmesh.lang.choisi');var s=localStorage.getItem('fabmesh.lang');l=c||((s&&s!=='en')?s:null);}catch(e){}if(!l){try{var n=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language];for(var i=0;i<n.length;i++){var b=String(n[i]||'').toLowerCase().split('-')[0];if(b==='en'){l='en';break;}if(['fr','es','zh','hi','ar'].indexOf(b)>=0){l=b;break;}}}catch(e){}}document.documentElement.lang=(l==='fr')?'fr':'en';})();`;

/** Texte court dans les deux langues (barre du haut, pied de page, boutons). */
export function T({ fr, en }: { fr: string; en: string }) {
  return (
    <>
      <span className="lang-fr">{fr}</span>
      <span className="lang-en">{en}</span>
    </>
  );
}

/** Langue affichee, lue cote client (pour un texte qu'on ne peut pas doubler : un confirm(), un title). */
export function langueAffichee(): 'fr' | 'en' {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang === 'fr' ? 'fr' : 'en';
}
