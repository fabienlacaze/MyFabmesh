/* MyFabmesh.AI — « Will it run on my PC? » (check.html).
   Lit ce que le navigateur expose (systeme, modele de carte via WebGL,
   nombre de fils du processeur) ; la memoire video est DEDUITE du modele
   (gpu-database.js), jamais lue.

   Verdicts (27/09/2026, alignes sur l'application) :
   - local : Windows + NVIDIA de 12 Go ou plus -> l'IA tourne sur le PC ;
   - cloud : Windows + autre carte -> l'appli Windows passe en mode cloud ;
   - doute : memoire inconnue ou ambigue (portable, modeles en 8 OU 16 Go) ->
             l'appli verifie elle-meme au premier lancement ;
   - web   : pas Windows -> application web.
   Les anciens modes « Full / Standard » et la promesse d'un .exe de
   diagnostic ont ete retires : ni l'un ni l'autre n'existaient. */
(function () {
  'use strict';

  var MIN_LOCAL_MB = 12 * 1024;
  var WINDOWS_APP = 'https://apps.microsoft.com/detail/9PH6GT8XKQDW';
  var WEB_APP = 'https://myfabmesh-cloud.fabien65400.workers.dev/';

  function setRow(id, text, cls) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'val ' + (cls || '');
  }

  function detectOS() {
    var ua = navigator.userAgent || '';
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
    if (/Windows NT 6\.[123]/.test(ua)) return 'Windows 7/8';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown';
  }

  function detectGPU() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return null;
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (!dbg) return null;
      return String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
    } catch (e) {
      return null;
    }
  }

  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)"
  // -> "NVIDIA GeForce RTX 5080"
  function cleanName(raw) {
    var m = /ANGLE \([^,]+,\s*([^,(]+?)\s*(\(0x[0-9A-Fa-f]+\))?\s*(Direct3D|OpenGL|Vulkan|,|\))/.exec(raw);
    return (m ? m[1] : raw).trim();
  }

  function lookupGPU(raw) {
    var vendor = /NVIDIA/i.test(raw) ? 'NVIDIA' : /AMD|Radeon/i.test(raw) ? 'AMD'
               : /Intel/i.test(raw) ? 'Intel' : /Apple/i.test(raw) ? 'Apple' : 'Unknown';
    var info = { name: cleanName(raw), vendor: vendor, vram: null, ambiguous: false };
    var db = window.GPU_DB || [];
    for (var i = 0; i < db.length; i++) {
      if (raw.indexOf(db[i].match) !== -1) { info.vram = db[i].vram; info.vendor = db[i].vendor || vendor; break; }
    }
    // Portables : meme nom que la carte de bureau, mais moins de memoire.
    // Certains modeles existent en 8 OU 16 Go. Dans ces cas, on ne tranche pas.
    if (/Laptop|Mobile|Max-Q/i.test(raw) || /RTX (4060 Ti|5060 Ti)/.test(raw)) info.ambiguous = true;
    return info;
  }

  function verdictFor(os, gpu) {
    if (os !== 'Windows 10/11') return 'web';
    if (!gpu || gpu.vendor !== 'NVIDIA') return 'cloud';
    if (gpu.vram === null || gpu.ambiguous) return 'doute';
    return gpu.vram >= MIN_LOCAL_MB ? 'local' : 'cloud';
  }

  var TEXTES = {
    local: ['Your PC can run the AI itself',
            'The Windows app uses your graphics card: unlimited generations, and it works offline once the AI models are downloaded.'],
    cloud: ['The Windows app works, in cloud mode',
            'Your graphics card is below the 12 GB NVIDIA card the local AI needs, so the app runs the AI on our servers. You pay with credits and see the price before each action. The web app works too.'],
    doute: ['The Windows app works: locally or in cloud mode',
            'Your browser does not tell us exactly how much video memory your card has. The app checks it at first launch: 12 GB or more and the AI runs on your PC, otherwise it switches to cloud mode.'],
    web: ['Use the web app',
          'The Windows app needs Windows 10 or 11. The web app runs in your browser on any computer or tablet, with no graphics card needed.'],
  };

  function lien(url, texte, primaire, externe) {
    return '<a class="btn' + (primaire ? ' primaire' : '') + '" href="' + url + '"'
         + (externe ? ' target="_blank" rel="noopener"' : '') + '>' + texte + '</a>';
  }

  function render() {
    var os = detectOS();
    setRow('r-os', os, os === 'Windows 10/11' ? 'ok' : 'warn');

    var raw = detectGPU();
    var gpu = raw ? lookupGPU(raw) : null;
    if (gpu) {
      setRow('r-gpu', gpu.name, gpu.vendor === 'NVIDIA' ? 'ok' : 'warn');
      if (gpu.vram !== null && !gpu.ambiguous) {
        setRow('r-vram', (gpu.vram / 1024).toFixed(0) + ' GB (estimated)', gpu.vram >= MIN_LOCAL_MB ? 'ok' : 'warn');
      } else {
        setRow('r-vram', 'checked by the app at first launch', 'warn');
      }
    } else {
      setRow('r-gpu', 'not reported by your browser', 'warn');
      setRow('r-vram', 'checked by the app at first launch', 'warn');
    }
    var fils = navigator.hardwareConcurrency;
    setRow('r-cores', fils ? String(fils) : 'unknown', fils >= 4 ? 'ok' : 'warn');

    var v = verdictFor(os, gpu);
    var box = document.getElementById('verdict');
    box.className = 'verdict ' + v;
    box.innerHTML = '<strong>' + TEXTES[v][0] + '</strong><p>' + TEXTES[v][1] + '</p>';
    document.getElementById('check-cta-row').innerHTML = v === 'web'
      ? lien(WEB_APP, 'Open the web app', true, false)
      : lien(WINDOWS_APP, 'Get the Windows app', true, true) + lien(WEB_APP, 'Or use the web app', false, false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
