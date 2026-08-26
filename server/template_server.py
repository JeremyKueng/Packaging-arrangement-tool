#!/usr/bin/env python3
"""模板库落地点：零依赖单文件服务（Python 标准库，无第三方包）。

同时承担两件事：
- 静态托管仓库根目录（与 `python -m http.server` 一致），工具页面从本服务打开
  时与 /api 同源，前端无需配置跨域；
- 模板 CRUD：存储为与本文件同目录的 templates.json（用户数据，已被 .gitignore 排除）。

启动：
    python server/template_server.py [端口]     # 默认 8090
然后浏览器访问 http://127.0.0.1:8090/

API（载荷契约 = 工具内「复制参数 JSON」的输出结构）：
    GET    /api/templates          模板列表（不含 payload）
    GET    /api/templates/{id}     单条详情（含 payload）
    POST   /api/templates          新增 {"name","section","payload"}
    DELETE /api/templates/{id}     删除

section 取值：unit / midpack / bigpack / case / pallet。
"""
import json
import re
import sys
import threading
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORE = Path(__file__).resolve().parent / "templates.json"
VALID_SECTIONS = {"unit", "midpack", "bigpack", "case", "pallet"}
_LOCK = threading.Lock()


def _load():
    if STORE.exists():
        try:
            data = json.loads(STORE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
        except Exception:
            pass
    return []


def _save(items):
    STORE.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


class TemplateHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

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

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/templates":
            with _LOCK:
                items = _load()
            summary = [{k: i.get(k) for k in ("id", "section", "name", "capturedAt", "algorithmVersion")} for i in items]
            self._json(200, summary)
            return
        match = re.fullmatch(r"/api/templates/([^/]+)", self.path)
        if match:
            with _LOCK:
                item = next((i for i in _load() if i["id"] == match.group(1)), None)
            if item is None:
                self._json(404, {"error": "template not found"})
            else:
                self._json(200, item)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/templates":
            self._json(404, {"error": "not found"})
            return
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
            "id": f"tpl_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
            "section": section,
            "name": name,
            "capturedAt": payload.get("capturedAt") or now,
            "algorithmVersion": payload.get("algorithmVersion"),
            "savedAt": now,
            "payload": payload,
        }
        with _LOCK:
            items = _load()
            items.insert(0, item)
            _save(items)
        self._json(200, {"id": item["id"]})

    def do_DELETE(self):
        match = re.fullmatch(r"/api/templates/([^/]+)", self.path)
        if not match:
            self._json(404, {"error": "not found"})
            return
        template_id = match.group(1)
        with _LOCK:
            items = _load()
            rest = [i for i in items if i["id"] != template_id]
            if len(rest) == len(items):
                self._json(404, {"error": "template not found"})
                return
            _save(rest)
        self._json(200, {"ok": True})

    def log_message(self, fmt, *args):  # 安静模式：不刷屏
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    print(f"模板库服务: http://127.0.0.1:{port}/  (存储: {STORE})")
    print("Ctrl+C 停止")
    ThreadingHTTPServer(("127.0.0.1", port), TemplateHandler).serve_forever()
