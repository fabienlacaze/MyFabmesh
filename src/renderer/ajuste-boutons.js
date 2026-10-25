/* AJUSTEMENT DU TEXTE DES BOUTONS D'OUTILS (2026-10-25, demande du user : « plein d'outils sont ecrits sur deux lignes (« Subdivise r ») : mets des
 * scale box dans le texte pour que d'une langue a l'autre on n'ait pas ce probleme »).
 *
 * Le libelle d'un outil est plus long dans certaines langues (« Corriger les normales », « Remodeler une zone », « Explosion / destruction »...). Plutot que de
 * laisser le navigateur couper au milieu d'un mot, chaque bouton REDUIT SA TAILLE DE TEXTE jusqu'a tenir sur UNE ligne ; si meme au minimum (8 px) ce n'est pas
 * possible, il passe sur deux lignes avec la police la plus grande qui ne coupe AUCUN mot. Se refait tout seul quand le texte change (changement de langue,
 * prix ajoute), quand le bouton change de taille (fenetre, panneau qui s'ouvre) et quand de nouveaux boutons apparaissent. Aucun DOM n'est modifie : seuls
 * font-size et white-space du bouton sont poses en ligne. Fichier IDENTIQUE bureau / site.
 * Desactivable : window.__ajusteBoutons = false (puis recharger). */
(function () {
  'use strict';
  if (window.__ajusteBoutons === false) return;
  const SELECTEUR = '.tool-btn, .lb-tool-btn, .step-tools-grid > button, .step-tools-row > button';
  const MIN = 8;          // px : en dessous, le texte devient illisible
  const PAS = 0.5;
  const aFaire = new Set();
  let planifie = false;
  let ro = null;

  function debordeX(b) { return b.scrollWidth > b.clientWidth + 1; }

  function ajuster(b) {
    if (!b || !b.isConnected || !b.clientWidth) return;       // masque (panneau ferme) : le ResizeObserver rappellera
    b.style.removeProperty('font-size');
    b.style.removeProperty('white-space');
    b.style.removeProperty('word-break');
    b.style.removeProperty('overflow-wrap');
    // sans cela, un texte qui ne peut pas se couper ELARGIT sa colonne de grille (min-width:auto) au lieu de deborder : la mesure serait fausse et la mise en page deformee
    b.style.setProperty('min-width', '0', 'important');
    b.style.setProperty('overflow', 'hidden', 'important');
    const base = parseFloat(getComputedStyle(b).fontSize) || 11;
    // 1) une seule ligne, police reduite
    b.style.setProperty('white-space', 'nowrap', 'important');
    let t = base;
    while (debordeX(b) && t > MIN) { t -= PAS; b.style.setProperty('font-size', t + 'px', 'important'); }
    if (!debordeX(b)) return;
    // 2) meme a 8 px : deux lignes, jamais un mot coupe ; on cherche la plus grande police qui tient
    b.style.setProperty('white-space', 'normal', 'important');
    b.style.setProperty('word-break', 'normal', 'important');
    b.style.setProperty('overflow-wrap', 'normal', 'important');
    t = Math.min(base, 10);
    b.style.setProperty('font-size', t + 'px', 'important');
    while (debordeX(b) && t > MIN) { t -= PAS; b.style.setProperty('font-size', t + 'px', 'important'); }
  }

  function planifier(b) {
    aFaire.add(b);
    if (planifie) return;
    planifie = true;
    requestAnimationFrame(() => {
      planifie = false;
      const liste = [...aFaire]; aFaire.clear();
      for (const x of liste) { try { ajuster(x); } catch (_) {} }
    });
  }

  function surveiller(b) {
    if (b.__ajusteVu) return;
    b.__ajusteVu = true;
    if (!ro && typeof ResizeObserver === 'function') ro = new ResizeObserver((es) => { for (const e of es) planifier(e.target); });
    if (ro) ro.observe(b);
    planifier(b);
  }

  function balayer(racine) {
    if (!racine || racine.nodeType !== 1) return;
    if (racine.matches && racine.matches(SELECTEUR)) surveiller(racine);
    if (racine.querySelectorAll) racine.querySelectorAll(SELECTEUR).forEach(surveiller);
  }

  function demarrer() {
    balayer(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((n) => balayer(n.nodeType === 1 ? n : n.parentElement));
          const p = m.target && m.target.nodeType === 1 ? m.target.closest && m.target.closest(SELECTEUR) : null;
          if (p) planifier(p);                       // texte ou badge change dans un bouton
        } else if (m.type === 'characterData') {
          const p = m.target.parentElement && m.target.parentElement.closest(SELECTEUR);
          if (p) planifier(p);
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => document.querySelectorAll(SELECTEUR).forEach(planifier));
    window.addEventListener('resize', () => document.querySelectorAll(SELECTEUR).forEach(planifier));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
