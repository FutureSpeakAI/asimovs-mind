# Cognitive Memory System

A 3-tier memory architecture mimicking human cognition, designed for Agent Friday. Part of the [Asimov's Mind](https://github.com/FutureSpeakAI/asimovs-mind) ecosystem.

## Architecture

Three memory tiers model how humans process and retain information:

- **Short-term** — Conversation buffer. Ephemeral observations from the current session.
- **Medium-term** — Tracked observations with confidence scores. Require cross-session validation before promotion.
- **Long-term** — Confirmed facts with source attribution and high confidence.

## Core Features

### Jaccard Deduplication
Word-set overlap with stop-word filtering. Entries with ≥80% similarity are flagged as duplicates and merged, preserving the best confidence score and longest content.

### Weighted Promotion Scoring
Medium → Long-term promotion requires a composite score ≥ 10 AND occurrences ≥ 3:

| Component | Calculation | Max |
|-----------|------------|-----|
| Frequency | occurrences × 2 | 20 |
| Cross-session | sessions × 2 | 10 |
| Time-span | +5 if observed ≥ 7 days | 5 |
| Confidence | +3 if confidence ≥ 0.9 | 3 |
| Staleness | −5 if > 14 days unreinforced | −5 |

### Episodic Memory
Append-only session recordings with AI-generated summaries, topics, emotional tone, and key decisions.

### Sleep-like Consolidation
Periodic cycle that deduplicates all tiers, promotes qualified entries, demotes stale ones, and timestamps the operation.

### JSON Persistence
Full memory state serializes to/from JSON for portable storage.

## Usage

### Python API

```python
from memory import CognitiveMemory, MemoryTier

mem = CognitiveMemory()

# Add entries
mem.add("user prefers dark mode", tier=MemoryTier.MEDIUM, confidence=0.8)

# Search
results = mem.find("dark mode")

# Run consolidation
results = mem.consolidate()

# Save / load
mem.save("memory.json")
mem = CognitiveMemory.load("memory.json")
```

### CLI

```bash
# Add a memory
python cli.py add "user prefers dark mode" --tier medium --confidence 0.8

# Search
python cli.py find "dark mode"

# Run promotion
python cli.py promote

# Full consolidation
python cli.py consolidate

# Stats
python cli.py stats

# Recent episodes
python cli.py episodes
```

## Testing

```bash
pip install pytest
pytest test_memory.py -v
```

## Project Status

Core implementation complete with comprehensive tests.

**Standalone repo:** [agent-fridays-cognitive-memory](https://github.com/FutureSpeakAI/agent-fridays-cognitive-memory)
