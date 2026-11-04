#!/bin/zsh
# 心灵之窗护眼助手 · 双击启动（优先打开 /Applications 里安装好的正式应用）
# 应用驻留后台（托盘常驻），关掉主窗口计时不停；退出请点托盘菜单「退出心灵之窗」。
if [ -d "/Applications/心灵之窗护眼助手.app" ]; then
  open -a "/Applications/心灵之窗护眼助手.app"
  echo "已启动 心灵之窗护眼助手（/Applications 正式版）。本窗口可关闭。"
  sleep 2
  exit 0
fi

# 正式版未安装时退回开发模式启动
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:$PATH"
if pgrep -f "心灵之窗/node_modules/electron/dist/Electron" >/dev/null 2>&1; then
  echo "心灵之窗已经在运行了（看屏幕右上角托盘）。"
  sleep 2
  exit 0
fi
echo "（未检测到 /Applications 正式版，以开发模式启动）"
nohup ./node_modules/.bin/electron . >/tmp/心灵之窗.log 2>&1 &
sleep 3
if pgrep -f "心灵之窗/node_modules/electron/dist/Electron" >/dev/null 2>&1; then
  echo "已启动 ✓ 主窗口稍后弹出；之后可关闭本终端窗口。"
else
  echo "启动遇到问题，日志如下："
  tail -5 /tmp/心灵之窗.log
fi
sleep 2
