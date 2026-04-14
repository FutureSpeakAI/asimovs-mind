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


# ---------------------------------------------------------------------------
# Trait Enum — 30 personality dimensions
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Visual Dimension Enum
# ---------------------------------------------------------------------------
class VisualDimension(str, Enum):
    HUE = "hue"              # 0-360 degrees
    ENERGY = "energy"        # 0-2
    COMPLEXITY = "complexity" # 0-2
    WARMTH = "warmth"        # 0-2


# ---------------------------------------------------------------------------
# Trait → Visual mapping tables
# Each entry: (weight, target_value)
# ---------------------------------------------------------------------------
TRAIT_TO_HUE: dict[Trait, tuple[float, float]] = {
    Trait.WARMTH:        (1.0, 30.0),
    Trait.ANALYTICAL:    (1.0, 200.0),
    Trait.PLAYFUL:       (0.8, 320.0),
    Trait.SERIOUS:       (0.6, 220.0),
    Trait.IRREVERENT:    (0.5, 300.0),
    Trait.EMPATHETIC:    (0.7, 50.0),
    Trait.CREATIVE:      (0.8, 280.0),
    Trait.PASSIONATE:    (0.7, 0.0),
    Trait.CALM:          (0.6, 180.0),
    Trait.INTENSE:       (0.5, 10.0),
    Trait.OPTIMISTIC:    (0.6, 60.0),
    Trait.PHILOSOPHICAL: (0.5, 260.0),
    Trait.TECHNICAL:     (0.7, 210.0),
    Trait.GONZO:         (0.9, 340.0),
}

TRAIT_TO_ENERGY: dict[Trait, tuple[float, float]] = {
    Trait.PLAYFUL:       (1.0, 1.6),
    Trait.CALM:          (1.0, 0.4),
    Trait.INTENSE:       (0.9, 1.8),
    Trait.PASSIONATE:    (0.8, 1.5),
    Trait.ADVENTUROUS:   (0.7, 1.4),
    Trait.PATIENT:       (0.6, 0.5),
    Trait.SERIOUS:       (0.5, 0.6),
    Trait.HUMOROUS:      (0.7, 1.3),
    Trait.CONFIDENT:     (0.6, 1.2),
    Trait.REFLECTIVE:    (0.5, 0.7),
    Trait.GONZO:         (0.9, 1.9),
    Trait.EDITORIAL:     (0.5, 1.1),
}

TRAIT_TO_COMPLEXITY: dict[Trait, tuple[float, float]] = {
    Trait.ANALYTICAL:    (1.0, 1.5),
    Trait.PHILOSOPHICAL: (0.9, 1.7),
    Trait.TECHNICAL:     (0.8, 1.4),
    Trait.PRECISE:       (0.7, 1.3),
    Trait.CREATIVE:      (0.6, 1.2),
    Trait.PRAGMATIC:     (0.7, 0.5),
    Trait.DIRECT:        (0.6, 0.4),
    Trait.PLAYFUL:       (0.4, 0.6),
    Trait.REFLECTIVE:    (0.6, 1.3),
    Trait.SKEPTICAL:     (0.5, 1.1),
    Trait.EDITORIAL:     (0.7, 1.4),
    Trait.GONZO:         (0.6, 1.5),
}

TRAIT_TO_WARMTH_VIS: dict[Trait, tuple[float, float]] = {
    Trait.EMPATHETIC:    (1.0, 1.8),
    Trait.WARMTH:        (0.9, 1.6),
    Trait.PROTECTIVE:    (0.8, 1.5),
    Trait.LOYAL:         (0.7, 1.4),
    Trait.PATIENT:       (0.6, 1.3),
    Trait.HUMOROUS:      (0.5, 1.2),
    Trait.SKEPTICAL:     (0.6, 0.5),
    Trait.DIRECT:        (0.5, 0.6),
    Trait.ANALYTICAL:    (0.4, 0.7),
    Trait.INDEPENDENT:   (0.4, 0.8),
    Trait.CALM:          (0.3, 1.0),
    Trait.OPTIMISTIC:    (0.5, 1.3),
}

# Default neutral visual values (what every fresh agent looks like)
NEUTRAL_VISUALS = {
    VisualDimension.HUE: 180.0,
    VisualDimension.ENERGY: 1.0,
    VisualDimension.COMPLEXITY: 1.0,
    VisualDimension.WARMTH: 1.0,
}


