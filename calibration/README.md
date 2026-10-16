# Calibrating the score

The 35/25/15/15/10 weights are a starting point. They haven't been checked against data yet. This folder lets you check them, and tune them, against reality.

## 1. Collect pairs

Put each resume and job description in `calibration/pairs/`. Any resume you've already sent works.

Then add one row per application to `pairs.csv` (copy `pairs.example.csv`):

| column | what to put |
|---|---|
| `id` | anything unique |
| `resume`, `jd` | paths relative to this folder, e.g. `pairs/acme-resume.pdf`, `pairs/acme-jd.txt` |
| `external_score` | *optional*: the score another checker gave the same pair, e.g. a Jobscan match rate **you ran yourself** |
| `outcome` | *optional*: `1` if you got an interview or passed the screen, `0` if rejected or no reply after ~3 weeks |
| `source` | free text for your own reference |

You need at least one of `external_score` or `outcome` per row.

- **Outcomes are the better signal.** They measure what employers actually did, not another tool's guess.
- **How many rows:** 20–30 is enough to see a trend. Weight fitting starts at 8 rows with external scores and becomes trustworthy around 25+.

## 2. Run

```bash
npm run calibrate
```

Add `-- --ai` to include Claude (this uses API credits).

The run writes `report.md` and `report.csv`:

- **Agreement with external scores:** correlation, rank agreement, typical point gap, and bias.
- **Suggested weights:** the five category weights that best reproduce the external scores, with a leave-one-out error that tells you whether the new weights would really be better on a new resume.
- **Outcome prediction:** AUC (how well the score separates interviews from rejections), the best cut-off score, and how often a "likely auto-reject" knockout flag matched a real rejection.

The script **never changes the app**. If the fitted weights clearly beat the current ones on the leave-one-out number, update `WEIGHTS` in `src/lib/scoring/engine.ts`.

## Privacy

Resumes stay on your machine. `pairs/`, `pairs.csv` and the reports are git-ignored.
