# -*- coding: utf-8 -*-
"""Cloisonnement REEL de la RAM et de la VRAM des generations locales (2026-09-30).

POURQUOI. Les marqueurs blancs de Parametres > Materiel (RAM, VRAM) n'etaient
que des avertissements : le chien de garde de main.js se contentait de
journaliser, et chaque script plafonnait la VRAM a une FRACTION DE LA CARTE
ENTIERE (FABMESH_VRAM_FRACTION), sans tenir compte de ce qu'Unreal ou le
navigateur y occupaient deja. Incident du 2026-09-30 chez l'exploitant
(RTX 5080 16 Go, 32 Go de RAM, marqueur RAM a 27 Go, Unreal ouvert) : 14,2 Go
utilises avant une generation 3D, puis 32 Go pendant le chargement du pipeline
(« RAM 32116 MB > 26263 MB ... NOT suspending ») — fichier d'echange, PC au bord
du gel.

CE QUE FAIT CE MODULE. Il est importe EN TETE de chaque script GPU lourd, avant
torch (le dossier du script n'est PAS sur sys.path dans le Python embarque, a
cause du fichier ._pth : chaque script insere le sien avant l'import).

1. RAM : plafond REEL par un « Job Object » Windows qui limite la memoire
   ENGAGEE (commit) du processus et de ses enfants (JOB_OBJECT_LIMIT_JOB_MEMORY).
   Budget = limite RAM de l'utilisateur - RAM occupee par tout le reste.
   Au-dela, Windows REFUSE l'allocation : Python leve MemoryError, PyTorch
   « DefaultCPUAllocator: not enough memory » — l'erreur est propre et rien
   n'est pousse dans le fichier d'echange. Le plafond suit le budget toutes les
   PERIODE_SUIVI_S secondes (un logiciel qui se libere rend de la place, un
   qui grossit en reprend), sans jamais descendre sous ce que le processus a
   deja engage.
   Pourquoi PAS l'ancien plafond de working set (SetProcessWorkingSetSizeEx,
   main.js) : il forcait Windows a sortir les pages CHAUDES vers le disque
   (104 s par iteration au lieu de 1,4 s, AGENT_LOG 2026-06-14). Une limite
   d'ENGAGEMENT ne pagine rien : elle refuse.
   Engage != resident : MESURE du 2026-09-30 (Python 3.11, torch 2.7.1+cu128,
   sans initialiser CUDA) : `import torch` engage 1 509 Mo pour 398 Mo
   residents ; `import numpy` en engage ~750 pour ~100 residents. Ces
   reservations ne deviennent jamais de la RAM. L'engagement non resident
   constate a la fin de l'initialisation (« decalage ») est donc ajoute au
   budget, sinon il amputerait le budget de ~1-2 Go pour rien.
2. VRAM : torch.cuda.set_per_process_memory_fraction((budget - contexte CUDA)
   / total), budget = limite VRAM de l'utilisateur - VRAM deja occupee par les
   AUTRES (nvidia-smi AVANT l'initialisation CUDA de ce processus) ; le
   contexte CUDA de ce processus est MESURE (nvidia-smi avant / apres) et
   deduit. L'ancienne fraction de la carte entiere laissait PyTorch demander
   plus que la VRAM libre : le pilote bascule alors dans la memoire partagee
   du systeme — c'est-a-dire dans la RAM.
3. Manque de memoire -> une phrase claire (anglais ; l'interface la traduit)
   et un marqueur FABMESH_MEMOIRE_INSUFFISANTE lu par main.js, au lieu d'une
   pile Python, d'un plantage ou d'un gel.
4. Mesures (mesurer) : engagement et working set du processus (et leurs pics),
   RAM du systeme, plafond courant, VRAM (PyTorch + nvidia-smi). A la fin, une
   ligne JSON dans FABMESH_MEMOIRE_JOURNAL (pic reellement occupe) : main.js
   s'en sert pour estimer le besoin d'un travail avant de le lancer.

CE QUI N'EST PAS PLAFONNE (et pourquoi) :
- la VRAM allouee HORS de l'allocateur de PyTorch (contexte CUDA, extensions
  qui appellent cudaMalloc elles-memes) : set_per_process_memory_fraction ne
  regle que l'allocateur de PyTorch. Le contexte est mesure et deduit ;
- la RAM des fichiers projetes en memoire (poids lus par safetensors) et du
  cache disque : elle n'est pas « engagee » et Windows la reprend sans rien
  ecrire dans le fichier d'echange ;
- du code natif qui ne verifie pas le retour de malloc peut mourir au lieu de
  lever MemoryError : le processus s'arrete sans geler le PC ; main.js
  rapproche alors la sortie du dernier plafond annonce ;
- hors Windows : seule la VRAM est plafonnee.

Premiere carte seulement (nvidia-smi ligne 1 = device 0 de PyTorch sur une
machine a une carte, le cas du produit).
Desactivation d'urgence : FABMESH_CLOISONNEMENT=0.
"""
import atexit
import json
import os
import re
import subprocess
import sys
import threading
import time

