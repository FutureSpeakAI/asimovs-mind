"""
Comprehensive tests for the Personality Evolution System.
"""

import json
import math
import os
import tempfile
import unittest

from personality import (
    PersonalityEngine,
    PersonalityProfile,
    StyleDimensions,
    SycophancyTracker,
    Trait,
    VisualDimension,
    NEUTRAL_VISUALS,
)


class TestTraitEnum(unittest.TestCase):
    """Trait enum basics."""

    def test_all_30_traits_exist(self):
        self.assertEqual(len(Trait), 30)

    def test_trait_from_string(self):
        self.assertEqual(Trait("warmth"), Trait.WARMTH)
        self.assertEqual(Trait("gonzo"), Trait.GONZO)

    def test_trait_values_are_strings(self):
        for t in Trait:
            self.assertIsInstance(t.value, str)


class TestVisualDimensionEnum(unittest.TestCase):

    def test_four_dimensions(self):
        self.assertEqual(len(VisualDimension), 4)
        names = {d.value for d in VisualDimension}
        self.assertEqual(names, {"hue", "energy", "complexity", "warmth"})


class TestPersonalityProfile(unittest.TestCase):

    def test_default_profile_has_all_traits(self):
        profile = PersonalityProfile()
        self.assertEqual(len(profile.traits), 30)
        for trait in Trait:
            self.assertIn(trait, profile.traits)
            self.assertEqual(profile.traits[trait], 0.5)

    def test_session_count_starts_at_zero(self):
        profile = PersonalityProfile()
        self.assertEqual(profile.session_count, 0)

    def test_maturity_property(self):
        profile = PersonalityProfile(session_count=0)
        # Force post-init
        profile.__post_init__()
        self.assertAlmostEqual(profile.maturity, 0.0)

        profile.session_count = 25
        self.assertAlmostEqual(profile.maturity, 0.5)

        profile.session_count = 50
        self.assertAlmostEqual(profile.maturity, 1.0)

        profile.session_count = 100
        self.assertAlmostEqual(profile.maturity, 1.0)

    def test_round_trip_serialization(self):
        profile = PersonalityProfile()
        profile.session_count = 17
        profile.traits[Trait.GONZO] = 0.9
        profile.traits[Trait.CALM] = 0.2

        data = profile.to_dict()
        restored = PersonalityProfile.from_dict(data)

        self.assertEqual(restored.session_count, 17)
        self.assertAlmostEqual(restored.traits[Trait.GONZO], 0.9)
        self.assertAlmostEqual(restored.traits[Trait.CALM], 0.2)
        self.assertEqual(len(restored.traits), 30)


class TestMaturityRamp(unittest.TestCase):
    """The 50-session maturity ramp."""

    def test_zero_sessions_zero_maturity(self):
        engine = PersonalityEngine()
        self.assertAlmostEqual(engine.maturity, 0.0)

    def test_25_sessions_half_maturity(self):
        engine = PersonalityEngine(PersonalityProfile(session_count=25))
        self.assertAlmostEqual(engine.maturity, 0.5)

    def test_50_sessions_full_maturity(self):
        engine = PersonalityEngine(PersonalityProfile(session_count=50))
        self.assertAlmostEqual(engine.maturity, 1.0)

    def test_100_sessions_capped_at_one(self):
        engine = PersonalityEngine(PersonalityProfile(session_count=100))
        self.assertAlmostEqual(engine.maturity, 1.0)

    def test_record_session_increments(self):
        engine = PersonalityEngine()
        self.assertEqual(engine.profile.session_count, 0)
        engine.record_session()
        self.assertEqual(engine.profile.session_count, 1)
        self.assertAlmostEqual(engine.maturity, 1 / 50)

    def test_trait_scaling_at_zero_maturity(self):
        """At zero maturity every trait reads as neutral 0.5."""
        engine = PersonalityEngine()
        engine.profile.traits[Trait.GONZO] = 1.0
        self.assertAlmostEqual(engine.get_trait(Trait.GONZO), 0.5)

    def test_trait_scaling_at_half_maturity(self):
        profile = PersonalityProfile(session_count=25)
        profile.traits[Trait.ANALYTICAL] = 0.9
        engine = PersonalityEngine(profile)
        # effective = 0.5 + (0.9 - 0.5) * 0.5 = 0.7
        self.assertAlmostEqual(engine.get_trait(Trait.ANALYTICAL), 0.7)

    def test_trait_scaling_at_full_maturity(self):
        profile = PersonalityProfile(session_count=50)
        profile.traits[Trait.WARMTH] = 0.8
        engine = PersonalityEngine(profile)
        self.assertAlmostEqual(engine.get_trait(Trait.WARMTH), 0.8)


