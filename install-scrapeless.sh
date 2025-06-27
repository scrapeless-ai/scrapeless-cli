#!/usr/bin/env bash

set -e

REPO="scrapeless-ai/scrapeless-cli"
INSTALL_DIR="$HOME/.local/bin"

echo "📦 Installing scrapeless..."

# Get latest release version
VERSION=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
if [[ -z "$VERSION" ]]; then
  echo "Failed to get latest release version."
  exit 1
fi
echo "🔎 Latest version: $VERSION"

# Detect OS
OS="$(uname | tr '[:upper:]' '[:lower:]')"
case "$OS" in
  linux) OS="linux" ;;
  darwin) OS="darwin" ;;
  msys* | mingw* | cygwin* | windows*) OS="windows" ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64 | amd64) ARCH="amd64" ;;
  i386 | i686) ARCH="386" ;;
  arm64 | aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

FILENAME="scrapeless-cli_${OS}_${ARCH}"
EXT="tar.gz"
[[ "$OS" == "windows" ]] && EXT="zip"

TARBALL="$FILENAME.$EXT"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/$TARBALL"

echo "Downloading $DOWNLOAD_URL..."
curl -fSL -o "$TARBALL" "$DOWNLOAD_URL"

echo "Extracting $TARBALL..."
EXTRACT_DIR="scrapeless_tmp_extract_$$"
mkdir -p "$EXTRACT_DIR"

if [[ "$EXT" == "zip" ]]; then
  unzip -q "$TARBALL" -d "$EXTRACT_DIR"
else
  tar -xzf "$TARBALL" -C "$EXTRACT_DIR"
fi
rm "$TARBALL"

mkdir -p "$INSTALL_DIR"

echo "📁 Moving files to $INSTALL_DIR..."
for f in "$EXTRACT_DIR"/*; do
  chmod +x "$f" 2>/dev/null || true
  mv -f "$f" "$INSTALL_DIR/"
done
rm -rf "$EXTRACT_DIR"

BINARY_NAME="scrapeless"
[[ "$OS" == "windows" ]] && BINARY_NAME="scrapeless.exe"

echo "Installed at: $INSTALL_DIR/$BINARY_NAME"

# PATH check
if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  if [[ "$OS" == "linux" || "$OS" == "darwin" ]]; then
    SHELL_CONFIG=""
    if [ -n "$ZSH_VERSION" ]; then
      SHELL_CONFIG="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
      SHELL_CONFIG="$HOME/.bashrc"
    else
      SHELL_CONFIG="$HOME/.profile"
    fi

    if ! grep -q "$INSTALL_DIR" "$SHELL_CONFIG" 2>/dev/null; then
      echo "Adding install directory to your PATH in $SHELL_CONFIG ..."
      echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_CONFIG"
      echo "Please restart your terminal or run 'source $SHELL_CONFIG' to apply the changes."
    else
      echo "Your PATH already contains the install directory."
    fi
  elif [[ "$OS" == "windows" ]]; then
    echo ""
    echo "Please manually add $INSTALL_DIR to your system PATH environment variable:"
    echo " 1. Open 'System Properties' -> 'Advanced' -> 'Environment Variables'"
    echo " 2. Under 'User variables', select PATH, then click Edit"
    echo " 3. Add a new entry: $INSTALL_DIR"
    echo " 4. Save and restart your terminal"
  fi
else
  echo "🚀 You can now run: $BINARY_NAME"
fi