MO = 1024 * 1024

# Marqueurs lus par main.js (lignes ASCII sur stdout).
MARQUEUR_PLAFOND = 'FABMESH_MEM_PLAFOND'
MARQUEUR_ETAPE = 'FABMESH_MEM_ETAPE'
MARQUEUR_ALERTE = 'FABMESH_MEM_ALERTE'
MARQUEUR_MANQUE = 'FABMESH_MEMOIRE_INSUFFISANTE'

# Engagement accorde AU-DELA de l'existant pendant l'initialisation (import de
# torch, contexte CUDA), tant que le « decalage » n'est pas mesure. VALEUR DE
# CONCEPTION, pas une mesure : `import torch` seul engage deja 1,5 Go (mesure
# ci-dessus) et le contexte CUDA n'a pas pu etre mesure sans GPU. Elle ne
# joue que si le budget est plus petit ; chaque lancement journalise
# l'engagement reel apres l'initialisation.
MARGE_DEMARRAGE_MO = 4096
# Au-dessus de ce qui est deja engage : de quoi lever et formuler l'erreur.
MARGE_MIN_MO = 256
# Periode du suivi du budget (plafond RAM dynamique).
PERIODE_SUIVI_S = 2.0
# Un nouveau plafond n'est pose que s'il differe d'au moins ceci (evite de
# rappeler Windows toutes les 2 s pour quelques Mo).
HYSTERESIS_MO = 64
# Alerte (une fois) quand l'engagement atteint cette part du plafond.
SEUIL_ALERTE = 0.9

# Phrases montrees a l'utilisateur. ANGLAIS (langue source de l'interface),
# ASCII (la sortie d'un sous-processus Windows n'est pas en UTF-8). Le
# renderer les reconnait (humanizeErrorMessage) et les traduit ; garder le
# debut « This generation needs about X GB of RAM|VRAM but only Y GB are
# available under your limit » tel quel.
PHRASE_RAM = ('This generation needs about {x} GB of RAM but only {y} GB are available '
              'under your limit. Close other apps or raise the RAM limit in Settings.')
PHRASE_VRAM = ('This generation needs about {x} GB of VRAM but only {y} GB are available '
               'under your limit. Close other apps using the graphics card or raise the '
               'VRAM limit in Settings.')


# ---------------------------------------------------------------------------
# Calculs purs (testes par build/test_cloisonnement_memoire.py ; memes
# definitions que src/main/budget_memoire.js)
# ---------------------------------------------------------------------------
def limite_ram_mo(env, total_mo):
    """Limite RAM de l'utilisateur (FABMESH_RAM_LIMIT_MB, posee par main.js depuis
    le marqueur), bornee a la RAM physique. None si aucune limite n'est definie."""
    try:
        v = float(env.get('FABMESH_RAM_LIMIT_MB') or 0)
    except (TypeError, ValueError):
        v = 0.0
    if v <= 0:
        return None
    return min(float(total_mo), v) if total_mo else v


def limite_vram_mo(env, total_mo):
    """Limite VRAM de l'utilisateur : FABMESH_VRAM_FRACTION x total (0,95 par
    defaut, comme les scripts avant ce module)."""
    try:
        f = float(env.get('FABMESH_VRAM_FRACTION') or 0.95)
    except (TypeError, ValueError):
        f = 0.95
    if not 0 < f <= 1:
        f = 0.95
    return f * float(total_mo)


def budget_ram_mo(limite_mo, utilisee_systeme_mo, propre_ws_mo):
    """RAM que CE processus peut occuper : limite - ce qu'occupe tout le reste.
    Le reste = RAM utilisee du systeme moins la part residente de ce processus."""
    autres = max(0.0, float(utilisee_systeme_mo) - float(propre_ws_mo))
    return max(0.0, float(limite_mo) - autres)


def plafond_engagement_mo(budget_mo, decalage_mo, engage_mo, marge_mo=MARGE_MIN_MO):
    """Plafond d'ENGAGEMENT a poser : le budget (resident) plus l'engagement non
    resident mesure a l'initialisation ; jamais sous l'engagement actuel + marge
    (sinon la moindre allocation, meme celle du message d'erreur, echouerait)."""
    return max(float(budget_mo) + max(0.0, float(decalage_mo)), float(engage_mo) + float(marge_mo))


def budget_vram_mo(limite_mo, utilisee_autres_mo):
    """VRAM que CE processus peut occuper : limite - VRAM deja occupee par les autres."""
    return max(0.0, float(limite_mo) - float(utilisee_autres_mo))