class TestVisualDimensions(unittest.TestCase):

    def test_zero_maturity_returns_neutral(self):
        engine = PersonalityEngine()
        visuals = engine.get_visual_dimensions()
        self.assertAlmostEqual(visuals[VisualDimension.HUE], 180.0)
        self.assertAlmostEqual(visuals[VisualDimension.ENERGY], 1.0)
        self.assertAlmostEqual(visuals[VisualDimension.COMPLEXITY], 1.0)
        self.assertAlmostEqual(visuals[VisualDimension.WARMTH], 1.0)

    def test_full_maturity_deviates_from_neutral(self):
        """With non-default traits and full maturity, visuals should shift."""
        profile = PersonalityProfile(session_count=50)
        profile.traits[Trait.PLAYFUL] = 1.0
        profile.traits[Trait.INTENSE] = 1.0
        engine = PersonalityEngine(profile)
        visuals = engine.get_visual_dimensions()
        # Energy should be high
        self.assertGreater(visuals[VisualDimension.ENERGY], 1.0)

    def test_energy_increases_with_playful(self):
        profile = PersonalityProfile(session_count=50)
        profile.traits[Trait.PLAYFUL] = 1.0
        profile.traits[Trait.CALM] = 0.0  # reduce calming effect
        engine = PersonalityEngine(profile)
        visuals = engine.get_visual_dimensions()
        self.assertGreater(visuals[VisualDimension.ENERGY], 1.0)

    def test_complexity_increases_with_analytical(self):
        profile = PersonalityProfile(session_count=50)
        profile.traits[Trait.ANALYTICAL] = 1.0
        engine = PersonalityEngine(profile)
        visuals = engine.get_visual_dimensions()
        self.assertGreater(visuals[VisualDimension.COMPLEXITY], 1.0)

    def test_warmth_increases_with_empathetic(self):
        profile = PersonalityProfile(session_count=50)
        profile.traits[Trait.EMPATHETIC] = 1.0
        engine = PersonalityEngine(profile)
        visuals = engine.get_visual_dimensions()
        self.assertGreater(visuals[VisualDimension.WARMTH], 1.0)

    def test_hue_is_in_range(self):
        profile = PersonalityProfile(session_count=50)
        profile.traits[Trait.GONZO] = 1.0
        engine = PersonalityEngine(profile)
        visuals = engine.get_visual_dimensions()
        hue = visuals[VisualDimension.HUE]
        self.assertGreaterEqual(hue, 0.0)
        self.assertLess(hue, 360.0)

    def test_energy_clamped(self):
        profile = PersonalityProfile(session_count=50)
        for t in Trait:
            profile.traits[t] = 1.0
        engine = PersonalityEngine(profile)
        visuals = engine.get_visual_dimensions()
        self.assertLessEqual(visuals[VisualDimension.ENERGY], 2.0)
        self.assertGreaterEqual(visuals[VisualDimension.ENERGY], 0.0)


