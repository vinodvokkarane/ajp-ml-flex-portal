# AJP ML Portal - Simple Render Deploy

This is a zero-dependency Python version of the portal designed to deploy on
Render without compiling scientific Python packages.

It intentionally does **not** install:

- scikit-learn
- scipy
- numpy
- pandas
- Flask
- gunicorn

The `/predict` route uses a deterministic placeholder scoring function. After
Render deployment is working, replace `simple_score()` in `app.py` with your real
model logic or add a separate API integration.

## Local run on Windows

```powershell
cd /d D:\FlexTech\ML-Flex\ajp-ml-portal
python app.py
```

Open `http://127.0.0.1:10000`.

## Render settings

Build Command:

```bash
true
```

Start Command:

```bash
python app.py
```

Environment variables:

```text
PYTHON_VERSION=3.11.11
MODEL_MODE=simple-placeholder
```

## API examples

Health check:

```bash
curl https://YOUR-RENDER-URL.onrender.com/healthz
```

JSON prediction:

```bash
curl -X POST https://YOUR-RENDER-URL.onrender.com/predict \
  -H "Content-Type: application/json" \
  -d '{"input_text":"sample case details", "metric_1":25, "metric_2":10}'
```