def fraction_vram(budget_mo, contexte_mo, total_mo):
    """Fraction a passer a set_per_process_memory_fraction : le budget moins le
    contexte CUDA (hors allocateur PyTorch), rapporte au total de la carte."""
    if not total_mo or total_mo <= 0:
        return None
    utile = float(budget_mo) - min(max(0.0, float(contexte_mo)), float(budget_mo))
    return min(1.0, max(0.0, utile / float(total_mo)))


def en_go(mo):
    """Mo -> Go arrondi au dixieme SUPERIEUR (on n'annonce jamais moins que le besoin)."""
    return max(0.0, int(float(mo) / 1024.0 * 10.0 + 0.999) / 10.0)


def en_go_bas(mo):
    """Mo -> Go arrondi au dixieme INFERIEUR (on n'annonce jamais plus que le disponible)."""
    return max(0.0, int(float(mo) / 1024.0 * 10.0) / 10.0)


def phrase_manque(type_, besoin_go, dispo_go):
    modele = PHRASE_VRAM if type_ == 'vram' else PHRASE_RAM
    return modele.replace('{x}', f'{besoin_go:.1f}').replace('{y}', f'{dispo_go:.1f}')


_RE_OCTETS = re.compile(r'you tried to allocate (\d+) bytes')
_RE_UNITE = re.compile(r'(?:Tried to allocate|Unable to allocate) ([\d.]+) ?([KMGT]i?B)')
_UNITES = {'K': 1.0 / 1024, 'M': 1.0, 'G': 1024.0, 'T': 1024.0 * 1024}
_RE_VRAM = re.compile(r'CUDA out of memory|CUDA error: out of memory|CUBLAS_STATUS_ALLOC_FAILED'
                      r'|cudaErrorMemoryAllocation|out of memory on device', re.I)
_RE_RAM = re.compile(r'DefaultCPUAllocator: not enough memory|std::bad_alloc|Unable to allocate'
                     r'|not enough memory|Cannot allocate memory|paging file is too small', re.I)


def demande_mo(texte):
    """Taille de l'allocation refusee, lue dans le message d'erreur (Mo) ; 0 si absente."""
    m = _RE_OCTETS.search(texte or '')
    if m:
        return int(m.group(1)) / MO
    m = _RE_UNITE.search(texte or '')
    if m:
        try:
            return float(m.group(1)) * _UNITES.get(m.group(2)[0].upper(), 1.0)
        except ValueError:
            return 0.0
    return 0.0


def type_manque(exc):
    """'ram', 'vram' ou None selon l'exception."""
    if exc is None:
        return None
    texte = f'{type(exc).__name__}: {exc}'
    if type(exc).__name__ == 'OutOfMemoryError' or _RE_VRAM.search(texte):
        return 'vram'
    if isinstance(exc, MemoryError) or _RE_RAM.search(texte):
        return 'ram'
    return None


# ---------------------------------------------------------------------------
# Windows : memoire du systeme, du processus, Job Object
# ---------------------------------------------------------------------------
_WIN = sys.platform == 'win32'
if _WIN:
    import ctypes
    from ctypes import wintypes

    class _MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [('dwLength', wintypes.DWORD), ('dwMemoryLoad', wintypes.DWORD),
                    ('ullTotalPhys', ctypes.c_ulonglong), ('ullAvailPhys', ctypes.c_ulonglong),
                    ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                    ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong),
                    ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]

    class _PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD),
                    ('PeakWorkingSetSize', ctypes.c_size_t), ('WorkingSetSize', ctypes.c_size_t),
                    ('QuotaPeakPagedPoolUsage', ctypes.c_size_t), ('QuotaPagedPoolUsage', ctypes.c_size_t),
                    ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t), ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
                    ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t),
                    ('PrivateUsage', ctypes.c_size_t)]

    class _JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                    ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                    ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                    ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD),
                    ('SchedulingClass', wintypes.DWORD)]

    class _IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in (
            'ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
            'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]

    class _JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [('BasicLimitInformation', _JOBOBJECT_BASIC_LIMIT_INFORMATION),
                    ('IoInfo', _IO_COUNTERS), ('ProcessMemoryLimit', ctypes.c_size_t),
                    ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t),
                    ('PeakJobMemoryUsed', ctypes.c_size_t)]

    _JobObjectExtendedLimitInformation = 9
    _JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
    _JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x00000800   # un enfant lance AVEC CREATE_BREAKAWAY_FROM_JOB n'echoue pas

    _k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    _k32.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(_MEMORYSTATUSEX)]
    _k32.GlobalMemoryStatusEx.restype = wintypes.BOOL
    _k32.GetCurrentProcess.argtypes = []
    _k32.GetCurrentProcess.restype = wintypes.HANDLE       # pseudo-handle (HANDLE)-1 : pas de troncature 32 bits
    _k32.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
    _k32.K32GetProcessMemoryInfo.restype = wintypes.BOOL
    _k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    _k32.CreateJobObjectW.restype = wintypes.HANDLE
    _k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    _k32.SetInformationJobObject.restype = wintypes.BOOL
    _k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    _k32.AssignProcessToJobObject.restype = wintypes.BOOL


