# Real-photo labels

Add consented device photos here. Keep the header in `labels.csv` exactly:

```csv
file,model,storage,battery_health,screen_cracked,back_cracked
```

One row represents one device case. `file` can be a single image, a subdirectory containing the four required views, or pipe-separated image paths. For example, place `front.jpg`, `back.jpg`, `battery.jpg`, and `about.jpg` in `case001/`, then add:

```csv
case001/,iPhone 13,128,79,true,false
```

Use canonical catalog model names, storage in GB, integer battery health, and `true`/`false` crack labels. Read labels manually from the actual device/photos; do not derive ground truth from model predictions. The four views should show screen, back, Settings > Battery > Battery Health and Settings > General > About. A single incomplete view may correctly trigger a retake or unknown prediction.

The file starts with the header only. Empty input reports N/A rather than fabricated accuracy and needs no OpenAI key. After labeling and configuring the key, run from the repository root:

```bash
backend/.venv/bin/python backend/evals/vision_eval.py --max-cost-usd 5
```

Outputs are `../output/vision_results.json` and `../output/vision_results.md`. Unknown predictions count as incorrect for per-field accuracy and are a separate cell in the crack confusion tables. Errors/skipped cases are reported separately from completed predictions.
