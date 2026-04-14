"""Comprehensive tests for Trust Graph - Phase 3."""

import json
import math
import os
import tempfile
from datetime import datetime, timezone, timedelta

import pytest

from trust_graph import (
    TrustGraph, TrustDimension, EvidenceType, Evidence, PersonNode,
    levenshtein_distance, DEFAULT_SCORE, SCORE_FLOOR, SCORE_CEILING,
    HERMENEUTIC_INTERVAL, _normalize_name,
)


def _ts(days_ago: float = 0) -> str:
    dt = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return dt.isoformat()


def _make_evidence(etype, mag=0.8, days_ago=0, domain=None, notes=None):
    return Evidence(type=etype, magnitude=mag, timestamp=_ts(days_ago),
                    domain=domain, notes=notes)


# --- Levenshtein ---

class TestLevenshtein:
    def test_identical(self):
        assert levenshtein_distance("hello", "hello") == 0

    def test_empty(self):
        assert levenshtein_distance("", "abc") == 3
        assert levenshtein_distance("abc", "") == 3

    def test_both_empty(self):
        assert levenshtein_distance("", "") == 0

    def test_one_edit(self):
        assert levenshtein_distance("cat", "bat") == 1
        assert levenshtein_distance("cat", "cats") == 1
        assert levenshtein_distance("cats", "cat") == 1

    def test_two_edits(self):
        assert levenshtein_distance("kitten", "sittin") == 2

    def test_completely_different(self):
        assert levenshtein_distance("abc", "xyz") == 3


# --- Person management ---

class TestPersonManagement:
    def test_add_person(self):
        g = TrustGraph()
        node = g.add_person("Jamie Chen")
        assert node.name == "Jamie Chen"
        assert g.people_count == 1

    def test_add_person_with_aliases(self):
        g = TrustGraph()
        node = g.add_person("Jamie Chen", aliases=["JJ", "Janet"])
        assert "JJ" in node.aliases
        assert "Janet" in node.aliases

    def test_add_duplicate_merges_aliases(self):
        g = TrustGraph()
        g.add_person("Jamie Chen", aliases=["JJ"])
        node = g.add_person("Jamie Chen", aliases=["Janet"])
        assert g.people_count == 1
        assert "JJ" in node.aliases
        assert "Janet" in node.aliases

    def test_default_scores(self):
        g = TrustGraph()
        node = g.add_person("Test Person")
        for dim in TrustDimension:
            assert node.scores[dim.value] == DEFAULT_SCORE

    def test_creation_date_set(self):
        g = TrustGraph()
        node = g.add_person("Test Person")
        assert node.creation_date is not None

    def test_get_person_exact(self):
        g = TrustGraph()
        g.add_person("Jamie Chen")
        assert g.get_person("Jamie Chen") is not None
        assert g.get_person("janet jay") is not None
        assert g.get_person("Unknown") is None


# --- Fuzzy resolution ---

class TestFuzzyResolution:
    def test_exact_alias_match(self):
        g = TrustGraph()
        g.add_person("Jamie Chen", aliases=["JJ"])
        result = g.find_person("JJ")
        assert result is not None
        assert result.name == "Jamie Chen"

    def test_alias_case_insensitive(self):
        g = TrustGraph()
        g.add_person("Jamie Chen", aliases=["jj"])
        result = g.find_person("JJ")
        assert result is not None
        assert result.name == "Jamie Chen"

    def test_normalized_name_match(self):
        g = TrustGraph()
        g.add_person("Jamie Chen")
        result = g.find_person("janet jay")
        assert result is not None
        assert result.name == "Jamie Chen"

    def test_normalized_extra_spaces(self):
        g = TrustGraph()
        g.add_person("Jamie Chen")
        result = g.find_person("  janet   jay  ")
        assert result is not None

    def test_levenshtein_match(self):
        g = TrustGraph()
        g.add_person("Jamie Chen")
        result = g.find_person("Janet Jey")
        assert result is not None
        assert result.name == "Jamie Chen"

    def test_levenshtein_too_far(self):
        g = TrustGraph()
        g.add_person("Jamie Chen")
        g.add_person("Zoe Xyz")
        result = g.find_person("Completely Different Name That Matches Nothing")
        assert result is None

    def test_first_name_unique_match(self):
        g = TrustGraph()
        g.add_person("Jamie Chen")
        g.add_person("Robb DeFilippis")
        result = g.find_person("Janet")
        assert result is not None
        assert result.name == "Jamie Chen"

    def test_first_name_ambiguous(self):
        g = TrustGraph()
        g.add_person("Jamie Chen")
        g.add_person("Janet Smith")
        result = g.find_person("Janet")
        assert result is None

    def test_not_found(self):
        g = TrustGraph()
        assert g.find_person("Nobody") is None

    def test_empty_graph(self):
        g = TrustGraph()
        assert g.find_person("Anyone") is None


