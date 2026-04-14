"""
Cognitive Memory System — 3-tier memory architecture mimicking human cognition.

Implements short/medium/long-term memory with Jaccard deduplication,
weighted promotion scoring, episodic memory, and sleep-like consolidation.

Part of the Agent Friday cognitive architecture.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Stop words for Jaccard filtering
# ---------------------------------------------------------------------------
STOP_WORDS: set[str] = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "as", "was", "are", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can", "this",
    "that", "these", "those", "i", "you", "he", "she", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
    "their", "not", "no", "so", "if", "then", "than", "too", "very",
    "just", "about", "up", "out", "into", "over", "after", "before",
}

JACCARD_THRESHOLD = 0.80
PROMOTION_SCORE_THRESHOLD = 10
PROMOTION_OCCURRENCES_MIN = 3
STALENESS_DAYS = 14


class MemoryTier(str, Enum):
    SHORT = "short"
    MEDIUM = "medium"
    LONG = "long"


@dataclass
class MemoryEntry:
    content: str
    tier: MemoryTier
    confidence: float = 0.5
    occurrences: int = 1
    first_seen: str = ""
    last_seen: str = ""
    source: Optional[str] = None
    domain: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    sessions: int = 1
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])

    def __post_init__(self) -> None:
        now = _now_iso()
        if not self.first_seen:
            self.first_seen = now
        if not self.last_seen:
            self.last_seen = now
        if isinstance(self.tier, str):
            self.tier = MemoryTier(self.tier)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["tier"] = self.tier.value
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MemoryEntry":
        return cls(**d)


@dataclass
class Episode:
    timestamp: str = ""
    summary: str = ""
    topics: list[str] = field(default_factory=list)
    emotional_tone: str = "neutral"
    key_decisions: list[str] = field(default_factory=list)
    entries: list[str] = field(default_factory=list)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = _now_iso()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Episode":
        return cls(**d)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _days_since(iso_str: str) -> float:
    dt = datetime.fromisoformat(iso_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    return delta.total_seconds() / 86400


def _tokenize(text: str) -> set[str]:
    words = set(text.lower().split())
    return words - STOP_WORDS


class CognitiveMemory:
    def __init__(self) -> None:
        self.entries: list[MemoryEntry] = []
        self.episodes: list[Episode] = []
        self.last_consolidation: Optional[str] = None

    def add(self, content: str, tier: MemoryTier = MemoryTier.SHORT,
            confidence: float = 0.5, source: Optional[str] = None,
            domain: Optional[str] = None, tags: Optional[list[str]] = None) -> MemoryEntry:
        if isinstance(tier, str):
            tier = MemoryTier(tier)
        for existing in self._tier_entries(tier):
            if self.jaccard_similarity(content, existing.content) >= JACCARD_THRESHOLD:
                existing.occurrences += 1
                existing.last_seen = _now_iso()
                existing.confidence = max(existing.confidence, confidence)
                if source and source != existing.source:
                    existing.sessions += 1
                return existing
        entry = MemoryEntry(content=content, tier=tier, confidence=confidence,
                            source=source, domain=domain, tags=tags or [])
        self.entries.append(entry)
        return entry

    def find(self, query: str, tier: Optional[MemoryTier] = None) -> list[MemoryEntry]:
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []
        scored: list[tuple[float, MemoryEntry]] = []
        pool = self._tier_entries(tier) if tier else self.entries
        for entry in pool:
            sim = self._jaccard_tokens(query_tokens, _tokenize(entry.content))
            if sim > 0:
                scored.append((sim, entry))
        scored.sort(key=lambda t: t[0], reverse=True)
        return [entry for _, entry in scored]

    @staticmethod
    def jaccard_similarity(a: str, b: str) -> float:
        set_a = _tokenize(a)
        set_b = _tokenize(b)
        if not set_a or not set_b:
            return 0.0
        return len(set_a & set_b) / len(set_a | set_b)

    @staticmethod
    def _jaccard_tokens(set_a: set[str], set_b: set[str]) -> float:
        if not set_a or not set_b:
            return 0.0
        return len(set_a & set_b) / len(set_a | set_b)

    def deduplicate(self, tier: MemoryTier) -> int:
        tier_entries = self._tier_entries(tier)
        if len(tier_entries) < 2:
            return 0
        merged_ids: set[str] = set()
        for i, a in enumerate(tier_entries):
            if a.id in merged_ids:
                continue
            for b in tier_entries[i + 1:]:
                if b.id in merged_ids:
                    continue
                if self.jaccard_similarity(a.content, b.content) >= JACCARD_THRESHOLD:
                    a.occurrences += b.occurrences
                    a.sessions += b.sessions
                    a.confidence = max(a.confidence, b.confidence)
                    a.last_seen = max(a.last_seen, b.last_seen)
                    a.first_seen = min(a.first_seen, b.first_seen)
                    if len(b.content) > len(a.content):
                        a.content = b.content
                    merged_ids.add(b.id)
        before = len(self.entries)
        self.entries = [e for e in self.entries if e.id not in merged_ids]
        return before - len(self.entries)

    @staticmethod
    def compute_promotion_score(entry: MemoryEntry) -> float:
        score = 0.0
        score += min(entry.occurrences * 2, 20)
        score += min(entry.sessions * 2, 10)
        if _days_since(entry.first_seen) >= 7:
            score += 5
        if entry.confidence >= 0.9:
            score += 3
        if _days_since(entry.last_seen) > STALENESS_DAYS:
            score -= 5
        return score

    def promote(self) -> list[MemoryEntry]:
        promoted: list[MemoryEntry] = []
        for entry in self._tier_entries(MemoryTier.MEDIUM):
            score = self.compute_promotion_score(entry)
            if score >= PROMOTION_SCORE_THRESHOLD and entry.occurrences >= PROMOTION_OCCURRENCES_MIN:
                entry.tier = MemoryTier.LONG
                promoted.append(entry)
        return promoted

    def demote(self) -> list[MemoryEntry]:
        demoted: list[MemoryEntry] = []
        for entry in self._tier_entries(MemoryTier.LONG):
            if _days_since(entry.last_seen) > STALENESS_DAYS:
                entry.tier = MemoryTier.MEDIUM
                demoted.append(entry)
        return demoted

    def consolidate(self) -> dict[str, Any]:
        results: dict[str, Any] = {
            "dedup_short": self.deduplicate(MemoryTier.SHORT),
            "dedup_medium": self.deduplicate(MemoryTier.MEDIUM),
            "dedup_long": self.deduplicate(MemoryTier.LONG),
            "promoted": len(self.promote()),
            "demoted": len(self.demote()),
        }
        self.last_consolidation = _now_iso()
        results["timestamp"] = self.last_consolidation
        return results

    def record_episode(self, summary: str, topics: Optional[list[str]] = None,
                       tone: str = "neutral", decisions: Optional[list[str]] = None,
                       entries: Optional[list[str]] = None) -> Episode:
        episode = Episode(summary=summary, topics=topics or [],
                          emotional_tone=tone, key_decisions=decisions or [],
                          entries=entries or [])
        self.episodes.append(episode)
        return episode

    def get_episodes(self, limit: int = 10) -> list[Episode]:
        return self.episodes[-limit:]

    def get_stats(self) -> dict[str, Any]:
        return {
            "short": len(self._tier_entries(MemoryTier.SHORT)),
            "medium": len(self._tier_entries(MemoryTier.MEDIUM)),
            "long": len(self._tier_entries(MemoryTier.LONG)),
            "total": len(self.entries),
            "episodes": len(self.episodes),
            "last_consolidation": self.last_consolidation,
        }

    def save(self, filepath: str | Path) -> None:
        data = {
            "entries": [e.to_dict() for e in self.entries],
            "episodes": [ep.to_dict() for ep in self.episodes],
            "last_consolidation": self.last_consolidation,
        }
        Path(filepath).write_text(json.dumps(data, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, filepath: str | Path) -> "CognitiveMemory":
        data = json.loads(Path(filepath).read_text(encoding="utf-8"))
        mem = cls()
        mem.entries = [MemoryEntry.from_dict(d) for d in data.get("entries", [])]
        mem.episodes = [Episode.from_dict(d) for d in data.get("episodes", [])]
        mem.last_consolidation = data.get("last_consolidation")
        return mem

    def _tier_entries(self, tier: Optional[MemoryTier] = None) -> list[MemoryEntry]:
        if tier is None:
            return list(self.entries)
        return [e for e in self.entries if e.tier == tier]
