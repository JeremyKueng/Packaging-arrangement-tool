#!/usr/bin/env python3
from __future__ import annotations

import http.server
import hashlib
import os
import socketserver
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Optional


TOOL_DIR = Path(__file__).resolve().parent
TEMP_DIR = Path(tempfile.gettempdir())
INSTANCE_KEY = hashlib.sha1(str(TOOL_DIR).encode("utf-8")).hexdigest()[:12]
PREFERRED_PORT = 56102
PORT_FILE = TEMP_DIR / f"midpack-layout-tool-{INSTANCE_KEY}.port"
LOCK_FILE = TEMP_DIR / f"midpack-layout-tool-{INSTANCE_KEY}.lock"
LOG_FILE = TEMP_DIR / f"midpack-layout-tool-{INSTANCE_KEY}.log"
REQUIRED_FILES = (
    TOOL_DIR / "index.html",
    TOOL_DIR / "vendor" / "three.module.js",
    TOOL_DIR / "vendor" / "OrbitControls.js",
    TOOL_DIR / "vendor" / "RoundedBoxGeometry.js",
    TOOL_DIR / "vendor" / "jspdf.umd.min.js",
    TOOL_DIR / "src" / "dimensions.js",
    TOOL_DIR / "src" / "geometry-core.js",
    TOOL_DIR / "src" / "preset-core.js",
    TOOL_DIR / "src" / "pdf-entry-core.js",
    TOOL_DIR / "src" / "carton-naming.js",
    TOOL_DIR / "src" / "case-divider.js",
    TOOL_DIR / "src" / "pallet-core.js",
    TOOL_DIR / "src" / "pallet-preset-core.js",
    TOOL_DIR / "src" / "storage-core.js",
    TOOL_DIR / "assets" / "vinda-logo.png",
    TOOL_DIR / "assets" / "fonts" / "cn-subset.ttf",
)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass

    def end_headers(self) -> None:
        # 工具更新频繁；禁止浏览器复用旧 ES Module，避免页面与模块版本不一致而白屏。
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def url_for(port: int) -> str:
    return f"http://127.0.0.1:{port}/index.html"


def live_url() -> Optional[str]:
    # 正常情况下优先使用端口记录；异常退出时记录文件可能已经丢失，
    # 但服务进程仍在监听首选端口。补探测首选端口，避免双击时误判为未启动。
    ports = []
    if PORT_FILE.exists():
        try:
            ports.append(int(PORT_FILE.read_text(encoding="utf-8").strip()))
        except (OSError, ValueError):
            PORT_FILE.unlink(missing_ok=True)
    if PREFERRED_PORT not in ports:
        ports.append(PREFERRED_PORT)

    for port in ports:
        try:
            url = url_for(port)
            with urllib.request.urlopen(url, timeout=1.0) as response:
                page = response.read(4096).decode("utf-8", errors="ignore")
                if response.status == 200 and "<title>中包动态排列工具</title>" in page:
                    return url
        except (OSError, ValueError):
            continue
    return None


def show_error(message: str) -> None:
    if sys.platform == "darwin":
        safe_message = message.replace("\\", "\\\\").replace('"', '\\"')
        script = f'display dialog "{safe_message}" with title "包装动态排列工具" buttons {{"确定"}} default button 1 with icon stop'
        subprocess.run(["/usr/bin/osascript", "-e", script], check=False)
    elif os.name == "nt":
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, message, "包装动态排列工具", 0x10)
    else:
        print(message, file=sys.stderr)


def open_url(url: str) -> None:
    if sys.platform == "darwin":
        subprocess.run(["/usr/bin/open", url], check=False)
    elif os.name == "nt":
        os.startfile(url)  # type: ignore[attr-defined]
    else:
        subprocess.run(["xdg-open", url], check=False)


def process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def acquire_server_lock() -> Optional[int]:
    """跨平台单实例锁；若上次异常退出，则自动清理失效锁。"""
    for _ in range(2):
        try:
            fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode("ascii"))
            return fd
        except FileExistsError:
            try:
                owner_pid = int(LOCK_FILE.read_text(encoding="ascii").strip())
            except (OSError, ValueError):
                owner_pid = 0
            if process_alive(owner_pid):
                return None
            LOCK_FILE.unlink(missing_ok=True)
    return None


def serve() -> None:
    lock_fd = acquire_server_lock()
    if lock_fd is None:
        return
    os.chdir(TOOL_DIR)
    try:
        try:
            server = ReusableServer(("127.0.0.1", PREFERRED_PORT), QuietHandler)
        except OSError:
            # 固定端口被其他应用占用时仍允许工具启动，但正常情况下保持来源地址稳定。
            server = ReusableServer(("127.0.0.1", 0), QuietHandler)
        with server:
            port = int(server.server_address[1])
            PORT_FILE.write_text(str(port), encoding="utf-8")
            server.serve_forever()
    finally:
        PORT_FILE.unlink(missing_ok=True)
        os.close(lock_fd)
        LOCK_FILE.unlink(missing_ok=True)


def launch() -> int:
    missing = [path.name for path in REQUIRED_FILES if not path.exists()]
    if missing:
        show_error(f"工具文件不完整：{', '.join(missing)}。请保留整个工具文件夹后再启动。")
        return 1

    current = live_url()
    if current:
        open_url(current)
        return 0

    try:
        popen_options = {
            "cwd": str(TOOL_DIR),
            "stdin": subprocess.DEVNULL,
            "stdout": None,
            "stderr": subprocess.STDOUT,
        }
        if os.name == "nt":
            popen_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        else:
            popen_options["start_new_session"] = True
        with LOG_FILE.open("ab") as log:
            popen_options["stdout"] = log
            subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve()), "--serve"],
                **popen_options,
            )
    except OSError as error:
        show_error(f"无法启动本地服务：{error}")
        return 1

    for _ in range(50):
        time.sleep(0.1)
        current = live_url()
        if current:
            open_url(current)
            return 0

    show_error(f"启动超时。诊断日志：{LOG_FILE}")
    return 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        serve()
    else:
        raise SystemExit(launch())
