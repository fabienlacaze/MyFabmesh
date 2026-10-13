// DOM MINIMAL pour executer les VRAIS fichiers de l'interface (i18n.js, lib/textes-serveur.js) dans node, sans navigateur
// (lot interface multilingue, 2026-10-13). Ce fichier n'est PAS un test (le prefixe _ l'exclut du motif *.test.mjs).
//
// Juste ce que ces fichiers utilisent : arbre d'elements et de noeuds texte, attributs, style, classList, dataset,
// selecteurs simples (balise, #id, [attr], [attr="v"], :not([attr]), listes a virgules), TreeWalker sur les noeuds
// texte, evenements (avec propagation vers les parents puis le document), MutationObserver (childList + attributs,
// livre en microtache comme dans un navigateur), <select> / <option>, localStorage, navigator.
import vm from 'node:vm';

const VIDES = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);

class Noeud {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this._ecouteurs = {}; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(n) { return this.insertBefore(n, null); }
  insertBefore(n, ref) {
    if (n.nodeType === 11) { for (const c of [...n.childNodes]) this.insertBefore(c, ref); return n; }
    if (n.parentNode) n.parentNode._retirer(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    n.parentNode = this;
    this.ownerDocument._muter({ type: 'childList', target: this, addedNodes: [n], removedNodes: [] });
    return n;
  }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n); }
  _retirer(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; this.ownerDocument._muter({ type: 'childList', target: this, addedNodes: [], removedNodes: [n] }); }
  }
  removeChild(n) { this._retirer(n); return n; }
  remove() { if (this.parentNode) this.parentNode._retirer(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  addEventListener(type, f, opts) { (this._ecouteurs[type] = this._ecouteurs[type] || []).push({ f, capture: opts === true || (opts && opts.capture) }); }
  removeEventListener(type, f) { this._ecouteurs[type] = (this._ecouteurs[type] || []).filter((e) => e.f !== f); }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    const chemin = [];
    for (let x = this; x; x = x.parentNode) chemin.push(x);
    if (this.ownerDocument && !chemin.includes(this.ownerDocument) && this !== this.ownerDocument) { /* noeud detache */ }
    for (const x of chemin) {
      if (ev._stop) break;
      ev.currentTarget = x;
      for (const e of [...(x._ecouteurs[ev.type] || [])]) e.f.call(x, ev);
      if (!ev.bubbles) break;
    }
    return !ev.defaultPrevented;
  }
}

class Texte extends Noeud {
  constructor(doc, v) { super(doc); this.nodeType = 3; this.nodeName = '#text'; this._v = String(v); }
  get nodeValue() { return this._v; }
  set nodeValue(v) { this._v = String(v); }
  get textContent() { return this._v; }
  set textContent(v) { this._v = String(v); }
}

class Fragment extends Noeud {
  constructor(doc) { super(doc); this.nodeType = 11; this.nodeName = '#document-fragment'; }
}

