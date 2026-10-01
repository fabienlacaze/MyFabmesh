/* PREVISION DE COUPURE MODAL — le calcul UNIQUE (2026-09-30).
 *
 * POURQUOI CE FICHIER EXISTE. La carte « Coût GPU (Modal) » de l'admin, le
 * bandeau fixe et l'e-mail d'alerte faisaient chacun LEUR calcul :
 *   - la carte : Math.floor(reste / moyenne 7 j) = « environ 0 jour(s) » alors
 *     que le mois se terminait le soir meme (0,49 jour arrondi a 0, et la
 *     remise a zero du 1er ignoree) ;
 *   - le bandeau : un fichier fige (_meta/modal_alert.json) qui gardait
 *     « budget faible — restant 9,52 $ » tout le mois SUIVANT ;
 *   - l'e-mail : un seuil de 15 % sans prevision, en anglais.
 * Et tous presentaient des chiffres vieux de 13 h (« relevee il y a 774 min »)
 * comme frais, sans aucune alerte avant 26 h.
 *
 * Ici : une fonction PURE (aucun acces R2, aucun Supabase, l'heure passee en
 * parametre) qui rend le bloc `prevision`. Le worker l'appelle pour la carte,
 * le bandeau, l'e-mail et le cron ; les bancs d'essai l'appellent tels quels.
 *
 * REGLES (conception « Prevision de coupure », validee le 30/09) :
 *   - releve « a jour » <= 2 h ; au-dela il REMPLACE le verdict : jamais de
 *     prevision sur des chiffres perimes. > 26 h = « arrete » (seuil de
 *     l'arret automatique, inchange) ;
 *   - rythme = moyenne des jours COMPLETS DU MOIS EN COURS (2 au moins, 7 au plus ;
 *     le jour en cours, a 1 h de donnees, comptait pour un jour plein), sinon total
 *     du mois / temps ecoule des 12 premieres heures, sinon aucun (2026-10-01) ;
 *   - on raisonne jusqu'a la remise a zero : le 1er du mois a 00:00 UTC
 *     (02:00 a Paris l'ete, 01:00 l'hiver) ;
 *   - un releve du mois PRECEDENT n'est jamais presente comme « ce mois ».
 *
 * Aucun nom d'application ni de moteur ne sort d'ici vers l'ecran : les
 * applications Modal sont regroupees en postes nommes (posteModal). */

export const SEUIL_A_JOUR_MIN = 120;      // releve horaire : 2 h = un passage manque
export const SEUIL_ARRETE_H = 26;         // meme seuil que l'arret automatique (_budgetReelEpuise)
export const SEUIL_SERRE = 0.85;          // prevu > 85 % de la limite = « de justesse »
const JOUR = 86_400_000;
const FUSEAU = 'Europe/Paris';

export type SourceLimite = 'admin' | 'secours_serveur' | 'aucune';
export interface LimiteModal {
  usd: number | null;                     // null = aucune limite ; 0 = tout refuser
  source: SourceLimite;
  enregistree_le: string | null;
  precedente_usd: number | null;
}
export interface ReleveBrut {
  usage?: unknown; ts?: unknown; mois?: unknown; by_day?: unknown;
}
export interface EntreesPrevision {
  maintenant: number;                     // ms epoch
  releve: ReleveBrut | null;              // _meta/modal_real_usage.json
  limite: LimiteModal;
  estimation_mois_usd?: number | null;    // estimation du site, lue seulement si le releve manque
  erreur?: { ts?: unknown; message?: unknown } | null;   // derniere erreur signalee par le releve
  refus_ts?: string | null;               // dernier envoi refuse (cle differente)
}
export type EtatReleve = 'a_jour' | 'en_retard' | 'arrete' | 'absent';
export type NiveauPrevision = 'limite_zero' | 'absent' | 'arrete' | 'debut_de_mois' | 'atteinte'
  | 'en_retard' | 'sans_limite' | 'coupure_prevue' | 'serre' | 'ok';
