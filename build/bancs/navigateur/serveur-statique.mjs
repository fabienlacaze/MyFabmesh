// Serveur statique minimal pour les bancs NAVIGATEUR (skill browser-automation) : sert un dossier sur 127.0.0.1, sans cache, aucun reseau sortant.
//   node build/bancs/navigateur/serveur-statique.mjs <racine> <port> [fichier par defaut d'un dossier : index.html]
// Bureau : racine = le dossier prepare par preparer-bureau.mjs, fichier par defaut index2.html.
// Site   : racine = cloud/public (la page est servie sous /app/), fichier par defaut index.html.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [, , racine, port, defaut = 'index.html'] = process.argv;
if (!racine || !port) { console.error('usage : node serveur-statique.mjs <racine> <port> [fichier par defaut]'); process.exit(1); }
const base = path.resolve(racine);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
http.createServer((req, res) => {
  try {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let p = path.join(base, u);
    if (!p.startsWith(base)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, defaut);
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(p));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}).listen(Number(port), '127.0.0.1', () => console.log('serveur statique :', base, 'sur http://127.0.0.1:' + port + '/'));
