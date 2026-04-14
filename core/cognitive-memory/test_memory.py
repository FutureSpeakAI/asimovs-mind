"""
Comprehensive tests for the Cognitive Memory system.

Covers: entry creation, Jaccard similarity, deduplication, promotion scoring,
promotion/demotion cycles, consolidation, episodic memory, persistence, edge cases.
"""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from memory import (
    JACCARD_THRESHOLD,
    PROMOTION_OCCURRENCES_MIN,
    PROMOTION_SCORE_THRESHOLD,
    STALENESS_DAYS,
    CognitiveMemory,
    Episode,
    MemoryEntry,
    MemoryTier,
    _now_iso,
    _tokenize,
)


# ===========================================================================
# Entry creation across all tiers
# ===========================================================================

class TestEntryCreation:
    def test_create_short_term(self):
        mem = CognitiveMemory()
        e = mem.add("user prefers dark mode", tier=MemoryTier.SHORT)
        assert e.tier == MemoryTier.SHORT
        assert e.confidence == 0.5
        assert e.occurrences == 1
        assert e.content == "user prefers dark mode"

    def test_create_medium_term(self):
        mem = CognitiveMemory()
        e = mem.add("user prefers dark mode", tier=MemoryTier.MEDIUM, confidence=0.7)
        assert e.tier == MemoryTier.MEDIUM
        assert e.confidence == 0.7

    def test_create_long_term(self):
        mem = CognitiveMemory()
        e = mem.add("user prefers dark mode", tier=MemoryTier.LONG, confidence=0.95)
        assert e.tier == MemoryTier.LONG
        assert e.confidence == 0.95

    def test_string_tier_accepted(self):
        mem = CognitiveMemory()
        e = mem.add("test", tier="medium")
        assert e.tier == MemoryTier.MEDIUM

    def test_source_and_domain(self):
        mem = CognitiveMemory()
        e = mem.add("fact", source="conversation-42", domain="preferences")
        assert e.source == "conversation-42"
        assert e.domain == "preferences"

    def test_tags(self):
        mem = CognitiveMemory()
        e = mem.add("fact", tags=["ui", "preference"])
        assert e.tags == ["ui", "preference"]

    def test_reinforce_existing(self):
        """Adding near-duplicate content should reinforce, not create new."""
        mem = CognitiveMemory()
        e1 = mem.add("user prefers dark mode")
        e2 = mem.add("user prefers dark mode")
        assert e1.id == e2.id
        assert e1.occurrences == 2
        assert len(mem.entries) == 1


# ===========================================================================
# Jaccard similarity
# ===========================================================================

class TestJaccardSimilarity:
    def test_identical_strings(self):
        sim = CognitiveMemory.jaccard_similarity(
            "the user prefers dark mode",
            "the user prefers dark mode",
        )
        assert sim == 1.0

    def test_similar_strings(self):
        sim = CognitiveMemory.jaccard_similarity(
            "user prefers dark mode",
            "user likes dark mode",
        )
        # tokens: {user, prefers, dark, mode} vs {user, likes, dark, mode}
        # intersection: {user, dark, mode} = 3, union: {user, prefers, likes, dark, mode} = 5
        assert abs(sim - 3 / 5) < 0.01

    def test_completely_different(self):
        sim = CognitiveMemory.jaccard_similarity(
            "python programming language",
            "chocolate cake recipe",
        )
        assert sim == 0.0

    def test_stop_words_filtered(self):
        # "the" and "a" are stop words — should be removed
        sim = CognitiveMemory.jaccard_similarity(
            "the cat sat",
            "a cat sat",
        )
        # After filtering: {cat, sat} vs {cat, sat} → 1.0
        assert sim == 1.0

    def test_empty_after_filtering(self):
        sim = CognitiveMemory.jaccard_similarity("the", "a")
        assert sim == 0.0

    def test_empty_string(self):
        sim = CognitiveMemory.jaccard_similarity("", "hello")
        assert sim == 0.0

    def test_both_empty(self):
        sim = CognitiveMemory.jaccard_similarity("", "")
        assert sim == 0.0


# ===========================================================================
# Tokenizer
# ===========================================================================

class TestTokenizer:
    def test_basic(self):
        tokens = _tokenize("The quick brown fox")
        assert "the" not in tokens
        assert "quick" in tokens
        assert "brown" in tokens
        assert "fox" in tokens

    def test_all_stop_words(self):
        tokens = _tokenize("the a an is are")
        assert tokens == set()


