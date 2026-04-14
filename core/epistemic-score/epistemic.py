"""
Epistemic Score System
======================
Measures whether AI interactions make the user smarter or more dependent.

Tracks six cognitive metrics across interactions to determine if the AI
is building the user's capacity or creating dependency.

Part of the Agent Friday / Reverse RLHF research project.
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
    """The six cognitive metrics tracked by the system."""
    INDEPENDENCE = "independence"
    QUESTION_COMPLEXITY = "question_complexity"
    KNOWLEDGE_TRANSFER = "knowledge_transfer"
    CRITICAL_THINKING = "critical_thinking"
    SELF_CORRECTION = "self_correction"
    DELEGATION = "delegation"


class DelegationType(str, Enum):
    """Whether a delegation to the AI was appropriate or an abdication."""
    APPROPRIATE = "appropriate"   # AI should handle this
    ABDICATION = "abdication"     # User should learn this


class Trend(str, Enum):
    """Direction of epistemic score movement."""
    IMPROVING = "improving"
    STABLE = "stable"
    DECLINING = "declining"
    INSUFFICIENT_DATA = "insufficient_data"


@dataclass
class InteractionRecord:
    """A single recorded interaction with epistemic metadata."""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    user_initiated_solution: bool = False
    ai_challenged: bool = False
    new_concept_applied: bool = False
    complexity_level: int = 1          # 1-5
    delegation_type: Optional[str] = None  # "appropriate" or "abdication" or None
    notes: str = ""

    def __post_init__(self):
        if self.complexity_level < 1:
            self.complexity_level = 1
        if self.complexity_level > 5:
            self.complexity_level = 5
        if self.delegation_type is not None:
            # Validate enum value
            DelegationType(self.delegation_type)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> InteractionRecord:
        return cls(**data)


class EpistemicScore:
    """
    Core scoring engine for epistemic measurement.

    Tracks interactions over time and computes six cognitive metrics
    plus an overall weighted score. Detects trends and alerts on
    dependency patterns.
    """

    # Default weights for overall score computation
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
        """Add an interaction record to the history."""
        self.interactions.append(record)

    def compute_metric(self, metric: EpistemicMetric, window: Optional[int] = None) -> float:
        """
        Compute a single metric score (0.0-1.0) over the most recent
        `window` interactions. If window is None, uses all interactions.
        """
        records = self._windowed(window)
        if not records:
            return 0.5  # neutral default with no data

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
        else:
            raise ValueError(f"Unknown metric: {metric}")

    def compute_scores(self, window: Optional[int] = None) -> dict:
        """
        Compute all six metrics and the weighted overall score.

        Returns dict with metric names as keys, float scores as values,
        plus 'overall' key.
        """
        scores = {}
        for metric in EpistemicMetric:
            scores[metric.value] = round(self.compute_metric(metric, window), 4)

        # Weighted average for overall
        overall = sum(
            scores[m.value] * self.weights[m]
            for m in EpistemicMetric
        )
        scores["overall"] = round(overall, 4)
        return scores

    def get_trend(self, window: int = 10) -> Trend:
        """
        Detect whether the user's epistemic score is improving, stable,
        or declining over the last `window` interactions.

        Uses simple linear regression on rolling overall scores.
        Needs at least 3 data points.
        """
        n = len(self.interactions)
        if n < 3:
            return Trend.INSUFFICIENT_DATA

        # Compute overall score at each point using expanding windows
        # starting from at least 1 interaction
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

        # Simple linear regression: slope of best-fit line
        slope = self._linear_slope(points)

        if slope > 0.02:
            return Trend.IMPROVING
        elif slope < -0.02:
            return Trend.DECLINING
        else:
            return Trend.STABLE

    def check_dependency_alert(self) -> bool:
        """Return True if overall score is below the dependency threshold."""
        if not self.interactions:
            return False
        scores = self.compute_scores()
        return scores["overall"] < self.DEPENDENCY_THRESHOLD

    def get_report(self) -> str:
        """Generate a human-readable epistemic report."""
        if not self.interactions:
            return "No interactions recorded yet."

        scores = self.compute_scores()
        trend = self.get_trend()
        alert = self.check_dependency_alert()

        lines = [
            "=" * 50,
            "EPISTEMIC SCORE REPORT",
            "=" * 50,
            f"Interactions analyzed: {len(self.interactions)}",
            "",
            "METRIC SCORES (0.0 = dependent, 1.0 = independent):",
            "-" * 50,
        ]

        metric_labels = {
            "independence": "Independence Ratio",
            "question_complexity": "Question Complexity Growth",
            "knowledge_transfer": "Knowledge Transfer",
            "critical_thinking": "Critical Thinking",
            "self_correction": "Self-Correction",
            "delegation": "Delegation Appropriateness",
        }

        for key, label in metric_labels.items():
            score = scores[key]
            bar = self._score_bar(score)
            lines.append(f"  {label:<30} {score:.2f} {bar}")

        lines.extend([
            "-" * 50,
            f"  {'OVERALL':<30} {scores['overall']:.2f} {self._score_bar(scores['overall'])}",
            "",
            f"Trend: {trend.value}",
        ])

        if alert:
            lines.extend([
                "",
                "⚠️  DEPENDENCY ALERT: Overall score below 0.4",
                "    Consider whether AI assistance is building or",
                "    replacing your capabilities.",
            ])

        lines.append("=" * 50)
        return "\n".join(lines)

    def save(self, path: str | Path) -> None:
        """Save interaction history and config to JSON."""
        path = Path(path)
        data = {
            "version": "1.0.0",
            "weights": {k.value: v for k, v in self.weights.items()},
            "interactions": [r.to_dict() for r in self.interactions],
        }
        path.write_text(json.dumps(data, indent=2))

    @classmethod
    def load(cls, path: str | Path) -> EpistemicScore:
        """Load from a JSON file."""
        path = Path(path)
        data = json.loads(path.read_text())
        weights_raw = data.get("weights", {})
        weights = {
            EpistemicMetric(k): v for k, v in weights_raw.items()
        }
        scorer = cls(weights=weights)
        for rec_data in data.get("interactions", []):
            scorer.record_interaction(InteractionRecord.from_dict(rec_data))
        return scorer

    # ── Private: metric computations ──────────────────────────────

    def _windowed(self, window: Optional[int] = None) -> list[InteractionRecord]:
        """Return the most recent `window` interactions."""
        if window is None or window >= len(self.interactions):
            return list(self.interactions)
        return self.interactions[-window:]

    def _compute_independence(self, records: list[InteractionRecord]) -> float:
        """Ratio of interactions where the user initiated the solution."""
        if not records:
            return 0.5
        initiated = sum(1 for r in records if r.user_initiated_solution)
        return initiated / len(records)

    def _compute_complexity(self, records: list[InteractionRecord]) -> float:
        """
        Are questions getting more sophisticated?
        Compares the average complexity of the recent half to the earlier half.
        Maps to 0.0-1.0 where 0.5 = flat, >0.5 = growing, <0.5 = declining.
        """
        if len(records) < 2:
            # Single record: normalize complexity_level to 0-1 scale
            return (records[0].complexity_level - 1) / 4.0

        mid = len(records) // 2
        early = records[:mid]
        late = records[mid:]

        early_avg = statistics.mean(r.complexity_level for r in early)
        late_avg = statistics.mean(r.complexity_level for r in late)

        # Difference ranges from -4 to +4, map to 0.0-1.0
        diff = late_avg - early_avg
        return max(0.0, min(1.0, 0.5 + diff / 8.0))

    def _compute_knowledge_transfer(self, records: list[InteractionRecord]) -> float:
        """Ratio of interactions where the user applied a previously learned concept."""
        if not records:
            return 0.5
        applied = sum(1 for r in records if r.new_concept_applied)
        return applied / len(records)

    def _compute_critical_thinking(self, records: list[InteractionRecord]) -> float:
        """Ratio of interactions where the user challenged the AI."""
        if not records:
            return 0.5
        challenged = sum(1 for r in records if r.ai_challenged)
        return challenged / len(records)

    def _compute_self_correction(self, records: list[InteractionRecord]) -> float:
        """
        Composite of independence + challenge + concept application.
        Users who self-correct tend to initiate solutions, challenge AI,
        and apply learned concepts. Weighted blend of these signals.
        """
        if not records:
            return 0.5
        # Self-correction is a derived metric: 40% independence, 30% challenge, 30% transfer
        indep = self._compute_independence(records)
        challenge = self._compute_critical_thinking(records)
        transfer = self._compute_knowledge_transfer(records)
        return 0.4 * indep + 0.3 * challenge + 0.3 * transfer

    def _compute_delegation(self, records: list[InteractionRecord]) -> float:
        """
        Ratio of delegations that were appropriate vs. abdications.
        Records without delegation_type are ignored.
        If no delegation records exist, return neutral 0.5.
        """
        delegation_records = [r for r in records if r.delegation_type is not None]
        if not delegation_records:
            return 0.5
        appropriate = sum(
            1 for r in delegation_records
            if r.delegation_type == DelegationType.APPROPRIATE.value
        )
        return appropriate / len(delegation_records)

    @staticmethod
    def _linear_slope(values: list[float]) -> float:
        """
        Compute the slope of a simple linear regression over the values.
        X values are 0, 1, 2, ..., n-1.
        """
        n = len(values)
        if n < 2:
            return 0.0
        x_mean = (n - 1) / 2.0
        y_mean = statistics.mean(values)
        numerator = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
        denominator = sum((i - x_mean) ** 2 for i in range(n))
        if denominator == 0:
            return 0.0
        return numerator / denominator

    @staticmethod
    def _score_bar(score: float, width: int = 20) -> str:
        """Render a visual bar for a score."""
        filled = int(score * width)
        return f"[{'█' * filled}{'░' * (width - filled)}]"
