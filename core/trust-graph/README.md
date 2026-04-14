# Trust Graph

Person-level credibility model for Agent Friday. Tracks trust scores across 5 dimensions with hermeneutic re-evaluation, fuzzy name resolution, time-based decay, and JSON persistence. Part of the [Asimov's Mind](https://github.com/FutureSpeakAI/asimovs-mind) ecosystem.

**Standalone repo:** [trust-graph](https://github.com/FutureSpeakAI/trust-graph)

## Trust Dimensions

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Reliability | 30% | Follow-through on promises |
| Information Quality | 25% | Accuracy of information provided |
| Emotional Trust | 20% | Safety for vulnerability |
| Timeliness | 15% | Response and delivery speed |
| Domain Expertise | 10% | Per-domain competency |
| Overall | — | Weighted composite |

## Setup

```bash
cd core/trust-graph
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## CLI Usage

```bash
# Add a person
python cli.py add "Jamie Chen" -a JJ -a Janet

# Record evidence
python cli.py evidence "Jamie Chen" promise_kept 0.9
python cli.py evidence "Jamie Chen" domain_expertise_shown 0.8 -d leadership

# View scores
python cli.py score "Jamie Chen"

# List all people
python cli.py list

# Fuzzy search
python cli.py find "JJ"

# Apply time decay
python cli.py decay

# Export graph
python cli.py export
```

## Tests

```bash
pytest test_trust_graph.py -v
```

## Design

- **Fuzzy resolution cascade**: exact alias → normalized name → Levenshtein ≤2 → first-name uniqueness → not found
- **Hermeneutic re-evaluation**: every 5 evidence records, full recompute from all evidence with exponential recency weighting
- **Time decay**: exponential decay with 30-day half-life toward floor of 0.3 (uncertainty, not distrust)
- **No external deps** beyond `click` for CLI — Levenshtein implemented from scratch
