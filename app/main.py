from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from mlflex.modeling import load_bundle, optimize_process, predict_interface, predict_pattern
from mlflex.synthetic import default_interface_payload, default_pattern_payload, metadata

ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "static"
ARTIFACT_DIR = ROOT / "model_artifacts"


class Payload(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


app = FastAPI(
    title="ML-Flex AJP Process Intelligence Portal",
    version="0.1.0",
    description="Synthetic ML demonstration for aerosol jet printed pattern and RF interface modeling.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_bundle: dict[str, Any] | None = None


def bundle() -> dict[str, Any]:
    global _bundle
    if _bundle is None:
        artifact = ARTIFACT_DIR / "model_bundle.joblib"
        if not artifact.exists():
            raise HTTPException(
                status_code=503,
                detail="Model artifacts are missing. Run `python scripts/train_models.py` before starting the app.",
            )
        _bundle = load_bundle(ARTIFACT_DIR)
    return _bundle


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, Any]:
    artifact = ARTIFACT_DIR / "model_bundle.joblib"
    return {"ok": artifact.exists(), "artifact": str(artifact.name)}


@app.get("/api/metadata")
def api_metadata() -> dict[str, Any]:
    data = metadata()
    data["defaults"] = {
        "pattern": default_pattern_payload(),
        "interface": default_interface_payload(),
    }
    try:
        data["metrics"] = bundle()["metrics"]
    except HTTPException:
        data["metrics"] = None
    data["research_sources"] = [
        {
            "label": "Rurup & Secor 2023, closed-loop AJP deposition-rate control",
            "url": "https://www.osti.gov/biblio/1968643",
        },
        {
            "label": "Zhang et al. 2024, data-driven AJP droplet abnormality identification",
            "url": "https://www.tandfonline.com/doi/full/10.1080/17452759.2024.2429530",
        },
        {
            "label": "TabPFN 2025, tabular foundation model",
            "url": "https://www.nature.com/articles/s41586-024-08328-6",
        },
        {
            "label": "SAM 2 2024, promptable image/video segmentation",
            "url": "https://arxiv.org/abs/2408.00714",
        },
        {
            "label": "DINOv2 2024 revision, self-supervised vision features",
            "url": "https://arxiv.org/abs/2304.07193",
        },
        {
            "label": "Temporal Fusion Transformer, interpretable time-series fusion",
            "url": "https://arxiv.org/abs/1912.09363",
        },
        {
            "label": "Conformalized Quantile Regression, finite-sample prediction intervals",
            "url": "https://papers.nips.cc/paper/8613-conformalized-quantile-regression",
        },
    ]
    return data


@app.post("/api/predict/pattern")
def api_predict_pattern(payload: Payload) -> dict[str, Any]:
    return predict_pattern(bundle(), payload.values)


@app.post("/api/predict/interface")
def api_predict_interface(payload: Payload) -> dict[str, Any]:
    return predict_interface(bundle(), payload.values)


@app.post("/api/optimize")
def api_optimize(payload: Payload) -> dict[str, Any]:
    count = int(payload.values.pop("candidates", 700))
    return optimize_process(bundle(), payload.values, candidates=max(100, min(2_500, count)))
