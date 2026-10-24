"""Encrypt an explicit owner-selected Like/Skip batch for the native GitHub connector.

Run locally in a private ChatGPT execution sandbox, not inside GitHub Actions.
GitHub MUST receive only the resulting .enc.json ciphertext, never raw choices.
Requires cryptography. Pass plaintext via stdin, never CLI argv or GH files.
Example:
  python scripts/encrypt_owner_choices.py --public-key docs/owner-approval-public-key.pem < private_batch.json > approval.enc.json
"""
import argparse
import base64
import json
import os
import sys
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def encrypted_envelope(pem: bytes, payload: dict) -> dict:
    if not isinstance(payload, dict) or payload.get("confirmed_by_owner") is not True:
        raise ValueError("Explicit owner signoff required")
    if not isinstance(payload.get("items"), list) or not 1 <= len(payload["items"]) <= 20:
        raise ValueError("Choose between one and twenty articles")
    if not isinstance(payload.get("batch_id"), str) or not 8 <= len(payload["batch_id"]) <= 100:
        raise ValueError("Batch ID required")
    plaintext=json.dumps(payload, ensure_ascii=False, separators=(",",":")).encode("utf-8")
    if len(plaintext)>22000:raise ValueError("Private payload exceeds Cloudflare size limit")
    pub=serialization.load_pem_public_key(pem)
    aes=os.urandom(32)
    iv=os.urandom(12)
    wrapped=pub.encrypt(aes,padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
    ciphertext=AESGCM(aes).encrypt(iv,plaintext,None)
    b64=lambda data:base64.b64encode(data).decode("ascii")
    return {"v":1,"key":b64(wrapped),"iv":b64(iv),"data":b64(ciphertext)}

def main():
    parser=argparse.ArgumentParser(description="Encrypt user-approved article choices without exposing them to GitHub.")
    parser.add_argument("--public-key",required=True)
    a=parser.parse_args()
    raw=sys.stdin.buffer.read(22500)
    if len(raw)>22000:raise SystemExit("Input too large")
    try:
        payload=json.loads(raw)
        with open(a.public_key,"rb") as handle:pem=handle.read()
        envelope=encrypted_envelope(pem,payload)
    except Exception as error:
        raise SystemExit("No envelope produced; "+type(error).__name__) from None
    sys.stdout.write(json.dumps(envelope,separators=(",",":"))+"\n")

if __name__=="__main__":
    main()
