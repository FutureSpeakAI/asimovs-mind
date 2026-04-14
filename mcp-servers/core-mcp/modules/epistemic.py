"""
Epistemic Score System
Measures whether AI interactions make the user smarter or more dependent.
"""

from __future__ import annotations

import json
import statistics
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional


class EpistemicMetric(str, Enum):
    INDEPENDENCE = "independence"
    QUESTION_COMPLEXITY = "question_complexity"
    KNOWLEDGE_TRANSFER = "knowledge_transfer"
    CRITICAL_THINKING = "critical_thinking"
    SELF_CORRECTION = "self_correction"
    DELEGATION = "delegation"


class DelegationType(str, Enum):
    APPROPRIATE = "appropriate"
    ABDICATION = "abdication"


class Trend(str, Enum):
    IMPROVING = "improving"
    STABLE = "stable"
    DECLINING = "declining"
    INSUFFICIENT_DATA = "insufficient_data"


@dataclass
class InteractionRecord:
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    user_initiated_solution: bool = False
    ai_challenged: bool = False
    new_concept_applied: bool = False
    complexity_level: int = 1
    delegation_type: Optional[str] = None
    notes: str = ""

    def __post_init__(self):
        self.complexity_level = max(1, min(5, self.complexity_level))
        if self.delegation_type is not None:
            DelegationType(self.delegation_type)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> InteractionRecord:
        return cls(**data)


