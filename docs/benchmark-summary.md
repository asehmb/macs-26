# Benchmark Summary

Use this file to record real measurements from live trials. Do not fill with estimated values.

## Methodology

- Task: same physical assembly task for both conditions.
- Conditions:
  - Baseline: video + verbal only
  - RealityCheck: anchored annotations enabled
- Minimum trials: 3 per condition.
- Record per trial:
  - device models and OS versions
  - browser versions
  - lighting notes
  - target print quality
  - network type

## Metrics

- Task completion time (seconds)
- Clarification count (integer)
- Tracking error (px, mean and p95)
- Tracking lost-frame percentage
- Annotation latency (ms)
- Verification success ratio (if P1 verification used)

## Raw results

Populate `data/raw-results.csv` directly during testing.

## Reporting notes

- Report medians and ranges.
- Include failures and outliers; do not exclude silently.
- Note any thermal throttling or camera autofocus issues.