# ===========================================================================
# Deduplication
# ===========================================================================

class TestDeduplication:
    def test_merges_similar_entries(self):
        mem = CognitiveMemory()
        # Force two separate entries with high similarity
        # "user prefers dark mode" → {user, prefers, dark, mode} (4 tokens)
        # "user prefers dark mode settings" → {user, prefers, dark, mode, settings} (5 tokens)
        # Jaccard: 4/5 = 0.80 → meets threshold
        e1 = MemoryEntry(content="user prefers dark mode", tier=MemoryTier.MEDIUM)
        e2 = MemoryEntry(content="user prefers dark mode settings", tier=MemoryTier.MEDIUM)
        mem.entries = [e1, e2]
        removed = mem.deduplicate(MemoryTier.MEDIUM)
        assert removed == 1
        assert len(mem.entries) == 1
        # Merged entry should have combined occurrences
        assert mem.entries[0].occurrences == 2

    def test_keeps_different_entries(self):
        mem = CognitiveMemory()
        e1 = MemoryEntry(content="user prefers dark mode", tier=MemoryTier.MEDIUM)
        e2 = MemoryEntry(content="python programming language", tier=MemoryTier.MEDIUM)
        mem.entries = [e1, e2]
        removed = mem.deduplicate(MemoryTier.MEDIUM)
        assert removed == 0
        assert len(mem.entries) == 2

    def test_only_deduplicates_within_tier(self):
        mem = CognitiveMemory()
        e1 = MemoryEntry(content="user prefers dark mode", tier=MemoryTier.SHORT)
        e2 = MemoryEntry(content="user prefers dark modes", tier=MemoryTier.MEDIUM)
        mem.entries = [e1, e2]
        removed = mem.deduplicate(MemoryTier.SHORT)
        assert removed == 0  # e2 is in a different tier

    def test_keeps_longer_content(self):
        mem = CognitiveMemory()
        e1 = MemoryEntry(content="dark mode", tier=MemoryTier.MEDIUM)
        e2 = MemoryEntry(content="dark mode preferred", tier=MemoryTier.MEDIUM)
        mem.entries = [e1, e2]
        # Jaccard: {dark, mode} vs {dark, mode, preferred} = 2/3 ≈ 0.67 < 0.80
        # These won't merge — that's correct, they're not similar enough
        removed = mem.deduplicate(MemoryTier.MEDIUM)
        assert removed == 0

    def test_merge_preserves_best_confidence(self):
        mem = CognitiveMemory()
        e1 = MemoryEntry(content="user prefers dark mode", tier=MemoryTier.MEDIUM, confidence=0.6)
        e2 = MemoryEntry(content="user prefers dark mode settings", tier=MemoryTier.MEDIUM, confidence=0.9)
        mem.entries = [e1, e2]
        mem.deduplicate(MemoryTier.MEDIUM)
        assert mem.entries[0].confidence == 0.9

    def test_single_entry(self):
        mem = CognitiveMemory()
        e1 = MemoryEntry(content="hello world", tier=MemoryTier.SHORT)
        mem.entries = [e1]
        removed = mem.deduplicate(MemoryTier.SHORT)
        assert removed == 0

    def test_empty_tier(self):
        mem = CognitiveMemory()
        removed = mem.deduplicate(MemoryTier.SHORT)
        assert removed == 0


# ===========================================================================
# Promotion scoring
# ===========================================================================

