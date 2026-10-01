#!/usr/bin/env bash
# Compila a partir do código-fonte e instala (binário + ícone + atalho do menu).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

wails build -tags webkit2_41
BIN=build/bin/localhub ICON=build/appicon.png ./packaging/linux/install.sh