class TestAntiSycophancy(unittest.TestCase):

    def test_fresh_tracker_does_not_fire(self):
        tracker = SycophancyTracker()
        self.assertFalse(tracker.should_fire())

    def test_streak_builds_on_agreement(self):
        tracker = SycophancyTracker()
        for _ in range(5):
            tracker.record(agreed=True, positive=True, contradicted=False, pushed_back=False)
        self.assertEqual(tracker.agreement_streak, 5)

    def test_streak_resets_on_disagreement(self):
        tracker = SycophancyTracker()
        for _ in range(5):
            tracker.record(agreed=True, positive=True, contradicted=False, pushed_back=False)
        tracker.record(agreed=False, positive=False, contradicted=True, pushed_back=True)
        self.assertEqual(tracker.agreement_streak, 0)

    def test_circuit_breaker_fires_at_threshold(self):
        tracker = SycophancyTracker()
        # Build streak of 8+ with high positivity
        for _ in range(10):
            tracker.record(agreed=True, positive=True, contradicted=False, pushed_back=False)
        self.assertTrue(tracker.should_fire())

    def test_circuit_breaker_below_threshold(self):
        tracker = SycophancyTracker()
        # 7 agreements — just below threshold
        for _ in range(7):
            tracker.record(agreed=True, positive=True, contradicted=False, pushed_back=False)
        self.assertFalse(tracker.should_fire())

    def test_high_streak_low_bias_no_fire(self):
        tracker = SycophancyTracker()
        # Alternate positive/negative to keep bias low, but all agreements
        for i in range(10):
            tracker.record(agreed=True, positive=(i % 3 == 0), contradicted=False, pushed_back=False)
        # Bias should be < 0.85 since only ~33% positive
        self.assertFalse(tracker.should_fire())

    def test_engine_fire_circuit_breaker(self):
        profile = PersonalityProfile(session_count=50)
        profile.traits[Trait.WARMTH] = 0.9
        profile.traits[Trait.HUMOROUS] = 0.85
        profile.traits[Trait.EMPATHETIC] = 0.95

        engine = PersonalityEngine(profile)
        event = engine.fire_circuit_breaker()

        self.assertAlmostEqual(engine.profile.traits[Trait.WARMTH], 0.5)
        self.assertAlmostEqual(engine.profile.traits[Trait.HUMOROUS], 0.5)
        self.assertAlmostEqual(engine.profile.traits[Trait.EMPATHETIC], 0.5)
        self.assertIn("timestamp", event)
        self.assertEqual(len(engine.profile.sycophancy.circuit_breaker_events), 1)

    def test_sycophancy_tracker_serialization(self):
        tracker = SycophancyTracker()
        for _ in range(5):
            tracker.record(agreed=True, positive=True, contradicted=False, pushed_back=False)
        tracker.record(agreed=False, positive=False, contradicted=True, pushed_back=True)

        data = tracker.to_dict()
        restored = SycophancyTracker.from_dict(data)

        self.assertEqual(restored.agreement_streak, tracker.agreement_streak)
        self.assertAlmostEqual(restored.positivity_bias, tracker.positivity_bias, places=3)
        self.assertEqual(restored.contradiction_count, tracker.contradiction_count)
        self.assertEqual(restored.pushback_count, tracker.pushback_count)
        self.assertEqual(restored.total_interactions, tracker.total_interactions)


class TestStyleDimensions(unittest.TestCase):

    def test_default_style_is_neutral(self):
        style = StyleDimensions()
        for val in [style.formality, style.verbosity, style.humor_frequency,
                    style.technical_depth, style.emotional_expressiveness,
                    style.challenge_willingness]:
            self.assertAlmostEqual(val, 0.5)

    def test_style_derives_from_traits_at_zero_maturity(self):
        """At zero maturity, style stays neutral regardless of traits."""
        style = StyleDimensions()
        traits = {t: 1.0 for t in Trait}
        style.derive_from_traits(traits, maturity=0.0)
        self.assertAlmostEqual(style.formality, 0.5)
        self.assertAlmostEqual(style.humor_frequency, 0.5)

    def test_style_shifts_with_high_humor_at_full_maturity(self):
        style = StyleDimensions()
        traits = {t: 0.5 for t in Trait}
        traits[Trait.HUMOROUS] = 1.0
        style.derive_from_traits(traits, maturity=1.0)
        self.assertGreater(style.humor_frequency, 0.5)

    def test_style_formality_increases_with_serious(self):
        style = StyleDimensions()
        traits = {t: 0.5 for t in Trait}
        traits[Trait.SERIOUS] = 1.0
        style.derive_from_traits(traits, maturity=1.0)
        self.assertGreater(style.formality, 0.5)

    def test_style_clamped_to_zero_one(self):
        style = StyleDimensions()
        traits = {t: 0.0 for t in Trait}  # extreme low
        style.derive_from_traits(traits, maturity=1.0)
        for val in [style.formality, style.verbosity, style.humor_frequency,
                    style.technical_depth, style.emotional_expressiveness,
                    style.challenge_willingness]:
            self.assertGreaterEqual(val, 0.0)
            self.assertLessEqual(val, 1.0)

        traits = {t: 1.0 for t in Trait}  # extreme high
        style.derive_from_traits(traits, maturity=1.0)
        for val in [style.formality, style.verbosity, style.humor_frequency,
                    style.technical_depth, style.emotional_expressiveness,
                    style.challenge_willingness]:
            self.assertGreaterEqual(val, 0.0)
            self.assertLessEqual(val, 1.0)

    def test_style_round_trip(self):
        style = StyleDimensions(formality=0.8, verbosity=0.2)
        data = style.to_dict()
        restored = StyleDimensions.from_dict(data)
        self.assertAlmostEqual(restored.formality, 0.8)
        self.assertAlmostEqual(restored.verbosity, 0.2)