def memoire_systeme():
    """RAM du systeme (Mo) : total, disponible (libre + cache reprenable), utilisee."""
    if not _WIN:
        return None
    m = _MEMORYSTATUSEX()
    m.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
    if not _k32.GlobalMemoryStatusEx(ctypes.byref(m)):
        return None
    total, dispo = m.ullTotalPhys / MO, m.ullAvailPhys / MO
    return {'total_mo': total, 'dispo_mo': dispo, 'utilisee_mo': total - dispo}


def memoire_processus():
    """Memoire de CE processus (Mo) : engagement (PrivateUsage), working set, et
    les pics tenus par Windows. ATTENTION : pic_engage_os_mo compte aussi les
    allocations REFUSEES par le plafond (mesure du 2026-09-30 : 2 810 Mo de pic
    pour 758 engages apres un refus de 2 Go) ; le pic fiable est celui du
    working set, ou celui echantillonne par ce module."""
    if not _WIN:
        return None
    p = _PROCESS_MEMORY_COUNTERS_EX()
    p.cb = ctypes.sizeof(_PROCESS_MEMORY_COUNTERS_EX)
    if not _k32.K32GetProcessMemoryInfo(_k32.GetCurrentProcess(), ctypes.byref(p), p.cb):
        return None
    return {'engage_mo': p.PrivateUsage / MO, 'pic_engage_os_mo': p.PeakPagefileUsage / MO,
            'ws_mo': p.WorkingSetSize / MO, 'pic_ws_mo': p.PeakWorkingSetSize / MO}


def vram_nvidia_smi(timeout=5.0):
    """VRAM de la premiere carte (Mo) d'apres nvidia-smi : total et utilisee
    (tous processus). None sans carte NVIDIA."""
    try:
        kw = {'creationflags': 0x08000000} if _WIN else {}   # CREATE_NO_WINDOW : pas de console qui clignote
        r = subprocess.run(['nvidia-smi', '--query-gpu=memory.total,memory.used',
                            '--format=csv,noheader,nounits'],
                           capture_output=True, text=True, timeout=timeout, **kw)
        if r.returncode != 0 or not r.stdout.strip():
            return None
        total, utilisee = [float(x) for x in r.stdout.strip().splitlines()[0].split(',')[:2]]
        return {'total_mo': total, 'utilisee_mo': utilisee}
    except Exception:
        return None


class _Job:
    """Job Object anonyme dont ce processus (et ses enfants) font partie.
    Imbrication : le processus est souvent deja dans un job (celui de libuv
    quand Electron le lance) ; Windows 8+ accepte les jobs imbriques — verifie
    le 2026-09-30 depuis Node (execFile) et depuis un terminal."""

    def __init__(self):
        h = _k32.CreateJobObjectW(None, None)
        if not h:
            raise OSError(ctypes.get_last_error(), 'CreateJobObjectW')
        self.h = h
        self.plafond_mo = None

    def fixer(self, plafond_mo):
        info = _JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = _JOB_OBJECT_LIMIT_JOB_MEMORY | _JOB_OBJECT_LIMIT_BREAKAWAY_OK
        info.JobMemoryLimit = int(plafond_mo * MO)
        if not _k32.SetInformationJobObject(self.h, _JobObjectExtendedLimitInformation,
                                            ctypes.byref(info), ctypes.sizeof(info)):
            raise OSError(ctypes.get_last_error(), 'SetInformationJobObject')
        self.plafond_mo = float(plafond_mo)

    def rattacher(self):
        if not _k32.AssignProcessToJobObject(self.h, _k32.GetCurrentProcess()):
            raise OSError(ctypes.get_last_error(), 'AssignProcessToJobObject')


# ---------------------------------------------------------------------------
# Etat du processus
# ---------------------------------------------------------------------------
def _log_defaut(m):
    print(f'[memoire] {m}', flush=True)


_log = _log_defaut
_verrou = threading.RLock()
_etat = {'actif': False}


def etat():
    """Copie de l'etat courant (lecture seule, pour les journaux et les tests)."""
    with _verrou:
        return {k: v for k, v in _etat.items() if k != 'job'}


