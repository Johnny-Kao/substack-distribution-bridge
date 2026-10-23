"""Client-side encrypted GitHub MCP gateway.

Any AI with GitHub MCP plus Python can run this helper. It needs NO Cloudflare
configuration or credential. Run using: uv run --with cryptography python -m scripts.gateway_client ...
Never post plaintext candidate details or approvals to a public GitHub issue.
"""
import base64
import json
import os
import sys
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".cache" / "gateway_reply_private.pem"

def b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")

def un64(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

def encrypt(op: str, limit: int = 12) -> str:
    if op not in ("status", "shortlist", "policy"):
        raise ValueError("Unsupported read-only operation")
    remote_public = serialization.load_pem_public_key((ROOT / "gateway_public.pem").read_bytes())
    temporary = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_bytes(temporary.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    STATE.chmod(0o600)
    reply_public = temporary.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    payload = {"op": op, "limit": limit, "reply_pub": reply_public}
    aes_key, iv = os.urandom(32), os.urandom(12)
    wrapped = remote_public.encrypt(aes_key,padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
    cipher = AESGCM(aes_key).encrypt(iv,json.dumps(payload,separators=(",",":")).encode(),None)
    return "enc-v1:" + b64(json.dumps({"v":1,"ek":b64(wrapped),"iv":b64(iv),"ct":b64(cipher)},separators=(",",":")).encode())

def decrypt(raw: str) -> dict:
    if not raw.startswith("enc-v1:"):
        raise ValueError("Encrypted reply expected")
    if not STATE.exists():
        raise FileNotFoundError("Ephemeral private key is missing; submit a new request instead")
    envelope = json.loads(un64(raw[7:]))
    temporary = serialization.load_pem_private_key(STATE.read_bytes(),password=None)
    symmetric = temporary.decrypt(un64(envelope["ek"]),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
    payload = AESGCM(symmetric).decrypt(un64(envelope["iv"]),un64(envelope["ct"]),None)
    return json.loads(payload)

if __name__ == "__main__":
    if len(sys.argv)<3:
        raise SystemExit("Usage: gateway_client create [status|shortlist|policy] [limit] | decrypt 'enc-v1:...'")
    if sys.argv[1]=="create":
        print(encrypt(sys.argv[2],int(sys.argv[3]) if len(sys.argv)>3 else 12))
    elif sys.argv[1]=="decrypt":
        print(json.dumps(decrypt(sys.argv[2]),ensure_ascii=False,indent=2))
    else:
        raise SystemExit("Unknown action")