class TestPromotionScoring:
    def test_frequency_component(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            occurrences=5,
            sessions=1,
        )
        score = CognitiveMemory.compute_promotion_score(entry)
        # freq: min(5*2, 20) = 10, sessions: min(1*2, 10) = 2
        # time-span: 0 days → 0, confidence 0.5 → 0, staleness: 0 days → 0
        assert score == 12.0

    def test_frequency_capped(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            occurrences=50,
            sessions=1,
        )
        score = CognitiveMemory.compute_promotion_score(entry)
        # freq capped at 20, sessions: 2
        assert score == 22.0

    def test_cross_session_component(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            occurrences=1,
            sessions=5,
        )
        score = CognitiveMemory.compute_promotion_score(entry)
        # freq: 2, sessions: min(5*2, 10) = 10
        assert score == 12.0

    def test_cross_session_capped(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            occurrences=1,
            sessions=20,
        )
        score = CognitiveMemory.compute_promotion_score(entry)
        # freq: 2, sessions capped at 10
        assert score == 12.0

    def test_time_span_bonus(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            occurrences=1,
            sessions=1,
        )
        # Set first_seen to 10 days ago
        entry.first_seen = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        score = CognitiveMemory.compute_promotion_score(entry)
        # freq: 2, sessions: 2, time-span: +5
        assert score == 9.0

    def test_confidence_bonus(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            occurrences=1,
            sessions=1,
            confidence=0.95,
        )
        score = CognitiveMemory.compute_promotion_score(entry)
        # freq: 2, sessions: 2, confidence: +3
        assert score == 7.0

    def test_staleness_penalty(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            occurrences=1,
            sessions=1,
        )
        # Set last_seen to 20 days ago
        entry.last_seen = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        score = CognitiveMemory.compute_promotion_score(entry)
        # freq: 2, sessions: 2, staleness: -5
        assert score == -1.0

    def test_all_bonuses_combined(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            occurrences=10,
            sessions=5,
            confidence=0.95,
        )
        entry.first_seen = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        score = CognitiveMemory.compute_promotion_score(entry)
        # freq: 20, sessions: 10, time-span: +5, confidence: +3 = 38
        assert score == 38.0

    def test_all_penalties(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            occurrences=1,
            sessions=1,
            confidence=0.3,
        )
        entry.last_seen = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        score = CognitiveMemory.compute_promotion_score(entry)
        # freq: 2, sessions: 2, staleness: -5 = -1
        assert score == -1.0


# ===========================================================================
# Promotion cycle
# ===========================================================================

class TestPromotionCycle:
    def test_qualified_entry_promotes(self):
        mem = CognitiveMemory()
        entry = MemoryEntry(
            content="confirmed fact",
            tier=MemoryTier.MEDIUM,
            occurrences=5,
            sessions=3,
            confidence=0.9,
        )
        mem.entries = [entry]
        promoted = mem.promote()
        assert len(promoted) == 1
        assert entry.tier == MemoryTier.LONG

    def test_unqualified_stays(self):
        mem = CognitiveMemory()
        entry = MemoryEntry(
            content="weak observation",
            tier=MemoryTier.MEDIUM,
            occurrences=1,
            sessions=1,
            confidence=0.3,
        )
        mem.entries = [entry]
        promoted = mem.promote()
        assert len(promoted) == 0
        assert entry.tier == MemoryTier.MEDIUM

    def test_insufficient_occurrences(self):
        """High score but < 3 occurrences should NOT promote."""
        mem = CognitiveMemory()
        entry = MemoryEntry(
            content="seen once but confident",
            tier=MemoryTier.MEDIUM,
            occurrences=2,
            sessions=5,
            confidence=0.95,
        )
        mem.entries = [entry]
        promoted = mem.promote()
        assert len(promoted) == 0
        assert entry.tier == MemoryTier.MEDIUM

    def test_only_medium_considered(self):
        """Short-term entries should not be promoted."""
        mem = CognitiveMemory()
        entry = MemoryEntry(
            content="short term fact",
            tier=MemoryTier.SHORT,
            occurrences=10,
            sessions=5,
            confidence=0.95,
        )
        mem.entries = [entry]
        promoted = mem.promote()
        assert len(promoted) == 0
        assert entry.tier == MemoryTier.SHORT


# ===========================================================================
# Demotion
# ===========================================================================

class TestDemotion:
    def test_stale_long_term_demotes(self):
        mem = CognitiveMemory()
        entry = MemoryEntry(content="old fact", tier=MemoryTier.LONG)
        entry.last_seen = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        mem.entries = [entry]
        demoted = mem.demote()
        assert len(demoted) == 1
        assert entry.tier == MemoryTier.MEDIUM

    def test_fresh_long_term_stays(self):
        mem = CognitiveMemory()
        entry = MemoryEntry(content="recent fact", tier=MemoryTier.LONG)
        mem.entries = [entry]
        demoted = mem.demote()
        assert len(demoted) == 0
        assert entry.tier == MemoryTier.LONG

    def test_medium_not_demoted(self):
        mem = CognitiveMemory()
        entry = MemoryEntry(content="medium fact", tier=MemoryTier.MEDIUM)
        entry.last_seen = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        mem.entries = [entry]
        demoted = mem.demote()
        assert len(demoted) == 0  # Only long-term gets demoted


# ===========================================================================
# Full consolidation cycle
# ===========================================================================

