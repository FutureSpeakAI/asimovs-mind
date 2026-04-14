# Epistemic Score System

Measures whether AI interactions make the user smarter or more dependent. This is Stephen's Reverse RLHF research made operational. Part of the [Asimov's Mind](https://github.com/FutureSpeakAI/asimovs-mind) ecosystem.

**Standalone repo:** [epistemic-score](https://github.com/FutureSpeakAI/epistemic-score)

## What It Does

Tracks six cognitive metrics across AI interactions to determine if the AI is building the user's capacity or creating dependency:

| Metric | What It Measures |
|---|---|
| **Independence Ratio** | How often the user solves problems without AI after learning from it |
| **Question Complexity Growth** | Whether questions are getting more sophisticated over time |
| **Knowledge Transfer** | Whether the user applies AI-provided knowledge in new contexts |
| **Critical Thinking** | Whether the user challenges AI responses or accepts uncritically |
| **Self-Correction** | Whether the user catches their own errors more often over time |
| **Delegation Appropriateness** | Whether the user delegates tasks AI should handle vs. abdicates learning |

## Scoring

- Each metric: **0.0** (fully dependent) to **1.0** (fully independent)
- Overall: weighted average of all six metrics
- Trend detection: improving / stable / declining (linear regression over window)
- Dependency alert: flags when overall drops below 0.4

## Installation

```bash
pip install -r requirements.txt  # only needed for testing (pytest)
```

No external runtime dependencies — pure Python stdlib.

## CLI Usage

```bash
# Record an interaction
python cli.py record --initiated --challenged --complexity 3 --appropriate

# View current scores
python cli.py score

# Check trend direction
python cli.py trend --window 10

# Full report
python cli.py report

# View history
python cli.py history
```

### Record Flags

| Flag | Short | Meaning |
|---|---|---|
| `--initiated` | `-i` | User proposed the solution |
| `--challenged` | `-c` | User pushed back on AI |
| `--applied` | `-a` | User applied a previously learned concept |
| `--complexity N` | `-x N` | Sophistication level (1-5) |
| `--appropriate` | | Delegation the AI should handle |
| `--abdication` | | Task the user should learn themselves |
| `--notes "..."` | `-n` | Freeform note about the interaction |

## Python API

```python
from epistemic import EpistemicScore, InteractionRecord

scorer = EpistemicScore()

scorer.record_interaction(InteractionRecord(
    user_initiated_solution=True,
    ai_challenged=True,
    new_concept_applied=False,
    complexity_level=3,
    delegation_type="appropriate",
))

scores = scorer.compute_scores()
print(scores["overall"])       # 0.0 - 1.0
print(scorer.get_trend())      # improving / stable / declining
print(scorer.get_report())     # human-readable summary

scorer.save("epistemic_data.json")
loaded = EpistemicScore.load("epistemic_data.json")
```

## Testing

```bash
pytest test_epistemic.py -v
```

## Data Storage

All data persists in a single JSON file (`epistemic_data.json` by default). The `--data-file` flag lets you use a custom path.

## Project Structure

```
friday-epistemic-score/
├── epistemic.py          # Core module (enums, dataclasses, scoring engine)
├── cli.py                # Command-line interface
├── test_epistemic.py     # Comprehensive test suite
├── requirements.txt      # Dependencies (pytest for testing)
└── README.md             # This file
```
