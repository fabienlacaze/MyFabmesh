// Worker de reduction (voir lod-maillage.js). Recoit { id, pos, uv, idx, cible } et rend { id, idx } (indices reduits).
import { MeshoptSimplifier as S } from './meshopt-simplifier.js';

self.onmessage = async (e) => {
  const { id, pos, uv, idx, cible } = e.data;
  try {
    await S.ready;
    const cibleIdx = Math.max(3, Math.floor(cible) * 3);
    let res;
    if (uv) {
      // les UV pesent dans le choix des arêtes a supprimer : la texture reste bien calee sur les triangles gardes
      [res] = S.simplifyWithAttributes(idx, pos, 3, uv, 2, [1, 1], null, cibleIdx, 0.02, []);
    } else {
      [res] = S.simplify(idx, pos, 3, cibleIdx, 0.02, []);
    }
    if (res.length > cibleIdx * 1.5) [res] = S.simplify(idx, pos, 3, cibleIdx, 1.0, []);
    if (res.length > cibleIdx * 2) [res] = S.simplifySloppy(idx, pos, 3, null, cibleIdx, 1.0);
    const out = res instanceof Uint32Array ? res : new Uint32Array(res);
    self.postMessage({ id, idx: out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