class TestConsolidation:
    def test_full_cycle(self):
        mem = CognitiveMemory()

        # Add duplicates in medium tier (Jaccard 4/5 = 0.80)
        e1 = MemoryEntry(content="user prefers dark mode", tier=MemoryTier.MEDIUM)
        e2 = MemoryEntry(content="user prefers dark mode settings", tier=MemoryTier.MEDIUM)

        # Add a promotable entry
        e3 = MemoryEntry(
            content="python expert confirmed",
            tier=MemoryTier.MEDIUM,
            occurrences=5,
            sessions=3,
            confidence=0.95,
        )

        # Add a stale long-term entry
        e4 = MemoryEntry(content="old stale knowledge", tier=MemoryTier.LONG)
        e4.last_seen = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

        mem.entries = [e1, e2, e3, e4]
        results = mem.consolidate()

        assert results["dedup_medium"] >= 1
        assert results["promoted"] >= 1
        assert results["demoted"] >= 1
        assert results["timestamp"] is not None
        assert mem.last_consolidation is not None

    def test_consolidation_on_empty(self):
        mem = CognitiveMemory()
        results = mem.consolidate()
        assert results["dedup_short"] == 0
        assert results["dedup_medium"] == 0
        assert results["dedup_long"] == 0
        assert results["promoted"] == 0
        assert results["demoted"] == 0


# ===========================================================================
# Episodic memory
# ===========================================================================

class TestEpisodicMemory:
    def test_record_episode(self):
        mem = CognitiveMemory()
        ep = mem.record_episode(
            summary="Discussed project architecture",
            topics=["architecture", "microservices"],
            tone="productive",
            decisions=["Use event sourcing", "Deploy to K8s"],
            entries=["abc123"],
        )
        assert ep.summary == "Discussed project architecture"
        assert ep.topics == ["architecture", "microservices"]
        assert ep.emotional_tone == "productive"
        assert ep.key_decisions == ["Use event sourcing", "Deploy to K8s"]
        assert ep.entries == ["abc123"]
        assert len(mem.episodes) == 1

    def test_get_episodes_limit(self):
        mem = CognitiveMemory()
        for i in range(20):
            mem.record_episode(summary=f"Episode {i}")
        recent = mem.get_episodes(limit=5)
        assert len(recent) == 5
        assert recent[0].summary == "Episode 15"
        assert recent[4].summary == "Episode 19"

    def test_get_episodes_fewer_than_limit(self):
        mem = CognitiveMemory()
        mem.record_episode(summary="Only one")
        recent = mem.get_episodes(limit=10)
        assert len(recent) == 1

    def test_episode_defaults(self):
        ep = Episode(summary="test")
        assert ep.emotional_tone == "neutral"
        assert ep.topics == []
        assert ep.key_decisions == []
        assert ep.entries == []
        assert ep.timestamp  # auto-filled


# ===========================================================================
# Find / search
# ===========================================================================

class TestFind:
    def test_finds_matching_entry(self):
        mem = CognitiveMemory()
        mem.add("user prefers dark mode", tier=MemoryTier.MEDIUM)
        mem.add("python programming tips", tier=MemoryTier.MEDIUM)
        results = mem.find("dark mode preference")
        assert len(results) >= 1
        assert "dark" in results[0].content

    def test_find_filters_by_tier(self):
        mem = CognitiveMemory()
        mem.add("dark mode", tier=MemoryTier.SHORT)
        mem.add("dark mode", tier=MemoryTier.LONG)
        results = mem.find("dark mode", tier=MemoryTier.LONG)
        assert all(e.tier == MemoryTier.LONG for e in results)

    def test_find_empty_query(self):
        mem = CognitiveMemory()
        mem.add("something")
        results = mem.find("")
        assert results == []

    def test_find_no_matches(self):
        mem = CognitiveMemory()
        mem.add("user prefers dark mode")
        results = mem.find("quantum physics entanglement")
        assert results == []


# ===========================================================================
# JSON persistence round-trip
# ===========================================================================

