'use client';
//
// Langue de l'enveloppe Next, partie CLIENT (2026-10-13, lot interface multilingue).
// Voir lib/langue.tsx pour le mecanisme d'ensemble.
//
//   - useLangue() / useTr() : la langue affichee pour les ATTRIBUTS (placeholder,
//     title, aria-label) et les textes calcules. Le HTML statique est rendu en
//     anglais ; la langue reelle est lue apres le montage, sans ecart d'hydratation.
//   - SelecteurLangue : le choix de la langue HORS de l'appli, dans la barre du haut
//     de toutes les pages (INTERFACE-04 / -07). Meme comportement que le menu de
//     l'appli (i18n.js, _construireMenu) : bouton aria-haspopup="listbox" /
//     aria-expanded, liste role="listbox" + role="option", fleches, Debut / Fin,
//     Entree / Espace, Echap, Tab ; noms de langue AUTONYMES ; translate="no".
//     Le choix est ecrit dans les MEMES cles que l'appli (fabmesh.lang.choisi,
//     fabmesh.lang) : l'appli s'ouvre ensuite dans la langue choisie ici.
//   - AvisLangue : langue du navigateur non servie (allemand, japonais, chinois
//     traditionnel…) -> un avis, une fois, dans la langue servie, avec un bouton qui
//     ouvre le selecteur (meme texte et meme cle de memoire que l'appli).
//
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LANGUES, NOMS_LANGUES, ORDRE_MENU, T, estLangue, langueAffichee, remplir, texteEn, type Langue } from './langue';

const EVT_LANGUE = 'fabmesh:langue';
const EVT_OUVRIR = 'fabmesh:ouvrir-langue';
const CLE_CHOIX = 'fabmesh.lang.choisi';
const CLE_DETECTEE = 'fabmesh.lang.detectee';
const CLE_AVIS = 'fabmesh.lang.avis';

/** Pose la langue sur la page (html[lang], [dir], [data-juridique]) et previent les composants. */
export function appliquerLangue(code: Langue) {
  const h = document.documentElement;
  h.lang = code;
  h.dir = code === 'ar' ? 'rtl' : 'ltr';
  h.setAttribute('data-juridique', code === 'fr' ? 'fr' : 'en');
  try { window.dispatchEvent(new CustomEvent(EVT_LANGUE, { detail: { lang: code } })); } catch { /* vieux navigateur */ }
}

/** Choix EXPLICITE (selecteur) : memorise pour l'enveloppe ET pour l'appli. */
export function choisirLangue(code: Langue) {
  try {
    localStorage.setItem(CLE_CHOIX, code);
    localStorage.setItem('fabmesh.lang', code);
    localStorage.removeItem(CLE_DETECTEE);
  } catch { /* stockage refuse : la langue vaut pour cette page */ }
  document.documentElement.removeAttribute('data-langue-demandee');
  appliquerLangue(code);
}

/** Langue affichee ; 'en' pendant le rendu statique et le premier rendu client. */
export function useLangue(): Langue {
  const [langue, setLangue] = useState<Langue>('en');
  useEffect(() => {
    const lire = () => setLangue(langueAffichee());
    lire();
    window.addEventListener(EVT_LANGUE, lire);
    return () => window.removeEventListener(EVT_LANGUE, lire);
  }, []);
  return langue;
}

/** tr(en, fr, ...valeurs) dans la langue affichee, pour un attribut ou un texte calcule pendant le rendu. */
export function useTr() {
  const langue = useLangue();
  return useCallback(
    (en: string, fr: string, ...vals: Array<string | number>) => remplir(texteEn(en, fr, langue), vals, langue === 'ar'),
    [langue],
  );
}

/** Nom d'une langue ecrit dans cette langue (« Deutsch », « 日本語 ») ; le code en repli. */
function autonyme(tag: string): string {
  try {
    const court = String(tag).toLowerCase().split('-')[0];
    const code = court === 'zh' ? 'zh-Hant' : court;
    const nom = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (nom && nom !== code) return nom.charAt(0).toLocaleUpperCase(code) + nom.slice(1);
  } catch { /* Intl.DisplayNames absent */ }
  return String(tag);
}

