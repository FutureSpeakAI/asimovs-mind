# Personality Evolution System

Agent Friday's personality trait engine with 50-session maturity ramp, visual dimension mapping, adaptive style, and anti-sycophancy calibration. Part of the [Asimov's Mind](https://github.com/FutureSpeakAI/asimovs-mind) ecosystem.

**Standalone repo:** [agent-fridays-personality-evolution-engine](https://github.com/FutureSpeakAI/agent-fridays-personality-evolution-engine)

## Overview

This module tracks and evolves 30 personality traits over time. A fresh agent looks identical to every other agent. As sessions accumulate (up to 50), the personality matures and begins expressing its unique visual identity and behavioral style.

### Core Concepts

- **30 Personality Traits** — each mapped to a 0-1 value (warmth, analytical, playful, gonzo, etc.)
- **4 Visual Dimensions** — Hue (0-360), Energy (0-2), Complexity (0-2), Warmth (0-2), derived from weighted trait combinations
- **50-Session Maturity Ramp** — `maturity = min(session_count / 50, 1.0)`. Traits only influence visuals proportionally to maturity.
- **6 Adaptive Style Dimensions** — formality, verbosity, humor frequency, technical depth, emotional expressiveness, challenge willingness
- **Anti-Sycophancy Calibration** — tracks agreement streaks and positivity bias. Circuit breaker fires when streak >= 8 AND bias >= 0.85, hard-resetting emotional warmth and humor to neutral.

## Files

| File | Purpose |
|------|---------|
| `personality.py` | Core module — Trait/VisualDimension enums, PersonalityProfile, PersonalityEngine |
| `cli.py` | Command-line interface |
| `test_personality.py` | Comprehensive test suite |
| `requirements.txt` | Dependencies (stdlib only) |

## Usage

### CLI

```bash
python cli.py show                    # current traits and maturity
python cli.py visuals                 # current visual dimensions
python cli.py style                   # current adaptive style
python cli.py session                 # record a new session
python cli.py set warmth 0.8          # set a trait value
python cli.py sycophancy              # show tracker stats
python cli.py --profile my.json show  # use custom profile path
```

### Python API

```python
from personality import PersonalityEngine, Trait, VisualDimension

engine = PersonalityEngine()

# Configure traits
engine.set_trait(Trait.GONZO, 0.9)
engine.set_trait(Trait.ANALYTICAL, 0.7)

# Record sessions to build maturity
for _ in range(25):
    engine.record_session()

# Read effective trait values (scaled by maturity)
print(engine.get_trait(Trait.GONZO))  # ~0.7 at 50% maturity

# Get visual dimensions
visuals = engine.get_visual_dimensions()
print(visuals[VisualDimension.HUE])

# Anti-sycophancy
engine.record_interaction(agreed=True, positive=True)
if engine.check_sycophancy():
    engine.fire_circuit_breaker()

# Persist
engine.save("profile.json")
engine = PersonalityEngine.load("profile.json")
```

## Tests

```bash
python -m pytest test_personality.py -v
# or
python -m unittest test_personality -v
```

## Architecture Notes

- Zero external dependencies — stdlib only (json, math, enum, dataclasses, pathlib)
- All state serializes to a single JSON file
- Trait-to-visual mappings use weighted means (circular for hue, linear for others)
- Style dimensions recompute automatically when traits change or sessions are recorded
