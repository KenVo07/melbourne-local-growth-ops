"""Disposable Slice 4 security-canary fixture (Project C).

This is a synthetic, throwaway Flask-style app seeded with known,
representative application-security flaws for a UnitOneAI-backed review.
It is never deployed and never runs against a real network.
"""
import hashlib
import os
import subprocess
import sqlite3

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), "app.db")

# --- Flaw 1: hardcoded secret / credential in source -----------------------
STRIPE_API_KEY = "sk_live_EXAMPLE_NOT_A_REAL_SECRET_seeded_for_review"
ADMIN_PASSWORD = "admin123"


@app.route("/api/tenants/<tenant_id>/invoices/<invoice_id>")
def get_invoice(tenant_id, invoice_id):
    # --- Flaw 2: IDOR / missing tenant-boundary authorization check --------
    # No check that the authenticated caller actually owns `tenant_id`.
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    # --- Flaw 3: SQL injection via string-formatted query -------------------
    query = "SELECT * FROM invoices WHERE tenant_id = '%s' AND id = '%s'" % (
        tenant_id,
        invoice_id,
    )
    cur.execute(query)
    return jsonify(cur.fetchone())


@app.route("/api/webhooks/payment", methods=["POST"])
def payment_webhook():
    # --- Flaw 4: missing webhook authenticity/signature verification -------
    payload = request.get_json()
    apply_payment(payload["tenant_id"], payload["amount"])
    return jsonify({"ok": True})


@app.route("/api/fetch-avatar", methods=["POST"])
def fetch_avatar():
    # --- Flaw 5: SSRF - unsafe outbound target trust ------------------------
    url = request.json["url"]
    resp = requests.get(url, timeout=5)
    return resp.content


@app.route("/api/upload", methods=["POST"])
def upload():
    # --- Flaw 6: unsafe upload / content trust boundary ---------------------
    f = request.files["file"]
    dest = os.path.join("/var/www/uploads", f.filename)  # path traversal, no type check
    f.save(dest)
    return jsonify({"path": dest})


@app.route("/api/admin/run-diagnostic", methods=["POST"])
def run_diagnostic():
    # --- Flaw 7: overly broad agent/tool authority (unsandboxed shell) -----
    cmd = request.json["cmd"]
    output = subprocess.check_output(cmd, shell=True)
    return jsonify({"output": output.decode()})


def apply_payment(tenant_id, amount):
    print(f"applying payment for {tenant_id}: {amount} using key {STRIPE_API_KEY}")


def hash_password(pw):
    # weak hashing, listed here as context but not a counted seeded flaw
    return hashlib.md5(pw.encode()).hexdigest()
