#!/bin/zsh
set -e
tool_dir="${0:A:h}"
for python_bin in /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if [[ -x "$python_bin" ]]; then
    exec "$python_bin" "$tool_dir/launcher.py"
  fi
done
if command -v python3 >/dev/null 2>&1; then
  exec python3 "$tool_dir/launcher.py"
fi
/usr/bin/osascript -e 'display dialog "未找到 Python 3。请先安装 Python 3 后再启动。" with title "包装动态排列工具" buttons {"确定"} default button 1 with icon stop'
exit 1