# ---------------------------------------------------------------------------
# Sycophancy Tracker
# ---------------------------------------------------------------------------
@dataclass
class SycophancyTracker:
    """Tracks behavioral signals that indicate sycophantic drift."""
    agreement_streak: int = 0
    positivity_bias: float = 0.5
    contradiction_count: int = 0
    pushback_count: int = 0
    total_interactions: int = 0
    circuit_breaker_events: list[dict[str, Any]] = field(default_factory=list)

    # Running accumulators for bias calculation
    _positive_count: int = 0
    _total_sentiment: int = 0

    def record(self, agreed: bool, positive: bool,
               contradicted: bool, pushed_back: bool) -> None:
        self.total_interactions += 1

        # Agreement streak
        if agreed:
            self.agreement_streak += 1
        else:
            self.agreement_streak = 0

        # Positivity bias — exponential moving average
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
            "timestamp": time.time(),
            "streak": self.agreement_streak,
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


# ---------------------------------------------------------------------------
# Style Dimensions
# ---------------------------------------------------------------------------
@dataclass
class StyleDimensions:
    """Six adaptive style dimensions, each 0-1."""
    formality: float = 0.5
    verbosity: float = 0.5
    humor_frequency: float = 0.5
    technical_depth: float = 0.5
    emotional_expressiveness: float = 0.5
    challenge_willingness: float = 0.5

    def to_dict(self) -> dict[str, float]:
        return {
            "formality": round(self.formality, 4),
            "verbosity": round(self.verbosity, 4),
            "humor_frequency": round(self.humor_frequency, 4),
            "technical_depth": round(self.technical_depth, 4),
            "emotional_expressiveness": round(self.emotional_expressiveness, 4),
            "challenge_willingness": round(self.challenge_willingness, 4),
        }

    @classmethod
    def from_dict(cls, data: dict[str, float]) -> "StyleDimensions":
        return cls(
            formality=data.get("formality", 0.5),
            verbosity=data.get("verbosity", 0.5),
            humor_frequency=data.get("humor_frequency", 0.5),
            technical_depth=data.get("technical_depth", 0.5),
            emotional_expressiveness=data.get("emotional_expressiveness", 0.5),
            challenge_willingness=data.get("challenge_willingness", 0.5),
        )

    def derive_from_traits(self, traits: dict[Trait, float], maturity: float) -> None:
        """Recompute style dimensions from current trait values scaled by maturity."""
        neutral = 0.5

        def _blend(trait_val: float, target: float, weight: float) -> float:
            return neutral + (target - neutral) * trait_val * weight * maturity

        # Formality: serious↑, irreverent↓, playful↓
        f = neutral
        f += (traits.get(Trait.SERIOUS, 0.5) - 0.5) * 0.6 * maturity
        f -= (traits.get(Trait.IRREVERENT, 0.5) - 0.5) * 0.4 * maturity
        f -= (traits.get(Trait.PLAYFUL, 0.5) - 0.5) * 0.3 * maturity
        self.formality = max(0.0, min(1.0, f))

        # Verbosity: reflective↑, philosophical↑, direct↓
        v = neutral
        v += (traits.get(Trait.REFLECTIVE, 0.5) - 0.5) * 0.5 * maturity
        v += (traits.get(Trait.PHILOSOPHICAL, 0.5) - 0.5) * 0.4 * maturity
        v -= (traits.get(Trait.DIRECT, 0.5) - 0.5) * 0.5 * maturity
        self.verbosity = max(0.0, min(1.0, v))

        # Humor frequency: humorous↑, playful↑, serious↓
        h = neutral
        h += (traits.get(Trait.HUMOROUS, 0.5) - 0.5) * 0.7 * maturity
        h += (traits.get(Trait.PLAYFUL, 0.5) - 0.5) * 0.4 * maturity
        h -= (traits.get(Trait.SERIOUS, 0.5) - 0.5) * 0.3 * maturity
        self.humor_frequency = max(0.0, min(1.0, h))

        # Technical depth: technical↑, analytical↑, precise↑
        t = neutral
        t += (traits.get(Trait.TECHNICAL, 0.5) - 0.5) * 0.6 * maturity
        t += (traits.get(Trait.ANALYTICAL, 0.5) - 0.5) * 0.5 * maturity
        t += (traits.get(Trait.PRECISE, 0.5) - 0.5) * 0.3 * maturity
        self.technical_depth = max(0.0, min(1.0, t))

        # Emotional expressiveness: empathetic↑, passionate↑, calm↓
        e = neutral
        e += (traits.get(Trait.EMPATHETIC, 0.5) - 0.5) * 0.6 * maturity
        e += (traits.get(Trait.PASSIONATE, 0.5) - 0.5) * 0.5 * maturity
        e -= (traits.get(Trait.CALM, 0.5) - 0.5) * 0.3 * maturity
        self.emotional_expressiveness = max(0.0, min(1.0, e))

        # Challenge willingness: skeptical↑, independent↑, direct↑
        c = neutral
        c += (traits.get(Trait.SKEPTICAL, 0.5) - 0.5) * 0.6 * maturity
        c += (traits.get(Trait.INDEPENDENT, 0.5) - 0.5) * 0.4 * maturity
        c += (traits.get(Trait.DIRECT, 0.5) - 0.5) * 0.4 * maturity
        self.challenge_willingness = max(0.0, min(1.0, c))


