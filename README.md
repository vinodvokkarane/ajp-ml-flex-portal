# ML-Flex AJP Process Intelligence Portal

Render-ready demonstration site for machine-learning-assisted aerosol jet printing (AJP) process monitoring. The app trains and serves synthetic models for:

- Basic printed pattern coupons: square pads, dogbones, and meander lines.
- Figure 6 style material stacks: conductive inks on Kapton, FR4, and NEA 121 dielectric stacks.
- RF validation devices: X-band patch antenna and coplanar waveguide (CPW).
- Integrated alumina interface and bonding coupon structures from the supplied figure: Zone A straight lines, meanders, square pads, overlap pads, and Zone B daisy-chain Kelvin, dummy die attach, and shear test pads.

The proposal document is not committed. The implementation encodes only the derived public-facing demo structure: material sets, pattern families, sensor features, defect modes, trace metrics, and RF validation targets.

## What It Demonstrates

- Synthetic data generator with domain randomization for material, process, mist-flow geometry, deposition-rate, and post-print measurements.
- Defect classifier for nominal, overspray, clog, under-deposit, over-deposit, and unstable states.
- Trace regressor for line width, thickness, resistance, and quality score.
- RF interface surrogate for resonance frequency, return loss, insertion loss, impedance, and yield probability.
- Coupon reliability surrogate for sheet/contact resistance drift, crack probability, delamination, adhesion, CT voiding, shear strength, reliability score, and failure mode.
- Empirical conformal residual bands for q90-style prediction intervals.
- Candidate process optimizer that searches feasible process settings and ranks likely high-yield recipes.
- Digital Twin feedback loop that searches nearby coupon process settings and recommends corrective actions for drift, voiding, cracking, delamination, and shear-risk reduction.

## Research Basis

The first deployable version uses robust tree ensembles because this demo is designed for Render, fast startup, and tabular process/sensor features. The research roadmap is captured in the portal and model card:

- Rurup & Secor showed closed-loop deposition-rate control using in-line light scattering for AJP, including long-duration resistance stability: <https://www.osti.gov/biblio/1968643>
- Zhang et al. reported data-driven AJP droplet morphology optimization and real-time abnormality identification: <https://www.tandfonline.com/doi/full/10.1080/17452759.2024.2429530>
- TabPFN motivates a future small-real-dataset upgrade for tabular lab data: <https://www.nature.com/articles/s41586-024-08328-6>
- SAM 2 and DINOv2 motivate future raw camera-frame segmentation and visual embeddings: <https://arxiv.org/abs/2408.00714> and <https://arxiv.org/abs/2304.07193>
- Temporal Fusion Transformers motivate high-rate sensor-stream fusion: <https://arxiv.org/abs/1912.09363>
- Conformalized Quantile Regression motivates uncertainty bands suitable for operator-facing decisions: <https://papers.nips.cc/paper/8613-conformalized-quantile-regression>

## Local Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python scripts/train_models.py --pattern-samples 80000 --interface-samples 40000 --coupon-samples 120000
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>.

## Render Deployment

The repo includes `render.yaml` and a `Procfile`.

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

The saved model artifacts in `model_artifacts/` are loaded at startup. Re-run `scripts/train_models.py` after changing the generator or training code.

## Hugging Face Spaces Deployment

For the full ML-enabled `main` branch, use a Hugging Face Space with Docker.

Create the Space with:

- Space SDK: Docker
- Hardware: CPU basic
- Visibility: Public or Private
- App port: 7860
- Branch: main

The repo includes a Spaces-ready `Dockerfile`. It pins Python to `3.11-slim`, forces binary wheels for scientific Python packages, installs `requirements.txt`, and starts the FastAPI app with:

```bash
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860} --proxy-headers --forwarded-allow-ips='*'
```

No training step is required during deploy. The committed `model_artifacts/model_bundle.joblib` is loaded at runtime.

## Data Notes

The training run creates synthetic rows from physics-inspired relationships and domain-randomized process, thermal, mechanical, inspection, and bonding settings. The default run generates 240,000 rows: 80,000 printed-pattern rows, 40,000 RF/interface rows, and 120,000 integrated-coupon rows.

The coupon generator covers:

- Inks: baseline Ag ink and 500C high-temperature ink.
- Substrate: single 500C-capable alumina platform.
- Zone A interface structures: straight lines, meander lines, square pads, and overlap pads.
- Zone B bonding structures: daisy-chain Kelvin structures, dummy die/chip attach sites, and shear test pads.
- Test methods: electrical/Kelvin, thermal aging, thermal cycling, mechanical bending/strain, shear/pull, X-ray/CT, and optical/SEM/EDS/FIB.
- Representative conditions: 150C, 250C, 350C, and 500C aging; -40C to 125C and room-temperature to 500C cycling; static and cyclic strain; in-situ electrical drift monitoring.

The full generated data can be recreated with:

```powershell
python scripts/train_models.py --write-full-data
```

Full parquet files are ignored by git to keep the demo repository lightweight. The committed `data/synthetic_preview.json`, `data/synthetic_summary.json`, and `model_artifacts/metrics.json` document the training distribution, detailed target ranges, model benchmarks, and Digital Twin reliability metrics.
