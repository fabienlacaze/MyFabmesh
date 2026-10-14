//
// Langue de l'enveloppe Next (2026-09-28, user : « ce n'est pas dans la langue
// de l'appli »). L'appli /app/ choisit sa langue dans i18n.js et la range dans
// localStorage (fabmesh.lang, fabmesh.lang.choisi, fabmesh.lang.detectee).
//
// 2026-10-13 (lot interface multilingue, constat INTERFACE-04) : SIX langues, comme
// l'appli. L'enveloppe n'existait qu'en francais et en anglais : un visiteur en
// espagnol, chinois, hindi ou arabe arrivait sur l'accueil, la connexion,
// l'inscription, le mot de passe oublie, la boutique et le bandeau des cookies en
// anglais, puis basculait dans sa langue en entrant dans l'appli.
//
//   - SCRIPT_LANGUE (pose dans le <head> par layout.tsx, donc execute avant le
//     premier rendu : aucun eclair de la mauvaise langue) applique la MEME decision
//     que i18n.js (choix explicite, langue enregistree non detectee, puis langue du
//     navigateur) et pose html[lang], html[dir] (rtl pour l'arabe) et
//     html[data-juridique] ;
//   - <T fr en /> rend une version par langue (.lang-en, .lang-fr, .lang-es…), les
//     regles de globals.css n'affichent que celle de html[lang]. L'anglais est la
//     cle, le francais est ecrit en ligne, les quatre autres langues viennent de
//     coque-traductions.json (build/check-traductions.mjs refuse un texte sans ses
//     six langues) ;
//   - les TEXTES JURIDIQUES (CGV, confidentialite, mentions, consentements de
//     renonciation) n'existent qu'en francais et en anglais et ne sont jamais
//     traduits par nous : classes .juridique-fr / .juridique-en reglees par
//     html[data-juridique] (le francais pour un visiteur francais, l'anglais pour
//     tous les autres), basculees par BasculeLangue sans toucher a la langue de
//     l'interface.
//
// Module NEUTRE (ni 'use client' ni code serveur) : le layout serveur lit la
// constante et <T> ; les crochets React (useTr, selecteur, avis) vivent dans
// langue-client.tsx.
//
import { Fragment, type ReactNode } from 'react';
import dicoBrut from './coque-traductions.json';

export type Langue = 'en' | 'fr' | 'es' | 'zh' | 'hi' | 'ar';
/** Langues servies par l'enveloppe ET par l'appli (meme liste que LANGUES_CONNUES de i18n.js, plus l'anglais). */
export const LANGUES: readonly Langue[] = ['en', 'fr', 'es', 'zh', 'hi', 'ar'];
/** Langues dont le texte vient du dictionnaire (l'anglais est la cle, le francais est ecrit en ligne). */
export const LANGUES_DICO = ['es', 'zh', 'hi', 'ar'] as const;
type LangueDico = (typeof LANGUES_DICO)[number];
/** Noms AUTONYMES, jamais traduits (meme table que NOMS_LANGUES de i18n.js). */
export const NOMS_LANGUES: Record<Langue, string> = { en: 'English', fr: 'Français', es: 'Español', zh: '中文', hi: 'हिन्दी', ar: 'العربية' };
/** Ordre du menu (meme ordre que ORDRE_MENU de i18n.js). */
export const ORDRE_MENU: readonly Langue[] = ['en', 'zh', 'hi', 'es', 'fr', 'ar'];

const DICO = dicoBrut as Record<string, Partial<Record<LangueDico, string>>>;

export function estLangue(x: unknown): x is Langue {
  return typeof x === 'string' && (LANGUES as readonly string[]).indexOf(x) !== -1;
}

