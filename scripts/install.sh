#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

wails build -tags webkit2_41
install -Dm755 build/bin/localhub "$HOME/.local/bin/localhub"

echo "Instalado em $HOME/.local/bin/localhub"
