# Correction du lot securite « textes courts latins » apres la relecture independante (24/10) : retire du lexique les termes qui sont des MOTS COURANTS d'une
# autre langue ou d'un autre sens (« dalam » = « dans » en indonesien, « goala » = « vide » en roumain, « nudos » = « noeuds » en espagnol...), et ajoute les
# TOURNURES non ambigues qui gardent le trou ferme. Script d'un seul usage, comme build/_inserer_lexique_latin*.py ; la source reelle reste cloud/src/nsfw_filter.ts.
# Il ne touche QUE les lignes ajoutees par le lot (git diff <parent> du fichier) : jamais un terme de la production. CRLF conserve.
# Usage : python build/_retirer_collisions_lexique.py <nsfw_filter.ts> <fichier_decisions.json> [<revision parent, defaut fbc8079e>]
#   fichier_decisions.json : { "retirer": ["terme", ...], "ajouter": { "NU_FORT": ["terme", ...], "NU_FORT_UNICODE": [...], ... } }
#   « retirer » s'applique a toutes les listes ou le terme figure dans une ligne du lot ; « ajouter » ecrit un bloc a la fin des lignes du lot de la liste
#   (et de GENERAL_SEXUEL_DUR quand la liste est NU_FORT : les deux listes portent le meme bloc).
import io, json, re, subprocess, sys

chemin, decisions, parent = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else 'fbc8079e')
dec = json.load(io.open(decisions, encoding='utf-8'))
retirer = set(dec.get('retirer', []))
ajouter = dec.get('ajouter', {})

s = io.open(chemin, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'
lignes = s.split(nl)

# lignes du lot = lignes ajoutees par rapport au parent (numeros dans le fichier courant)
rel = subprocess.run(['git', '-C', chemin.rsplit('cloud', 1)[0] or '.', 'diff', '-U0', parent, '--', 'cloud/src/nsfw_filter.ts'], capture_output=True).stdout.decode('utf-8')
lot = set()
dernier = {}
liste_courante = None
for l in rel.split('\n'):
    m = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@(?: (?:export )?const (\w+))?', l)
    if m:
        debut, n = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
        if m.group(3):
            liste_courante = m.group(3)
        for i in range(debut, debut + n):
            lot.add(i)
        if n:
            dernier[liste_courante] = max(dernier.get(liste_courante, 0), debut + n - 1)

TOK = re.compile(r"'(?:[^'\\]|\\.)*'")
retires = {}
for i in sorted(lot):
    ligne = lignes[i - 1]
    st = ligne.strip()
    if not st or st.startswith('//'):
        continue
    toks = TOK.findall(ligne)
    if not toks:
        continue
    indent = ligne[:len(ligne) - len(ligne.lstrip())]
    fin = ',' if ligne.rstrip().endswith(',') else ''
    # la ligne doit etre une pure suite de termes : on verifie qu'on la reconstruit a l'identique
    refait = indent + ', '.join(toks) + fin
    if refait != ligne.rstrip():
        continue
    gardes = [t for t in toks if t[1:-1] not in retirer]
    if len(gardes) != len(toks):
        for t in toks:
            if t[1:-1] in retirer:
                retires[t[1:-1]] = retires.get(t[1:-1], 0) + 1
        lignes[i - 1] = (indent + ', '.join(gardes) + fin) if gardes else None

lignes = [l for l in lignes if l is not None]
# les numeros ont change : recalcule les fins de blocs par recherche de la fin de chaque liste ciblee
def fin_de_liste(nom):
    deb = None
    for k, l in enumerate(lignes):
        if re.match(r'(?:export )?const ' + nom + r'\b', l):
            deb = k
            break
    if deb is None:
        raise SystemExit('liste introuvable : ' + nom)
    for k in range(deb, len(lignes)):
        if lignes[k].startswith('];'):
            return k
    raise SystemExit('fin introuvable : ' + nom)

def bloc(termes, titre):
    out = ['  // ' + titre]
    cur = '  '
    for t in termes:
        piece = "'" + t.replace("\\", "\\\\").replace("'", "\\'") + "',"
        if len(cur) + len(piece) + 1 > 150 and cur.strip():
            out.append(cur.rstrip())
            cur = '  '
        cur += piece + ' '
    if cur.strip():
        out.append(cur.rstrip())
    return out

titre = dec.get('titre', '2026-10-24 (lot securite, correction apres relecture) : tournures non ambigues qui remplacent des termes retires (mots courants d une autre langue)')
for nom, termes in ajouter.items():
    cibles = [nom] + (['GENERAL_SEXUEL_DUR'] if nom == 'NU_FORT' else [])
    for c in cibles:
        # evite les doublons deja presents dans le fichier courant
        k = fin_de_liste(c)
        lignes[k:k] = bloc(termes, titre)

io.open(chemin, 'w', encoding='utf-8', newline='').write(nl.join(lignes))
print('retires :', sum(retires.values()), 'occurrences,', len(retires), 'termes distincts')
manq = sorted(retirer - set(retires))
if manq:
    print('NON TROUVES dans les lignes du lot :', manq)
