#!/usr/bin/env bash
# Publish dist/ to Qortal MAINNET QDN as qortal://APP/Keygen/default,
# registering the name "Keygen" first if it does not exist yet.
#
# SPENDS REAL QORT: name registration costs the current REGISTER_NAME unit fee
# (1.25 QORT as of 2026-08) plus 0.01 QORT for the ARBITRARY publish.
#
# Signing happens LOCALLY via the qortal_local_sign/publish_qdn tools (from
# qortium-site); the private key never reaches the node.
#
# Required environment:
#   QORTAL_WALLET         path to the publisher's wallet backup .json
#   QORTAL_PASSWORD_FILE  file containing that wallet's password
# Optional:
#   QKG_QORTAL_NODE   node base URL   (default https://ext-node.qortal.link)
#   QKG_QORTAL_NAME   publish name    (default Keygen)
#   QKG_SIGNER_DIR    dir holding qortal_local_sign.py + publish_qdn.py
#                     (default ~/qortium/git/qortium-site/tools)
set -euo pipefail

NODE="${QKG_QORTAL_NODE:-https://ext-node.qortal.link}"
NAME="${QKG_QORTAL_NAME:-Keygen}"
TOOLS="${QKG_SIGNER_DIR:-$HOME/qortium/git/qortium-site/tools}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO_ROOT/dist"

: "${QORTAL_WALLET:?set QORTAL_WALLET to the wallet backup .json path}"
: "${QORTAL_PASSWORD_FILE:?set QORTAL_PASSWORD_FILE to the wallet password file}"
[ -f "$DIST/index.html" ] || { echo "ERROR: $DIST/index.html missing — run npm run build first." >&2; exit 1; }
[ -f "$TOOLS/qortal_local_sign.py" ] || { echo "ERROR: signer tools not found in $TOOLS" >&2; exit 1; }

echo "==> signer identity"
ADDR_OUT="$(python3 "$TOOLS/qortal_local_sign.py" address \
  --wallet "$QORTAL_WALLET" --password-file "$QORTAL_PASSWORD_FILE")"
echo "$ADDR_OUT"
ADDR="$(printf '%s\n' "$ADDR_OUT" | awk '/^address:/ {print $2}')"
PUB="$(printf '%s\n' "$ADDR_OUT" | awk '/^public_key:/ {print $2}')"

name_owner() {
  curl -sS "$NODE/names/$NAME" | python3 -c \
    'import json,sys
try: print(json.load(sys.stdin).get("owner",""))
except Exception: print("")' 2>/dev/null || true
}

OWNER="$(name_owner)"
if [ -z "$OWNER" ]; then
  echo "==> name $NAME is unregistered; registering it to $ADDR"
  REF="$(curl -sS "$NODE/addresses/lastreference/$ADDR")"
  FEE="$(curl -sS "$NODE/transactions/unitfee?txType=REGISTER_NAME")"
  echo "    reference: $REF"
  echo "    fee (qortoshis): $FEE"

  UNSIGNED="$(REF="$REF" PUB="$PUB" NAME="$NAME" FEE="$FEE" TOOLS="$TOOLS" python3 - <<'PY'
import os, sys, time, json
sys.path.insert(0, os.environ["TOOLS"])
import qortal_local_sign as s

# RegisterNameTransactionTransformer layout (qortal core):
# type(3) i32 | timestamp i64 | txGroupId i32 | reference 64B | pubkey 32B |
# name len+utf8 | data len+utf8 | fee i64 | [signature]
i32 = lambda n: int(n).to_bytes(4, "big")
i64 = lambda n: int(n).to_bytes(8, "big")
lp = lambda b: i32(len(b)) + b

ref = s.b58decode(os.environ["REF"]); assert len(ref) == 64, "reference must be 64 bytes"
pub = s.b58decode(os.environ["PUB"]); assert len(pub) == 32, "public key must be 32 bytes"
name = os.environ["NAME"].encode("utf-8")
data = json.dumps({"app": os.environ["NAME"], "purpose": "QORT vanity address generator"}).encode("utf-8")
fee = int(os.environ["FEE"])
tx = i32(3) + i64(int(time.time() * 1000)) + i32(0) + ref + pub + lp(name) + lp(data) + i64(fee)
print(s.b58encode(tx))
PY
)"
  echo "    unsigned tx: ${#UNSIGNED} chars"

  SIGNED="$(printf '%s' "$UNSIGNED" | python3 "$TOOLS/qortal_local_sign.py" sign \
    --wallet "$QORTAL_WALLET" --password-file "$QORTAL_PASSWORD_FILE")"

  echo "==> broadcasting REGISTER_NAME"
  RESP="$(curl -sS -X POST "$NODE/transactions/process" -H 'Content-Type: text/plain' --data "$SIGNED")"
  echo "    process response: $RESP"

  echo "==> waiting for name confirmation"
  for _ in $(seq 1 60); do
    OWNER="$(name_owner)"
    [ -n "$OWNER" ] && break
    sleep 10
  done
  [ -n "$OWNER" ] || { echo "ERROR: name $NAME still unconfirmed; check manually before re-running." >&2; exit 1; }
fi

if [ "$OWNER" != "$ADDR" ]; then
  echo "ERROR: name $NAME is owned by $OWNER, not the signing account $ADDR." >&2
  exit 1
fi
echo "==> name $NAME confirmed, owner $OWNER"

echo "==> publishing APP/$NAME/default (fee 0.01 QORT)"
python3 "$TOOLS/publish_qdn.py" \
  --node "$NODE" \
  --service APP \
  --name "$NAME" \
  --identifier default \
  --path "$DIST" \
  --title "Keygen" \
  --description "Generate QORT vanity addresses locally in your browser." \
  --category TOOLS \
  --fee 0.01 \
  --wallet "$QORTAL_WALLET" \
  --password-file "$QORTAL_PASSWORD_FILE"

echo "==> verifying"
curl -sS "$NODE/arbitrary/resources/search?service=APP&name=$NAME&includemetadata=true" | head -c 600
echo
echo "Done: qortal://APP/$NAME/default"