export type Couleur = 'vert' | 'orange' | 'rouge' | 'gris' | 'bleu';
export type EtatArret = 'actif' | 'bloque' | 'aveugle' | 'inactif' | 'tout_refuse' | 'sans_limite';

export interface PrevisionModal {
  version: 1;
  calcule_le: string;
  cycle: string;                          // 'AAAA-MM' (mois UTC = cycle de facturation Modal)
  cycle_nom: string;                      // 'septembre'
  cycle_debut_ts: string;
  cycle_fin_ts: string;                   // remise a zero
  jour_utc_debut_ts: string;              // debut du « jour » de la facture (minuit UTC)
  releve: {
    etat: EtatReleve;
    ts: string | null;
    age_min: number | null;
    mois: string | null;
    mois_nom: string | null;
    du_mois_courant: boolean;
    usage_usd: number | null;             // total du mois DU RELEVE (peut etre le mois precedent)
    erreur: { ts: string; message: string } | null;
    refus_ts: string | null;
  };
  limite: LimiteModal;
  niveau: NiveauPrevision;
  couleur: Couleur;
  icone: string;
  urgence: boolean;                       // coupure dans moins de 24 h
  titre: string;
  phrase: string;
  depense_usd: number | null;             // depense du mois EN COURS (null si inconnue)
  reste_usd: number | null;
  rythme_usd_jour: number | null;
  rythme_source: '7_jours' | 'mois_en_cours' | 'depuis_debut_mois' | null;
  rythme_jours: Array<{ jour: string; usd: number }>;
  fin_prevue_usd: number | null;          // depense prevue a la remise a zero
  marge_usd: number | null;               // limite - fin prevue
  coupure_ts: string | null;              // epuisement prevu AVANT la remise a zero
  aujourdhui_usd: number | null;
  hier_usd: number | null;
  estimation_mois_usd: number | null;
  arret_auto: { etat: EtatArret; raison: string };
  bandeau: { couleur: 'rouge' | 'orange'; texte: string } | null;
}

// ─── formats (francais, heure de Paris) ───────────────────────────────────
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function usd(n: number): string {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00a0$';
}

function morceaux(ms: number, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, ...opts }).formatToParts(new Date(ms))) {
    o[p.type] = p.value;
  }
  return o;
}

