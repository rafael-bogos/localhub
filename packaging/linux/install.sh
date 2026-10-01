#!/usr/bin/env bash
# Instala o Localhub para o usuário atual: binário, ícone e atalho no menu de
# aplicativos. Não precisa de root.
#
#   ./install.sh              instala
#   ./install.sh --uninstall  remove tudo que foi instalado
#
# Este mesmo script vai dentro do .tar.gz da release (ao lado de `localhub` e
# `localhub.png`) e é usado por scripts/install.sh a partir do código-fonte,
# que aponta BIN e ICON para os arquivos recém-compilados.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${BIN:-$here/localhub}"
ICON="${ICON:-$here/localhub.png}"

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
bin_dir="$HOME/.local/bin"
target_bin="$bin_dir/localhub"
target_icon="$data_home/icons/localhub.png"
apps_dir="$data_home/applications"
target_desktop="$apps_dir/localhub.desktop"

refresh_menu() {
    # Faz o menu perceber o atalho sem precisar sair e entrar na sessão.
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps_dir" 2>/dev/null || true
}

usage() {
    echo "Uso: $0 [--uninstall]"
}

case "${1:-}" in
    "") ;;
    --uninstall | -u)
        rm -f "$target_bin" "$target_icon" "$target_desktop"
        refresh_menu
        echo "Localhub removido."
        exit 0
        ;;
    -h | --help)
        usage
        exit 0
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac

[ -f "$BIN" ] || { echo "Binário não encontrado: $BIN" >&2; exit 1; }
[ -f "$ICON" ] || { echo "Ícone não encontrado: $ICON" >&2; exit 1; }

install -Dm755 "$BIN" "$target_bin"
install -Dm644 "$ICON" "$target_icon"

desktop_tmp="$(mktemp)"
trap 'rm -f "$desktop_tmp"' EXIT
cat > "$desktop_tmp" <<DESKTOP
[Desktop Entry]
Name=Localhub
Comment=Hub de ferramentas locais para desenvolvedores
Exec="$target_bin"
Icon=$target_icon
Type=Application
Terminal=false
Categories=Development;
DESKTOP
install -Dm644 "$desktop_tmp" "$target_desktop"
refresh_menu

echo "Localhub instalado:"
echo "  binário: $target_bin"
echo "  atalho:  $target_desktop"
echo "Procure por \"Localhub\" no menu de aplicativos (se não aparecer na hora, saia e entre na sessão)."

# O app usa o WebKitGTK 4.1; avisa se ele não parece estar instalado. A lista é
# capturada antes do grep: com `pipefail`, um `grep -q` que sai no primeiro
# acerto faria o ldconfig levar SIGPIPE e o pipeline contaria como falha.
if command -v ldconfig >/dev/null 2>&1; then
    libs="$(ldconfig -p 2>/dev/null || true)"
else
    libs=""
fi
if [ -n "$libs" ] && ! grep -q 'libwebkit2gtk-4\.1\.so' <<<"$libs"; then
    echo
    echo "Atenção: a biblioteca WebKitGTK 4.1 não foi encontrada. Instale-a para o app abrir:"
    echo "  Fedora:        sudo dnf install webkit2gtk4.1"
    echo "  Ubuntu/Debian: sudo apt install libwebkit2gtk-4.1-0"
fi

case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *)
        echo
        echo "Dica: $bin_dir não está no seu PATH. O atalho do menu funciona assim mesmo;"
        echo "só para abrir pelo terminal digitando \"localhub\" é que você precisaria adicioná-lo."
        ;;
esac