def _env_float(nom):
    try:
        v = float(os.environ.get(nom) or 'nan')
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def appliquer(nom, cle=None, log=None, budget_ram_fixe_mo=None):
    """A appeler EN TETE du script, avant `import torch`.

    nom : libelle dans les journaux ; cle : identifiant du type de travail dans
    le journal des pics (ex. 'trellis2_1024_cascade'). budget_ram_fixe_mo :
    budget impose (tests) — le plafond ne suit alors plus la RAM du systeme."""
    global _log
    with _verrou:
        if _etat.get('actif'):
            return etat()
        if log:
            _log = log
        _etat.clear()
        _etat.update(actif=True, nom=nom, cle=cle or nom, debut=time.time(), phase='demarrage',
                     issue=None, termine=False, job=None, ram_actif=False, alerte=False,
                     pic_engage_mo=0.0, decalage_mo=0.0, budget_fixe_mo=budget_ram_fixe_mo,
                     vram_budget_mo=None, vram_autres_mo=None, vram_total_mo=None,
                     vram_contexte_mo=None, vram_fraction=None, besoin_mo=None)
        _installer_crochet()
        if os.environ.get('FABMESH_CLOISONNEMENT') == '0':
            _log('cloisonnement memoire DESACTIVE (FABMESH_CLOISONNEMENT=0) : aucun plafond')
            return etat()

        # VRAM occupee par les AUTRES : mesuree AVANT que ce processus n'initialise CUDA.
        v = vram_nvidia_smi()
        if v:
            lim_v = limite_vram_mo(os.environ, v['total_mo'])
            _etat.update(vram_total_mo=v['total_mo'], vram_autres_mo=v['utilisee_mo'],
                         vram_limite_mo=lim_v, vram_budget_mo=budget_vram_mo(lim_v, v['utilisee_mo']))
        else:
            _etat['vram_budget_mo'] = _env_float('FABMESH_VRAM_BUDGET_MB')   # calcule par main.js au lancement

        sysm, proc = memoire_systeme(), memoire_processus()
        if not (sysm and proc):
            _log('plafond RAM indisponible hors Windows : seule la VRAM sera plafonnee')
        else:
            lim = limite_ram_mo(os.environ, sysm['total_mo'])
            if budget_ram_fixe_mo is not None:
                budget = float(budget_ram_fixe_mo)
            elif lim is None:
                budget = None
            else:
                budget = budget_ram_mo(lim, sysm['utilisee_mo'], proc['ws_mo'])
            _etat.update(ram_limite_mo=lim, ram_total_mo=sysm['total_mo'],
                         ram_budget_lancement_mo=_env_float('FABMESH_RAM_BUDGET_MB'))
            if budget is None:
                _log('aucune limite RAM definie (FABMESH_RAM_LIMIT_MB absent) : pas de plafond RAM')
            else:
                # Allocation d'initialisation FIXE (au-dessus de l'engagement de depart) :
                # elle ne suit pas la croissance du processus.
                _etat['engage_depart_mo'] = proc['engage_mo']
                plafond = max(budget, proc['engage_mo'] + MARGE_DEMARRAGE_MO)
                try:
                    job = _Job()
                    job.fixer(plafond)
                    job.rattacher()
                    _etat.update(job=job, ram_actif=True, ram_budget_mo=budget, ram_plafond_mo=plafond)
                except OSError as e:
                    _log(f'plafond RAM impossible ({e}) : avertissement seul, comme avant')
        _annoncer('demarrage')
        if _etat.get('ram_actif') and budget_ram_fixe_mo is None:
            threading.Thread(target=_suivre, name='cloisonnement-memoire', daemon=True).start()
        return etat()


def plafonner_vram(torch, device=0):
    """A appeler juste apres `import torch` : remplace l'ancien
    torch.cuda.set_per_process_memory_fraction(FABMESH_VRAM_FRACTION).
    Initialise CUDA (pour mesurer son contexte), pose la fraction tiree du
    budget, puis resserre le plafond RAM (fin de l'initialisation)."""
    if not _etat.get('actif'):
        appliquer(os.path.basename(sys.argv[0] or 'script'))
    try:
        if os.environ.get('FABMESH_CLOISONNEMENT') == '0' and torch.cuda.is_available():
            # desactive : exactement l'ancienne regle (fraction de la carte entiere)
            total_mo = torch.cuda.get_device_properties(device).total_memory / MO
            torch.cuda.set_per_process_memory_fraction(limite_vram_mo(os.environ, total_mo) / total_mo, device)
        elif torch.cuda.is_available():
            torch.empty(1, device=f'cuda:{device}')          # cree le contexte CUDA
            total_mo = torch.cuda.get_device_properties(device).total_memory / MO
            contexte = 0.0
            v = vram_nvidia_smi()
            if v and _etat.get('vram_autres_mo') is not None:
                contexte = max(0.0, v['utilisee_mo'] - _etat['vram_autres_mo']
                               - torch.cuda.memory_reserved(device) / MO)
            budget = _etat.get('vram_budget_mo')
            if budget is None:
                budget = limite_vram_mo(os.environ, total_mo)      # autres inconnus : ancienne regle
                _log('VRAM des autres logiciels inconnue (nvidia-smi) : plafond sur la carte entiere')
            frac = fraction_vram(budget, contexte, total_mo)
            torch.cuda.set_per_process_memory_fraction(frac, device)
            _etat.update(vram_total_mo=_etat.get('vram_total_mo') or total_mo, vram_budget_mo=budget,
                         vram_contexte_mo=contexte, vram_fraction=frac)
            _log(f'plafond VRAM : {frac * total_mo:.0f} Mo pour PyTorch (budget {budget:.0f} Mo = '
                 f'limite {_etat.get("vram_limite_mo") or limite_vram_mo(os.environ, total_mo):.0f} - '
                 f'autres {_etat.get("vram_autres_mo") or 0:.0f} ; contexte CUDA mesure {contexte:.0f} Mo)')
    except Exception as e:
        _log(f'plafond VRAM impossible : {type(e).__name__}: {e}')
    regime()
    return etat()


