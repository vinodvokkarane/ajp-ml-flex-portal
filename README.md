# BOND-AI Reliability Digital Twin Portal

BOND-AI is a FastAPI web app for a standardized 500C-capable alumina coupon that combines Zone A interface test structures and Zone B bonding test structures on one substrate. The app generates a large synthetic reliability dataset, trains tree-based surrogate models, and serves an operator-facing Digital Twin that links printed-interface degradation to bond-joint reliability.

The proposal document is not committed. This repository encodes the derived public-facing methodology: coupon structures, inks, representative stress conditions, characterization outputs, reliability targets, and feedback-loop behavior.

## Coupon Platform

- Substrate: single 500C-capable alumina coupon.
- Inks: baseline Ag-NP ink and ANI 500C conductive ink.
- Zone A interface structures: straight lines, meander lines, square pads, and overlap pads.
- Zone B bonding structures: daisy-chain Kelvin structures, dummy die/chip attach sites, and shear test pads.
- Characterization: 4-point probe, Kelvin, I-V, thermal aging, thermal cycling, bending/strain, shear/pull, X-ray/CT, optical microscopy, SEM/EDS, and FIB.
- Representative conditions: 150C, 250C, 350C, and 500C aging; -40C to 125C and room-temperature to 500C cycling; static and cyclic strain; in-situ electrical monitoring.

## What It Demonstrates

- Synthetic data generator for process settings, coupon geometry, thermal/cycling/mechanical exposure, CT voiding, oxidation, roughness, alignment, drift, delamination, adhesion, and shear.
- Process characterization model for line width, thickness, resistance, quality, and process anomaly probability.
- Blind CPW validation surrogate on the same alumina material/process family.
- Coupon reliability model for sheet/contact drift, crack probability, delamination, adhesion strength, void fraction, post-aging shear strength, reliability score, and failure mode.
- BOND-AI decision layer with PASS, MARGINAL, or DEFER_TO_INSPECTION output, failure-mechanism ranking, degradation-state index, confidence, and remaining-useful-life estimate.
- Digital Twin feedback loop that ranks better process/cure recipes and recommends high-information next coupon tests for active learning.

## Local Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python scripts/train_models.py --pattern-samples 80000 --interface-samples 40000 --coupon-samples 120000
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>.

## Hugging Face Spaces Deployment

For the full ML-enabled `main` branch, use a Hugging Face Space with Docker.

- Space SDK: Docker
- Hardware: CPU basic
- App port: 7860
- Branch: main

The Dockerfile pins Python to `3.11-slim`, forces binary wheels for scientific packages, installs `requirements.txt`, and starts:

```bash
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860} --proxy-headers --forwarded-allow-ips='*'
```

No training step is required during deploy when `model_artifacts/model_bundle.joblib` is committed.

## Render Note

Render can still serve this repository when it uses Python 3.11 and binary wheels, but the free build path is slower and more fragile for SciPy/scikit-learn stacks. Hugging Face Spaces with Docker remains the preferred free deployment target for the main branch.

## Data Notes

The default training run generates 240,000 synthetic rows: 80,000 print-characterization rows, 40,000 blind CPW validation rows, and 120,000 integrated-coupon rows. The committed `data/synthetic_preview.json`, `data/synthetic_summary.json`, and `model_artifacts/metrics.json` document the generated distributions, target ranges, model benchmarks, and Digital Twin reliability metrics.

To recreate the full local parquet datasets:

```powershell
python scripts/train_models.py --write-full-data
```

Full parquet files are ignored by git to keep the deployable repository lightweight.