class TestPersistence(unittest.TestCase):

    def test_save_and_load_round_trip(self):
        engine = PersonalityEngine()
        engine.set_trait(Trait.GONZO, 0.95)
        engine.set_trait(Trait.CALM, 0.1)
        for _ in range(30):
            engine.record_session()
        engine.record_interaction(agreed=True, positive=True)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            filepath = f.name

        try:
            engine.save(filepath)
            loaded = PersonalityEngine.load(filepath)

            self.assertEqual(loaded.profile.session_count, 30)
            self.assertAlmostEqual(loaded.profile.traits[Trait.GONZO], 0.95)
            self.assertAlmostEqual(loaded.profile.traits[Trait.CALM], 0.1)
            self.assertEqual(loaded.profile.sycophancy.total_interactions, 1)
            self.assertAlmostEqual(loaded.maturity, 30 / 50)
        finally:
            os.unlink(filepath)

    def test_load_empty_creates_defaults(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({}, f)
            filepath = f.name

        try:
            engine = PersonalityEngine.load(filepath)
            self.assertEqual(engine.profile.session_count, 0)
            self.assertEqual(len(engine.profile.traits), 30)
        finally:
            os.unlink(filepath)

    def test_json_is_valid(self):
        engine = PersonalityEngine()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            filepath = f.name

        try:
            engine.save(filepath)
            with open(filepath) as f:
                data = json.load(f)
            self.assertIn("traits", data)
            self.assertIn("session_count", data)
            self.assertIn("style", data)
            self.assertIn("sycophancy", data)
        finally:
            os.unlink(filepath)


class TestEdgeCases(unittest.TestCase):

    def test_set_trait_boundary_values(self):
        engine = PersonalityEngine()
        engine.set_trait(Trait.WARMTH, 0.0)
        self.assertAlmostEqual(engine.profile.traits[Trait.WARMTH], 0.0)
        engine.set_trait(Trait.WARMTH, 1.0)
        self.assertAlmostEqual(engine.profile.traits[Trait.WARMTH], 1.0)

    def test_set_trait_rejects_out_of_range(self):
        engine = PersonalityEngine()
        with self.assertRaises(ValueError):
            engine.set_trait(Trait.WARMTH, 1.5)
        with self.assertRaises(ValueError):
            engine.set_trait(Trait.WARMTH, -0.1)

    def test_all_traits_neutral_at_zero_maturity(self):
        engine = PersonalityEngine()
        for trait in Trait:
            self.assertAlmostEqual(engine.get_trait(trait), 0.5)

    def test_record_session_returns_maturity(self):
        engine = PersonalityEngine()
        m = engine.record_session()
        self.assertAlmostEqual(m, 1 / 50)

    def test_multiple_circuit_breaker_fires(self):
        engine = PersonalityEngine()
        engine.fire_circuit_breaker()
        engine.fire_circuit_breaker()
        engine.fire_circuit_breaker()
        self.assertEqual(len(engine.profile.sycophancy.circuit_breaker_events), 3)

    def test_personality_summary_is_string(self):
        engine = PersonalityEngine()
        summary = engine.get_personality_summary()
        self.assertIsInstance(summary, str)
        self.assertIn("Maturity", summary)
        self.assertIn("Dominant traits", summary)

    def test_get_style_returns_dict(self):
        engine = PersonalityEngine()
        style = engine.get_style()
        self.assertIsInstance(style, dict)
        expected_keys = {"formality", "verbosity", "humor_frequency",
                         "technical_depth", "emotional_expressiveness",
                         "challenge_willingness"}
        self.assertEqual(set(style.keys()), expected_keys)

    def test_unknown_traits_in_json_are_ignored(self):
        data = {
            "traits": {"warmth": 0.8, "nonexistent_trait": 0.9},
            "session_count": 5,
        }
        profile = PersonalityProfile.from_dict(data)
        self.assertAlmostEqual(profile.traits[Trait.WARMTH], 0.8)
        self.assertEqual(profile.session_count, 5)
        # nonexistent_trait should not blow up; all 30 traits present
        self.assertEqual(len(profile.traits), 30)


if __name__ == "__main__":
    unittest.main()
