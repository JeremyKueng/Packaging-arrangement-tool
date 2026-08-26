#!/usr/bin/env python3
"""模板库共享模块：目录式存储 + 可复用 API Mixin（Python 标准库，零依赖）。

存储形态（用户可直接在资源管理器里查看、复制、归档）：
    模板库/
      midpack/某方案A.json
      pallet/某方案B.json
      ...

- 文件名 = 模板名（同名保存视为更新）；工段 = 子目录名。
- 模板 id = "<section>/<文件名主干>"，对前端不透明。
- 首次访问时自动迁移旧版单文件存储 server/templates.json（若存在）。

API 逻辑封装在 TemplateApiMixin 中，由 launcher.py 的常驻静态服务混入——
双击「启动中包排列工具」打开的页面即与模板接口同源，无需运行任何额外进程。
本文件的 __main__ 入口仅用于团队局域网共享（可选，默认端口 8090）。

载荷契约 = 工具内「复制参数 JSON」的输出结构：
    GET    /api/templates          模板列表（不含 payload）
    GET    /api/templates/{id}     单条详情（含 payload）
    POST   /api/templates          新增/同名更新 {"name","section","payload"}
    DELETE /api/templates/{id}     删除

section 取值：unit / midpack / bigpack / case / pallet。
"""
import json
import re
import sys
import threading
import urllib.parse
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORE_DIR = ROOT / "模板库"
LEGACY_STORE = Path(__file__).resolve().parent / "templates.json"
VALID_SECTIONS = {"unit", "midpack", "bigpack", "case", "pallet"}
_LOCK = threading.Lock()

_MIGRATED = False


def _safe_name(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]', "_", str(name)).strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned or "未命名")[:60]


def _migrate_legacy() -> None:
    """旧版单文件 templates.json → 目录式存储；只执行一次。"""
    global _MIGRATED
    if _MIGRATED or not LEGACY_STORE.exists():
        _MIGRATED = True
        return
    try:
        items = json.loads(LEGACY_STORE.read_text(encoding="utf-8"))
        if isinstance(items, list):
            for item in items:
                _write_file(item.get("section"), item.get("name"), item)
    except Exception:
        pass  # 迁移失败不影响新存储的使用
    LEGACY_STORE.rename(LEGACY_STORE.with_suffix(".json.migrated"))
    _MIGRATED = True


def _write_file(section, name, data) -> str:
    stem = _safe_name(name)
    target = STORE_DIR / str(section)
    target.mkdir(parents=True, exist_ok=True)
    path = target / f"{stem}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return f"{section}/{stem}"


def _load_all():
    _migrate_legacy()
    items = []
    if STORE_DIR.exists():
        for path in sorted(STORE_DIR.glob("*/*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    items.append(data)
            except Exception:
                continue
    items.sort(key=lambda i: i.get("savedAt") or "", reverse=True)
    return items


class TemplateApiMixin:
    """模板 CRUD 请求处理；宿主 Handler 必须是 SimpleHTTPRequestHandler 子类。

    try_handle_api() 命中 /api/templates* 时写出响应并返回 True，
    未命中返回 False 交回静态文件流程。
    """

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # 允许工具页面以任意方式打开（file:// / 其他端口静态服务）时跨域访问本 API。
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _handle_list(self):
        with _LOCK:
            items = _load_all()
        summary = [{k: i.get(k) for k in ("id", "section", "name", "capturedAt", "algorithmVersion")} for i in items]
        self._json(200, summary)

    def _handle_create(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception as exc:
            self._json(400, {"error": f"bad json: {exc}"})
            return
        name = str(data.get("name") or "").strip()
        section = data.get("section")
        payload = data.get("payload")
        if section not in VALID_SECTIONS or not name or not isinstance(payload, dict):
            self._json(400, {"error": "需要 name(str)、section(unit/midpack/bigpack/case/pallet)、payload(dict)"})
            return
        now = datetime.now(timezone.utc).isoformat()
        item = {
            "id": "",
            "section": section,
            "name": name,
            "capturedAt": payload.get("capturedAt") or now,
            "algorithmVersion": payload.get("algorithmVersion"),
            "savedAt": now,
            "payload": payload,
        }
        with _LOCK:
            template_id = _write_file(section, name, item)
        item["id"] = template_id
        # 回写真实 id，保证目录内文件自描述
        stem = template_id.split("/", 1)[1]
        (STORE_DIR / str(section) / f"{stem}.json").write_text(
            json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self._json(200, {"id": template_id})

    def _handle_detail(self, raw_id):
        template_id = urllib.parse.unquote(raw_id)
        with _LOCK:
            item = next((i for i in _load_all() if i.get("id") == template_id), None)
        if item is None:
            self._json(404, {"error": "template not found"})
        else:
            self._json(200, item)

    def _handle_delete(self, raw_id):
        template_id = urllib.parse.unquote(raw_id)
        parts = template_id.split("/", 1)
        if len(parts) != 2 or parts[0] not in VALID_SECTIONS:
            self._json(404, {"error": "template not found"})
            return
        path = STORE_DIR / parts[0] / f"{_safe_name(parts[1])}.json"
        with _LOCK:
            if not path.exists():
                self._json(404, {"error": "template not found"})
                return
            path.unlink()
        self._json(200, {"ok": True})

    def try_handle_api(self) -> bool:
        """处理 /api/templates* 请求；命中返回 True（响应已写出）。"""
        path = self.path
        if self.command == "OPTIONS":
            if path.startswith("/api/templates"):
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return True
            return False
        match = re.fullmatch(r"/api/templates/(.+)", path)
        if match:
            raw_id = match.group(1)
            if self.command == "GET":
                self._handle_detail(raw_id)
            elif self.command == "DELETE":
                self._handle_delete(raw_id)
            else:
                self._json(405, {"error": "method not allowed"})
            return True
        if path.rstrip("/") == "/api/templates":
            if self.command == "GET":
                self._handle_list()
            elif self.command == "POST":
                self._handle_create()
            else:
                self._json(405, {"error": "method not allowed"})
            return True
        return False


class TemplateHandler(TemplateApiMixin, SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.try_handle_api():
            return
        super().do_GET()

    def do_POST(self):
        if self.try_handle_api():
            return
        self._json(404, {"error": "not found"})

    def do_DELETE(self):
        if self.try_handle_api():
            return
        self._json(404, {"error": "not found"})

    def do_OPTIONS(self):
        if self.try_handle_api():
            return
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):  # 安静模式：不刷屏
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    print(f"模板库共享服务（局域网可选）: http://127.0.0.1:{port}/  (存储: {STORE_DIR})")
    print("Ctrl+C 停止")
    ThreadingHTTPServer(("127.0.0.1", port), TemplateHandler).serve_forever()
