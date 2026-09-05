#!/usr/bin/env bash
# Installed public selftest. Deliberately limited to the shipped direct-API response firewall; it
# neither discovers agy nor makes a provider call.
set -euo pipefail
SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/gemini-frozen-gate-selftest.mjs"
