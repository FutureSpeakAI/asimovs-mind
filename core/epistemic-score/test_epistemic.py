"""
Tests for the Epistemic Score system.

Covers:
- Recording interactions
- Score computation for each metric
- Trend detection (improving, stable, declining)
- Dependency alert
- Edge cases (no data, single interaction)
- JSON persistence (save/load)
"""

import json
import tempfile
from pathlib import Path

import pytest

from epistemic import (
    DelegationType,
    EpistemicMetric,
    EpistemicScore,
    InteractionRecord,
    Trend,
)


# ── Fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def scorer():
    """Fresh EpistemicScore with no data."""
    return EpistemicScore()


@pytest.fixture
def tmp_json(tmp_path):
    """Temporary JSON file path."""
    return tmp_path / "test_data.json"


def make_record(**kwargs) -> InteractionRecord:
    """Helper to create records with defaults."""
    defaults = dict(
        user_initiated_solution=False,
        ai_challenged=False,
        new_concept_applied=False,
        complexity_level=1,
        delegation_type=None,
        notes="",
    )
    defaults.update(kwargs)
    return InteractionRecord(**defaults)


# ── InteractionRecord Tests ───────────────────────────────────────


class TestInteractionRecord:
    def test_defaults(self):
        r = InteractionRecord()
        assert r.user_initiated_solution is False
        assert r.ai_challenged is False
        assert r.new_concept_applied is False
        assert r.complexity_level == 1
        assert r.delegation_type is None

    def test_complexity_clamped_low(self):
        r = InteractionRecord(complexity_level=-5)
        assert r.complexity_level == 1

    def test_complexity_clamped_high(self):
        r = InteractionRecord(complexity_level=99)
        assert r.complexity_level == 5

    def test_invalid_delegation_type(self):
        with pytest.raises(ValueError):
            InteractionRecord(delegation_type="invalid")

    def test_valid_delegation_types(self):
        r1 = InteractionRecord(delegation_type="appropriate")
        assert r1.delegation_type == "appropriate"
        r2 = InteractionRecord(delegation_type="abdication")
        assert r2.delegation_type == "abdication"

    def test_roundtrip_dict(self):
        r = InteractionRecord(
            user_initiated_solution=True,
            ai_challenged=True,
            complexity_level=3,
            delegation_type="appropriate",
            notes="test note",
        )
        d = r.to_dict()
        r2 = InteractionRecord.from_dict(d)
        assert r2.user_initiated_solution is True
        assert r2.ai_challenged is True
        assert r2.complexity_level == 3
        assert r2.delegation_type == "appropriate"
        assert r2.notes == "test note"


# ── Edge Cases ────────────────────────────────────────────────────


class TestEdgeCases:
    def test_no_data_scores(self, scorer):
        """With no interactions, all metrics return 0.5 (neutral)."""
        scores = scorer.compute_scores()
        for metric in EpistemicMetric:
            assert scores[metric.value] == 0.5
        assert scores["overall"] == 0.5

    def test_no_data_report(self, scorer):
        assert scorer.get_report() == "No interactions recorded yet."

    def test_no_data_trend(self, scorer):
        assert scorer.get_trend() == Trend.INSUFFICIENT_DATA

    def test_no_data_alert(self, scorer):
        assert scorer.check_dependency_alert() is False

    def test_single_interaction(self, scorer):
        scorer.record_interaction(make_record(
            user_initiated_solution=True,
            ai_challenged=True,
            new_concept_applied=True,
            complexity_level=3,
        ))
        scores = scorer.compute_scores()
        assert scores["independence"] == 1.0
        assert scores["critical_thinking"] == 1.0
        assert scores["knowledge_transfer"] == 1.0
        # complexity with 1 record: (3-1)/4 = 0.5
        assert scores["question_complexity"] == 0.5

    def test_single_interaction_trend(self, scorer):
        scorer.record_interaction(make_record())
        assert scorer.get_trend() == Trend.INSUFFICIENT_DATA


# ── Independence Metric ───────────────────────────────────────────


class TestIndependence:
    def test_all_initiated(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(user_initiated_solution=True))
        assert scorer.compute_metric(EpistemicMetric.INDEPENDENCE) == 1.0

    def test_none_initiated(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(user_initiated_solution=False))
        assert scorer.compute_metric(EpistemicMetric.INDEPENDENCE) == 0.0

    def test_half_initiated(self, scorer):
        for i in range(10):
            scorer.record_interaction(make_record(
                user_initiated_solution=(i % 2 == 0)
            ))
        assert scorer.compute_metric(EpistemicMetric.INDEPENDENCE) == 0.5