# --- Evidence ---

class TestEvidence:
    def test_add_evidence_positive(self):
        g = TrustGraph()
        g.add_person("Jamie Chen")
        ev = _make_evidence(EvidenceType.PROMISE_KEPT, 0.9)
        g.add_evidence("Jamie Chen", ev)
        node = g.find_person("Jamie Chen")
        assert node.scores[TrustDimension.RELIABILITY.value] > DEFAULT_SCORE

    def test_add_evidence_negative(self):
        g = TrustGraph()
        g.add_person("Test Person")
        ev = _make_evidence(EvidenceType.PROMISE_BROKEN, 0.9)
        g.add_evidence("Test Person", ev)
        node = g.find_person("Test Person")
        assert node.scores[TrustDimension.RELIABILITY.value] < DEFAULT_SCORE

    def test_evidence_magnitude_clamped(self):
        ev = Evidence(type=EvidenceType.PROMISE_KEPT, magnitude=1.5, timestamp=_ts())
        assert ev.magnitude == 1.0
        ev2 = Evidence(type=EvidenceType.PROMISE_KEPT, magnitude=-0.5, timestamp=_ts())
        assert ev2.magnitude == 0.0

    def test_score_bounded_high(self):
        g = TrustGraph()
        g.add_person("Super Reliable")
        for _ in range(50):
            g.add_evidence("Super Reliable", _make_evidence(EvidenceType.PROMISE_KEPT, 1.0))
        node = g.find_person("Super Reliable")
        assert node.scores[TrustDimension.RELIABILITY.value] <= SCORE_CEILING

    def test_score_floor(self):
        g = TrustGraph()
        g.add_person("Unreliable")
        for _ in range(50):
            g.add_evidence("Unreliable", _make_evidence(EvidenceType.PROMISE_BROKEN, 1.0))
        node = g.find_person("Unreliable")
        assert node.scores[TrustDimension.RELIABILITY.value] >= SCORE_FLOOR

    def test_unknown_person_raises(self):
        g = TrustGraph()
        with pytest.raises(ValueError, match="Person not found"):
            g.add_evidence("Ghost", _make_evidence(EvidenceType.PROMISE_KEPT, 0.5))

    def test_evidence_tracks_domain(self):
        g = TrustGraph()
        g.add_person("Expert")
        g.add_evidence("Expert", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.9, domain="python"))
        node = g.find_person("Expert")
        assert "python" in node.domains

    def test_evidence_notes(self):
        g = TrustGraph()
        g.add_person("Test")
        g.add_evidence("Test", _make_evidence(EvidenceType.HELPFUL_ACTION, 0.7, notes="Helped with move"))
        node = g.find_person("Test")
        assert node.evidence[0].notes == "Helped with move"

    def test_last_interaction_updated(self):
        g = TrustGraph()
        g.add_person("Test")
        ev = _make_evidence(EvidenceType.TIMELY_RESPONSE, 0.6)
        g.add_evidence("Test", ev)
        node = g.find_person("Test")
        assert node.last_interaction == ev.timestamp

    def test_overall_is_weighted_composite(self):
        g = TrustGraph()
        g.add_person("Test")
        g.add_evidence("Test", _make_evidence(EvidenceType.PROMISE_KEPT, 0.8))
        node = g.find_person("Test")
        expected = (
            node.scores[TrustDimension.RELIABILITY.value] * 0.30
            + node.scores[TrustDimension.INFORMATION_QUALITY.value] * 0.25
            + node.scores[TrustDimension.EMOTIONAL_TRUST.value] * 0.20
            + node.scores[TrustDimension.TIMELINESS.value] * 0.15
            + node.scores[TrustDimension.DOMAIN_EXPERTISE.value] * 0.10
        )
        assert abs(node.scores[TrustDimension.OVERALL.value] - expected) < 0.001