# ---------------------------------------------------------------------------
# Personality Profile — the full state object
# ---------------------------------------------------------------------------
@dataclass
class PersonalityProfile:
    traits: dict[Trait, float] = field(default_factory=dict)
    session_count: int = 0
    style: StyleDimensions = field(default_factory=StyleDimensions)
    sycophancy: SycophancyTracker = field(default_factory=SycophancyTracker)

    def __post_init__(self) -> None:
        # Ensure every trait has a default value of 0.5
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
                pass  # skip unknown traits gracefully

        profile = cls(
            traits=traits,
            session_count=data.get("session_count", 0),
            style=StyleDimensions.from_dict(data.get("style", {})),
            sycophancy=SycophancyTracker.from_dict(data.get("sycophancy", {})),
        )
        return profile


# ---------------------------------------------------------------------------
# Personality Engine — the main API
# ---------------------------------------------------------------------------
class PersonalityEngine:
    """Core engine for managing personality evolution."""

    MATURITY_SESSIONS = 50

    def __init__(self, profile: PersonalityProfile | None = None) -> None:
        self.profile = profile or PersonalityProfile()

    # --- Persistence ---

    @classmethod
    def load(cls, filepath: str | Path) -> "PersonalityEngine":
        path = Path(filepath)
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return cls(profile=PersonalityProfile.from_dict(data))

    def save(self, filepath: str | Path) -> None:
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(self.profile.to_dict(), f, indent=2)

    # --- Session tracking ---

    def record_session(self) -> float:
        """Increment session count, update maturity, recompute style. Returns new maturity."""
        self.profile.session_count += 1
        self.profile.style.derive_from_traits(self.profile.traits, self.profile.maturity)
        return self.profile.maturity

    @property
    def maturity(self) -> float:
        return self.profile.maturity

    # --- Trait access ---

    def get_trait(self, trait: Trait) -> float:
        """Return trait value scaled by maturity. At 0 maturity → 0.5 (neutral)."""
        raw = self.profile.traits.get(trait, 0.5)
        return 0.5 + (raw - 0.5) * self.maturity

    def set_trait(self, trait: Trait, value: float) -> None:
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"Trait value must be 0-1, got {value}")
        self.profile.traits[trait] = value
        self.profile.style.derive_from_traits(self.profile.traits, self.maturity)

    # --- Visual dimensions ---

    def get_visual_dimensions(self) -> dict[VisualDimension, float]:
        """Compute hue/energy/complexity/warmth from traits, scaled by maturity."""
        result: dict[VisualDimension, float] = {}

        # Hue — weighted circular mean
        result[VisualDimension.HUE] = self._compute_hue()
        result[VisualDimension.ENERGY] = self._compute_linear(
            TRAIT_TO_ENERGY, NEUTRAL_VISUALS[VisualDimension.ENERGY], 0.0, 2.0
        )
        result[VisualDimension.COMPLEXITY] = self._compute_linear(
            TRAIT_TO_COMPLEXITY, NEUTRAL_VISUALS[VisualDimension.COMPLEXITY], 0.0, 2.0
        )
        result[VisualDimension.WARMTH] = self._compute_linear(
            TRAIT_TO_WARMTH_VIS, NEUTRAL_VISUALS[VisualDimension.WARMTH], 0.0, 2.0
        )
        return result

    def _compute_hue(self) -> float:
        """Weighted circular mean of hue contributions, blended with neutral by maturity."""
        neutral = NEUTRAL_VISUALS[VisualDimension.HUE]
        if self.maturity == 0:
            return neutral

        sin_sum = 0.0
        cos_sum = 0.0
        weight_sum = 0.0

        for trait, (weight, target_hue) in TRAIT_TO_HUE.items():
            trait_val = self.profile.traits.get(trait, 0.5)
            effective_weight = weight * trait_val
            rad = math.radians(target_hue)
            sin_sum += effective_weight * math.sin(rad)
            cos_sum += effective_weight * math.cos(rad)
            weight_sum += effective_weight

        if weight_sum == 0:
            return neutral

        trait_hue = math.degrees(math.atan2(sin_sum / weight_sum, cos_sum / weight_sum)) % 360

        # Blend toward neutral based on maturity (circular interpolation)
        diff = (trait_hue - neutral + 540) % 360 - 180
        return (neutral + diff * self.maturity) % 360

    def _compute_linear(
        self,
        mapping: dict[Trait, tuple[float, float]],
        neutral: float,
        lo: float,
        hi: float,
    ) -> float:
        """Weighted linear mean blended with neutral by maturity."""
        if self.maturity == 0:
            return neutral

        weighted_sum = 0.0
        weight_sum = 0.0

        for trait, (weight, target) in mapping.items():
            trait_val = self.profile.traits.get(trait, 0.5)
            effective_weight = weight * trait_val
            weighted_sum += effective_weight * target
            weight_sum += effective_weight

        if weight_sum == 0:
            return neutral

        trait_value = weighted_sum / weight_sum
        blended = neutral + (trait_value - neutral) * self.maturity
        return max(lo, min(hi, blended))

    # --- Anti-sycophancy ---

    def record_interaction(
        self,
        agreed: bool = False,
        positive: bool = False,
        contradicted: bool = False,
        pushed_back: bool = False,
    ) -> None:
        self.profile.sycophancy.record(agreed, positive, contradicted, pushed_back)

    def check_sycophancy(self) -> bool:
        return self.profile.sycophancy.should_fire()

    def fire_circuit_breaker(self) -> dict[str, Any]:
        """Hard-reset warmth/humor to neutral and log the event."""
        self.profile.traits[Trait.WARMTH] = 0.5
        self.profile.traits[Trait.HUMOROUS] = 0.5
        self.profile.traits[Trait.EMPATHETIC] = 0.5

        self.profile.sycophancy.log_event()
        self.profile.sycophancy.agreement_streak = 0

        # Recompute style
        self.profile.style.derive_from_traits(self.profile.traits, self.maturity)

        event = self.profile.sycophancy.circuit_breaker_events[-1]
        return event

    # --- Style ---

    def get_style(self) -> dict[str, float]:
        return self.profile.style.to_dict()

    # --- Summary ---

    def get_personality_summary(self) -> str:
        """Human-readable personality description."""
        lines: list[str] = []
        lines.append(f"Session count: {self.profile.session_count}")
        lines.append(f"Maturity: {self.maturity:.1%}")
        lines.append("")

        # Top 5 dominant traits (furthest from neutral)
        deviations = [
            (trait, abs(val - 0.5), val)
            for trait, val in self.profile.traits.items()
        ]
        deviations.sort(key=lambda x: x[1], reverse=True)
        top = deviations[:5]

        lines.append("Dominant traits:")
        for trait, dev, val in top:
            direction = "high" if val > 0.5 else "low"
            effective = self.get_trait(trait)
            lines.append(f"  {trait.value:20s}  raw={val:.2f}  effective={effective:.2f}  ({direction})")

        lines.append("")
        visuals = self.get_visual_dimensions()
        lines.append("Visual dimensions:")
        lines.append(f"  Hue:        {visuals[VisualDimension.HUE]:.1f}")
        lines.append(f"  Energy:     {visuals[VisualDimension.ENERGY]:.3f}")
        lines.append(f"  Complexity: {visuals[VisualDimension.COMPLEXITY]:.3f}")
        lines.append(f"  Warmth:     {visuals[VisualDimension.WARMTH]:.3f}")

        lines.append("")
        style = self.get_style()
        lines.append("Style dimensions:")
        for k, v in style.items():
            lines.append(f"  {k:30s}  {v:.3f}")

        lines.append("")
        syc = self.profile.sycophancy
        lines.append("Sycophancy tracker:")
        lines.append(f"  Agreement streak:    {syc.agreement_streak}")
        lines.append(f"  Positivity bias:     {syc.positivity_bias:.3f}")
        lines.append(f"  Contradictions:      {syc.contradiction_count}")
        lines.append(f"  Pushbacks:           {syc.pushback_count}")
        lines.append(f"  Total interactions:  {syc.total_interactions}")
        lines.append(f"  Circuit breaker fires: {len(syc.circuit_breaker_events)}")

        return "\n".join(lines)
