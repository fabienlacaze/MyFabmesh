"""Acces R2 en LECTURE SEULE (cloud/.env.local, jamais affiche)."""
import io, boto3
def client():
    cfg = {}
    for l in io.open(r'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/cloud/.env.local', encoding='utf-8'):
        l = l.strip()
        if l and not l.startswith('#') and '=' in l:
            k, v = l.split('=', 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
    s3 = boto3.client('s3', endpoint_url='https://%s.r2.cloudflarestorage.com' % cfg['R2_ACCOUNT_ID'],
        aws_access_key_id=cfg['R2_ACCESS_KEY_ID'], aws_secret_access_key=cfg['R2_SECRET_ACCESS_KEY'], region_name='auto')
    return s3, cfg