export function SelecteurLangue() {
  const langue = useLangue();
  const tr = useTr();
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState<Langue>('en');
  const bouton = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLUListElement>(null);
  const id = 'coque-langue-liste';

  const fermer = useCallback((rendreFocus: boolean) => {
    setOuvert(false);
    if (rendreFocus) { try { bouton.current?.focus(); } catch { /* rien */ } }
  }, []);
  const ouvrir = useCallback(() => { setActif(langueAffichee()); setOuvert(true); }, []);
  const valider = (code: Langue) => {
    fermer(true);
    if (code !== langueAffichee()) choisirLangue(code);
  };

  useEffect(() => { if (ouvert) { try { liste.current?.focus(); } catch { /* rien */ } } }, [ouvert]);
  useEffect(() => {
    if (!ouvert) return;
    const clic = () => fermer(false);
    document.addEventListener('click', clic);
    return () => document.removeEventListener('click', clic);
  }, [ouvert, fermer]);
  useEffect(() => {
    // « Changer de langue » de l'avis de repli ouvre ce menu.
    const ouvrirDepuisAvis = () => ouvrir();
    window.addEventListener(EVT_OUVRIR, ouvrirDepuisAvis);
    // Langue choisie dans l'appli (autre onglet) : l'enveloppe suit.
    const stockage = (e: StorageEvent) => { if (e.key === CLE_CHOIX && estLangue(e.newValue)) appliquerLangue(e.newValue); };
    window.addEventListener('storage', stockage);
    return () => { window.removeEventListener(EVT_OUVRIR, ouvrirDepuisAvis); window.removeEventListener('storage', stockage); };
  }, [ouvrir]);

  const surTouche = (e: KeyboardEvent<HTMLUListElement>) => {
    const i = Math.max(0, ORDRE_MENU.indexOf(actif));
    if (e.key === 'ArrowDown') { e.preventDefault(); setActif(ORDRE_MENU[Math.min(ORDRE_MENU.length - 1, i + 1)]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif(ORDRE_MENU[Math.max(0, i - 1)]); }
    else if (e.key === 'Home') { e.preventDefault(); setActif(ORDRE_MENU[0]); }
    else if (e.key === 'End') { e.preventDefault(); setActif(ORDRE_MENU[ORDRE_MENU.length - 1]); }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); valider(actif); }
    else if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); fermer(true); }
    else if (e.key === 'Tab') { fermer(false); }
  };

  const nom = tr('Language: {x}', 'Langue : {x}', NOMS_LANGUES[langue]);
  return (
    <div className="coque-langue" translate="no" data-coque-langue="">
      <button
        ref={bouton}
        type="button"
        className="coque-langue-bouton"
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={id}
        aria-label={nom}
        title={nom}
        onClick={(e) => { e.stopPropagation(); if (ouvert) fermer(false); else ouvrir(); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ouvrir(); } }}
      >
        <span aria-hidden="true">🌐</span>
        {/* Le code visible suit html[lang] par la feuille de style : juste des le HTML statique. */}
        {LANGUES.map((l) => <span key={l} className={'lang-' + l}>{l.toUpperCase()}</span>)}
        <span aria-hidden="true" className="coque-langue-chevron">▾</span>
      </button>
      <ul
        ref={liste}
        id={id}
        role="listbox"
        tabIndex={-1}
        hidden={!ouvert}
        aria-label={tr('Interface language', "Langue de l'interface")}
        aria-activedescendant={ouvert ? id + '-' + actif : undefined}
        onKeyDown={surTouche}
        className="coque-langue-liste"
      >
        {ORDRE_MENU.map((code) => (
          <li
            key={code}
            id={id + '-' + code}
            role="option"
            aria-selected={code === langue}
            lang={code}
            dir={code === 'ar' ? 'rtl' : undefined}
            data-actif={code === actif ? '1' : undefined}
            onMouseMove={() => setActif(code)}
            onClick={(e) => { e.stopPropagation(); valider(code); }}
          >
            {NOMS_LANGUES[code]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AvisLangue() {
  const langue = useLangue();
  const tr = useTr();
  const [demandee, setDemandee] = useState<string | null>(null);
  useEffect(() => {
    const d = document.documentElement.getAttribute('data-langue-demandee');
    if (!d) return;
    let vu: string | null = null;
    try { vu = localStorage.getItem(CLE_AVIS); } catch { /* rien */ }
    if (vu !== d) setDemandee(d);
  }, []);
  // Un choix explicite fait disparaitre l'avis.
  useEffect(() => {
    const suivre = () => { if (!document.documentElement.getAttribute('data-langue-demandee')) setDemandee(null); };
    window.addEventListener(EVT_LANGUE, suivre);
    return () => window.removeEventListener(EVT_LANGUE, suivre);
  }, []);
  if (!demandee) return null;
  const fermer = () => { try { localStorage.setItem(CLE_AVIS, demandee); } catch { /* rien */ } setDemandee(null); };
  return (
    <div role="status" className="coque-avis-langue" data-coque-avis-langue="">
      <span className="coque-avis-texte">
        🌐 <T
          en="MyFabmesh is not available in {x} yet: the interface is shown in {y}."
          fr="MyFabmesh n'est pas encore disponible en {x} : l'interface est affichée en {y}."
          vals={[autonyme(demandee), NOMS_LANGUES[langue]]}
        />
      </span>
      <button type="button" className="ghost-btn small" onClick={(e) => { e.stopPropagation(); fermer(); window.dispatchEvent(new CustomEvent(EVT_OUVRIR)); }}>
        <T en="Change language" fr="Changer de langue" />
      </button>
      <button type="button" className="ghost-btn small" aria-label={tr('Close', 'Fermer')} title={tr('Close', 'Fermer')} onClick={fermer}>✕</button>
    </div>
  );
}