# --- Hermeneutic re-evaluation ---

class TestHermeneuticReeval:
    def test_reeval_triggers_at_interval(self):
        g = TrustGraph()
        g.add_person("Test")
        for i in range(HERMENEUTIC_INTERVAL):
            g.add_evidence("Test", _make_evidence(EvidenceType.PROMISE_KEPT, 0.8, days_ago=i))
        node = g.find_person("Test")
        assert len(node.evidence) == HERMENEUTIC_INTERVAL
        assert node.scores[TrustDimension.RELIABILITY.value] > DEFAULT_SCORE

    def test_reeval_recomputes_from_all_evidence(self):
        g = TrustGraph()
        g.add_person("Test")
        for i in range(3):
            g.add_evidence("Test", _make_evidence(EvidenceType.PROMISE_KEPT, 0.8, days_ago=i))
        for i in range(2):
            g.add_evidence("Test", _make_evidence(EvidenceType.PROMISE_BROKEN, 0.8, days_ago=i))
        node = g.find_person("Test")
        score = node.scores[TrustDimension.RELIABILITY.value]
        assert score != DEFAULT_SCORE

    def test_manual_recompute(self):
        g = TrustGraph()
        node = g.add_person("Test")
        node.evidence.append(_make_evidence(EvidenceType.ACCURATE_INFO, 0.9))
        g.recompute_scores(node)
        assert node.scores[TrustDimension.INFORMATION_QUALITY.value] > DEFAULT_SCORE

    def test_recompute_empty_evidence(self):
        g = TrustGraph()
        node = g.add_person("Test")
        g.recompute_scores(node)
        for dim in TrustDimension:
            if dim != TrustDimension.OVERALL:
                assert node.scores[dim.value] == DEFAULT_SCORE


# --- Decay ---

class TestDecay:
    def test_decay_moves_toward_floor(self):
        g = TrustGraph()
        g.add_person("Old Friend")
        node = g.find_person("Old Friend")
        node.scores[TrustDimension.RELIABILITY.value] = 0.9
        node.last_interaction = _ts(days_ago=60)
        old_score = node.scores[TrustDimension.RELIABILITY.value]
        g.apply_decay()
        new_score = node.scores[TrustDimension.RELIABILITY.value]
        assert new_score < old_score
        assert new_score >= SCORE_FLOOR

    def test_decay_preserves_floor(self):
        g = TrustGraph()
        g.add_person("At Floor")
        node = g.find_person("At Floor")
        node.scores[TrustDimension.RELIABILITY.value] = SCORE_FLOOR
        node.last_interaction = _ts(days_ago=365)
        g.apply_decay()
        assert node.scores[TrustDimension.RELIABILITY.value] == SCORE_FLOOR

    def test_recent_interaction_minimal_decay(self):
        g = TrustGraph()
        g.add_person("Recent")
        node = g.find_person("Recent")
        node.scores[TrustDimension.RELIABILITY.value] = 0.9
        node.last_interaction = _ts(days_ago=0.01)
        g.apply_decay()
        assert node.scores[TrustDimension.RELIABILITY.value] > 0.89

    def test_decay_half_life(self):
        g = TrustGraph()
        g.add_person("HalfLife")
        node = g.find_person("HalfLife")
        node.scores[TrustDimension.RELIABILITY.value] = 0.9
        node.last_interaction = _ts(days_ago=30)
        g.apply_decay()
        score = node.scores[TrustDimension.RELIABILITY.value]
        expected = SCORE_FLOOR + (0.9 - SCORE_FLOOR) * 0.5
        assert abs(score - expected) < 0.01


# --- Domain expertise ---