def regime():
    """Fin de l'initialisation : mesure l'engagement non resident (« decalage ») et
    ramene le plafond RAM au budget. Les scripts sans CUDA l'appellent eux-memes."""
    with _verrou:
        if not _etat.get('actif') or _etat.get('phase') == 'regime':
            return
        proc = memoire_processus()
        if proc:
            # Engagement non resident, borne a ce que l'initialisation a ajoute : un
            # processus deja « taille » par Windows a ce moment ne gonfle pas le budget.
            croissance = proc['engage_mo'] - (_etat.get('engage_depart_mo') or 0.0)
            _etat['decalage_mo'] = max(0.0, min(proc['engage_mo'] - proc['ws_mo'], croissance))
        _etat['phase'] = 'regime'
        _ajuster(force=True)
        _annoncer('regime')


def _ajuster(force=False):
    """Recalcule le budget RAM et deplace le plafond du Job Object."""
    with _verrou:
        job = _etat.get('job')
        proc = memoire_processus()
        if proc:
            _etat['pic_engage_mo'] = max(_etat.get('pic_engage_mo') or 0.0, proc['engage_mo'])
        if not job or not proc:
            return
        if _etat.get('budget_fixe_mo') is not None:
            budget = float(_etat['budget_fixe_mo'])
        else:
            sysm = memoire_systeme()
            if not sysm or _etat.get('ram_limite_mo') is None:
                return
            budget = budget_ram_mo(_etat['ram_limite_mo'], sysm['utilisee_mo'], proc['ws_mo'])
        if _etat.get('phase') == 'regime':
            plafond = plafond_engagement_mo(budget, _etat.get('decalage_mo') or 0.0, proc['engage_mo'])
        else:
            plafond = max(budget, (_etat.get('engage_depart_mo') or 0.0) + MARGE_DEMARRAGE_MO)
        if force or job.plafond_mo is None or abs(plafond - job.plafond_mo) >= HYSTERESIS_MO:
            try:
                job.fixer(plafond)
            except OSError as e:
                _log(f'plafond RAM non deplace : {e}')
                return
        _etat.update(ram_budget_mo=budget, ram_plafond_mo=job.plafond_mo)
        if proc['engage_mo'] >= SEUIL_ALERTE * job.plafond_mo:
            if not _etat.get('alerte'):
                _etat['alerte'] = True
                print(f'{MARQUEUR_ALERTE} ' + json.dumps({
                    'engage_mo': round(proc['engage_mo']), 'plafond_mo': round(job.plafond_mo),
                    'budget_mo': round(budget)}), flush=True)
        elif proc['engage_mo'] < 0.8 * job.plafond_mo:
            _etat['alerte'] = False


def _suivre():
    while True:
        time.sleep(PERIODE_SUIVI_S)
        try:
            _ajuster()
        except Exception:
            pass


def _annoncer(moment):
    d = {'moment': moment, 'nom': _etat.get('nom'), 'cle': _etat.get('cle'),
         'ram_actif': bool(_etat.get('ram_actif'))}
    for k in ('ram_limite_mo', 'ram_budget_mo', 'ram_plafond_mo', 'ram_budget_lancement_mo',
              'decalage_mo', 'vram_limite_mo', 'vram_autres_mo', 'vram_budget_mo',
              'vram_contexte_mo'):
        if _etat.get(k) is not None:
            d[k] = round(_etat[k])
    proc = memoire_processus()
    if proc:
        d['engage_mo'] = round(proc['engage_mo'])
        d['ws_mo'] = round(proc['ws_mo'])
    print(f'{MARQUEUR_PLAFOND} ' + json.dumps(d), flush=True)
    if _etat.get('ram_actif'):
        origine = ('budget impose' if _etat.get('budget_fixe_mo') is not None
                   else f'limite {_etat.get("ram_limite_mo") or 0:.0f} - RAM des autres')
        _log(f'plafond RAM ({moment}) : {_etat["ram_plafond_mo"]:.0f} Mo engages au plus '
             f'(budget {_etat["ram_budget_mo"]:.0f} Mo = {origine} ; '
             f'engage {d.get("engage_mo", 0)} Mo dont {d.get("ws_mo", 0)} residents)')


