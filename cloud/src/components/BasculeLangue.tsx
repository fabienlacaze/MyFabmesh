'use client';
//
// Sur une page legale : lire l'autre version sans toucher a la langue de
// l'appli (2026-09-28). Le texte opposable au consommateur francais est la
// version francaise (commit 2b2bc56) ; elle doit rester a un clic quelle que
// soit la langue choisie dans l'appli. Voir lib/langue.tsx.
//
import { useEffect, useState } from 'react';

export function BasculeLangue() {
  const [lang, setLang] = useState<'fr' | 'en'>('en');
  useEffect(() => {
    setLang(document.documentElement.lang === 'fr' ? 'fr' : 'en');
  }, []);
  const basculer = () => {
    const suivante = lang === 'fr' ? 'en' : 'fr';
    document.documentElement.lang = suivante;
    setLang(suivante);
  };
  return (
    <p style={{ textAlign: 'right', margin: '0 0 8px', fontSize: 13 }}>
      <button type="button" onClick={basculer} className="ghost-btn small">
        {lang === 'fr' ? 'Read in English' : 'Lire en français'}
      </button>
    </p>
  );
}