class EpistemicScore:
    DEFAULT_WEIGHTS = {
        EpistemicMetric.INDEPENDENCE: 0.25,
        EpistemicMetric.QUESTION_COMPLEXITY: 0.15,
        EpistemicMetric.KNOWLEDGE_TRANSFER: 0.15,
        EpistemicMetric.CRITICAL_THINKING: 0.20,
        EpistemicMetric.SELF_CORRECTION: 0.10,
        EpistemicMetric.DELEGATION: 0.15,
    }
    DEPENDENCY_THRESHOLD = 0.4

    def __init__(self, weights: Optional[dict] = None):
        self.interactions: list[InteractionRecord] = []
        self.weights = weights or dict(self.DEFAULT_WEIGHTS)

    def record_interaction(self, record: InteractionRecord) -> None:
        self.interactions.append(record)

    def compute_metric(self, metric: EpistemicMetric, window: Optional[int] = None) -> float:
        records = self._windowed(window)
        if not records:
            return 0.5
        if metric == EpistemicMetric.INDEPENDENCE:
            return self._compute_independence(records)
        elif metric == EpistemicMetric.QUESTION_COMPLEXITY:
            return self._compute_complexity(records)
        elif metric == EpistemicMetric.KNOWLEDGE_TRANSFER:
            return self._compute_knowledge_transfer(records)
        elif metric == EpistemicMetric.CRITICAL_THINKING:
            return self._compute_critical_thinking(records)
        elif metric == EpistemicMetric.SELF_CORRECTION:
            return self._compute_self_correction(records)
        elif metric == EpistemicMetric.DELEGATION:
            return self._compute_delegation(records)
        raise ValueError(f"Unknown metric: {metric}")

    def compute_scores(self, window: Optional[int] = None) -> dict:
        scores = {}
        for metric in EpistemicMetric:
            scores[metric.value] = round(self.compute_metric(metric, window), 4)
        overall = sum(scores[m.value] * self.weights[m] for m in EpistemicMetric)
        scores["overall"] = round(overall, 4)
        return scores

    def get_trend(self, window: int = 10) -> Trend:
        n = len(self.interactions)
        if n < 3:
            return Trend.INSUFFICIENT_DATA
        points = []
        start = max(0, n - window)
        for i in range(start, n):
            subset = self.interactions[:i + 1]
            scorer = EpistemicScore(weights=self.weights)
            scorer.interactions = subset
            overall = scorer.compute_scores()["overall"]
            points.append(overall)
        if len(points) < 3:
            return Trend.INSUFFICIENT_DATA
        slope = self._linear_slope(points)
        if slope > 0.02:
            return Trend.IMPROVING
        elif slope < -0.02:
            return Trend.DECLINING
        return Trend.STABLE

    def check_dependency_alert(self) -> bool:
        if not self.interactions:
            return False
        return self.compute_scores()["overall"] < self.DEPENDENCY_THRESHOLD

    def get_report(self) -> str:
        if not self.interactions:
            return "No interactions recorded yet."
        scores = self.compute_scores()
        trend = self.get_trend()
        alert = self.check_dependency_alert()
        lines = ["=" * 50, "EPISTEMIC SCORE REPORT", "=" * 50,
                 f"Interactions analyzed: {len(self.interactions)}", "",
                 "METRIC SCORES (0.0 = dependent, 1.0 = independent):", "-" * 50]
        labels = {
            "independence": "Independence Ratio",
            "question_complexity": "Question Complexity Growth",
            "knowledge_transfer": "Knowledge Transfer",
            "critical_thinking": "Critical Thinking",
            "self_correction": "Self-Correction",
            "delegation": "Delegation Appropriateness",
        }
        for key, label in labels.items():
            s = scores[key]
            bar = self._score_bar(s)
            lines.append(f"  {label:<30} {s:.2f} {bar}")
        lines.extend(["-" * 50, f"  {'OVERALL':<30} {scores['overall']:.2f} {self._score_bar(scores['overall'])}",
                       "", f"Trend: {trend.value}"])
        if alert:
            lines.extend(["", "DEPENDENCY ALERT: Overall score below 0.4"])
        lines.append("=" * 50)
        return "\n".join(lines)

    def save(self, path: str | Path) -> None:
        path = Path(path)
        data = {"version": "1.0.0",
                "weights": {k.value: v for k, v in self.weights.items()},
                "interactions": [r.to_dict() for r in self.interactions]}
        path.write_text(json.dumps(data, indent=2))

    @classmethod
    def load(cls, path: str | Path) -> EpistemicScore:
        data = json.loads(Path(path).read_text())
        weights = {EpistemicMetric(k): v for k, v in data.get("weights", {}).items()}
        scorer = cls(weights=weights)
        for rec in data.get("interactions", []):
            scorer.record_interaction(InteractionRecord.from_dict(rec))
        return scorer

    def _windowed(self, window=None):
        if window is None or window >= len(self.interactions):
            return list(self.interactions)
        return self.interactions[-window:]

    def _compute_independence(self, records):
        return sum(1 for r in records if r.user_initiated_solution) / len(records) if records else 0.5

    def _compute_complexity(self, records):
        if len(records) < 2:
            return (records[0].complexity_level - 1) / 4.0
        mid = len(records) // 2
        early_avg = statistics.mean(r.complexity_level for r in records[:mid])
        late_avg = statistics.mean(r.complexity_level for r in records[mid:])
        return max(0.0, min(1.0, 0.5 + (late_avg - early_avg) / 8.0))

    def _compute_knowledge_transfer(self, records):
        return sum(1 for r in records if r.new_concept_applied) / len(records) if records else 0.5

    def _compute_critical_thinking(self, records):
        return sum(1 for r in records if r.ai_challenged) / len(records) if records else 0.5

    def _compute_self_correction(self, records):
        if not records:
            return 0.5
        return (0.4 * self._compute_independence(records) +
                0.3 * self._compute_critical_thinking(records) +
                0.3 * self._compute_knowledge_transfer(records))

    def _compute_delegation(self, records):
        dr = [r for r in records if r.delegation_type is not None]
        if not dr:
            return 0.5
        return sum(1 for r in dr if r.delegation_type == DelegationType.APPROPRIATE.value) / len(dr)

    @staticmethod
    def _linear_slope(values):
        n = len(values)
        if n < 2:
            return 0.0
        x_mean = (n - 1) / 2.0
        y_mean = statistics.mean(values)
        num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
        den = sum((i - x_mean) ** 2 for i in range(n))
        return num / den if den else 0.0

    @staticmethod
    def _score_bar(score, width=20):
        filled = int(score * width)
        return f"[{'█' * filled}{'░' * (width - filled)}]"
