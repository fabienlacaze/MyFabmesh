# -*- coding: utf-8 -*-
"""SURVEILLANCE DU PARENT pour les scripts qui ne passent pas par cloisonnement_memoire (2026-09-30).

Pourquoi : cloisonnement_memoire._surveiller_parent arrete un calcul quand l'appli disparait (plantage, arret force), mais
seuls les scripts qui importent ce module en profitent. Detail++ (detail_synth.py et sa recuisson texture_project.py), le rig
(skintokens_bridge.py, environnement python-rig), les outils de maillage, la decoupe (python-segment) et les petits serveurs
d'appoint (traduction, filtre de contenu) restaient orphelins : un calcul qui tient la carte ou la RAM jusqu'au redemarrage.

Meme contrat que cloisonnement_memoire (bibliotheque standard seule : utilisable depuis n'importe quel Python) :
  * main.js pose FABMESH_PARENT_PID (son pid) et FABMESH_KEEP_FLAG (fichier ecrit AVANT de quitter avec « Quit and keep jobs
    running » ou la pause) ;
  * un fil attend la fin du parent (WaitForSingleObject, sans interrogation) ; parent disparu et pas de drapeau -> os._exit(3),
    le meme code de sortie ;
  * enfants=True : les processus lances ENSUITE par ce script (texture_project.py, moteur du rig, Blender...) sont places dans
    un Job Object « kill on close » : ils s'arretent avec lui, qu'il soit arrete par ce fil ou tue de l'exterieur. Sans lui, un
    enfant survivait a son pere (os._exit ne touche pas aux enfants sous Windows).
Desactivation d'urgence : FABMESH_PARENT_WATCH=0 (la meme que pour cloisonnement_memoire).
"""
import os
import sys
import threading

_job_enfants = None      # poignee gardee ouverte toute la vie du processus (sa fermeture tue les enfants)
_arme = False


def _log(message):
    try:
        print('[surveillance] ' + message, flush=True)
    except Exception:
        pass


def _job_tuer_enfants_a_la_fermeture():
    """Job Object KILL_ON_JOB_CLOSE sur ce processus : ses futurs enfants y entrent d'office et meurent avec lui."""
    global _job_enfants
    if _job_enfants is not None:
        return True
    import ctypes
    from ctypes import wintypes

    class _Base(ctypes.Structure):
        _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                    ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                    ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                    ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]

    class _Io(ctypes.Structure):
        _fields_ = [(n, ctypes.c_uint64) for n in ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
                                                   'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]

    class _Etendu(ctypes.Structure):
        _fields_ = [('BasicLimitInformation', _Base), ('IoInfo', _Io), ('ProcessMemoryLimit', ctypes.c_size_t),
                    ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t),
                    ('PeakJobMemoryUsed', ctypes.c_size_t)]

    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    k32.CreateJobObjectW.restype = ctypes.c_void_p
    k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
    k32.SetInformationJobObject.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k32.SetInformationJobObject.restype = wintypes.BOOL
    k32.GetCurrentProcess.restype = ctypes.c_void_p
    k32.AssignProcessToJobObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    k32.AssignProcessToJobObject.restype = wintypes.BOOL
    h = k32.CreateJobObjectW(None, None)
    if not h:
        raise OSError(ctypes.get_last_error(), 'CreateJobObject')
    info = _Etendu()
    info.BasicLimitInformation.LimitFlags = 0x2000                          # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not k32.SetInformationJobObject(h, 9, ctypes.byref(info), ctypes.sizeof(info)):   # JobObjectExtendedLimitInformation
        raise OSError(ctypes.get_last_error(), 'SetInformationJobObject')
    if not k32.AssignProcessToJobObject(h, k32.GetCurrentProcess()):
        raise OSError(ctypes.get_last_error(), 'AssignProcessToJobObject')
    _job_enfants = h
    return True


def surveiller(nom='calcul', enfants=False):
    """A appeler en tete du script (avant tout travail long). Rend True si la surveillance est armee."""
    global _arme
    if _arme:
        return True
    if sys.platform != 'win32' or os.environ.get('FABMESH_PARENT_WATCH') == '0':
        return False
    try:
        pid = int(os.environ.get('FABMESH_PARENT_PID') or 0)
    except ValueError:
        pid = 0
    if pid <= 0 or pid == os.getpid():
        return False                         # lance a la main (terminal, banc) : rien a surveiller
    drapeau = os.environ.get('FABMESH_KEEP_FLAG') or ''
    if enfants:
        try:
            _job_tuer_enfants_a_la_fermeture()
        except Exception as e:
            _log('%s : enfants non rattaches (%s)' % (nom, e))

    def _boucle():
        try:
            import ctypes
            k32 = ctypes.windll.kernel32
            k32.OpenProcess.restype = ctypes.c_void_p
            h = k32.OpenProcess(0x00100000, False, pid)        # SYNCHRONIZE
            if not h:
                return                                          # parent introuvable : on ne tue rien
            k32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
            while True:
                if k32.WaitForSingleObject(h, 2000) == 0:       # 0 = le parent s'est termine
                    if drapeau and os.path.exists(drapeau):
                        return                                  # « keep jobs » / pause : le calcul continue seul
                    _log('%s : application disparue (pid %d), arret du calcul' % (nom, pid))
                    os._exit(3)
        except Exception:
            return
    threading.Thread(target=_boucle, name='surveillance-parent', daemon=True).start()
    _arme = True
    return True
