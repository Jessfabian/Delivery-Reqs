import base64
import json
import re
import tempfile
import threading
import webbrowser
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"
DEFAULT_CONFIG = {
    "host": "127.0.0.1",
    "port": 5055,
    "shared_mailbox": "MassMutual MMSD Underwriting & New Business Case Updates",
    "allow_send": False,
    "open_browser": True,
}
EMAIL_RE = re.compile(r"^[^@\s;,<>]+@[^@\s;,<>]+\.[A-Za-z]{2,}$")
CID_PROP = "http://schemas.microsoft.com/mapi/proptag/0x3712001F"
STATIC = {"index.html", "styles.css", "app.js", "pdfbuilder.js", "templates.js", "assets.js"}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    else:
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


CONFIG = load_config()
app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024


def split_list(v):
    if isinstance(v, list):
        parts = v
    else:
        parts = re.split(r"[;,]", str(v or ""))
    return [p.strip() for p in parts if p and p.strip()]


def validate_payload(data):
    if not isinstance(data, dict):
        abort(400, "JSON body required")
    to = split_list(data.get("to"))
    cc = split_list(data.get("cc"))
    bcc = split_list(data.get("bcc"))
    if not to:
        abort(400, "At least one To recipient is required")
    bad = [a for a in to + cc + bcc if not EMAIL_RE.match(a)]
    if bad:
        abort(400, "Invalid email address: " + ", ".join(bad))
    subject = str(data.get("subject") or "").strip()
    html = str(data.get("html") or "")
    if not subject:
        abort(400, "Subject is required")
    if not html:
        abort(400, "HTML body is required")
    if len(html) > 700_000:
        abort(400, "HTML body is too large")
    attachments = []
    for a in data.get("attachments") or []:
        name = Path(str(a.get("name") or "attachment.bin")).name
        name = re.sub(r'[<>:"/\\|?*]', "_", name)[:180]
        try:
            content = base64.b64decode(str(a.get("content_base64") or ""), validate=True)
        except Exception:
            abort(400, f"Attachment {name} is not valid base64")
        attachments.append(
            {
                "name": name,
                "content": content,
                "content_id": re.sub(r"[^A-Za-z0-9._@-]", "", str(a.get("content_id") or "")),
            }
        )
    return {
        "to": "; ".join(to),
        "cc": "; ".join(cc),
        "bcc": "; ".join(bcc),
        "subject": subject,
        "html": html,
        "attachments": attachments,
    }


def create_outlook_message(payload, mode):
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        msg = outlook.CreateItem(0)
        msg.SentOnBehalfOfName = CONFIG["shared_mailbox"]
        msg.To = payload["to"]
        msg.CC = payload["cc"]
        msg.BCC = payload["bcc"]
        msg.Subject = payload["subject"]
        with tempfile.TemporaryDirectory() as td:
            for att in payload["attachments"]:
                p = Path(td) / att["name"]
                p.write_bytes(att["content"])
                added = msg.Attachments.Add(str(p))
                if att["content_id"]:
                    added.PropertyAccessor.SetProperty(CID_PROP, att["content_id"])
            msg.HTMLBody = payload["html"]
            if mode == "send":
                msg.Send()
            else:
                msg.Display(False)
    finally:
        pythoncom.CoUninitialize()


@app.get("/")
def index():
    return send_from_directory(APP_DIR, "index.html")


@app.get("/<path:path>")
def files(path):
    if path in STATIC or path.startswith("lib/"):
        return send_from_directory(APP_DIR, path)
    abort(404)


@app.get("/api/status")
def status():
    return jsonify(
        {
            "ok": True,
            "sharedMailbox": CONFIG["shared_mailbox"],
            "allowSend": bool(CONFIG.get("allow_send")),
        }
    )


@app.post("/api/outlook")
def outlook():
    body = request.get_json(force=True, silent=True) or {}
    mode = str(body.get("mode") or "draft").lower()
    if mode not in ("draft", "send"):
        abort(400, "mode must be draft or send")
    if mode == "send" and not CONFIG.get("allow_send"):
        abort(403, "Sending is disabled in config.json (allow_send=false)")
    payload = validate_payload(body)
    try:
        create_outlook_message(payload, mode)
    except Exception as ex:
        return jsonify({"ok": False, "error": f"Outlook failed: {ex}"}), 500
    return jsonify({"ok": True, "mode": mode})


@app.errorhandler(400)
@app.errorhandler(403)
def bad_request(ex):
    return jsonify({"ok": False, "error": ex.description}), ex.code


if __name__ == "__main__":
    url = f"http://{CONFIG['host']}:{CONFIG['port']}/"
    if CONFIG.get("open_browser"):
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    print(f"Delivery Requirements App running at {url}")
    app.run(host=CONFIG["host"], port=int(CONFIG["port"]), debug=False)