class TestDomainExpertise:
    def test_domain_tracked(self):
        g = TrustGraph()
        g.add_person("Expert")
        g.add_evidence("Expert", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.9, domain="ml"))
        assert "ml" in g.find_person("Expert").domains

    def test_multiple_domains(self):
        g = TrustGraph()
        g.add_person("Polymath")
        g.add_evidence("Polymath", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.8, domain="python"))
        g.add_evidence("Polymath", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.7, domain="cooking"))
        node = g.find_person("Polymath")
        assert "python" in node.domains
        assert "cooking" in node.domains

    def test_domain_not_duplicated(self):
        g = TrustGraph()
        g.add_person("Expert")
        g.add_evidence("Expert", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.9, domain="python"))
        g.add_evidence("Expert", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.8, domain="python"))
        assert g.find_person("Expert").domains.count("python") == 1

    def test_domain_expertise_affects_score(self):
        g = TrustGraph()
        g.add_person("Expert")
        g.add_evidence("Expert", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.9, domain="python"))
        assert g.find_person("Expert").scores[TrustDimension.DOMAIN_EXPERTISE.value] > DEFAULT_SCORE


# --- Persistence ---

class TestPersistence:
    def test_save_and_load(self):
        g = TrustGraph()
        g.add_person("Jamie Chen", aliases=["JJ"])
        g.add_evidence("Jamie Chen", _make_evidence(EvidenceType.PROMISE_KEPT, 0.9))
        g.add_evidence("Jamie Chen", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.8, domain="leadership"))
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        try:
            g.save(path)
            loaded = TrustGraph.load(path)
            assert loaded.people_count == 1
            node = loaded.find_person("Jamie Chen")
            assert node is not None
            assert "JJ" in node.aliases
            assert len(node.evidence) == 2
            assert "leadership" in node.domains
            orig = g.find_person("Jamie Chen")
            for dim in TrustDimension:
                assert abs(node.scores[dim.value] - orig.scores[dim.value]) < 0.0001
        finally:
            os.unlink(path)

    def test_save_creates_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "subdir", "graph.json")
            g = TrustGraph()
            g.add_person("Test")
            g.save(path)
            assert os.path.exists(path)

    def test_load_nonexistent_raises(self):
        with pytest.raises(FileNotFoundError):
            TrustGraph.load("/nonexistent/path/graph.json")

    def test_to_dict(self):
        g = TrustGraph()
        g.add_person("Test")
        d = g.to_dict()
        assert "version" in d
        assert "people" in d
        assert len(d["people"]) == 1

    def test_empty_graph_roundtrip(self):
        g = TrustGraph()
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        try:
            g.save(path)
            loaded = TrustGraph.load(path)
            assert loaded.people_count == 0
        finally:
            os.unlink(path)


# --- Queries ---

class TestQueries:
    def test_get_score_overall(self):
        g = TrustGraph()
        g.add_person("Test")
        assert g.get_score("Test") == DEFAULT_SCORE

    def test_get_score_specific_dimension(self):
        g = TrustGraph()
        g.add_person("Test")
        g.add_evidence("Test", _make_evidence(EvidenceType.ACCURATE_INFO, 0.8))
        assert g.get_score("Test", TrustDimension.INFORMATION_QUALITY) > DEFAULT_SCORE

    def test_get_score_unknown_person(self):
        g = TrustGraph()
        with pytest.raises(ValueError):
            g.get_score("Ghost")

    def test_get_all_scores(self):
        g = TrustGraph()
        g.add_person("Test")
        scores = g.get_all_scores("Test")
        assert len(scores) == len(TrustDimension)

    def test_get_all_people_sorted(self):
        g = TrustGraph()
        g.add_person("Low")
        g.add_person("High")
        for _ in range(5):
            g.add_evidence("High", _make_evidence(EvidenceType.PROMISE_KEPT, 1.0))
        people = g.get_all_people()
        assert people[0].name == "High"
        assert people[1].name == "Low"

    def test_get_all_people_empty(self):
        g = TrustGraph()
        assert g.get_all_people() == []


# --- Edge cases ---

class TestEdgeCases:
    def test_duplicate_names_different_case(self):
        g = TrustGraph()
        g.add_person("Jamie Chen")
        g.add_person("janet jay")
        assert g.people_count == 1

    def test_evidence_type_from_string(self):
        ev = Evidence(type="promise_kept", magnitude=0.5, timestamp=_ts())
        assert ev.type == EvidenceType.PROMISE_KEPT

    def test_normalize_name(self):
        assert _normalize_name("  John   Doe  ") == "john doe"
        assert _normalize_name("ALICE") == "alice"


