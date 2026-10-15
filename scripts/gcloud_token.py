"""Spustí gcloud (scripts/gcloud_token.py run deploy …) s krátkodobým přístupovým tokenem uživatelského účtu.

Postup z DEPLOY.md: z obnovovacího tokenu v legacy_credentials/<účet>/adc.json
se vyrobí přístupový token a gcloud ho dostane v CLOUDSDK_AUTH_ACCESS_TOKEN.
Token se nikam nevypisuje ani neukládá.
"""
import json
import os
import pathlib
import subprocess
import sys
import urllib.parse
import urllib.request

UCET = os.environ.get("KAM_GCLOUD_UCET") or sys.exit("Nastav KAM_GCLOUD_UCET na účet přihlášený v gcloud.")
adc = pathlib.Path(os.environ["APPDATA"]) / "gcloud" / "legacy_credentials" / UCET / "adc.json"
d = json.loads(adc.read_text(encoding="utf-8"))
telo = urllib.parse.urlencode({
    "client_id": d["client_id"], "client_secret": d["client_secret"],
    "refresh_token": d["refresh_token"], "grant_type": "refresh_token",
}).encode()
with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=telo), timeout=30) as r:
    token = json.load(r)["access_token"]

env = dict(os.environ)
env["CLOUDSDK_AUTH_ACCESS_TOKEN"] = token
env["CLOUDSDK_PYTHON"] = r"C:\Users\hushkys\AppData\Local\Programs\Python\Python312\python.exe"
env["CLOUDSDK_CORE_PROJECT"] = "hack-a-ton-hushkys"
env["CLOUDSDK_CORE_ACCOUNT"] = UCET
sys.exit(subprocess.call([r"C:\gcsdk\google-cloud-sdk\bin\gcloud.cmd", *sys.argv[1:]], env=env))