// Meme ordre de decision que i18n.js (LANGUE PAR DEFAUT) : choix explicite, puis
// langue enregistree (hors 'en' herite et hors langue seulement detectee), puis
// langue du navigateur. La premiere langue DEMANDEE et non servie (allemand,
// chinois traditionnel…) est notee dans html[data-langue-demandee] : l'avis de
// repli (langue-client.tsx, AvisLangue) le dit au lieu de basculer sans un mot.
export const SCRIPT_LANGUE = `(function(){var C=['fr','es','zh','hi','ar'],l=null,d=null,det=false;function ok(x){return x==='en'||C.indexOf(x)>=0;}try{var c=localStorage.getItem('fabmesh.lang.choisi'),s=localStorage.getItem('fabmesh.lang'),e=localStorage.getItem('fabmesh.lang.detectee')==='1';if(c&&ok(c))l=c;else if(s&&s!=='en'&&!e&&ok(s))l=s;}catch(x){}if(!l){det=true;var n=[];try{n=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language];}catch(x){}for(var i=0;i<n.length;i++){var t=String(n[i]||'');if(!t)continue;var b=t.toLowerCase().split('-')[0];if(b==='en'){l='en';break;}if(C.indexOf(b)>=0){if(b==='zh'&&/^zh-(tw|hk|mo|hant)/i.test(t)&&!d)d=t;l=b;break;}if(!d)d=t;}if(!l)l='en';}var h=document.documentElement;h.lang=l;h.dir=(l==='ar')?'rtl':'ltr';h.setAttribute('data-juridique',l==='fr'?'fr':'en');if(det&&d)h.setAttribute('data-langue-demandee',d);})();`;

/** Valeurs inserees dans un texte : {x} = la premiere, {y} = la seconde (par NOM, une traduction peut les inverser). */
export type Valeurs = ReadonlyArray<string | number>;

// Dans un texte de droite a gauche (arabe), une valeur inseree (adresse e-mail, nom de langue, montant)
// est isolee par FSI … PDI (U+2068 / U+2069), comme dans l'appli (INTERFACE-05) : sans cela le point
// final ou l'arobase d'une adresse se placent du mauvais cote.
const FSI = '\u2068';
const PDI = '\u2069';
export function remplir(s: string, vals?: Valeurs, isoler = false): string {
  if (!vals || !vals.length) return s;
  return s.replace(/\{([xy])\}/g, (_, m: string) => {
    const v = vals[m === 'x' ? 0 : 1];
    if (v === undefined || v === null) return '';
    return isoler ? FSI + String(v) + PDI : String(v);
  });
}

/** Le texte d'une langue : le francais ecrit en ligne, les autres du dictionnaire, l'anglais en repli. */
export function texteEn(en: string, fr: string, langue: Langue): string {
  if (langue === 'en') return en;
  if (langue === 'fr') return fr;
  const e = DICO[en];
  return (e && e[langue]) || en;
}

/** Langue affichee, lue cote client (html[lang] pose par SCRIPT_LANGUE ou par le selecteur). */
export function langueAffichee(): Langue {
  if (typeof document === 'undefined') return 'en';
  const l = document.documentElement.lang;
  return estLangue(l) ? l : 'en';
}

/** Locale des dates et des nombres : celle de l'INTERFACE, pas celle du navigateur (meme table que
 *  locale() de i18n.js ; chiffres latins en arabe, comme le reste de l'interface). */
export function localeDe(l: Langue): string {
  if (l === 'en') {
    try { const n = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''; if (/^en\b/i.test(n)) return n; } catch { /* rien */ }
    return 'en';
  }
  return ({ fr: 'fr-FR', es: 'es-ES', zh: 'zh-CN', hi: 'hi-IN', ar: 'ar-u-nu-latn' } as const)[l];
}

/** Traduction LUE A L'APPEL (alert(), confirm(), message pose par un gestionnaire d'evenement).
 *  Pendant un rendu, utiliser useTr() (langue-client.tsx) : le HTML statique est en anglais. */
export function tr(en: string, fr: string, ...vals: Array<string | number>): string {
  const l = langueAffichee();
  return remplir(texteEn(en, fr, l), vals, l === 'ar');
}

/** Message garde dans un etat React et rendu dans les six langues par <Message />. */
export interface Texte { en: string; fr: string; vals?: Valeurs }
export function texte(en: string, fr: string, ...vals: Array<string | number>): Texte {
  return { en, fr, vals };
}