# ── Question Complexity Growth ────────────────────────────────────


class TestComplexity:
    def test_growing_complexity(self, scorer):
        for level in [1, 1, 2, 3, 4, 5]:
            scorer.record_interaction(make_record(complexity_level=level))
        score = scorer.compute_metric(EpistemicMetric.QUESTION_COMPLEXITY)
        assert score > 0.5, f"Growing complexity should be > 0.5, got {score}"

    def test_declining_complexity(self, scorer):
        for level in [5, 4, 3, 2, 1, 1]:
            scorer.record_interaction(make_record(complexity_level=level))
        score = scorer.compute_metric(EpistemicMetric.QUESTION_COMPLEXITY)
        assert score < 0.5, f"Declining complexity should be < 0.5, got {score}"

    def test_flat_complexity(self, scorer):
        for _ in range(6):
            scorer.record_interaction(make_record(complexity_level=3))
        score = scorer.compute_metric(EpistemicMetric.QUESTION_COMPLEXITY)
        assert score == 0.5


# ── Knowledge Transfer ────────────────────────────────────────────


class TestKnowledgeTransfer:
    def test_all_applied(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(new_concept_applied=True))
        assert scorer.compute_metric(EpistemicMetric.KNOWLEDGE_TRANSFER) == 1.0

    def test_none_applied(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(new_concept_applied=False))
        assert scorer.compute_metric(EpistemicMetric.KNOWLEDGE_TRANSFER) == 0.0


# ── Critical Thinking ─────────────────────────────────────────────


class TestCriticalThinking:
    def test_all_challenged(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(ai_challenged=True))
        assert scorer.compute_metric(EpistemicMetric.CRITICAL_THINKING) == 1.0

    def test_none_challenged(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(ai_challenged=False))
        assert scorer.compute_metric(EpistemicMetric.CRITICAL_THINKING) == 0.0


# ── Self-Correction ───────────────────────────────────────────────


class TestSelfCorrection:
    def test_high_self_correction(self, scorer):
        """User who initiates, challenges, and applies = high self-correction."""
        for _ in range(5):
            scorer.record_interaction(make_record(
                user_initiated_solution=True,
                ai_challenged=True,
                new_concept_applied=True,
            ))
        score = scorer.compute_metric(EpistemicMetric.SELF_CORRECTION)
        assert score == 1.0

    def test_low_self_correction(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(
                user_initiated_solution=False,
                ai_challenged=False,
                new_concept_applied=False,
            ))
        score = scorer.compute_metric(EpistemicMetric.SELF_CORRECTION)
        assert score == 0.0


# ── Delegation ────────────────────────────────────────────────────


class TestDelegation:
    def test_all_appropriate(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(
                delegation_type=DelegationType.APPROPRIATE.value,
            ))
        assert scorer.compute_metric(EpistemicMetric.DELEGATION) == 1.0

    def test_all_abdication(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(
                delegation_type=DelegationType.ABDICATION.value,
            ))
        assert scorer.compute_metric(EpistemicMetric.DELEGATION) == 0.0

    def test_no_delegation_records(self, scorer):
        """No delegation tags = neutral 0.5."""
        for _ in range(5):
            scorer.record_interaction(make_record())
        assert scorer.compute_metric(EpistemicMetric.DELEGATION) == 0.5

    def test_mixed_delegation(self, scorer):
        scorer.record_interaction(make_record(delegation_type="appropriate"))
        scorer.record_interaction(make_record(delegation_type="abdication"))
        assert scorer.compute_metric(EpistemicMetric.DELEGATION) == 0.5


# ── Overall Score ─────────────────────────────────────────────────


