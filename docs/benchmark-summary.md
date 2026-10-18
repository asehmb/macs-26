# Benchmark Summary

Only measured values go here. No results have been recorded on real devices yet.

## Methodology

- Tracking mode: printed sheet. The reference-marker error, detection, and verification metrics need it; in a room, tap **Use printed sheet** on the presenter before starting.
- Task: the same physical task in both conditions (e.g. place the part in the printed zone, then follow the demo steps).
- Conditions, set with the Guided / Baseline toggle in the Bench panel:
  - Baseline: video and voice only; annotations are hidden.
  - Guided: anchored annotations, steps, and verification.
- At least 3 trials per condition, alternating order.
- Record device models, browsers, lighting, and network in the trial metadata fields.

## Metrics (collected automatically by the Bench panel)

| Column | Meaning |
| --- | --- |
| `task_seconds` | timer from Start task to Save trial |
| `clarifications` | manual counter of "where exactly?" style questions |
| `tracking_fps`, `detect_ms` | detection rate and mean detection time on the recording device |
| `lost_frame_percent` | share of processed frames with status "lost" |
| `tracking_error_*_px`, `tracking_error_*_mm` | reference marker (ID 20): predicted vs detected corners, mean and p95 |
| `sync_latency_median_ms` | annotation created on one device → received on the other, using server clock offset |
| `verification_ratio` | share of the zone matching the part colour at save time |

## Results

Export from `/bench` and paste the rows into `data/raw-results.csv`. Report medians and ranges per condition, and include failed or outlier trials with a note.

## Development checks (not user trials)

`npm test` renders the target under known poses and checks the projected test-dot error. These are synthetic images, not camera footage, and are not benchmark results.
