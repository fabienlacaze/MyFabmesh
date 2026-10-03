"""Supabase REST en LECTURE SEULE (service role de cloud/.env.local, jamais affiche)."""
import io, json, urllib.request
def cfg():
    c = {}
    for l in io.open(r'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/cloud/.env.local', encoding='utf-8'):
        l = l.strip()
        if l and not l.startswith('#') and '=' in l:
            k, v = l.split('=', 1); c[k.strip()] = v.strip().strip('"').strip("'")
    return c
def get(path, c=None):
    c = c or cfg()
    req = urllib.request.Request(c['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/') + '/rest/v1/' + path,
        headers={'apikey': c['SUPABASE_SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + c['SUPABASE_SERVICE_ROLE_KEY']})
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))