class TestPersistence:
    def test_save_load_roundtrip(self):
        mem = CognitiveMemory()
        mem.add("user prefers dark mode", tier=MemoryTier.MEDIUM, confidence=0.8)
        mem.add("python expert", tier=MemoryTier.LONG, confidence=0.95)
        mem.record_episode(
            summary="Test session",
            topics=["testing"],
            tone="focused",
            decisions=["write more tests"],
        )
        mem.last_consolidation = _now_iso()

        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name

        mem.save(path)
        loaded = CognitiveMemory.load(path)

        assert len(loaded.entries) == 2
        assert loaded.entries[0].content == "user prefers dark mode"
        assert loaded.entries[0].tier == MemoryTier.MEDIUM
        assert loaded.entries[0].confidence == 0.8
        assert loaded.entries[1].content == "python expert"
        assert loaded.entries[1].tier == MemoryTier.LONG

        assert len(loaded.episodes) == 1
        assert loaded.episodes[0].summary == "Test session"
        assert loaded.episodes[0].topics == ["testing"]

        assert loaded.last_consolidation == mem.last_consolidation

        Path(path).unlink()

    def test_save_empty_memory(self):
        mem = CognitiveMemory()
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        mem.save(path)
        loaded = CognitiveMemory.load(path)
        assert len(loaded.entries) == 0
        assert len(loaded.episodes) == 0
        Path(path).unlink()

    def test_json_structure(self):
        mem = CognitiveMemory()
        mem.add("test entry", tier=MemoryTier.SHORT)
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        mem.save(path)
        data = json.loads(Path(path).read_text())
        assert "entries" in data
        assert "episodes" in data
        assert "last_consolidation" in data
        assert data["entries"][0]["tier"] == "short"
        Path(path).unlink()


# ===========================================================================
# Edge cases
# ===========================================================================

class TestEdgeCases:
    def test_empty_memory_stats(self):
        mem = CognitiveMemory()
        stats = mem.get_stats()
        assert stats["short"] == 0
        assert stats["medium"] == 0
        assert stats["long"] == 0
        assert stats["total"] == 0
        assert stats["episodes"] == 0
        assert stats["last_consolidation"] is None

    def test_single_entry_operations(self):
        mem = CognitiveMemory()
        mem.add("solo entry", tier=MemoryTier.MEDIUM)
        assert mem.deduplicate(MemoryTier.MEDIUM) == 0
        assert len(mem.promote()) == 0
        assert len(mem.demote()) == 0

    def test_all_tiers_populated(self):
        mem = CognitiveMemory()
        mem.add("short item", tier=MemoryTier.SHORT)
        mem.add("medium item", tier=MemoryTier.MEDIUM)
        mem.add("long item", tier=MemoryTier.LONG)
        stats = mem.get_stats()
        assert stats["short"] == 1
        assert stats["medium"] == 1
        assert stats["long"] == 1
        assert stats["total"] == 3

    def test_entry_serialization_roundtrip(self):
        entry = MemoryEntry(
            content="test",
            tier=MemoryTier.MEDIUM,
            confidence=0.85,
            occurrences=3,
            source="conv-1",
            domain="prefs",
            tags=["a", "b"],
        )
        d = entry.to_dict()
        restored = MemoryEntry.from_dict(d)
        assert restored.content == entry.content
        assert restored.tier == entry.tier
        assert restored.confidence == entry.confidence
        assert restored.occurrences == entry.occurrences
        assert restored.source == entry.source
        assert restored.domain == entry.domain
        assert restored.tags == entry.tags

    def test_episode_serialization_roundtrip(self):
        ep = Episode(
            summary="test",
            topics=["a"],
            emotional_tone="happy",
            key_decisions=["decide"],
            entries=["id1"],
        )
        d = ep.to_dict()
        restored = Episode.from_dict(d)
        assert restored.summary == ep.summary
        assert restored.topics == ep.topics
        assert restored.emotional_tone == ep.emotional_tone
        assert restored.key_decisions == ep.key_decisions

    def test_memory_tier_enum_values(self):
        assert MemoryTier.SHORT.value == "short"
        assert MemoryTier.MEDIUM.value == "medium"
        assert MemoryTier.LONG.value == "long"

    def test_reinforce_across_sources_increments_sessions(self):
        mem = CognitiveMemory()
        mem.add("user prefers dark mode", source="session-1")
        mem.add("user prefers dark mode", source="session-2")
        assert mem.entries[0].sessions == 2
        assert mem.entries[0].occurrences == 2

    def test_reinforce_same_source_no_session_increment(self):
        mem = CognitiveMemory()
        mem.add("user prefers dark mode", source="session-1")
        mem.add("user prefers dark mode", source="session-1")
        assert mem.entries[0].sessions == 1
        assert mem.entries[0].occurrences == 2
