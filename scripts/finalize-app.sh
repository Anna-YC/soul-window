#!/bin/zsh
# 打包后处理：修正中文应用名 / bundleId / 图标（electron-builder 26 对非 ASCII productName 回退为 Electron.app，这里补齐）
set -euo pipefail
cd "$(dirname "$0")/.."

# electron-builder 26 对中文 productName 可能回退 Electron.app（旧行为），也可能直接产出中文名（新行为）
SRC_E="release/mac-arm64/Electron.app"
SRC_C="release/mac-arm64/心灵之窗护眼助手.app"
APP="release/mac-arm64/心灵之窗护眼助手.app"

if [ -d "$SRC_E" ]; then
  rm -rf "$APP"
  mv "$SRC_E" "$APP"
elif [ ! -d "$SRC_C" ]; then
  echo "未找到 $SRC_E 或 $SRC_C，先运行 npm run dist" >&2
  exit 1
fi

# ---- icns：512 品牌图标 → iconset → iconutil ----
ICONSET="build/icon.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for size in 16 32 64 128 256 512; do
  sips -z $size $size build/icon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  if [ $double -le 1024 ]; then
    sips -z $double $double build/icon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  fi
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/app.icns"
rm -rf "$ICONSET"

# ---- Info.plist 元数据 ----
PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName 心灵之窗护眼助手" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 心灵之窗护眼助手" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier cn.dengshan.soul-window" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile app.icns" "$PLIST"
# 固定 bundle 版本，便于后续升级替换
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 0.2.2" "$PLIST"

echo "✓ $APP"
/usr/libexec/PlistBuddy -c "Print :CFBundleName" -c "Print :CFBundleIdentifier" -c "Print :CFBundleIconFile" "$PLIST"
du -sh "$APP"
