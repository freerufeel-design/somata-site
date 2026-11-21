#!/bin/sh
# Starts the local Somata server (serve.py) and opens the browser.
cd "$(dirname "$0")" || exit 1
exec python3 serve.py "$@"
