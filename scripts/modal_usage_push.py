#!/usr/bin/env python3
"""Push the REAL Modal workspace usage to the MyFabmesh cloud admin.

The Cloudflare Worker can't run the Modal CLI, so this small poller runs
`modal billing report --for "this month" --json`, sums the per-app/day cost
(= the real workspace usage that counts toward your Modal budget), and POSTs it
to <WORKER_URL>/api/admin/modal-usage. The admin then shows the REAL number and
the budget alert fires on real usage vs your Modal limit (instead of the worker's
rough estimate).

Env vars:
  MODAL_USAGE_SECRET   shared secret == the Worker's MODAL_USAGE_SECRET (required)
  FABMESH_WORKER_URL   default https://myfabmesh-cloud.fabien65400.workers.dev
  MODAL_BILLING_FOR    default "this month"  (Modal billing cycle window)

Schedule it ~hourly: Windows Task Scheduler, cron, or a GitHub Action.
Requires the `modal` CLI to be installed + authenticated on the host that runs it.
"""
import datetime
import json
import os
import subprocess
import sys
import urllib.request

WORKER = os.environ.get("FABMESH_WORKER_URL", "https://myfabmesh-cloud.fabien65400.workers.dev").rstrip("/")
SECRET = os.environ.get("MODAL_USAGE_SECRET", "")
PERIOD = os.environ.get("MODAL_BILLING_FOR", "this month")


def modal_usage():
    """Return (total_usd, by_app) from `modal billing report --json` for the cycle."""
    proc = subprocess.run(
        [sys.executable, "-m", "modal", "billing", "report", "--for", PERIOD, "--json"],
        capture_output=True, text=True, timeout=180,
    )
    if proc.returncode != 0:
        raise SystemExit(f"`modal billing report` failed: {proc.stderr.strip()[:400]}")
    rows = json.loads(proc.stdout)
    total = 0.0
    by_app = {}
    for r in rows:
        c = float(r.get("Cost", 0) or 0)
        total += c
        app = str(r.get("Description") or r.get("Object ID") or "unknown")
        by_app[app] = round(by_app.get(app, 0.0) + c, 6)
    return round(total, 6), by_app


def modal_usage_by_day(days=30):
    """Facture REELLE jour par jour ({'AAAA-MM-JJ': usd}) sur `days` jours.

    Le graphique « Revenue vs Cost » de l'admin tracait l'ESTIMATION du
    worker : 9 EUR le 24/09 pour 25 EUR factures. Seul le total du mois
    etait reel ; le detail par jour n'etait jamais remonte. Un echec ici ne
    doit pas empecher de pousser le total : on rend None.

    30 jours = ceux du graphique ; Modal refuse un rapport journalier de
    plus de 31 jours (« Daily reports cannot span more than 31 days »)."""
    fin = datetime.date.today() + datetime.timedelta(days=1)
    debut = fin - datetime.timedelta(days=days)
    proc = subprocess.run(
        [sys.executable, "-m", "modal", "billing", "report", "--start", debut.isoformat(),
         "--end", fin.isoformat(), "--resolution", "d", "--json"],
        capture_output=True, text=True, timeout=180,
    )
    if proc.returncode != 0:
        print(f"detail par jour indisponible: {proc.stderr.strip()[:300]}")
        return None
    by_day = {}
    for r in json.loads(proc.stdout):
        jour = str(r.get("Interval Start") or "")[:10]
        if len(jour) == 10:
            by_day[jour] = round(by_day.get(jour, 0.0) + float(r.get("Cost", 0) or 0), 6)
    return by_day


def main() -> None:
    if not SECRET:
        raise SystemExit("Set MODAL_USAGE_SECRET (must match the Worker's MODAL_USAGE_SECRET).")
    usage, by_app = modal_usage()
    corps = {"usage": usage, "by_app": by_app, "cycle": PERIOD}
    by_day = modal_usage_by_day()
    if by_day is not None:
        corps["by_day"] = by_day
    payload = json.dumps(corps).encode("utf-8")
    req = urllib.request.Request(
        f"{WORKER}/api/admin/modal-usage", data=payload, method="POST",
        headers={"content-type": "application/json", "x-ingest-secret": SECRET.strip(),
                 "user-agent": "MyFabmesh-ModalPoller/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"pushed Modal usage ${usage:.4f} across {len(by_app)} apps ({PERIOD}) -> HTTP {resp.status}: {resp.read(200).decode()}")


if __name__ == "__main__":
    main()
