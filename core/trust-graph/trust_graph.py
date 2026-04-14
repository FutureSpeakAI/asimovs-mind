"""
Trust Graph - Phase 3: Person-level credibility model.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class TrustDimension(str, Enum):
    RELIABILITY = "reliability"
    INFORMATION_QUALITY = "information_quality"
    EMOTIONAL_TRUST = "emotional_trust"
    TIMELINESS = "timeliness"
    DOMAIN_EXPERTISE = "domain_expertise"
    OVERALL = "overall"


class EvidenceType(str, Enum):
    PROMISE_KEPT = "promise_kept"
    PROMISE_BROKEN = "promise_broken"
    ACCURATE_INFO = "accurate_info"
    INACCURATE_INFO = "inaccurate_info"
    EMOTIONAL_SUPPORT = "emotional_support"
    EMOTIONAL_HARM = "emotional_harm"
    TIMELY_RESPONSE = "timely_response"
    LATE_RESPONSE = "late_response"
    HELPFUL_ACTION = "helpful_action"
    UNHELPFUL_ACTION = "unhelpful_action"
    DOMAIN_EXPERTISE_SHOWN = "domain_expertise_shown"
    DOMAIN_EXPERTISE_LACKING = "domain_expertise_lacking"


EVIDENCE_DIMENSION_MAP: Dict[EvidenceType, Tuple[TrustDimension, bool]] = {
    EvidenceType.PROMISE_KEPT: (TrustDimension.RELIABILITY, True),
    EvidenceType.PROMISE_BROKEN: (TrustDimension.RELIABILITY, False),
    EvidenceType.ACCURATE_INFO: (TrustDimension.INFORMATION_QUALITY, True),
    EvidenceType.INACCURATE_INFO: (TrustDimension.INFORMATION_QUALITY, False),
    EvidenceType.EMOTIONAL_SUPPORT: (TrustDimension.EMOTIONAL_TRUST, True),
    EvidenceType.EMOTIONAL_HARM: (TrustDimension.EMOTIONAL_TRUST, False),
    EvidenceType.TIMELY_RESPONSE: (TrustDimension.TIMELINESS, True),
    EvidenceType.LATE_RESPONSE: (TrustDimension.TIMELINESS, False),
    EvidenceType.HELPFUL_ACTION: (TrustDimension.RELIABILITY, True),
    EvidenceType.UNHELPFUL_ACTION: (TrustDimension.RELIABILITY, False),
    EvidenceType.DOMAIN_EXPERTISE_SHOWN: (TrustDimension.DOMAIN_EXPERTISE, True),
    EvidenceType.DOMAIN_EXPERTISE_LACKING: (TrustDimension.DOMAIN_EXPERTISE, False),
}

DIMENSION_WEIGHTS: Dict[TrustDimension, float] = {
    TrustDimension.RELIABILITY: 0.30,
    TrustDimension.INFORMATION_QUALITY: 0.25,
    TrustDimension.EMOTIONAL_TRUST: 0.20,
    TrustDimension.TIMELINESS: 0.15,
    TrustDimension.DOMAIN_EXPERTISE: 0.10,
}

DEFAULT_SCORE = 0.5
SCORE_FLOOR = 0.3
DECAY_HALF_LIFE_DAYS = 30.0
HERMENEUTIC_INTERVAL = 5
SCORE_CEILING = 1.0


@dataclass
class Evidence:
    type: EvidenceType
    magnitude: float
    timestamp: str
    domain: Optional[str] = None
    notes: Optional[str] = None

    def __post_init__(self) -> None:
        if isinstance(self.type, str):
            self.type = EvidenceType(self.type)
        self.magnitude = max(0.0, min(1.0, float(self.magnitude)))

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type.value, "magnitude": self.magnitude,
                "timestamp": self.timestamp, "domain": self.domain, "notes": self.notes}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Evidence":
        return cls(type=EvidenceType(data["type"]), magnitude=data["magnitude"],
                   timestamp=data["timestamp"], domain=data.get("domain"), notes=data.get("notes"))


@dataclass
class PersonNode:
    name: str
    aliases: List[str] = field(default_factory=list)
    scores: Dict[str, float] = field(default_factory=dict)
    evidence: List[Evidence] = field(default_factory=list)
    domains: List[str] = field(default_factory=list)
    last_interaction: Optional[str] = None
    creation_date: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.scores:
            for dim in TrustDimension:
                self.scores[dim.value] = DEFAULT_SCORE
        if self.creation_date is None:
            self.creation_date = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "aliases": self.aliases, "scores": self.scores,
                "evidence": [e.to_dict() for e in self.evidence], "domains": self.domains,
                "last_interaction": self.last_interaction, "creation_date": self.creation_date}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PersonNode":
        return cls(name=data["name"], aliases=data.get("aliases", []),
                   scores=data.get("scores", {}),
                   evidence=[Evidence.from_dict(e) for e in data.get("evidence", [])],
                   domains=data.get("domains", []),
                   last_interaction=data.get("last_interaction"),
                   creation_date=data.get("creation_date"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _parse_iso(ts: str) -> datetime:
    ts = ts.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return datetime.fromisoformat(ts.split(".")[0] + "+00:00")

def levenshtein_distance(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            curr_row.append(min(prev_row[j + 1] + 1, curr_row[j] + 1,
                                prev_row[j] + (0 if c1 == c2 else 1)))
        prev_row = curr_row
    return prev_row[-1]

def _normalize_name(name: str) -> str:
    return " ".join(name.lower().strip().split())

def _first_name(name: str) -> str:
    parts = name.strip().split()
    return parts[0].lower() if parts else ""


class TrustGraph:
    def __init__(self) -> None:
        self._people: Dict[str, PersonNode] = {}

    def add_person(self, name: str, aliases: Optional[List[str]] = None) -> PersonNode:
        key = _normalize_name(name)
        if key in self._people:
            if aliases:
                for a in aliases:
                    if a not in self._people[key].aliases:
                        self._people[key].aliases.append(a)
            return self._people[key]
        node = PersonNode(name=name, aliases=aliases or [])
        self._people[key] = node
        return node

    def find_person(self, query: str) -> Optional[PersonNode]:
        q_norm = _normalize_name(query)
        q_first = _first_name(query)
        for node in self._people.values():
            for alias in node.aliases:
                if _normalize_name(alias) == q_norm:
                    return node
        if q_norm in self._people:
            return self._people[q_norm]
        best_node = None
        best_dist = 3
        for key, node in self._people.items():
            dist = levenshtein_distance(q_norm, key)
            if dist < best_dist:
                best_dist = dist
                best_node = node
        if best_node is not None:
            return best_node
        first_matches = [n for n in self._people.values() if _first_name(n.name) == q_first]
        if len(first_matches) == 1:
            return first_matches[0]
        return None

    def get_person(self, name: str) -> Optional[PersonNode]:
        return self._people.get(_normalize_name(name))

    def add_evidence(self, person_query: str, evidence: Evidence) -> PersonNode:
        node = self.find_person(person_query)
        if node is None:
            raise ValueError(f"Person not found: {person_query}")
        node.evidence.append(evidence)
        node.last_interaction = evidence.timestamp
        if evidence.domain and evidence.domain not in node.domains:
            node.domains.append(evidence.domain)
        self._apply_evidence_to_scores(node, evidence)
        if len(node.evidence) % HERMENEUTIC_INTERVAL == 0:
            self.recompute_scores(node)
        return node

    def _apply_evidence_to_scores(self, node: PersonNode, ev: Evidence) -> None:
        dimension, positive = EVIDENCE_DIMENSION_MAP[ev.type]
        dim_key = dimension.value
        current = node.scores.get(dim_key, DEFAULT_SCORE)
        delta = ev.magnitude * 0.1
        if positive:
            new_score = current + delta * (SCORE_CEILING - current)
        else:
            new_score = current - delta * (current - SCORE_FLOOR)
        node.scores[dim_key] = max(SCORE_FLOOR, min(SCORE_CEILING, new_score))
        self._update_overall(node)

    def _update_overall(self, node: PersonNode) -> None:
        total = sum(node.scores.get(d.value, DEFAULT_SCORE) * w for d, w in DIMENSION_WEIGHTS.items())
        node.scores[TrustDimension.OVERALL.value] = round(total, 6)

    def recompute_scores(self, node: PersonNode) -> None:
        for dim in TrustDimension:
            if dim != TrustDimension.OVERALL:
                node.scores[dim.value] = DEFAULT_SCORE
        if not node.evidence:
            self._update_overall(node)
            return
        now = datetime.now(timezone.utc)
        dim_evidence: Dict[str, list] = {d.value: [] for d in TrustDimension if d != TrustDimension.OVERALL}
        for ev in node.evidence:
            dimension, _ = EVIDENCE_DIMENSION_MAP[ev.type]
            ev_time = _parse_iso(ev.timestamp)
            if ev_time.tzinfo is None:
                ev_time = ev_time.replace(tzinfo=timezone.utc)
            days_ago = (now - ev_time).total_seconds() / 86400.0
            recency_weight = math.pow(0.5, days_ago / DECAY_HALF_LIFE_DAYS)
            dim_evidence[dimension.value].append((ev, recency_weight))
        for dim_key, records in dim_evidence.items():
            if not records:
                continue
            weighted_sum = 0.0
            weight_total = 0.0
            for ev, recency_w in records:
                _, positive = EVIDENCE_DIMENSION_MAP[ev.type]
                value = ev.magnitude if positive else -ev.magnitude
                weighted_sum += value * recency_w
                weight_total += recency_w
            if weight_total > 0:
                avg_signal = weighted_sum / weight_total
                raw_score = DEFAULT_SCORE + avg_signal * 0.5
                node.scores[dim_key] = max(SCORE_FLOOR, min(SCORE_CEILING, raw_score))
        self._update_overall(node)

    def apply_decay(self) -> None:
        now = datetime.now(timezone.utc)
        for node in self._people.values():
            if node.last_interaction is None:
                ref_time = _parse_iso(node.creation_date) if node.creation_date else now
            else:
                ref_time = _parse_iso(node.last_interaction)
            if ref_time.tzinfo is None:
                ref_time = ref_time.replace(tzinfo=timezone.utc)
            days_since = (now - ref_time).total_seconds() / 86400.0
            if days_since <= 0:
                continue
            decay_factor = math.pow(0.5, days_since / DECAY_HALF_LIFE_DAYS)
            for dim in TrustDimension:
                current = node.scores.get(dim.value, DEFAULT_SCORE)
                decayed = SCORE_FLOOR + (current - SCORE_FLOOR) * decay_factor
                node.scores[dim.value] = max(SCORE_FLOOR, min(SCORE_CEILING, decayed))

    def get_score(self, person_query: str, dimension: Optional[TrustDimension] = None) -> float:
        node = self.find_person(person_query)
        if node is None:
            raise ValueError(f"Person not found: {person_query}")
        dim = dimension or TrustDimension.OVERALL
        return node.scores.get(dim.value, DEFAULT_SCORE)

    def get_all_scores(self, person_query: str) -> Dict[str, float]:
        node = self.find_person(person_query)
        if node is None:
            raise ValueError(f"Person not found: {person_query}")
        return dict(node.scores)

    def get_all_people(self) -> List[PersonNode]:
        return sorted(self._people.values(),
                      key=lambda n: n.scores.get(TrustDimension.OVERALL.value, DEFAULT_SCORE), reverse=True)

    @property
    def people_count(self) -> int:
        return len(self._people)

    def save(self, filepath: str) -> None:
        data = {"version": "0.3.0", "saved_at": _now_iso(),
                "people": {k: v.to_dict() for k, v in self._people.items()}}
        os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    @classmethod
    def load(cls, filepath: str) -> "TrustGraph":
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        graph = cls()
        for key, pdata in data.get("people", {}).items():
            graph._people[key] = PersonNode.from_dict(pdata)
        return graph

    def to_dict(self) -> Dict[str, Any]:
        return {"version": "0.3.0", "people": {k: v.to_dict() for k, v in self._people.items()}}
