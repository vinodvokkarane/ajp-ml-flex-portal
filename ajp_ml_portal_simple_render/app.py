"""AJP ML Portal - zero-dependency Render deploy.

This version uses only the Python standard library. It intentionally avoids
scikit-learn, scipy, numpy, pandas, Flask, and gunicorn so Render has no heavy
packages to build.

Start command: python app.py
"""

from __future__ import annotations

import html
import json
import os
import re
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

APP_NAME = "AJP ML Portal"
MODEL_MODE = os.environ.get("MODEL_MODE", "simple-placeholder")


def to_float(value: Any, default: float = 0.0) -> float:
    """Convert input to float without raising an exception."""
    if isinstance(value, list):
        value = value[0] if value else default
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def simple_score(text: str, metric_1: float, metric_2: float) -> dict[str, Any]:
    """A tiny placeholder scoring function with no ML dependencies.

    Replace this function later with the real model call after your Render
    deployment is stable.
    """
    cleaned = text.strip()
    word_count = len(re.findall(r"\b\w+\b", cleaned))
    score = max(0.0, min(100.0, (word_count * 3.0) + (metric_1 * 0.6) + (metric_2 * 0.4)))

    if score >= 70:
        label = "High"
        recommendation = "Prioritize this item for review."
    elif score >= 35:
        label = "Medium"
        recommendation = "Review when capacity is available."
    else:
        label = "Low"
        recommendation = "No urgent action needed."

    return {
        "label": label,
        "score": round(score, 2),
        "word_count": word_count,
        "recommendation": recommendation,
        "model_mode": MODEL_MODE,
    }


def page(result: dict[str, Any] | None = None, input_text: str = "", metric_1: Any = "", metric_2: Any = "") -> bytes:
    """Render the HTML page."""
    safe_text = html.escape(str(input_text))
    safe_metric_1 = html.escape(str(metric_1))
    safe_metric_2 = html.escape(str(metric_2))

    result_html = ""
    if result:
        result_html = f"""
        <section class=\"result\" aria-live=\"polite\">
          <h2>Result</h2>
          <dl>
            <div><dt>Label</dt><dd>{html.escape(str(result['label']))}</dd></div>
            <div><dt>Score</dt><dd>{html.escape(str(result['score']))}</dd></div>
            <div><dt>Word count</dt><dd>{html.escape(str(result['word_count']))}</dd></div>
            <div><dt>Recommendation</dt><dd>{html.escape(str(result['recommendation']))}</dd></div>
          </dl>
        </section>
        """

    html_doc = f"""<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>{APP_NAME} - Simple</title>
    <style>
      * {{ box-sizing: border-box; }}
      body {{ margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f7fb; color: #172033; }}
      .page {{ min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; }}
      .card {{ width: min(760px, 100%); background: #fff; border: 1px solid #dbe3ef; border-radius: 24px; box-shadow: 0 24px 60px rgba(22,32,51,.08); padding: 32px; }}
      .eyebrow {{ margin: 0 0 8px; color: #3157a4; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: .75rem; }}
      h1 {{ margin: 0; font-size: clamp(2rem, 5vw, 3.25rem); line-height: 1; }}
      .lede {{ color: #516073; line-height: 1.6; margin: 16px 0 28px; }}
      .form {{ display: grid; gap: 14px; }}
      label {{ font-weight: 700; }}
      textarea, input {{ width: 100%; margin-top: 6px; border: 1px solid #c8d3e3; border-radius: 14px; padding: 12px 14px; font: inherit; }}
      textarea:focus, input:focus {{ outline: 3px solid rgba(49,87,164,.16); border-color: #3157a4; }}
      .grid {{ display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; }}
      button {{ justify-self: start; border: none; border-radius: 999px; background: #3157a4; color: white; padding: 12px 20px; font-weight: 800; cursor: pointer; }}
      button:hover {{ filter: brightness(.95); }}
      .result {{ margin-top: 24px; border-radius: 18px; background: #f6f8fc; padding: 20px; }}
      .result h2 {{ margin-top: 0; }}
      dl {{ display: grid; gap: 10px; margin: 0; }}
      dl div {{ display: grid; grid-template-columns: 160px 1fr; gap: 12px; }}
      dt {{ font-weight: 800; }} dd {{ margin: 0; }}
      .small {{ margin: 24px 0 0; color: #687789; font-size: .92rem; }}
      code {{ background: #eef2f8; border-radius: 6px; padding: 2px 6px; }}
      @media (max-width: 640px) {{ .card {{ padding: 24px; }} .grid, dl div {{ grid-template-columns: 1fr; }} }}
    </style>
  </head>
  <body>
    <main class=\"page\">
      <section class=\"card\">
        <p class=\"eyebrow\">Render-ready zero-dependency version</p>
        <h1>{APP_NAME}</h1>
        <p class=\"lede\">
          This build uses Python's standard library only. It avoids scikit-learn,
          SciPy, NumPy, pandas, Flask, and Gunicorn so Render has no heavy packages
          to compile.
        </p>
        <form method=\"post\" action=\"/predict\" class=\"form\">
          <label for=\"input_text\">Input text</label>
          <textarea id=\"input_text\" name=\"input_text\" rows=\"5\" placeholder=\"Enter notes, request details, or case text...\">{safe_text}</textarea>
          <div class=\"grid\">
            <div>
              <label for=\"metric_1\">Metric 1</label>
              <input id=\"metric_1\" name=\"metric_1\" type=\"number\" step=\"0.01\" value=\"{safe_metric_1}\" placeholder=\"0\" />
            </div>
            <div>
              <label for=\"metric_2\">Metric 2</label>
              <input id=\"metric_2\" name=\"metric_2\" type=\"number\" step=\"0.01\" value=\"{safe_metric_2}\" placeholder=\"0\" />
            </div>
          </div>
          <button type=\"submit\">Generate result</button>
        </form>
        {result_html}
        <p class=\"small\">API check: <code>GET /healthz</code>. JSON prediction: <code>POST /predict</code>.</p>
      </section>
    </main>
  </body>
</html>"""
    return html_doc.encode("utf-8")


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "AJPMLPortalSimple/1.0"

    def send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8")

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self.send_bytes(HTTPStatus.OK, page(), "text/html; charset=utf-8")
            return
        if path == "/healthz":
            self.send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "service": "ajp-ml-portal-simple",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "path": path})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/predict":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "path": path})
            return

        content_length = int(self.headers.get("Content-Length", "0") or 0)
        raw_body = self.rfile.read(content_length).decode("utf-8")
        content_type = self.headers.get("Content-Type", "")

        if "application/json" in content_type:
            try:
                payload = json.loads(raw_body or "{}")
            except json.JSONDecodeError:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
                return
        else:
            payload = parse_qs(raw_body)

        text_value = payload.get("input_text", "")
        if isinstance(text_value, list):
            text = text_value[0] if text_value else ""
        else:
            text = str(text_value)

        metric_1 = to_float(payload.get("metric_1"), 0.0)
        metric_2 = to_float(payload.get("metric_2"), 0.0)
        result = simple_score(text, metric_1, metric_2)

        if "application/json" in content_type:
            self.send_json(HTTPStatus.OK, result)
        else:
            self.send_bytes(HTTPStatus.OK, page(result, text, metric_1, metric_2), "text/html; charset=utf-8")


def main() -> None:
    port = int(os.environ.get("PORT", "10000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), RequestHandler)
    print(f"{APP_NAME} running on port {port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
