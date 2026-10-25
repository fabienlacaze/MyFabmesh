/* AJUSTEMENT DU TEXTE DES BOUTONS D'OUTILS (2026-10-25, « scale box » demandee par le user : « plein d'outils sont ecrits sur deux lignes (« Subdivise r ») :
 * mets des scale box dans le texte pour que d'une langue a l'autre on n'ait pas ce probleme »). V2 le meme jour (retour du user : tailles de texte inegales
 * dans une meme grille, pastilles coupees).
 *
 * Principe : la taille du texte est calculee a partir de sa LARGEUR REELLE (mesuree au canvas avec la meme police) et de la place disponible dans le bouton
 * (largeur - marges - pastille de prix). Les boutons d'une meme GRILLE partagent UNE taille de police : la plus grande qui fait tenir sur une ligne tous les
 * libelles, sans descendre sous 10 px. Un libelle qui ne tient pas meme a 10 px passe sur deux lignes, a 10 px, sans jamais couper un mot (reduit jusqu'a 8 px
 * si un seul mot est trop large). Se refait quand le texte change (langue, prix), quand un bouton change de taille (fenetre, panneau qui s'ouvre) et quand de
 * nouveaux boutons apparaissent. Aucun DOM n'est modifie : seuls font-size / white-space / overflow du bouton sont poses en ligne. Fichier IDENTIQUE bureau / site.
 * Desactivable : window.__ajusteBoutons = false (puis recharger). */
(function () {
  'use strict';
  if (window.__ajusteBoutons === false) return;
  const SELECTEUR = '.tool-btn, .lb-tool-btn, .step-tools-grid > button, .step-tools-row > button';
  const CONFORT = 10;      // px : taille commune minimale avant de passer sur deux lignes
  const MIN = 8;           // px : plancher absolu (un seul mot trop large)
  const MARGE = 0.96;      // securite sur la mesure du texte
  const PROPRES = ['font-size', 'white-space', 'word-break', 'overflow-wrap', 'min-width', 'overflow'];
  const aFaire = new Set();
  let planifie = false;
  let ro = null;
  let ctx = null;

  function mesure(texte, taille, police) {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    ctx.font = police.replace('__T__', taille + 'px');
    return ctx.measureText(texte).width;
  }

  function texteDe(b) {
    let t = '';
    b.childNodes.forEach((n) => {
      if (n.nodeType === 3) t += n.nodeValue;
      else if (n.nodeType === 1 && !n.classList.contains('cloud-cost-badge') && !n.classList.contains('credit-badge')) t += n.textContent;
    });
    return t.replace(/\s+/g, ' ').trim();
  }

  function placeDispo(b, cs) {
    let p = b.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const badge = b.querySelector(':scope > .cloud-cost-badge, :scope > .credit-badge');
    if (badge && badge.offsetWidth) p -= badge.offsetWidth + (parseFloat(cs.columnGap) || parseFloat(cs.gap) || 4);
    return p * MARGE;
  }

  function nettoyer(b) { PROPRES.forEach((k) => b.style.removeProperty(k)); }

  function ajusterGroupe(boutons) {
    const vus = boutons.filter((b) => b.isConnected && b.clientWidth > 0);
    if (!vus.length) return;
    vus.forEach(nettoyer);
    const infos = vus.map((b) => {
      const cs = getComputedStyle(b);
      const base = parseFloat(cs.fontSize) || 11;
      const police = `${cs.fontStyle === 'italic' ? 'italic ' : ''}${cs.fontWeight} __T__ ${cs.fontFamily}`;
      const texte = texteDe(b);
      const dispo = placeDispo(b, cs);
      const w = texte ? mesure(texte, base, police) : 0;
      // taille a laquelle le libelle tient sur UNE ligne (la largeur est proportionnelle a la taille)
      const une = w > 0 ? Math.floor(base * dispo / w * 2) / 2 : base;
      return { b, base, police, texte, dispo, une: Math.min(base, Math.max(MIN, une)) };
    });
    const base = Math.max(...infos.map((i) => i.base));
    // taille commune : la plus grande qui convient a TOUS (plancher CONFORT), jamais au-dessus de la taille d'origine
    const G = Math.min(base, Math.max(CONFORT, Math.min(...infos.map((i) => i.une))));
    for (const i of infos) {
      const { b } = i;
      b.style.setProperty('min-width', '0', 'important');      // sans cela un texte insecable elargit la colonne de grille
      b.style.setProperty('overflow', 'hidden', 'important');
      if (i.une >= G) {                                        // tient sur une ligne a la taille commune
        b.style.setProperty('font-size', G + 'px', 'important');
        b.style.setProperty('white-space', 'nowrap', 'important');
      } else {                                                 // deux lignes, a la taille commune, aucun mot coupe
        let t = G;
        const mots = i.texte.split(' ');
        const plusLarge = (taille) => Math.max(...mots.map((m) => mesure(m, taille, i.police)));
        while (t > MIN && plusLarge(t) > i.dispo) t -= 0.5;
        b.style.setProperty('font-size', t + 'px', 'important');
        b.style.setProperty('white-space', 'normal', 'important');
        b.style.setProperty('word-break', 'normal', 'important');
        b.style.setProperty('overflow-wrap', 'normal', 'important');
      }
    }
  }

  function groupeDe(b) {
    const parent = b.parentElement;
    if (!parent) return [b];
    return [...parent.children].filter((x) => x.matches && x.matches(SELECTEUR));
  }

  function planifier(b) {
    aFaire.add(b);
    if (planifie) return;
    planifie = true;
    requestAnimationFrame(() => {
      planifie = false;
      const parents = new Map();
      for (const b2 of aFaire) { const p = b2.parentElement || b2; if (!parents.has(p)) parents.set(p, b2); }
      aFaire.clear();
      for (const b2 of parents.values()) { try { ajusterGroupe(groupeDe(b2)); } catch (_) {} }
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
          const p = m.target && m.target.nodeType === 1 && m.target.closest ? m.target.closest(SELECTEUR) : null;
          if (p) planifier(p);                       // texte ou pastille qui change dans un bouton
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
