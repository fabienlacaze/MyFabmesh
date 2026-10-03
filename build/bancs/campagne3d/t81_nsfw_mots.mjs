// Verifie (appli de bureau lancee) que la liste de mots affichee par la fenetre « New project » ne contient QUE des termes durs :
// « blood », « kill »... (termes de contexte) ne doivent plus figurer ; un terme dur (liste du filtre) doit rester.
import * as h from './h.mjs';
const r = await h.ipc('getNsfwKeywords', []);   // methode du preload (meshyAPI), pas le nom du canal IPC
const mots = Array.isArray(r && r.data) ? r.data : [];
const contexte = ['blood', 'bloody', 'kill', 'wound', 'strip', 'breast', 'flesh', 'crack', 'hanging'].filter((m) => mots.includes(m));
console.log(JSON.stringify({ nb_mots: mots.length, termes_de_contexte_presents: contexte, exemple_terme_dur_present: mots.slice(0, 5) }));
process.exit(contexte.length === 0 && mots.length > 20 ? 0 : 1);