# --- Real people scenario ---

class TestRealPeopleScenario:
    def _build_graph(self):
        g = TrustGraph()
        g.add_person("Jamie Chen", aliases=["JJ", "Janet"])
        for _ in range(4):
            g.add_evidence("Jamie Chen", _make_evidence(EvidenceType.PROMISE_KEPT, 0.9))
        g.add_evidence("Jamie Chen", _make_evidence(EvidenceType.ACCURATE_INFO, 0.85))
        g.add_evidence("Jamie Chen", _make_evidence(EvidenceType.EMOTIONAL_SUPPORT, 0.9))
        g.add_evidence("Jamie Chen", _make_evidence(EvidenceType.TIMELY_RESPONSE, 0.8))
        g.add_evidence("Jamie Chen", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.9, domain="leadership"))

        g.add_person("Robb DeFilippis", aliases=["Robb", "RD"])
        g.add_evidence("Robb DeFilippis", _make_evidence(EvidenceType.PROMISE_KEPT, 0.7))
        g.add_evidence("Robb DeFilippis", _make_evidence(EvidenceType.PROMISE_KEPT, 0.8))
        g.add_evidence("Robb DeFilippis", _make_evidence(EvidenceType.ACCURATE_INFO, 0.7))
        g.add_evidence("Robb DeFilippis", _make_evidence(EvidenceType.LATE_RESPONSE, 0.5))
        g.add_evidence("Robb DeFilippis", _make_evidence(EvidenceType.DOMAIN_EXPERTISE_SHOWN, 0.8, domain="finance"))

        g.add_person("Taylor Nguyen-Park", aliases=["Elisabeth", "EDW"])
        g.add_evidence("Taylor Nguyen-Park", _make_evidence(EvidenceType.PROMISE_BROKEN, 0.7))
        g.add_evidence("Taylor Nguyen-Park", _make_evidence(EvidenceType.PROMISE_BROKEN, 0.6))
        g.add_evidence("Taylor Nguyen-Park", _make_evidence(EvidenceType.INACCURATE_INFO, 0.8))
        g.add_evidence("Taylor Nguyen-Park", _make_evidence(EvidenceType.LATE_RESPONSE, 0.7))
        g.add_evidence("Taylor Nguyen-Park", _make_evidence(EvidenceType.EMOTIONAL_HARM, 0.5))
        return g

    def test_trust_ordering(self):
        g = self._build_graph()
        people = g.get_all_people()
        assert people[0].name == "Jamie Chen"
        assert people[-1].name == "Taylor Nguyen-Park"

    def test_janet_high_reliability(self):
        g = self._build_graph()
        assert g.get_score("Jamie Chen", TrustDimension.RELIABILITY) > 0.65

    def test_elisabeth_low_reliability(self):
        g = self._build_graph()
        assert g.get_score("Taylor Nguyen-Park", TrustDimension.RELIABILITY) < DEFAULT_SCORE

    def test_fuzzy_find_robb(self):
        g = self._build_graph()
        assert g.find_person("RD").name == "Robb DeFilippis"
        assert g.find_person("Robb").name == "Robb DeFilippis"

    def test_fuzzy_find_elisabeth_alias(self):
        g = self._build_graph()
        assert g.find_person("EDW").name == "Taylor Nguyen-Park"

    def test_domain_tracking(self):
        g = self._build_graph()
        assert "leadership" in g.find_person("Jamie Chen").domains
        assert "finance" in g.find_person("Robb DeFilippis").domains

    def test_persistence_roundtrip(self):
        g = self._build_graph()
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        try:
            g.save(path)
            loaded = TrustGraph.load(path)
            assert loaded.people_count == 3
            people = loaded.get_all_people()
            assert people[0].name == "Jamie Chen"
            assert people[-1].name == "Taylor Nguyen-Park"
        finally:
            os.unlink(path)

    def test_overall_scores_differ(self):
        g = self._build_graph()
        janet = g.get_score("Jamie Chen")
        robb = g.get_score("Robb DeFilippis")
        elisabeth = g.get_score("Taylor Nguyen-Park")
        assert janet > robb > elisabeth