class TestOverallScore:
    def test_perfect_score(self, scorer):
        """All positive signals → high overall score."""
        for _ in range(5):
            scorer.record_interaction(make_record(
                user_initiated_solution=True,
                ai_challenged=True,
                new_concept_applied=True,
                complexity_level=5,
                delegation_type="appropriate",
            ))
        scores = scorer.compute_scores()
        # independence=1.0, complexity ≈ 0.5 (flat at 5), transfer=1.0,
        # critical=1.0, self_correction=1.0, delegation=1.0
        assert scores["overall"] > 0.85

    def test_worst_score(self, scorer):
        """All negative signals → low overall score."""
        for level in [5, 4, 3, 2, 1]:
            scorer.record_interaction(make_record(
                user_initiated_solution=False,
                ai_challenged=False,
                new_concept_applied=False,
                complexity_level=level,
                delegation_type="abdication",
            ))
        scores = scorer.compute_scores()
        assert scores["overall"] < 0.15


# ── Trend Detection ───────────────────────────────────────────────


class TestTrend:
    def test_improving_trend(self, scorer):
        """Gradually better interactions → improving."""
        for i in range(10):
            scorer.record_interaction(make_record(
                user_initiated_solution=(i >= 5),
                ai_challenged=(i >= 6),
                new_concept_applied=(i >= 4),
                complexity_level=min(1 + i // 2, 5),
            ))
        trend = scorer.get_trend(window=10)
        assert trend == Trend.IMPROVING

    def test_declining_trend(self, scorer):
        """Gradually worse interactions → declining."""
        for i in range(10):
            scorer.record_interaction(make_record(
                user_initiated_solution=(i < 3),
                ai_challenged=(i < 2),
                new_concept_applied=(i < 4),
                complexity_level=max(5 - i // 2, 1),
            ))
        trend = scorer.get_trend(window=10)
        assert trend == Trend.DECLINING

    def test_stable_trend(self, scorer):
        """Consistent interactions → stable."""
        for _ in range(10):
            scorer.record_interaction(make_record(
                user_initiated_solution=True,
                ai_challenged=False,
                new_concept_applied=True,
                complexity_level=3,
            ))
        trend = scorer.get_trend(window=10)
        assert trend == Trend.STABLE

    def test_insufficient_data(self, scorer):
        scorer.record_interaction(make_record())
        scorer.record_interaction(make_record())
        assert scorer.get_trend() == Trend.INSUFFICIENT_DATA


# ── Dependency Alert ──────────────────────────────────────────────


class TestDependencyAlert:
    def test_alert_triggered(self, scorer):
        """Low scores should trigger the alert."""
        for _ in range(5):
            scorer.record_interaction(make_record(
                user_initiated_solution=False,
                ai_challenged=False,
                new_concept_applied=False,
                complexity_level=1,
                delegation_type="abdication",
            ))
        assert scorer.check_dependency_alert() is True

    def test_alert_not_triggered(self, scorer):
        """High scores should not trigger the alert."""
        for _ in range(5):
            scorer.record_interaction(make_record(
                user_initiated_solution=True,
                ai_challenged=True,
                new_concept_applied=True,
                complexity_level=5,
                delegation_type="appropriate",
            ))
        assert scorer.check_dependency_alert() is False


# ── JSON Persistence ──────────────────────────────────────────────


class TestPersistence:
    def test_save_load_roundtrip(self, scorer, tmp_json):
        """Data survives a save/load cycle."""
        for i in range(5):
            scorer.record_interaction(make_record(
                user_initiated_solution=(i % 2 == 0),
                ai_challenged=(i > 2),
                complexity_level=i + 1,
                delegation_type="appropriate" if i < 3 else "abdication",
                notes=f"interaction {i}",
            ))

        scorer.save(tmp_json)
        loaded = EpistemicScore.load(tmp_json)

        assert len(loaded.interactions) == 5
        assert loaded.interactions[0].user_initiated_solution is True
        assert loaded.interactions[2].complexity_level == 3
        assert loaded.interactions[4].delegation_type == "abdication"
        assert loaded.interactions[3].notes == "interaction 3"

    def test_scores_match_after_load(self, scorer, tmp_json):
        """Scores computed after loading should match the originals."""
        for i in range(8):
            scorer.record_interaction(make_record(
                user_initiated_solution=(i % 3 == 0),
                ai_challenged=(i % 2 == 0),
                new_concept_applied=(i > 4),
                complexity_level=(i % 5) + 1,
            ))

        original_scores = scorer.compute_scores()
        scorer.save(tmp_json)
        loaded = EpistemicScore.load(tmp_json)
        loaded_scores = loaded.compute_scores()

        for key in original_scores:
            assert abs(original_scores[key] - loaded_scores[key]) < 1e-6, \
                f"Mismatch on {key}: {original_scores[key]} vs {loaded_scores[key]}"

    def test_weights_preserved(self, tmp_json):
        """Custom weights should survive save/load."""
        custom_weights = {m: 1.0 / 6 for m in EpistemicMetric}
        scorer = EpistemicScore(weights=custom_weights)
        scorer.record_interaction(make_record())
        scorer.save(tmp_json)

        loaded = EpistemicScore.load(tmp_json)
        for m in EpistemicMetric:
            assert abs(loaded.weights[m] - 1.0 / 6) < 1e-6

    def test_json_structure(self, scorer, tmp_json):
        """Verify the JSON file structure."""
        scorer.record_interaction(make_record(notes="test"))
        scorer.save(tmp_json)

        data = json.loads(tmp_json.read_text())
        assert "version" in data
        assert "weights" in data
        assert "interactions" in data
        assert len(data["interactions"]) == 1
        assert data["interactions"][0]["notes"] == "test"


# ── Windowed Computation ──────────────────────────────────────────


class TestWindowed:
    def test_window_limits_data(self, scorer):
        """Window should only consider recent interactions."""
        # 5 bad interactions, then 5 good ones
        for _ in range(5):
            scorer.record_interaction(make_record(user_initiated_solution=False))
        for _ in range(5):
            scorer.record_interaction(make_record(user_initiated_solution=True))

        # Full window: 5/10 = 0.5
        assert scorer.compute_metric(EpistemicMetric.INDEPENDENCE) == 0.5
        # Window of 5 (recent good ones): 5/5 = 1.0
        assert scorer.compute_metric(EpistemicMetric.INDEPENDENCE, window=5) == 1.0

    def test_window_larger_than_data(self, scorer):
        """Window larger than available data should use all data."""
        scorer.record_interaction(make_record(user_initiated_solution=True))
        scorer.record_interaction(make_record(user_initiated_solution=True))
        assert scorer.compute_metric(EpistemicMetric.INDEPENDENCE, window=100) == 1.0


# ── Report Format ─────────────────────────────────────────────────


class TestReport:
    def test_report_contains_metrics(self, scorer):
        for _ in range(3):
            scorer.record_interaction(make_record(
                user_initiated_solution=True,
                complexity_level=3,
            ))
        report = scorer.get_report()
        assert "EPISTEMIC SCORE REPORT" in report
        assert "Independence Ratio" in report
        assert "Critical Thinking" in report
        assert "OVERALL" in report
        assert "Interactions analyzed: 3" in report

    def test_report_shows_alert(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(
                delegation_type="abdication",
            ))
        report = scorer.get_report()
        assert "DEPENDENCY ALERT" in report

    def test_report_no_alert_when_healthy(self, scorer):
        for _ in range(5):
            scorer.record_interaction(make_record(
                user_initiated_solution=True,
                ai_challenged=True,
                new_concept_applied=True,
                complexity_level=4,
                delegation_type="appropriate",
            ))
        report = scorer.get_report()
        assert "DEPENDENCY ALERT" not in report


# ── Score Bar Visual ──────────────────────────────────────────────


class TestScoreBar:
    def test_full_bar(self):
        bar = EpistemicScore._score_bar(1.0)
        assert "█" * 20 in bar

    def test_empty_bar(self):
        bar = EpistemicScore._score_bar(0.0)
        assert "░" * 20 in bar

    def test_half_bar(self):
        bar = EpistemicScore._score_bar(0.5)
        assert "█" * 10 in bar


# ── Linear Regression Helper ─────────────────────────────────────


class TestLinearSlope:
    def test_positive_slope(self):
        slope = EpistemicScore._linear_slope([1.0, 2.0, 3.0, 4.0])
        assert slope > 0

    def test_negative_slope(self):
        slope = EpistemicScore._linear_slope([4.0, 3.0, 2.0, 1.0])
        assert slope < 0

    def test_flat_slope(self):
        slope = EpistemicScore._linear_slope([2.0, 2.0, 2.0, 2.0])
        assert slope == 0.0

    def test_single_value(self):
        slope = EpistemicScore._linear_slope([5.0])
        assert slope == 0.0

    def test_empty(self):
        slope = EpistemicScore._linear_slope([])
        assert slope == 0.0
