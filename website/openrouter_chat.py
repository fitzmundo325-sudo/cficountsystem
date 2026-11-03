import json
import os

import requests
from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context

chat_bp = Blueprint("openrouter_chat", __name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_MESSAGES = 40


def _cfg(key, default=None):
    return current_app.config.get(key) or os.getenv(key) or default


def _sse(payload):
    return f"data: {json.dumps(payload)}\n\n"


def _clean_messages(messages):
    cleaned = []
    for m in messages[-MAX_MESSAGES:]:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = m.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            cleaned.append({"role": role, "content": content})
    return cleaned


@chat_bp.route("/chat", methods=["POST"])
def chat():
    api_key = _cfg("OPENROUTER_API_KEY")
    if not api_key:
        return jsonify(error="OPENROUTER_API_KEY is not set"), 500

    data = request.get_json(silent=True) or {}
    messages = _clean_messages(data.get("messages") or [])
    if not messages:
        return jsonify(error="messages must be a non-empty list"), 400

    system_prompt = data.get("system") if current_app.config.get("OPENROUTER_ALLOW_CLIENT_SYSTEM") else None
    system_prompt = system_prompt or _cfg("OPENROUTER_SYSTEM_PROMPT", "You are a helpful assistant.")

    body = {
        "model": data.get("model") or _cfg("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
        "messages": [{"role": "system", "content": system_prompt}] + messages,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": _cfg("OPENROUTER_APP_URL", request.host_url.rstrip("/")),
        "X-Title": _cfg("OPENROUTER_APP_NAME", "Flask Chat Gateway"),
    }

    def generate():
        upstream = None
        try:
            upstream = requests.post(
                OPENROUTER_URL,
                headers=headers,
                json=body,
                stream=True,
                timeout=(10, 120),
            )
            upstream.encoding = "utf-8"

            if upstream.status_code != 200:
                try:
                    message = upstream.json().get("error", {}).get("message")
                except ValueError:
                    message = None
                yield _sse({"error": message or f"Upstream error {upstream.status_code}"})
                return

            for line in upstream.iter_lines(decode_unicode=True):
                if not line or line.startswith(":") or not line.startswith("data:"):
                    continue

                chunk = line[5:].strip()
                if chunk == "[DONE]":
                    break

                try:
                    parsed = json.loads(chunk)
                except ValueError:
                    continue

                if "error" in parsed:
                    err = parsed["error"]
                    message = err.get("message") if isinstance(err, dict) else str(err)
                    yield _sse({"error": message or "Upstream error"})
                    return

                choices = parsed.get("choices") or []
                if not choices:
                    continue

                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    yield _sse({"delta": delta})

            yield _sse({"done": True})
        except requests.RequestException as e:
            yield _sse({"error": f"Connection problem: {e}"})
        finally:
            if upstream is not None:
                upstream.close()

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
