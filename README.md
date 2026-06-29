# BOND-AI Reliability Digital Twin Portal

BOND-AI is a physics-of-failure digital twin with machine-learning prognostics for high-temperature printed interfaces and bond joints. This FastAPI web app is the reviewer-accessible reference implementation of the methodology proposed under **SEMI FlexTech 2026 - Topic B: Advanced Bonding Reliability** (UMass Lowell / Raytheon-UMass Lowell Research Institute). It is built around a single 500C-capable alumina coupon that co-locates Zone A interface test structures with Zone B bonding test structures, generates a large synthetic reliability dataset, trains surrogate models, and serves an operator-facing Digital Twin that links printed-interface degradation to bond-joint reliability.

The working hypothesis: measurable degradation of printed interfaces is an earlier and more sensitive predictor of bond-joint reliability than bond testing alone.

> **Synthetic demonstrator.** All current outputs are illustrative. The five models are trained on 240,000 synthetic rows to demonstrate the data-fusion, conformal-uncertainty, and decision pipeline - not the measured reliability of any specific material. Under the project (Tasks T1-T6) the synthetic training data are replaced with measured coupon data, the q90 bands are re-derived from conformal calibration on observed high-temperature failures, and the decision states are validated against SEM/cross-section ground truth.

The proposal document is not committed. This repository encodes the derived public-facing methodology: coupon structures, inks, representative stress conditions, characterization outputs, reliability targets, and feedback-loop behavior.

## Five linked views

| View | Stage |
| --- | --- |
| **Coupon** | Integrated Zone A + Zone B coupon reliability under accelerated aging |
| **Digital Twin** | Closes the process-to-reliability feedback loop and ranks better recipes |
| **Characterize** | Printed-trace geometry, resistance, and quality with a process-anomaly breakdown |
| **CPW Verify** | Blind validation on a held-out X-band coplanar waveguide (Figure 5) |
| **Active Learn** | Uncertainty-guided ranking of the next coupons and aging conditions |

## Coupon Platform

- Substrate: single 500C-capable alumina coupon.
- Inks: baseline Ag-NP ink and ANI 500C conductive ink.
- Zone A interface structures: straight lines, meander lines, square pads, and overlap pads.
- Zone B bonding structures: daisy-chain Kelvin structures, dummy die/chip attach sites, and shear test pads.
- Characterization: 4-point probe, Kelvin, I-V, thermal aging, thermal cycling, bending/strain, shear/pull, X-ray/CT, optical microscopy, SEM/EDS, and FIB.
- Temperature regimes: **Regime I (25-180C)** ages both inks for a common baseline and digital-twin calibration; **Regime II (250-500C)** ages the ANI 500C ink only for high-temperature degradation, failure mechanisms, and RUL.
- Blind validation: a held-out X-band CPW (Figure 5) built on the same materials but excluded from model development.

## End-of-project performance targets

These are the proposal targets surfaced in the portal's methodology section (objectives contingent on relevant-environment validation, not demonstrated results):

- Remaining-useful-life prediction (held-out coupons): MAPE <= 20%
- Failure-mode classification: Top-1 >= 75%, Top-3 >= 90%
- Electrical degradation tracking (dR/R0): prediction error <= 15%
- Active-learning efficiency: >= 25-30% fewer coupons
- Measurement repeatability (Gage R&R): <= 10%
- Technology / Manufacturing Readiness Level: TRL 4 / MRL 4 -> TRL 5 / MRL 5

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
