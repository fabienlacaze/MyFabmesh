'use client';
//
// Sur une page legale : lire l'autre version sans toucher a la langue de
// l'appli (2026-09-28). Le texte opposable au consommateur francais est la
// version francaise (commit 2b2bc56) ; elle doit rester a un clic quelle que
// soit la langue choisie dans l'appli. Voir lib/langue.tsx.
//
// 2026-10-13 (lot interface multilingue) : le bouton bascule html[data-juridique]
// (versions .juridique-fr / .juridique-en) et plus html[lang]. Avant, lire la
// version anglaise passait TOUTE l'enveloppe (barre du haut, pied de page) en
// anglais ; avec six langues d'interface, la langue de l'interface et celle du
// texte de loi sont desormais deux choses distinctes.
//
import { useEffect, useState } from 'react';
import { T } from '@/lib/langue';

export function BasculeLangue() {
  const [version, setVersion] = useState<'fr' | 'en'>('en');
  useEffect(() => {
    setVersion(document.documentElement.getAttribute('data-juridique') === 'fr' ? 'fr' : 'en');
  }, []);
  const basculer = () => {
    const suivante = version === 'fr' ? 'en' : 'fr';
    document.documentElement.setAttribute('data-juridique', suivante);
    setVersion(suivante);
  };
  return (
    <p style={{ textAlign: 'end', margin: '0 0 8px', fontSize: 13 }}>
      {/* Libelle ecrit dans la langue qu'il propose : il s'adresse a qui la lit. */}
      <button type="button" onClick={basculer} className="ghost-btn small" translate="no" lang={version === 'fr' ? 'en' : 'fr'}>
        {version === 'fr' ? 'Read in English' : 'Lire en français'}
      </button>
    </p>
  );
}

/** Dans les quatre langues sans version juridique (espagnol, chinois, hindi, arabe) : le dire, au lieu
 *  d'afficher un texte anglais sans un mot (globals.css cache cet avis en anglais et en francais). */
export function AvisJuridique() {
  return (
    <p className="avis-juridique" role="note" style={{ color: 'var(--text-2)', fontSize: 13, margin: '0 0 14px' }}>
      <T
        en="This legal text is available in English and French only."
        fr="Ce texte juridique n'existe qu'en anglais et en français."
      />
    </p>
  );
}
