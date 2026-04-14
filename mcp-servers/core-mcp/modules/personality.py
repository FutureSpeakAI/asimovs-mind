"""
Personality Evolution System — Phase 5 of 7
Agent Friday's personality trait engine with 50-session maturity ramp,
visual dimension mapping, adaptive style, and anti-sycophancy calibration.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any


class Trait(str, Enum):
    WARMTH = "warmth"
    ANALYTICAL = "analytical"
    PLAYFUL = "playful"
    SERIOUS = "serious"
    IRREVERENT = "irreverent"
    EMPATHETIC = "empathetic"
    DIRECT = "direct"
    PATIENT = "patient"
    CURIOUS = "curious"
    SKEPTICAL = "skeptical"
    HUMOROUS = "humorous"
    PRECISE = "precise"
    CREATIVE = "creative"
    PRAGMATIC = "pragmatic"
    LOYAL = "loyal"
    INDEPENDENT = "independent"
    PROTECTIVE = "protective"
    ADVENTUROUS = "adventurous"
    REFLECTIVE = "reflective"
    CONFIDENT = "confident"
    HUMBLE = "humble"
    PASSIONATE = "passionate"
    CALM = "calm"
    INTENSE = "intense"
    OPTIMISTIC = "optimistic"
    REALISTIC = "realistic"
    PHILOSOPHICAL = "philosophical"
    TECHNICAL = "technical"
    EDITORIAL = "editorial"
    GONZO = "gonzo"


class VisualDimension(str, Enum):
    HUE = "hue"
    ENERGY = "energy"
    COMPLEXITY = "complexity"
    WARMTH = "warmth"


TRAIT_TO_HUE: dict[Trait, tuple[float, float]] = {
    Trait.WARMTH: (1.0, 30.0), Trait.ANALYTICAL: (1.0, 200.0),
    Trait.PLAYFUL: (0.8, 320.0), Trait.SERIOUS: (0.6, 220.0),
    Trait.IRREVERENT: (0.5, 300.0), Trait.EMPATHETIC: (0.7, 50.0),
    Trait.CREATIVE: (0.8, 280.0), Trait.PASSIONATE: (0.7, 0.0),
    Trait.CALM: (0.6, 180.0), Trait.INTENSE: (0.5, 10.0),
    Trait.OPTIMISTIC: (0.6, 60.0), Trait.PHILOSOPHICAL: (0.5, 260.0),
    Trait.TECHNICAL: (0.7, 210.0), Trait.GONZO: (0.9, 340.0),
}
TRAIT_TO_ENERGY: dict[Trait, tuple[float, float]] = {
    Trait.PLAYFUL: (1.0, 1.6), Trait.CALM: (1.0, 0.4),
    Trait.INTENSE: (0.9, 1.8), Trait.PASSIONATE: (0.8, 1.5),
    Trait.ADVENTUROUS: (0.7, 1.4), Trait.PATIENT: (0.6, 0.5),
    Trait.SERIOUS: (0.5, 0.6), Trait.HUMOROUS: (0.7, 1.3),
    Trait.CONFIDENT: (0.6, 1.2), Trait.REFLECTIVE: (0.5, 0.7),
    Trait.GONZO: (0.9, 1.9), Trait.EDITORIAL: (0.5, 1.1),
}
TRAIT_TO_COMPLEXITY: dict[Trait, tuple[float, float]] = {
    Trait.ANALYTICAL: (1.0, 1.5), Trait.PHILOSOPHICAL: (0.9, 1.7),
    Trait.TECHNICAL: (0.8, 1.4), Trait.PRECISE: (0.7, 1.3),
    Trait.CREATIVE: (0.6, 1.2), Trait.PRAGMATIC: (0.7, 0.5),
    Trait.DIRECT: (0.6, 0.4), Trait.PLAYFUL: (0.4, 0.6),
    Trait.REFLECTIVE: (0.6, 1.3), Trait.SKEPTICAL: (0.5, 1.1),
    Trait.EDITORIAL: (0.7, 1.4), Trait.GONZO: (0.6, 1.5),
}
TRAIT_TO_WARMTH_VIS: dict[Trait, tuple[float, float]] = {
    Trait.EMPATHETIC: (1.0, 1.8), Trait.WARMTH: (0.9, 1.6),
    Trait.PROTECTIVE: (0.8, 1.5), Trait.LOYAL: (0.7, 1.4),
    Trait.PATIENT: (0.6, 1.3), Trait.HUMOROUS: (0.5, 1.2),
    Trait.SKEPTICAL: (0.6, 0.5), Trait.DIRECT: (0.5, 0.6),
    Trait.ANALYTICAL: (0.4, 0.7), Trait.INDEPENDENT: (0.4, 0.8),
    Trait.CALM: (0.3, 1.0), Trait.OPTIMISTIC: (0.5, 1.3),
}
NEUTRAL_VISUALS = {
    VisualDimension.HUE: 180.0, VisualDimension.ENERGY: 1.0,
    VisualDimension.COMPLEXITY: 1.0, VisualDimension.WARMTH: 1.0,
}


@dataclass
class SycophancyTracker:
    agreement_streak: int = 0
    positivity_bias: float = 0.5
    contradiction_count: int = 0
    pushback_count: int = 0
    total_interactions: int = 0
    circuit_breaker_events: list[dict[str, Any]] = field(default_factory=list)
    _positive_count: int = 0
    _total_sentiment: int = 0

    def record(self, agreed: bool, positive: bool, contradicted: bool, pushed_back: bool) -> None:
        self.total_interactions += 1
        if agreed:
            self.agreement_streak += 1
        else:
            self.agreement_streak = 0
        self._total_sentiment += 1
        if positive:
            self._positive_count += 1
        if self._total_sentiment > 0:
            self.positivity_bias = self._positive_count / self._total_sentiment
        if contradicted:
            self.contradiction_count += 1
        if pushed_back:
            self.pushback_count += 1

    def should_fire(self) -> bool:
        return self.agreement_streak >= 8 and self.positivity_bias >= 0.85

    def log_event(self) -> None:
        self.circuit_breaker_events.append({
            "timestamp": time.time(), "streak": self.agreement_streak,
            "bias": round(self.positivity_bias, 4),
            "total_interactions": self.total_interactions,
        })

    def to_dict(self) -> dict[str, Any]:
        return {
            "agreement_streak": self.agreement_streak,
            "positivity_bias": round(self.positivity_bias, 4),
            "contradiction_count": self.contradiction_count,
            "pushback_count": self.pushback_count,
            "total_interactions": self.total_interactions,
            "circuit_breaker_events": self.circuit_breaker_events,
            "_positive_count": self._positive_count,
            "_total_sentiment": self._total_sentiment,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SycophancyTracker":
        tracker = cls()
        tracker.agreement_streak = data.get("agreement_streak", 0)
        tracker.positivity_bias = data.get("positivity_bias", 0.5)
        tracker.contradiction_count = data.get("contradiction_count", 0)
        tracker.pushback_count = data.get("pushback_count", 0)
        tracker.total_interactions = data.get("total_interactions", 0)
        tracker.circuit_breaker_events = data.get("circuit_breaker_events", [])
        tracker._positive_count = data.get("_positive_count", 0)
        tracker._total_sentiment = data.get("_total_sentiment", 0)
        return tracker


@dataclass
class StyleDimensions:
    formality: float = 0.5
    verbosity: float = 0.5
    humor_frequency: float = 0.5
    technical_depth: float = 0.5
    emotional_expressiveness: float = 0.5
    challenge_willingness: float = 0.5

    def to_dict(self) -> dict[str, float]:
        return {k: round(getattr(self, k), 4) for k in [
            "formality", "verbosity", "humor_frequency",
            "technical_depth", "emotional_expressiveness", "challenge_willingness"
        ]}

    @classmethod
    def from_dict(cls, data: dict[str, float]) -> "StyleDimensions":
        return cls(**{k: data.get(k, 0.5) for k in [
            "formality", "verbosity", "humor_frequency",
            "technical_depth", "emotional_expressiveness", "challenge_willingness"
        ]})

    def derive_from_traits(self, traits: dict[Trait, float], maturity: float) -> None:
        neutral = 0.5
        f = neutral
        f += (traits.get(Trait.SERIOUS, 0.5) - 0.5) * 0.6 * maturity
        f -= (traits.get(Trait.IRREVERENT, 0.5) - 0.5) * 0.4 * maturity
        f -= (traits.get(Trait.PLAYFUL, 0.5) - 0.5) * 0.3 * maturity
        self.formality = max(0.0, min(1.0, f))
        v = neutral
        v += (traits.get(Trait.REFLECTIVE, 0.5) - 0.5) * 0.5 * maturity
        v += (traits.get(Trait.PHILOSOPHICAL, 0.5) - 0.5) * 0.4 * maturity
        v -= (traits.get(Trait.DIRECT, 0.5) - 0.5) * 0.5 * maturity
        self.verbosity = max(0.0, min(1.0, v))
        h = neutral
        h += (traits.get(Trait.HUMOROUS, 0.5) - 0.5) * 0.7 * maturity
        h += (traits.get(Trait.PLAYFUL, 0.5) - 0.5) * 0.4 * maturity
        h -= (traits.get(Trait.SERIOUS, 0.5) - 0.5) * 0.3 * maturity
        self.humor_frequency = max(0.0, min(1.0, h))
        t = neutral
        t += (traits.get(Trait.TECHNICAL, 0.5) - 0.5) * 0.6 * maturity
        t += (traits.get(Trait.ANALYTICAL, 0.5) - 0.5) * 0.5 * maturity
        t += (traits.get(Trait.PRECISE, 0.5) - 0.5) * 0.3 * maturity
        self.technical_depth = max(0.0, min(1.0, t))
        e = neutral
        e += (traits.get(Trait.EMPATHETIC, 0.5) - 0.5) * 0.6 * maturity
        e += (traits.get(Trait.PASSIONATE, 0.5) - 0.5) * 0.5 * maturity
        e -= (traits.get(Trait.CALM, 0.5) - 0.5) * 0.3 * maturity
        self.emotional_expressiveness = max(0.0, min(1.0, e))
        c = neutral
        c += (traits.get(Trait.SKEPTICAL, 0.5) - 0.5) * 0.6 * maturity
        c += (traits.get(Trait.INDEPENDENT, 0.5) - 0.5) * 0.4 * maturity
        c += (traits.get(Trait.DIRECT, 0.5) - 0.5) * 0.4 * maturity
        self.challenge_willingness = max(0.0, min(1.0, c))


@dataclass
class PersonalityProfile:
    traits: dict[Trait, float] = field(default_factory=dict)
    session_count: int = 0
    style: StyleDimensions = field(default_factory=StyleDimensions)
    sycophancy: SycophancyTracker = field(default_factory=SycophancyTracker)

    def __post_init__(self) -> None:
        for trait in Trait:
            if trait not in self.traits:
                self.traits[trait] = 0.5

    @property
    def maturity(self) -> float:
        return min(self.session_count / 50.0, 1.0)

    def to_dict(self) -> dict[str, Any]:
        return {
            "traits": {t.value: round(v, 4) for t, v in self.traits.items()},
            "session_count": self.session_count,
            "style": self.style.to_dict(),
            "sycophancy": self.sycophancy.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PersonalityProfile":
        traits: dict[Trait, float] = {}
        for key, val in data.get("traits", {}).items():
            try:
                traits[Trait(key)] = float(val)
            except (ValueError, KeyError):
                pass
        return cls(
            traits=traits, session_count=data.get("session_count", 0),
            style=StyleDimensions.from_dict(data.get("style", {})),
            sycophancy=SycophancyTracker.from_dict(data.get("sycophancy", {})),
        )


class PersonalityEngine:
    MATURITY_SESSIONS = 50

    def __init__(self, profile: PersonalityProfile | None = None) -> None:
        self.profile = profile or PersonalityProfile()

    @classmethod
    def load(cls, filepath: str | Path) -> "PersonalityEngine":
        with Path(filepath).open("r", encoding="utf-8") as f:
            data = json.load(f)
        return cls(profile=PersonalityProfile.from_dict(data))

    def save(self, filepath: str | Path) -> None:
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(self.profile.to_dict(), f, indent=2)

    def record_session(self) -> float:
        self.profile.session_count += 1
        self.profile.style.derive_from_traits(self.profile.traits, self.profile.maturity)
        return self.profile.maturity

    @property
    def maturity(self) -> float:
        return self.profile.maturity

    def get_trait(self, trait: Trait) -> float:
        raw = self.profile.traits.get(trait, 0.5)
        return 0.5 + (raw - 0.5) * self.maturity

    def set_trait(self, trait: Trait, value: float) -> None:
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"Trait value must be 0-1, got {value}")
        self.profile.traits[trait] = value
        self.profile.style.derive_from_traits(self.profile.traits, self.maturity)

    def get_visual_dimensions(self) -> dict[VisualDimension, float]:
        result: dict[VisualDimension, float] = {}
        result[VisualDimension.HUE] = self._compute_hue()
        result[VisualDimension.ENERGY] = self._compute_linear(
            TRAIT_TO_ENERGY, NEUTRAL_VISUALS[VisualDimension.ENERGY], 0.0, 2.0)
        result[VisualDimension.COMPLEXITY] = self._compute_linear(
            TRAIT_TO_COMPLEXITY, NEUTRAL_VISUALS[VisualDimension.COMPLEXITY], 0.0, 2.0)
        result[VisualDimension.WARMTH] = self._compute_linear(
            TRAIT_TO_WARMTH_VIS, NEUTRAL_VISUALS[VisualDimension.WARMTH], 0.0, 2.0)
        return result

    def _compute_hue(self) -> float:
        neutral = NEUTRAL_VISUALS[VisualDimension.HUE]
        if self.maturity == 0:
            return neutral
        sin_sum = cos_sum = weight_sum = 0.0
        for trait, (weight, target_hue) in TRAIT_TO_HUE.items():
            trait_val = self.profile.traits.get(trait, 0.5)
            ew = weight * trait_val
            rad = math.radians(target_hue)
            sin_sum += ew * math.sin(rad)
            cos_sum += ew * math.cos(rad)
            weight_sum += ew
        if weight_sum == 0:
            return neutral
        trait_hue = math.degrees(math.atan2(sin_sum / weight_sum, cos_sum / weight_sum)) % 360
        diff = (trait_hue - neutral + 540) % 360 - 180
        return (neutral + diff * self.maturity) % 360

    def _compute_linear(self, mapping, neutral, lo, hi) -> float:
        if self.maturity == 0:
            return neutral
        weighted_sum = weight_sum = 0.0
        for trait, (weight, target) in mapping.items():
            trait_val = self.profile.traits.get(trait, 0.5)
            ew = weight * trait_val
            weighted_sum += ew * target
            weight_sum += ew
        if weight_sum == 0:
            return neutral
        trait_value = weighted_sum / weight_sum
        blended = neutral + (trait_value - neutral) * self.maturity
        return max(lo, min(hi, blended))

    def record_interaction(self, agreed=False, positive=False, contradicted=False, pushed_back=False):
        self.profile.sycophancy.record(agreed, positive, contradicted, pushed_back)

    def check_sycophancy(self) -> bool:
        return self.profile.sycophancy.should_fire()

    def fire_circuit_breaker(self) -> dict[str, Any]:
        self.profile.traits[Trait.WARMTH] = 0.5
        self.profile.traits[Trait.HUMOROUS] = 0.5
        self.profile.traits[Trait.EMPATHETIC] = 0.5
        self.profile.sycophancy.log_event()
        self.profile.sycophancy.agreement_streak = 0
        self.profile.style.derive_from_traits(self.profile.traits, self.maturity)
        return self.profile.sycophancy.circuit_breaker_events[-1]

    def get_style(self) -> dict[str, float]:
        return self.profile.style.to_dict()

    def get_personality_summary(self) -> str:
        lines = [f"Session count: {self.profile.session_count}",
                 f"Maturity: {self.maturity:.1%}", ""]
        deviations = [(t, abs(v - 0.5), v) for t, v in self.profile.traits.items()]
        deviations.sort(key=lambda x: x[1], reverse=True)
        lines.append("Dominant traits:")
        for t, d, v in deviations[:5]:
            direction = "high" if v > 0.5 else "low"
            eff = self.get_trait(t)
            lines.append(f"  {t.value:20s}  raw={v:.2f}  effective={eff:.2f}  ({direction})")
        lines.append("")
        vis = self.get_visual_dimensions()
        lines.append("Visual dimensions:")
        lines.append(f"  Hue: {vis[VisualDimension.HUE]:.1f}  Energy: {vis[VisualDimension.ENERGY]:.3f}  Complexity: {vis[VisualDimension.COMPLEXITY]:.3f}  Warmth: {vis[VisualDimension.WARMTH]:.3f}")
        lines.append("")
        syc = self.profile.sycophancy
        lines.append(f"Sycophancy: streak={syc.agreement_streak} bias={syc.positivity_bias:.3f} contradictions={syc.contradiction_count} pushbacks={syc.pushback_count} breaker_fires={len(syc.circuit_breaker_events)}")
        return "\n".join(lines)
