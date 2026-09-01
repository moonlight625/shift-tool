# -*- coding: utf-8 -*-
"""改善要望フォームのDiscord Webhookを js/main.js に設定する。

usage: python3 tools/set_webhook.py
WebhookのURL全体を貼り付けてEnter(入力は画面に表示されない)。
base64エンコードして FEEDBACK_WEBHOOK_B64 に書き込むところまで自動でやる。
あとは git commit & push すれば有効になる。
"""
import base64
import getpass
import re
import sys
from pathlib import Path

MAIN_JS = Path(__file__).resolve().parent.parent / "js" / "main.js"

url = getpass.getpass("Webhook URLを貼ってEnter(画面には表示されません): ").strip()
if "webhooks/" not in url:
    sys.exit("エラー: URLに 'webhooks/' が含まれていません。DiscordのWebhook URLを貼ってください。")
part = url.split("webhooks/")[-1].strip("/ ")
if not re.fullmatch(r"\d{15,25}/[A-Za-z0-9_-]{30,}", part):
    sys.exit("エラー: '数字ID/トークン' の形になっていません。URLをコピーし直してください。")

b64 = base64.b64encode(part.encode()).decode()
src = MAIN_JS.read_text(encoding="utf-8")
new, n = re.subn(
    r'var FEEDBACK_WEBHOOK_B64 = "[^"]*";',
    'var FEEDBACK_WEBHOOK_B64 = "' + b64 + '";',
    src,
)
if n != 1:
    sys.exit("エラー: js/main.js に FEEDBACK_WEBHOOK_B64 の行が見つかりませんでした。")
MAIN_JS.write_text(new, encoding="utf-8")
print("OK: js/main.js に設定しました。あとは git commit & push で有効になります。")