// Mise en forme minimale dans un texte traduisible : **gras** et [lien](/chemin).
// Les valeurs ({x}, {y}) sont inserees APRES le decoupage : une adresse e-mail ou un
// nom saisi par l'utilisateur ne peut jamais devenir un lien ni du gras.
type Morceau = { k: 't' | 'b' | 'a'; s: string; href?: string };
const MISE_EN_FORME = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
export function morceaux(s: string): Morceau[] {
  if (s.indexOf('**') < 0 && s.indexOf('](') < 0) return [{ k: 't', s }];
  const out: Morceau[] = [];
  let i = 0;
  for (const m of s.matchAll(MISE_EN_FORME)) {
    const debut = m.index ?? 0;
    if (debut > i) out.push({ k: 't', s: s.slice(i, debut) });
    if (m[1] !== undefined) out.push({ k: 'b', s: m[1] });
    else out.push({ k: 'a', s: m[2], href: m[3] });
    i = debut + m[0].length;
  }
  if (i < s.length) out.push({ k: 't', s: s.slice(i) });
  return out;
}
function rendre(s: string, vals?: Valeurs, isoler = false): ReactNode {
  const ms = morceaux(s);
  if (ms.length === 1 && ms[0].k === 't') return remplir(s, vals, isoler);
  return ms.map((m, n) => {
    const v = remplir(m.s, vals, isoler);
    if (m.k === 'b') return <strong key={n}>{v}</strong>;
    if (m.k === 'a') {
      const externe = /^\/legal\//.test(m.href || '');
      return <a key={n} href={m.href} target={externe ? '_blank' : undefined} rel={externe ? 'noopener' : undefined}>{v}</a>;
    }
    return <Fragment key={n}>{v}</Fragment>;
  });
}

/** Texte court dans les six langues (barre du haut, pied de page, boutons, pages d'entree). */
export function T({ fr, en, vals }: { fr: string; en: string; vals?: Valeurs }) {
  const e = DICO[en] || {};
  return (
    <>
      <span className="lang-en">{rendre(en, vals)}</span>
      <span className="lang-fr">{rendre(fr, vals)}</span>
      {LANGUES_DICO.map((l) => (
        <span key={l} className={'lang-' + l}>{rendre(e[l] || en, vals, l === 'ar')}</span>
      ))}
    </>
  );
}

/* Refus du serveur traduits par leur CODE (worker.ts, REFUS_CONNUS / _avecCodeRefus ; meme principe que
 * lib/textes-serveur.js dans l'appli). Seuls les codes que l'enveloppe peut recevoir (paiement, boutique,
 * session) ; un refus sans code connu garde son texte d'origine. */
const REFUS_COQUE: Record<string, Texte> = {
  sales_closed: texte('Purchases are not open yet.', 'Les achats ne sont pas encore ouverts.'),
  payments_unavailable: texte('Payments are temporarily unavailable. Please try again later.', 'Les paiements sont momentanément indisponibles. Réessayez plus tard.'),
  site_disabled: texte('The site is temporarily unavailable. Please try again later.', 'Le site est momentanément indisponible. Réessayez plus tard.'),
  unauthorized: texte('Your session has expired. Please sign in again.', 'Votre session a expiré. Reconnectez-vous.'),
  forbidden: texte('You are not allowed to do this.', "Vous n'avez pas l'autorisation de faire cela."),
  not_found: texte('Not found.', 'Introuvable.'),
  reports_rate_limited: texte('Too many reports today. Please try again tomorrow.', "Trop de signalements aujourd'hui. Réessayez demain."),
};
/** Message d'une reponse d'erreur du serveur ({ error, code }) : sa traduction si le code est connu, sinon son texte. */
export function messageServeur(corps: unknown, repli: Texte): Texte | string {
  const c = (corps && typeof corps === 'object') ? corps as { error?: unknown; code?: unknown } : null;
  if (c && typeof c.code === 'string' && Object.prototype.hasOwnProperty.call(REFUS_COQUE, c.code)) return REFUS_COQUE[c.code];
  if (c && typeof c.error === 'string' && c.error.trim()) return c.error;
  return repli;
}
/** Le meme, en texte dans la langue affichee (pour alert()). */
export function texteServeur(corps: unknown, repli: Texte): string {
  const m = messageServeur(corps, repli);
  return typeof m === 'string' ? m : tr(m.en, m.fr, ...(m.vals || []));
}

/** Rend un message garde dans un etat : un Texte (six langues) ou un texte brut (erreur inconnue du serveur). */
export function Message({ m }: { m: Texte | string | null | undefined }) {
  if (m === null || m === undefined || m === '') return null;
  if (typeof m === 'string') return <>{m}</>;
  return <T en={m.en} fr={m.fr} vals={m.vals} />;
}