def mesurer(etape):
    """Une ligne de mesure par etape : engagement et working set du processus (et
    leurs pics), RAM du systeme, plafond, VRAM PyTorch (sans initialiser CUDA)
    et VRAM de la carte (nvidia-smi)."""
    try:
        with _verrou:
            proc = memoire_processus()
            if proc:
                _etat['pic_engage_mo'] = max(_etat.get('pic_engage_mo') or 0.0, proc['engage_mo'])
        sysm = memoire_systeme()
        v = vram_nvidia_smi()
        parts = [f'etape={etape}']
        if proc:
            parts.append(f'engage={proc["engage_mo"]:.0f}Mo pic_engage={_etat.get("pic_engage_mo", 0):.0f}Mo '
                         f'ws={proc["ws_mo"]:.0f}Mo pic_ws={proc["pic_ws_mo"]:.0f}Mo')
        if sysm:
            parts.append(f'ram_sys={sysm["utilisee_mo"]:.0f}/{sysm["total_mo"]:.0f}Mo')
        if _etat.get('ram_actif'):
            parts.append(f'plafond={_etat.get("ram_plafond_mo", 0):.0f}Mo budget={_etat.get("ram_budget_mo", 0):.0f}Mo')
        t = sys.modules.get('torch')
        try:
            if t is not None and t.cuda.is_available() and t.cuda.is_initialized():
                parts.append(f'vram_torch={t.cuda.memory_allocated() / MO:.0f}Mo '
                             f'pic_vram_torch={t.cuda.max_memory_allocated() / MO:.0f}Mo '
                             f'pic_vram_reserve={t.cuda.max_memory_reserved() / MO:.0f}Mo')
                _etat['pic_vram_reserve_mo'] = t.cuda.max_memory_reserved() / MO
        except Exception:
            pass
        if v:
            parts.append(f'vram_carte={v["utilisee_mo"]:.0f}/{v["total_mo"]:.0f}Mo')
        print(f'{MARQUEUR_ETAPE} ' + ' '.join(parts), flush=True)
    except Exception as e:
        _log(f'mesure {etape} impossible : {type(e).__name__}: {e}')


# ---------------------------------------------------------------------------
# Manque de memoire -> message clair
# ---------------------------------------------------------------------------
def diagnostiquer(exc):
    """{'type', 'besoin_mo', 'dispo_mo', 'phrase'} pour une erreur de memoire, sinon None."""
    type_ = type_manque(exc)
    if type_ is None:
        return None
    demande = demande_mo(str(exc))
    if type_ == 'vram':
        t = sys.modules.get('torch')
        occupe = 0.0
        try:
            if t is not None and t.cuda.is_initialized():
                occupe = t.cuda.max_memory_reserved() / MO
        except Exception:
            pass
        occupe += _etat.get('vram_contexte_mo') or 0.0
        dispo = _etat.get('vram_budget_mo')
        if dispo is None:
            dispo = occupe
    else:
        proc = memoire_processus() or {}
        decalage = _etat.get('decalage_mo') or 0.0
        occupe = max(_etat.get('pic_engage_mo') or 0.0, proc.get('engage_mo', 0.0)) - decalage
        if not demande and proc:
            # MemoryError sans taille (bytearray, objets Python) : le pic d'engagement
            # tenu par Windows COMPTE la demande refusee (mesure du 2026-09-30).
            demande = max(0.0, proc.get('pic_engage_os_mo', 0.0) - decalage - occupe)
        dispo = _etat.get('ram_budget_mo')
        if dispo is None:
            dispo = max(0.0, occupe)
    besoin = max(occupe + demande, dispo + 0.1 * 1024)   # jamais « besoin de 1,0 Go, 1,0 Go disponibles »
    return {'type': type_, 'besoin_mo': besoin, 'dispo_mo': dispo,
            'phrase': phrase_manque(type_, en_go(besoin), en_go_bas(dispo))}


def _secours():
    """Le travail echoue de toute facon : quelques Mo au-dessus de l'engagement
    actuel pour que la pile et le message puissent s'ecrire (jamais a la baisse)."""
    try:
        job, proc = _etat.get('job'), memoire_processus()
        if job and proc and (job.plafond_mo or 0) < proc['engage_mo'] + 128:
            job.fixer(proc['engage_mo'] + 128)
    except Exception:
        pass


def signaler(info):
    """Ecrit le marqueur (lu par main.js) puis la phrase, sur stdout ET stderr."""
    with _verrou:
        _etat['issue'] = 'memoire'
        _etat['refus'] = True
        _etat['besoin_mo'] = info['besoin_mo']
    marque = f'{MARQUEUR_MANQUE} ' + json.dumps({
        'type': info['type'], 'besoin_go': en_go(info['besoin_mo']),
        'dispo_go': en_go_bas(info['dispo_mo']), 'nom': _etat.get('nom')})
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.write(marque + '\n' + info['phrase'] + '\n')
            flux.flush()
        except Exception:
            pass