class Element extends Noeud {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.tagName = this.nodeName = String(tag).toUpperCase();
    this._attrs = new Map();
    const el = this;
    this.style = new Proxy({ _p: {} }, {
      get(o, k) { if (k === 'cssText') return Object.entries(o._p).map(([a, b]) => a + ':' + b).join(';'); if (k === 'setProperty') return (a, b) => { o._p[a] = b; }; return o._p[k] ?? ''; },
      set(o, k, v) {
        if (k === 'cssText') { o._p = {}; for (const d of String(v).split(';')) { const i = d.indexOf(':'); if (i > 0) o._p[d.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = d.slice(i + 1).trim(); } return true; }
        o._p[k] = v; return true;
      },
    });
    this.classList = {
      contains: (c) => (el.getAttribute('class') || '').split(/\s+/).includes(c),
      add: (...cs) => { const s = new Set((el.getAttribute('class') || '').split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); el.setAttribute('class', [...s].join(' ')); },
      remove: (...cs) => { el.setAttribute('class', (el.getAttribute('class') || '').split(/\s+/).filter((c) => c && !cs.includes(c)).join(' ')); },
      toggle: (c, f) => { const a = el.classList.contains(c); const v = f === undefined ? !a : !!f; if (v) el.classList.add(c); else el.classList.remove(c); return v; },
    };
    this.dataset = new Proxy({}, {
      get(_, k) { const v = el.getAttribute('data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())); return v == null ? undefined : v; },
      set(_, k, v) { el.setAttribute('data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(v)); return true; },
    });
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }
  get type() { return this.getAttribute('type') || (this.tagName === 'BUTTON' ? 'submit' : this.tagName === 'INPUT' ? 'text' : ''); }
  set type(v) { this.setAttribute('type', v); }
  get placeholder() { return this.getAttribute('placeholder') || ''; }
  set placeholder(v) { this.setAttribute('placeholder', v); }
  get tabIndex() { const v = this.getAttribute('tabindex'); return v == null ? -1 : Number(v); }
  set tabIndex(v) { this.setAttribute('tabindex', String(v)); }
  get alt() { return this.getAttribute('alt') || ''; }
  set alt(v) { this.setAttribute('alt', v); }
  get src() { return this.getAttribute('src') || ''; }
  set src(v) { this.setAttribute('src', v); }
  get href() { return this.getAttribute('href') || ''; }
  set href(v) { this.setAttribute('href', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  getAttribute(a) { return this._attrs.has(a) ? this._attrs.get(a) : null; }
  hasAttribute(a) { return this._attrs.has(a); }
  setAttribute(a, v) { const ancien = this.getAttribute(a); this._attrs.set(a, String(v)); this.ownerDocument._muter({ type: 'attributes', target: this, attributeName: a, oldValue: ancien }); }
  removeAttribute(a) { if (!this._attrs.has(a)) return; const ancien = this.getAttribute(a); this._attrs.delete(a); this.ownerDocument._muter({ type: 'attributes', target: this, attributeName: a, oldValue: ancien }); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { for (const c of [...this.childNodes]) this._retirer(c); if (v !== '' && v != null) this.appendChild(this.ownerDocument.createTextNode(v)); }
  get innerHTML() { return this.childNodes.map(serialiser).join(''); }
  set innerHTML(h) { for (const c of [...this.childNodes]) this._retirer(c); this.appendChild(this.ownerDocument._analyser(h)); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() { this.dispatchEvent(new this.ownerDocument.defaultView.Event('click', { bubbles: true })); }
  matches(sel) { return correspond(this, sel); }
  closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (correspond(x, sel)) return x; return null; }
  querySelectorAll(sel) { const r = []; parcourirElements(this, (e) => { if (e !== this && correspond(e, sel)) r.push(e); }); return r; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 }; }
  insertAdjacentElement(pos, el) { if (pos === 'afterend') this.parentNode.insertBefore(el, this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null); else this.appendChild(el); return el; }
  // <select>
  get options() { return this.tagName === 'SELECT' ? this.querySelectorAll('option') : undefined; }
  get selectedIndex() { const o = this.options || []; const i = o.findIndex((x) => x.selected); return i >= 0 ? i : (o.length ? 0 : -1); }
  get value() {
    if (this.tagName === 'SELECT') { const o = this.options; const i = this.selectedIndex; return i >= 0 ? o[i].value : ''; }
    if (this.tagName === 'OPTION') return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent;
    return this._valeur ?? this.getAttribute('value') ?? '';
  }
  set value(v) {
    if (this.tagName === 'SELECT') { for (const o of this.options) o.selected = (o.value === String(v)); return; }
    this._valeur = String(v);
  }
}

function serialiser(n) {
  if (n.nodeType === 3) return n.nodeValue.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const attrs = [...n._attrs].map(([a, v]) => ' ' + a + '="' + String(v).replace(/"/g, '&quot;') + '"').join('');
  const tag = n.tagName.toLowerCase();
  return VIDES.has(tag) ? '<' + tag + attrs + '>' : '<' + tag + attrs + '>' + n.childNodes.map(serialiser).join('') + '</' + tag + '>';
}

function parcourirElements(racine, f) {
  for (const c of racine.childNodes) if (c.nodeType === 1) { f(c); parcourirElements(c, f); }
}

// Selecteurs : liste a virgules de composes « tag#id.classe[attr][attr="v"]:not([attr]) ».
function correspond(el, sel) {
  return String(sel).split(',').some((s) => composeOk(el, s.trim()));
}
function composeOk(el, s) {
  let reste = s;
  const tag = (reste.match(/^[a-zA-Z][a-zA-Z0-9-]*/) || [])[0];
  if (tag) { if (el.tagName !== tag.toUpperCase()) return false; reste = reste.slice(tag.length); }
  while (reste) {
    let m;
    if ((m = reste.match(/^#([\w-]+)/))) { if (el.id !== m[1]) return false; }
    else if ((m = reste.match(/^\.([\w-]+)/))) { if (!el.classList.contains(m[1])) return false; }
    else if ((m = reste.match(/^\[([\w-]+)(?:\s*=\s*["']?([^"'\]]*)["']?)?\]/))) {
      if (!el.hasAttribute(m[1])) return false;
      if (m[2] !== undefined && el.getAttribute(m[1]) !== m[2]) return false;
    } else if ((m = reste.match(/^:not\(\[([\w-]+)\]\)/))) { if (el.hasAttribute(m[1])) return false; }
    else throw new Error('selecteur non gere : ' + s);
    reste = reste.slice(m[0].length);
  }
  return true;
}

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', middot: '·', hellip: '…', mdash: '—', ndash: '–', times: '×' };
function decoder(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (t, n) => (ENTITES[n] ?? t));
}

class Document extends Noeud {
  constructor(fenetre) {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.nodeName = '#document';
    this.defaultView = fenetre;
    this.readyState = 'loading';
    this._observateurs = [];
    this.documentElement = new Element(this, 'html');
    this.documentElement.parentNode = this;
    this.childNodes = [this.documentElement];
    this.head = new Element(this, 'head');
    this.body = new Element(this, 'body');
    this.documentElement.childNodes.push(this.head, this.body);
    this.head.parentNode = this.documentElement; this.body.parentNode = this.documentElement;
    this.activeElement = this.body;
  }
  createElement(t) { return new Element(this, t); }
  createTextNode(v) { return new Texte(this, v); }
  createDocumentFragment() { return new Fragment(this); }
  getElementById(id) { let r = null; parcourirElements(this.documentElement, (e) => { if (!r && e.id === id) r = e; }); return r; }
  querySelectorAll(sel) { const r = []; parcourirElements(this.documentElement, (e) => { if (correspond(e, sel)) r.push(e); }); return r; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  createTreeWalker(racine, _quoi, filtre) {
    const noeuds = [];
    const visiter = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) {
          const r = filtre && filtre.acceptNode ? filtre.acceptNode(c) : 1;
          if (r === 1) noeuds.push(c);
        } else if (c.nodeType === 1) visiter(c);
      }
    };
    visiter(racine);
    let i = 0;
    return { nextNode: () => (i < noeuds.length ? noeuds[i++] : null) };
  }
  _muter(rec) {
    for (const o of this._observateurs) {
      if (rec.type === 'attributes' && (!o.opts.attributes || (o.opts.attributeFilter && !o.opts.attributeFilter.includes(rec.attributeName)))) continue;
      if (rec.type === 'childList' && !o.opts.childList) continue;
      o.file.push(rec);
      if (!o.prevu) { o.prevu = true; queueMicrotask(() => { o.prevu = false; const f = o.file.splice(0); if (f.length) o.cb(f, o); }); }
    }
  }
  _analyser(html) {
    const frag = new Fragment(this);
    const pile = [frag];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
      const haut = pile[pile.length - 1];
      if (m[0].startsWith('<!--')) continue;
      if (m[1]) { while (pile.length > 1) { const x = pile.pop(); if (x.tagName === m[1].toUpperCase()) break; } continue; }
      if (m[2]) {
        const el = new Element(this, m[2]);
        for (const a of (m[3] || '').matchAll(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el._attrs.set(a[1], decoder(a[2] ?? a[3] ?? a[4] ?? ''));
        if (el.tagName === 'OPTION' && el.hasAttribute('selected')) el.selected = true;
        haut.appendChild(el);
        if (!m[4] && !VIDES.has(m[2].toLowerCase())) pile.push(el);
        continue;
      }
      if (m[5]) haut.appendChild(new Texte(this, decoder(m[5])));
    }
    return frag;
  }
}

class Evenement {
  constructor(type, init = {}) { this.type = type; this.bubbles = !!init.bubbles; this.defaultPrevented = false; this.detail = init.detail; this.key = init.key; this.target = null; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
}

/** Monte une page : `html` va dans <body> ; rend { fenetre, document, executer(code, nom), vider() }. */
export function creerPage({ html = '', langues = ['en-US'], stockage = {} } = {}) {
  const magasin = new Map(Object.entries(stockage));
  const fenetre = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Intl, Promise, Map, Set, JSON, Math, Date, RegExp, Error, Array, Object, String, Number, Boolean, Symbol, Proxy, Reflect, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    navigator: { language: langues[0], languages: langues.slice() },
    localStorage: {
      getItem: (k) => (magasin.has(k) ? magasin.get(k) : null),
      setItem: (k, v) => { magasin.set(k, String(v)); },
      removeItem: (k) => { magasin.delete(k); },
      _magasin: magasin,
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    Event: Evenement,
    CustomEvent: Evenement,
    KeyboardEvent: Evenement,
    MouseEvent: Evenement,
    _ecouteurs: {},
  };
  fenetre.addEventListener = (type, f) => { (fenetre._ecouteurs[type] = fenetre._ecouteurs[type] || []).push(f); };
  fenetre.removeEventListener = (type, f) => { fenetre._ecouteurs[type] = (fenetre._ecouteurs[type] || []).filter((x) => x !== f); };
  fenetre.dispatchEvent = (ev) => { for (const f of [...(fenetre._ecouteurs[ev.type] || [])]) f(ev); return true; };
  const document = new Document(fenetre);
  fenetre.document = document;
  fenetre.window = fenetre;
  fenetre.self = fenetre;
  fenetre.MutationObserver = class {
    constructor(cb) { this.cb = cb; this.file = []; this.prevu = false; }
    observe(_cible, opts) { this.opts = opts || {}; document._observateurs.push(this); }
    disconnect() { const i = document._observateurs.indexOf(this); if (i >= 0) document._observateurs.splice(i, 1); }
    takeRecords() { return this.file.splice(0); }
  };
  if (html) document.body.appendChild(document._analyser(html));
  const contexte = vm.createContext(fenetre);
  return {
    fenetre,
    document,
    /** Execute un script classique dans la page (comme une balise <script>). */
    executer(code, nom = 'script.js') { return vm.runInContext(code, contexte, { filename: nom }); },
    /** Fin du chargement : readyState=complete puis DOMContentLoaded (le document ecoute, comme un navigateur). */
    charger() { document.readyState = 'interactive'; document.dispatchEvent(new Evenement('DOMContentLoaded')); document.readyState = 'complete'; },
    /** Laisse passer les microtaches (MutationObserver) et les minuteries a 0 ms. */
    async attendre(ms = 0) { await new Promise((r) => setTimeout(r, ms)); },
    clavier(el, key) { const ev = new Evenement('keydown', { bubbles: true, key }); el.dispatchEvent(ev); return ev; },
    stockage: magasin,
  };
}