export function heureParis(ms: number): string {
  const p = morceaux(ms, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

/** « 1er octobre », « jeudi 1er octobre ». Intl ecrit « 1 octobre ». */
export function dateParis(ms: number, avecJourSemaine = false): string {
  const p = morceaux(ms, { weekday: 'long', day: 'numeric', month: 'long' });
  const jour = p.day === '1' ? '1er' : p.day;
  return (avecJourSemaine ? `${p.weekday} ` : '') + `${jour} ${p.month}`;
}

function jourParis(ms: number): string {
  const p = morceaux(ms, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** « aujourd'hui vers 18 h », « demain vers 03 h », « le samedi 10 octobre vers 02 h ». */
export function quandParis(ms: number, maintenant: number): string {
  // Heure ET jour pris sur l'instant arrondi : 23:40 donne « samedi vers 00 h »,
  // pas « vendredi vers 00 h ». (Paris est a une heure pleine d'UTC.)
  const arrondi = Math.round(ms / 3_600_000) * 3_600_000;
  const h = morceaux(arrondi, { hour: '2-digit', hourCycle: 'h23' }).hour;
  const j = jourParis(arrondi);
  if (j === jourParis(maintenant)) return `aujourd'hui vers ${h} h`;
  if (j === jourParis(maintenant + JOUR)) return `demain vers ${h} h`;
  return `le ${dateParis(arrondi, true)} vers ${h} h`;
}

/** Duree lisible : « 17 min », « 12 h 54 », « 3 jours ». Jamais « jour(s) ». */
export function duree(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  }
  return `${Math.round(min / 1440)} jours`;
}

/** Ecart avant la remise a zero : « 11 h 30 », « 5 jours », « 3 semaines ». */
function ecart(ms: number): string {
  if (ms < 48 * 3_600_000) return duree(ms);
  const j = ms / JOUR;
  return j < 14 ? `${Math.round(j)} jours` : `${Math.round(j / 7)} semaines`;
}

export function moisUtc(ms: number): string { return new Date(ms).toISOString().slice(0, 7); }
export function jourUtc(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
function debutMoisUtc(ms: number): number { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
function finMoisUtc(ms: number): number { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
function debutJourUtc(ms: number): number { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

/** « d'octobre », « de septembre ». */
function deMois(nom: string): string { return /^[aeiouyh]/i.test(nom) ? `d'${nom}` : `de ${nom}`; }
function majuscule(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export function nomMois(mois: string): string {
  const [a, m] = mois.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long' }).format(new Date(Date.UTC(a, m - 1, 15)));
}

// ─── postes : jamais un nom d'application a l'ecran ───────────────────────
/** Regroupe une application Modal en poste lisible. Tout nom inconnu tombe
 *  dans « Autres services » : un nom d'appli peut contenir un nom de moteur
 *  (secret industriel) ou un nom technique (« myfabmesh-etat »). */
export function posteModal(app: string): string {
  const a = String(app || '').toLowerCase();
  if (a === 'myfabmesh-cloud' || a === 'myfabmesh-lod') return 'Images et maillages 3D';
  if (/^fabmesh-|test|banc|diag|train/.test(a)) return "Essais et bancs de test";
  if (/skintokens|-rig$/.test(a)) return 'Rig (squelette)';
  if (/unimate|anim|fbx-retarget/.test(a)) return 'Animation';
  if (/partsam|sampart|segment/.test(a)) return 'Segmentation';
  if (a === 'myfabmesh-redacteur') return 'Descriptions automatiques';
  if (a === 'myfabmesh-etat') return 'Suivi des services';
  return 'Autres services';
}

export function regrouperPostes(byApp: unknown): Array<{ nom: string; usd: number }> {
  const tot: Record<string, number> = {};
  if (byApp && typeof byApp === 'object') {
    for (const [app, v] of Object.entries(byApp as Record<string, unknown>)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      const k = posteModal(app);
      tot[k] = (tot[k] ?? 0) + n;
    }
  }
  return Object.entries(tot)
    .filter(([, c]) => c >= 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([nom, c]) => ({ nom, usd: r4(c) }));
}

// ─── le calcul ────────────────────────────────────────────────────────────
function lireReleve(r: ReleveBrut | null) {
  if (!r || typeof r.usage !== 'number' || !Number.isFinite(r.usage) || typeof r.ts !== 'string') return null;
  const tsMs = Date.parse(r.ts);
  if (!Number.isFinite(tsMs)) return null;
  const mois = (typeof r.mois === 'string' && /^\d{4}-\d{2}$/.test(r.mois)) ? r.mois : moisUtc(tsMs);
  let byDay: Record<string, number> | null = null;
  if (r.by_day && typeof r.by_day === 'object') {
    byDay = {};
    for (const [j, v] of Object.entries(r.by_day as Record<string, unknown>)) {
      const n = Number(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(j) && Number.isFinite(n) && n >= 0) byDay[j] = n;
    }
    if (!Object.keys(byDay).length) byDay = null;
  }
  return { usage: Math.max(0, r.usage), ts: r.ts, tsMs, mois, byDay };
}

export function calculerPrevisionModal(e: EntreesPrevision): PrevisionModal {
  const now = e.maintenant;
  const cycle = moisUtc(now);
  const cDeb = debutMoisUtc(now);
  const cFin = finMoisUtc(now);
  const rel = lireReleve(e.releve);
  const ageMin = rel ? Math.max(0, (now - rel.tsMs) / 60000) : null;
  const etat: EtatReleve = !rel || ageMin == null ? 'absent'
    : ageMin <= SEUIL_A_JOUR_MIN ? 'a_jour'
    : ageMin <= SEUIL_ARRETE_H * 60 ? 'en_retard' : 'arrete';
  // Un releve d'un mois plus RECENT que l'horloge du worker (quelques secondes
  // de decalage a minuit) compte comme du mois courant.
  const duMois = !!rel && rel.mois >= cycle;
  const limite = e.limite.usd;
  const depense = rel && duMois ? rel.usage : null;
  const reste = (limite != null && depense != null) ? limite - depense : null;

  // Rythme (corrige le 2026-10-01, user : « pourquoi on a la limite » : le 1er octobre la fenetre de 7 jours remontait a la fin de SEPTEMBRE
  // (24/09-30/09 : 19,28 $/jour d'essais et de mises en ligne) et annoncait une coupure le 9 octobre alors qu'octobre coutait ~1,5 $/jour).
  //  - 2 jours COMPLETS ou plus dans le mois en cours -> leur moyenne (au plus les 7 derniers) ;
  //  - sinon, au moins 12 h ecoulees dans le mois -> total du mois / temps ecoule ;
  //  - sinon -> pas de rythme (« pas assez de donnees ») plutot qu'un chiffre d'un autre mois.
  let rythme: number | null = null;
  let rythmeSource: PrevisionModal['rythme_source'] = null;
  const rythmeJours: Array<{ jour: string; usd: number }> = [];
  if (rel) {
    const d0 = debutJourUtc(rel.tsMs);
    const moisReleve = moisUtc(rel.tsMs);
    if (rel.byDay) {
      const joursMois: Array<{ jour: string; usd: number }> = [];
      for (let i = 7; i >= 1; i--) {
        const j = jourUtc(d0 - i * JOUR);
        if (j.slice(0, 7) !== moisReleve) continue;        // un jour d'un autre mois ne dit rien du mois en cours
        joursMois.push({ jour: j, usd: r4(rel.byDay[j] ?? 0) });   // Modal n'ecrit aucune ligne pour un jour sans usage
      }
      if (joursMois.length >= 2) {
        rythmeJours.push(...joursMois);
        rythme = joursMois.reduce((t, x) => t + x.usd, 0) / joursMois.length;
        rythmeSource = 'mois_en_cours';
      }
    }
    if (rythme == null) {
      const ecoule = (rel.tsMs - debutMoisUtc(rel.tsMs)) / JOUR;
      if (ecoule >= 0.5) { rythme = rel.usage / ecoule; rythmeSource = 'depuis_debut_mois'; }
    }
  }

  // Prevision : seulement sur un releve A JOUR du mois en cours.
  const prevoir = etat === 'a_jour' && duMois && depense != null;
  const finPrevue = (prevoir && rythme != null && rel)
    ? depense! + rythme * Math.max(0, (cFin - rel.tsMs) / JOUR) : null;
  let coupureMs: number | null = null;
  if (prevoir && rel && limite != null && limite > 0 && reste != null && reste > 0 && rythme != null && rythme > 0) {
    const t = rel.tsMs + (reste / rythme) * JOUR;
    if (t < cFin) coupureMs = t;
  }
  const urgence = coupureMs != null && coupureMs - now < JOUR;

  // Aujourd'hui / hier : jours UTC de la facture.
  const jourNow = jourUtc(now);
  const jourRel = rel ? jourUtc(rel.tsMs) : null;
  const aujourdhui = (rel && rel.byDay && etat === 'a_jour' && jourRel === jourNow) ? (rel.byDay[jourNow] ?? 0) : null;
  const hier = (rel && rel.byDay && jourRel === jourNow) ? (rel.byDay[jourUtc(now - JOUR)] ?? 0) : null;

  // Niveau : UN seul, par ordre de priorite.
  let niveau: NiveauPrevision;
  if (limite === 0) niveau = 'limite_zero';
  else if (etat === 'absent') niveau = 'absent';
  else if (etat === 'arrete') niveau = 'arrete';
  else if (!duMois) niveau = 'debut_de_mois';
  else if (limite != null && depense != null && depense >= limite) niveau = 'atteinte';
  else if (etat === 'en_retard') niveau = 'en_retard';
  else if (limite == null) niveau = 'sans_limite';
  else if (coupureMs != null) niveau = 'coupure_prevue';
  else if (finPrevue != null ? finPrevue > SEUIL_SERRE * limite : (reste != null && reste <= (1 - SEUIL_SERRE) * limite)) niveau = 'serre';
  else niveau = 'ok';

  const couleur: Couleur = ({
    ok: 'vert', serre: 'orange', coupure_prevue: urgence ? 'rouge' : 'orange', atteinte: 'rouge',
    en_retard: 'orange', arrete: 'rouge', absent: 'rouge', debut_de_mois: 'bleu',
    sans_limite: 'gris', limite_zero: 'rouge',
  } as Record<NiveauPrevision, Couleur>)[niveau];
  const icone = ({
    ok: '🟢', serre: '🟠', coupure_prevue: urgence ? '🔴' : '🟠', atteinte: '🔴', en_retard: '🟠',
    arrete: '🔴', absent: '🔴', debut_de_mois: '🆕', sans_limite: '⚪', limite_zero: '⛔',
  } as Record<NiveauPrevision, string>)[niveau];

  // ─── mots ───
  const razDate = dateParis(cFin);
  const moisNom = nomMois(cycle);
  const relMoisNom = rel ? nomMois(rel.mois) : null;
  const au = rel ? `Au relevé de ${heureParis(rel.tsMs)} : ` : '';
  const estim = (e.estimation_mois_usd != null && Number.isFinite(e.estimation_mois_usd))
    ? ` Estimation du site pour ${moisNom} : ${usd(e.estimation_mois_usd)} (souvent 2 à 5 fois trop basse).` : '';
  let titre = '', phrase = '';
  switch (niveau) {
    case 'limite_zero':
      titre = 'Limite à 0 $ : tous les calculs GPU refusés';
      phrase = 'Pour relancer les calculs, change la limite.';
      break;
    case 'absent':
      titre = 'Aucun relevé reçu : pas de prévision';
      phrase = "Le site n'a jamais reçu la facture Modal : l'arrêt automatique ne protège pas." + estim;
      break;
    case 'arrete':
      titre = 'Relevé arrêté : plus de prévision';
      phrase = `Dernier relevé le ${dateParis(rel!.tsMs)} à ${heureParis(rel!.tsMs)}, il y a ${duree(now - rel!.tsMs)}. `
        + "Le site ne voit plus la facture : l'arrêt automatique ne protège plus." + estim;
      break;
    case 'debut_de_mois':
      titre = 'Nouveau mois : compteur remis à zéro';
      phrase = `${majuscule(relMoisNom!)} : ${usd(rel!.usage)} au dernier relevé (${dateParis(rel!.tsMs)} à ${heureParis(rel!.tsMs)}).`
        + (limite != null ? ` La limite de ${usd(limite)} vaut pour ${moisNom}.` : '')
        + ` Premier relevé ${deMois(moisNom)} au prochain passage horaire.`;
      break;
    case 'atteinte':
      titre = 'Limite atteinte : calculs GPU refusés';
      phrase = (etat === 'a_jour' ? '' : au) + `${usd(depense!)} dépensés sur ${usd(limite!)}. `
        + `Calculs GPU refusés jusqu'à la remise à zéro du ${razDate}, ou jusqu'à ce que tu relèves la limite (ici ET sur modal.com).`;
      break;
    case 'en_retard':
      titre = 'Chiffres en retard : pas de prévision';
      phrase = (limite != null ? `À ${heureParis(rel!.tsMs)}, il restait ${usd(reste!)} sur ${usd(limite)}. `
                               : `À ${heureParis(rel!.tsMs)}, ${usd(depense!)} dépensés. `)
        + `Aucun relevé depuis ${duree(now - rel!.tsMs)} : PC éteint ou relevé en panne. `
        + "L'arrêt automatique ne voit pas la dépense récente.";
      break;
    case 'sans_limite':
      titre = 'Aucune limite définie';
      phrase = 'Ni alerte ni arrêt automatique.'
        + (finPrevue != null ? ` Dépense prévue à la remise à zéro du ${razDate} : ${usd(finPrevue)}.` : '');
      break;
    case 'coupure_prevue': {
      const quand = coupureMs! <= now ? 'dans quelques instants' : quandParis(coupureMs!, now);
      titre = coupureMs! <= now ? 'Coupure imminente' : `Coupure prévue ${quand}`;
      phrase = `Au rythme récent (${usd(rythme!)} par jour), les ${usd(reste!)} restants seront épuisés ${quand}, `
        + `${ecart(cFin - coupureMs!)} avant la remise à zéro du ${razDate}. Le site refusera alors les calculs GPU.`;
      break;
    }
    case 'serre':
      titre = 'Ça passe, mais de justesse';
      phrase = (finPrevue != null
        ? `Au rythme récent (${usd(rythme!)} par jour), environ ${usd(finPrevue)} à la remise à zéro du ${razDate} : `
          + `il ne resterait que ${usd(limite! - finPrevue)}.`
        : `Il ne reste que ${usd(reste!)} sur ${usd(limite!)}.`)
        + " Évite les gros essais GPU d'ici là.";
      break;
    default:   // ok
      titre = 'Pas de coupure prévue';
      phrase = rythme == null
        ? `Il reste ${usd(reste!)} sur ${usd(limite!)} (rythme encore inconnu).`
        : rythme < 0.005
          ? `Aucune dépense notable ces 7 derniers jours : il reste ${usd(reste!)} sur ${usd(limite!)}.`
          : `Au rythme récent (${usd(rythme)} par jour), environ ${usd(finPrevue!)} à la remise à zéro du ${razDate} : `
            + `${usd(limite! - finPrevue!)} sous la limite.`;
  }

  // Arret automatique a 100 % : ce que _budgetReelEpuise fait VRAIMENT.
  let arret: PrevisionModal['arret_auto'];
  if (limite === 0) arret = { etat: 'tout_refuse', raison: 'limite à 0 $ : tout est refusé' };
  else if (limite == null) arret = { etat: 'sans_limite', raison: 'aucune limite : rien à comparer' };
  else if (etat === 'absent') arret = { etat: 'inactif', raison: 'aucun relevé reçu' };
  else if (etat === 'arrete') arret = { etat: 'inactif', raison: `relevé arrêté depuis ${duree(now - rel!.tsMs)}` };
  else if (!duMois) arret = { etat: 'inactif', raison: `en attente du premier relevé ${deMois(moisNom)}` };
  else if (depense != null && depense >= limite) arret = { etat: 'bloque', raison: 'limite atteinte : calculs GPU refusés' };
  else if (etat === 'en_retard') arret = { etat: 'aveugle', raison: `relevé en retard : dépense inconnue depuis ${heureParis(rel!.tsMs)}` };
  else arret = { etat: 'actif', raison: 'relevé à jour' };

  // Bandeau fixe : calcule EN DIRECT, il tombe tout seul au 1er du mois.
  let bandeau: PrevisionModal['bandeau'] = null;
  if (niveau === 'atteinte') {
    bandeau = { couleur: 'rouge', texte: `🔴 Modal : limite atteinte (${usd(depense!)} sur ${usd(limite!)}) — calculs GPU refusés.` };
  } else if (niveau === 'coupure_prevue') {
    bandeau = { couleur: urgence ? 'rouge' : 'orange',
      texte: `${icone} Modal : ${titre.charAt(0).toLowerCase()}${titre.slice(1)} — il reste ${usd(reste!)} sur ${usd(limite!)}.` };
  } else if (niveau === 'arrete') {
    bandeau = { couleur: 'orange', texte: `🟠 Relevé de la facture Modal arrêté depuis ${duree(now - rel!.tsMs)} : l'arrêt automatique ne protège plus.` };
  } else if (niveau === 'absent') {
    bandeau = { couleur: 'orange', texte: "🟠 Aucun relevé de la facture Modal : l'arrêt automatique ne protège pas." };
  } else if (niveau === 'limite_zero') {
    bandeau = { couleur: 'rouge', texte: '⛔ Modal : limite à 0 $ — tous les calculs GPU sont refusés.' };
  }

  // Derniere erreur / dernier refus : seulement s'ils sont POSTERIEURS au releve.
  let erreur: PrevisionModal['releve']['erreur'] = null;
  if (e.erreur && typeof e.erreur.ts === 'string' && typeof e.erreur.message === 'string') {
    const t = Date.parse(e.erreur.ts);
    if (Number.isFinite(t) && (!rel || t > rel.tsMs)) erreur = { ts: e.erreur.ts, message: e.erreur.message.slice(0, 300) };
  }
  let refus: string | null = null;
  if (typeof e.refus_ts === 'string') {
    const t = Date.parse(e.refus_ts);
    if (Number.isFinite(t) && (!rel || t > rel.tsMs)) refus = e.refus_ts;
  }

  const rn = (n: number | null) => (n == null || !Number.isFinite(n) ? null : r4(n));
  return {
    version: 1,
    calcule_le: new Date(now).toISOString(),
    cycle,
    cycle_nom: moisNom,
    cycle_debut_ts: new Date(cDeb).toISOString(),
    cycle_fin_ts: new Date(cFin).toISOString(),
    jour_utc_debut_ts: new Date(debutJourUtc(now)).toISOString(),
    releve: {
      etat,
      ts: rel ? rel.ts : null,
      age_min: ageMin == null ? null : Math.round(ageMin),
      mois: rel ? rel.mois : null,
      mois_nom: relMoisNom,
      du_mois_courant: duMois,
      usage_usd: rel ? r4(rel.usage) : null,
      erreur,
      refus_ts: refus,
    },
    limite: e.limite,
    niveau, couleur, icone, urgence, titre, phrase,
    depense_usd: rn(depense),
    reste_usd: rn(reste),
    rythme_usd_jour: rn(rythme),
    rythme_source: rythmeSource,
    rythme_jours: rythmeJours,
    fin_prevue_usd: rn(finPrevue),
    marge_usd: (limite != null && finPrevue != null) ? r4(limite - finPrevue) : null,
    coupure_ts: coupureMs == null ? null : new Date(coupureMs).toISOString(),
    aujourdhui_usd: rn(aujourdhui),
    hier_usd: rn(hier),
    estimation_mois_usd: rn(e.estimation_mois_usd ?? null),
    arret_auto: arret,
    bandeau,
  };
}

/** L'e-mail d'alerte, tire du MEME calcul. null = rien a envoyer.
 *  gravite : 1 coupure prevue, 2 coupure dans moins de 24 h, 3 limite atteinte. */
export function alerteEmailModal(p: PrevisionModal): { gravite: number; sujet: string; texte: string } | null {
  let gravite = 0;
  if (p.niveau === 'atteinte') gravite = 3;
  else if (p.niveau === 'coupure_prevue') gravite = p.urgence ? 2 : 1;
  if (!gravite) return null;
  const sujet = p.niveau === 'atteinte'
    ? '🚨 MyFabmesh — Modal : limite atteinte'
    : `⚠️ MyFabmesh — Modal : ${p.titre.charAt(0).toLowerCase()}${p.titre.slice(1)}`;
  const lignes = [
    `${p.icone} ${p.titre}`,
    '',
    p.phrase,
    '',
    `Dépensé en ${p.cycle_nom} : ${p.depense_usd == null ? '—' : usd(p.depense_usd)}`
      + (p.limite.usd != null ? ` sur ${usd(p.limite.usd)}` : ''),
    `Rythme récent : ${p.rythme_usd_jour == null ? 'inconnu' : usd(p.rythme_usd_jour) + ' par jour'}`,
    `Remise à zéro : ${dateParis(Date.parse(p.cycle_fin_ts))} à ${heureParis(Date.parse(p.cycle_fin_ts))} (heure de Paris)`,
    '',
    'Que faire : relever la limite sur modal.com (« Usage limit ») puis dans l\'admin',
    '(onglet Revenus › Coût GPU › Changer la limite), ou ralentir les essais.',
    '',
    'Un seul e-mail par niveau et par mois ; renvoyé si la situation empire.',
  ];
  return { gravite, sujet, texte: lignes.join('\n') };
}