def signaler_si_memoire(exc):
    """A appeler dans un `except` qui avale l'erreur : True si c'etait un manque de memoire."""
    try:
        if type_manque(exc):
            _secours()
        info = diagnostiquer(exc)
    except Exception:
        return False
    if info:
        signaler(info)
        return True
    return False


def texte_erreur(exc):
    """Texte d'erreur a renvoyer a l'interface : la phrase claire pour un manque
    de memoire, sinon le message d'origine (serveur SDXL)."""
    try:
        if type_manque(exc):
            _secours()
        info = diagnostiquer(exc)
        if info:
            with _verrou:
                _etat['refus'] = True          # le serveur continue : pas d'issue « memoire » definitive
                _etat['besoin_mo'] = max(_etat.get('besoin_mo') or 0.0, info['besoin_mo'])
            return info['phrase']
    except Exception:
        pass
    return str(exc)


_precedent = None


def _crochet(type_, valeur, tb):
    try:
        if type_manque(valeur):
            _secours()
        (_precedent or sys.__excepthook__)(type_, valeur, tb)
    finally:
        signaler_si_memoire(valeur)


def _installer_crochet():
    global _precedent
    if sys.excepthook is not _crochet:
        _precedent = sys.excepthook
        sys.excepthook = _crochet
    atexit.register(_a_la_sortie)


# ---------------------------------------------------------------------------
# Fin : journal des pics
# ---------------------------------------------------------------------------
def terminer(issue='ok'):
    """Derniere mesure + une ligne dans FABMESH_MEMOIRE_JOURNAL. A appeler en fin
    de script (os._exit saute atexit) ; idempotent."""
    with _verrou:
        if not _etat.get('actif') or _etat.get('termine'):
            return
        _etat['termine'] = True
        if _etat.get('issue') is None:
            _etat['issue'] = issue
    try:
        mesurer('fin')
    except Exception:
        pass
    _ecrire_journal(_etat.get('issue'))


def noter_pic(issue='ok'):
    """Processus PERSISTANT (serveur d'images) : ecrit son pic courant au journal
    sans se terminer — il est d'ordinaire arrete de force, sans passer par atexit.
    issue='memoire' : un chargement a ete refuse (besoin_mo note par texte_erreur)."""
    if _etat.get('actif'):
        _ecrire_journal(issue)


def _ecrire_journal(issue):
    chemin = os.environ.get('FABMESH_MEMOIRE_JOURNAL')
    if not chemin:
        return
    proc = memoire_processus() or {}
    decalage = _etat.get('decalage_mo') or 0.0
    ligne = {'date': time.strftime('%Y-%m-%dT%H:%M:%S'), 'cle': _etat.get('cle'), 'nom': _etat.get('nom'),
             'issue': issue, 'duree_s': round(time.time() - (_etat.get('debut') or time.time()), 1),
             'pic_ws_mo': round(proc.get('pic_ws_mo', 0.0)),
             'pic_engage_mo': round(_etat.get('pic_engage_mo') or 0.0),
             'pic_engage_os_mo': round(proc.get('pic_engage_os_mo', 0.0)),
             'decalage_mo': round(decalage)}
    if issue == 'ok':
        # BESOIN mesure, dans l'unite du plafond : pic d'engagement exact (Windows)
        # moins les reservations d'initialisation. Le travail tient sous le plafond
        # si et seulement si ce nombre tient dans le budget RAM. Apres un refus, le pic
        # de Windows compte la demande refusee : on prend alors le pic echantillonne.
        pic = (_etat.get('pic_engage_mo') or 0.0) if _etat.get('refus') else proc.get('pic_engage_os_mo', 0.0)
        ligne['pic_prive_mo'] = round(max(0.0, pic - decalage))
    for k in ('ram_limite_mo', 'ram_budget_mo', 'ram_plafond_mo', 'vram_budget_mo',
              'vram_contexte_mo', 'pic_vram_reserve_mo', 'besoin_mo'):
        if _etat.get(k) is not None:
            ligne[k] = round(_etat[k])
    try:
        if os.path.isfile(chemin) and os.path.getsize(chemin) > 512 * 1024:
            with open(chemin, 'r', encoding='utf-8') as f:
                garde = f.readlines()[-200:]
            with open(chemin, 'w', encoding='utf-8') as f:
                f.writelines(garde)
        with open(chemin, 'a', encoding='utf-8') as f:
            f.write(json.dumps(ligne) + '\n')
    except Exception as e:
        _log(f'journal memoire non ecrit : {e}')


def _a_la_sortie():
    try:
        terminer(_etat.get('issue') or 'fin')
    except Exception:
        pass
