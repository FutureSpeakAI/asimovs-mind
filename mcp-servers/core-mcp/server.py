"""
Agent Friday — Unified Core MCP Server
Wraps all 7 core systems into a single FastMCP server.

Systems: Sovereign Vault, Privacy Shield, Trust Graph,
         Cognitive Memory, Personality Evolution,
         Epistemic Score, HMAC Integrity
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP

# Ensure modules dir is on path
sys.path.insert(0, str(Path(__file__).parent))

from modules.vault import (
    init_vault, lock_category, unlock_category,
    get_category_status, VaultConfig,
)
from modules.shield import (
    scan_text, scrub_text, allowlist_add as _allowlist_add,
    allowlist_show as _allowlist_show, PIICategory,
)
from modules.trust_graph import (
    TrustGraph, Evidence, EvidenceType, TrustDimension,
)
from modules.memory import CognitiveMemory, MemoryTier
from modules.personality import PersonalityEngine, Trait
from modules.epistemic import EpistemicScore, InteractionRecord, DelegationType
from modules.integrity import IntegrityManager, ProtectionTier


# ── Data paths ────────────────────────────────────────────────────────────
DATA_DIR = Path(os.environ.get("FRIDAY_DATA_DIR", Path.home() / ".friday"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

VAULT_DIR = DATA_DIR / "vault"
TRUST_GRAPH_PATH = DATA_DIR / "trust_graph.json"
MEMORY_PATH = DATA_DIR / "memory.json"
PERSONALITY_PATH = DATA_DIR / "personality.json"
EPISTEMIC_PATH = DATA_DIR / "epistemic.json"
INTEGRITY_DIR = DATA_DIR / "integrity"
MANIFEST_PATH = INTEGRITY_DIR / "manifest.json"

VAULT_DIR.mkdir(parents=True, exist_ok=True)
INTEGRITY_DIR.mkdir(parents=True, exist_ok=True)


# ── Lazy-load helpers ─────────────────────────────────────────────────────

def _load_trust_graph() -> TrustGraph:
    if TRUST_GRAPH_PATH.exists():
        return TrustGraph.load(str(TRUST_GRAPH_PATH))
    return TrustGraph()


def _save_trust_graph(graph: TrustGraph) -> None:
    graph.save(str(TRUST_GRAPH_PATH))


def _load_memory() -> CognitiveMemory:
    if MEMORY_PATH.exists():
        return CognitiveMemory.load(MEMORY_PATH)
    return CognitiveMemory()


def _save_memory(mem: CognitiveMemory) -> None:
    mem.save(MEMORY_PATH)


def _load_personality() -> PersonalityEngine:
    if PERSONALITY_PATH.exists():
        return PersonalityEngine.load(PERSONALITY_PATH)
    return PersonalityEngine()


def _save_personality(engine: PersonalityEngine) -> None:
    engine.save(PERSONALITY_PATH)


def _load_epistemic() -> EpistemicScore:
    if EPISTEMIC_PATH.exists():
        return EpistemicScore.load(EPISTEMIC_PATH)
    return EpistemicScore()


def _save_epistemic(scorer: EpistemicScore) -> None:
    scorer.save(EPISTEMIC_PATH)


def _load_integrity() -> IntegrityManager:
    mgr = IntegrityManager()
    if MANIFEST_PATH.exists():
        mgr.load_manifest(MANIFEST_PATH)
    return mgr


def _save_integrity(mgr: IntegrityManager) -> None:
    mgr.save_manifest(MANIFEST_PATH)


# ── Create the MCP server ────────────────────────────────────────────────

mcp = FastMCP("Agent Friday Core")


# ═══════════════════════════════════════════════════════════════════════════
# 1. SOVEREIGN VAULT
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def vault_init(password: str) -> str:
    """Initialize the Sovereign Vault with a master password. Creates category directories and encryption salt."""
    try:
        config = init_vault(VAULT_DIR, password)
        return json.dumps({
            "status": "initialized",
            "vault_root": str(VAULT_DIR),
            "categories": config.categories,
        })
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def vault_lock(category: str, password: str) -> str:
    """Encrypt all unlocked files in a vault category (e.g. 'family', 'finances')."""
    try:
        encrypted = lock_category(VAULT_DIR, category, password)
        return json.dumps({"status": "locked", "category": category, "files_encrypted": len(encrypted), "files": encrypted})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def vault_unlock(category: str, password: str) -> str:
    """Decrypt all .vault files in a vault category."""
    try:
        decrypted = unlock_category(VAULT_DIR, category, password)
        return json.dumps({"status": "unlocked", "category": category, "files_decrypted": len(decrypted), "files": decrypted})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def vault_status() -> str:
    """Show lock/unlock status of all vault categories."""
    try:
        config = VaultConfig.load(VAULT_DIR)
        statuses = {}
        for cat in config.categories:
            statuses[cat] = get_category_status(VAULT_DIR, cat)
        return json.dumps({"vault_root": str(VAULT_DIR), "categories": statuses})
    except FileNotFoundError:
        return json.dumps({"status": "not_initialized", "message": "Run vault_init first"})
    except Exception as e:
        return json.dumps({"error": str(e)})


# ═══════════════════════════════════════════════════════════════════════════
# 2. PRIVACY SHIELD
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def shield_scan(text: str) -> str:
    """Scan text for PII (SSN, credit cards, phones, emails, addresses, medical terms, gov IDs). Returns findings."""
    matches = scan_text(text)
    findings = [{"category": m.category.name, "found": m.original, "replacement": m.replacement,
                 "position": [m.start, m.end]} for m in matches]
    return json.dumps({"pii_found": len(findings), "findings": findings})


@mcp.tool()
def shield_scrub(text: str) -> str:
    """Scrub all PII from text, replacing with hashed placeholders. Returns cleaned text."""
    cleaned, matches = scrub_text(text)
    return json.dumps({"scrubbed_text": cleaned, "replacements_made": len(matches)})


@mcp.tool()
def shield_allowlist_add(value: str) -> str:
    """Add a value to the Privacy Shield allowlist (won't be flagged as PII)."""
    _allowlist_add(value)
    return json.dumps({"status": "added", "value": value})


@mcp.tool()
def shield_allowlist_show() -> str:
    """Show all values on the Privacy Shield allowlist."""
    items = _allowlist_show()
    return json.dumps({"allowlist": items, "count": len(items)})


# ═══════════════════════════════════════════════════════════════════════════
# 3. TRUST GRAPH
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def trust_add_person(name: str, aliases: list[str] | None = None) -> str:
    """Add a person to the trust graph. Provide optional aliases for fuzzy matching."""
    graph = _load_trust_graph()
    node = graph.add_person(name, aliases or [])
    _save_trust_graph(graph)
    return json.dumps({"status": "added", "name": node.name, "aliases": node.aliases,
                        "scores": node.scores})


@mcp.tool()
def trust_add_evidence(person: str, evidence_type: str, magnitude: float, notes: str = "") -> str:
    """Record trust evidence for a person. evidence_type: promise_kept, promise_broken, accurate_info, inaccurate_info, emotional_support, emotional_harm, timely_response, late_response, helpful_action, unhelpful_action, domain_expertise_shown, domain_expertise_lacking. magnitude: 0.0-1.0."""
    graph = _load_trust_graph()
    try:
        ev = Evidence(
            type=EvidenceType(evidence_type),
            magnitude=magnitude,
            timestamp=datetime.now(timezone.utc).isoformat(),
            notes=notes or None,
        )
        node = graph.add_evidence(person, ev)
        _save_trust_graph(graph)
        return json.dumps({"status": "recorded", "person": node.name, "scores": node.scores})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def trust_get_score(person: str) -> str:
    """Get all trust dimension scores for a person."""
    graph = _load_trust_graph()
    try:
        scores = graph.get_all_scores(person)
        return json.dumps({"person": person, "scores": scores})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def trust_find(query: str) -> str:
    """Fuzzy-search the trust graph for a person by name or alias."""
    graph = _load_trust_graph()
    node = graph.find_person(query)
    if node is None:
        return json.dumps({"found": False, "query": query})
    return json.dumps({"found": True, "name": node.name, "aliases": node.aliases,
                        "scores": node.scores, "evidence_count": len(node.evidence)})


@mcp.tool()
def trust_list() -> str:
    """List all people in the trust graph, sorted by overall trust score (highest first)."""
    graph = _load_trust_graph()
    people = graph.get_all_people()
    result = [{"name": p.name, "overall": p.scores.get("overall", 0.5),
               "evidence_count": len(p.evidence)} for p in people]
    return json.dumps({"people": result, "total": len(result)})


# ═══════════════════════════════════════════════════════════════════════════
# 4. COGNITIVE MEMORY
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def memory_add(content: str, tier: str = "short", confidence: float = 0.5, source: str = "") -> str:
    """Add a memory entry. tier: short, medium, or long. confidence: 0.0-1.0. Near-duplicates are reinforced."""
    mem = _load_memory()
    entry = mem.add(content, tier=MemoryTier(tier), confidence=confidence, source=source or None)
    _save_memory(mem)
    return json.dumps({"status": "added", "id": entry.id, "tier": entry.tier.value,
                        "occurrences": entry.occurrences, "confidence": entry.confidence})


@mcp.tool()
def memory_find(query: str) -> str:
    """Search memories by Jaccard word-overlap. Returns ranked results."""
    mem = _load_memory()
    results = mem.find(query)
    entries = [{"id": e.id, "content": e.content, "tier": e.tier.value,
                "confidence": e.confidence, "occurrences": e.occurrences} for e in results[:20]]
    return json.dumps({"results": entries, "total_matches": len(results)})


@mcp.tool()
def memory_promote() -> str:
    """Run promotion cycle: move qualified medium-term memories to long-term."""
    mem = _load_memory()
    promoted = mem.promote()
    _save_memory(mem)
    return json.dumps({"promoted": len(promoted),
                        "entries": [{"id": e.id, "content": e.content[:80]} for e in promoted]})


@mcp.tool()
def memory_consolidate() -> str:
    """Run full sleep-like consolidation: deduplicate all tiers, promote, demote."""
    mem = _load_memory()
    results = mem.consolidate()
    _save_memory(mem)
    return json.dumps(results)


@mcp.tool()
def memory_stats() -> str:
    """Get memory statistics: counts per tier, total entries, episodes, last consolidation."""
    mem = _load_memory()
    return json.dumps(mem.get_stats())


@mcp.tool()
def memory_record_episode(summary: str, topics: list[str] | None = None, tone: str = "neutral") -> str:
    """Record an episodic memory (session recording) with summary, topics, and emotional tone."""
    mem = _load_memory()
    ep = mem.record_episode(summary=summary, topics=topics or [], tone=tone)
    _save_memory(mem)
    return json.dumps({"status": "recorded", "id": ep.id, "timestamp": ep.timestamp})


# ═══════════════════════════════════════════════════════════════════════════
# 5. PERSONALITY EVOLUTION
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def personality_show() -> str:
    """Show current personality: traits, maturity, style dimensions, sycophancy state."""
    engine = _load_personality()
    return engine.get_personality_summary()


@mcp.tool()
def personality_session() -> str:
    """Record a new session, incrementing maturity. Returns new maturity level."""
    engine = _load_personality()
    maturity = engine.record_session()
    _save_personality(engine)
    return json.dumps({"session_count": engine.profile.session_count,
                        "maturity": round(maturity, 4),
                        "maturity_pct": f"{maturity:.1%}"})


@mcp.tool()
def personality_set_trait(trait: str, value: float) -> str:
    """Set a personality trait value (0.0-1.0). See personality_show for trait names."""
    engine = _load_personality()
    try:
        engine.set_trait(Trait(trait), value)
        _save_personality(engine)
        effective = engine.get_trait(Trait(trait))
        return json.dumps({"status": "set", "trait": trait, "raw": value,
                            "effective": round(effective, 4), "maturity": round(engine.maturity, 4)})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def personality_record_interaction(agreed: bool = False, positive: bool = False,
                                    contradicted: bool = False, pushed_back: bool = False) -> str:
    """Track an interaction for sycophancy detection. Record whether Friday agreed, was positive, contradicted, or pushed back."""
    engine = _load_personality()
    engine.record_interaction(agreed=agreed, positive=positive,
                               contradicted=contradicted, pushed_back=pushed_back)
    fired = engine.check_sycophancy()
    if fired:
        event = engine.fire_circuit_breaker()
        _save_personality(engine)
        return json.dumps({"warning": "SYCOPHANCY CIRCUIT BREAKER FIRED",
                            "event": event, "traits_reset": ["warmth", "humorous", "empathetic"]})
    _save_personality(engine)
    syc = engine.profile.sycophancy
    return json.dumps({"streak": syc.agreement_streak, "bias": round(syc.positivity_bias, 4),
                        "total_interactions": syc.total_interactions})


@mcp.tool()
def personality_check_sycophancy() -> str:
    """Check if the sycophancy circuit breaker should fire (streak >= 8 and bias >= 0.85)."""
    engine = _load_personality()
    syc = engine.profile.sycophancy
    should_fire = engine.check_sycophancy()
    return json.dumps({
        "should_fire": should_fire,
        "agreement_streak": syc.agreement_streak,
        "positivity_bias": round(syc.positivity_bias, 4),
        "contradiction_count": syc.contradiction_count,
        "pushback_count": syc.pushback_count,
        "total_interactions": syc.total_interactions,
        "breaker_fires": len(syc.circuit_breaker_events),
    })


# ═══════════════════════════════════════════════════════════════════════════
# 6. EPISTEMIC SCORE
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def epistemic_record(initiated: bool = False, challenged: bool = False,
                     applied: bool = False, complexity: int = 1,
                     delegation_type: str = "") -> str:
    """Record an epistemic interaction. initiated=user proposed solution, challenged=user pushed back, applied=user used learned concept, complexity=1-5, delegation_type='appropriate' or 'abdication' or empty."""
    scorer = _load_epistemic()
    record = InteractionRecord(
        user_initiated_solution=initiated,
        ai_challenged=challenged,
        new_concept_applied=applied,
        complexity_level=complexity,
        delegation_type=delegation_type if delegation_type else None,
    )
    scorer.record_interaction(record)
    _save_epistemic(scorer)
    scores = scorer.compute_scores()
    return json.dumps({"status": "recorded", "total_interactions": len(scorer.interactions),
                        "current_scores": scores})


@mcp.tool()
def epistemic_score() -> str:
    """Compute current epistemic scores across all 6 metrics plus overall."""
    scorer = _load_epistemic()
    scores = scorer.compute_scores()
    return json.dumps(scores)


@mcp.tool()
def epistemic_trend() -> str:
    """Get the trend direction of the user's epistemic score (improving, stable, declining, insufficient_data)."""
    scorer = _load_epistemic()
    trend = scorer.get_trend()
    alert = scorer.check_dependency_alert()
    return json.dumps({"trend": trend.value, "dependency_alert": alert,
                        "interactions": len(scorer.interactions)})


@mcp.tool()
def epistemic_report() -> str:
    """Generate a full human-readable epistemic score report."""
    scorer = _load_epistemic()
    return scorer.get_report()


# ═══════════════════════════════════════════════════════════════════════════
# 7. HMAC INTEGRITY
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def integrity_sign(filepath: str, tier: int = 2) -> str:
    """Sign a file with HMAC-SHA256. tier: 1=Core Laws, 2=Identity, 3=Memory. Uses internal signing key."""
    mgr = _load_integrity()
    secret = _get_integrity_secret()
    try:
        protection = ProtectionTier(tier)
        record = mgr.sign_file(filepath, protection, secret)
        _save_integrity(mgr)
        return json.dumps({"status": "signed", "file": record.file_path,
                            "tier": record.tier, "hmac": record.hmac_hash[:16] + "..."})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def integrity_verify(filepath: str) -> str:
    """Verify a file's HMAC signature against its .sig sidecar."""
    mgr = _load_integrity()
    secret = _get_integrity_secret()
    try:
        ok = mgr.verify_file(filepath, secret)
        safe_mode = mgr.is_safe_mode()
        _save_integrity(mgr)
        return json.dumps({"file": filepath, "valid": ok, "safe_mode": safe_mode})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def integrity_manifest() -> str:
    """Show all files tracked by the HMAC integrity system."""
    mgr = _load_integrity()
    manifest = mgr.get_manifest()
    entries = []
    for fp, rec in manifest.items():
        entries.append({"file": fp, "tier": rec["tier"],
                        "hmac": rec["hmac_hash"][:16] + "...",
                        "timestamp": rec["timestamp"]})
    return json.dumps({"files": entries, "total": len(entries)})


@mcp.tool()
def integrity_safe_mode() -> str:
    """Check if the agent is in safe mode (triggered by Tier-1 tamper detection)."""
    mgr = _load_integrity()
    state = mgr.safe_mode_state()
    return json.dumps(state.to_dict())


def _get_integrity_secret() -> str:
    """Get or create the HMAC signing secret."""
    secret_path = INTEGRITY_DIR / ".secret"
    if secret_path.exists():
        return secret_path.read_text(encoding="utf-8").strip()
    import secrets
    key = secrets.token_hex(32)
    secret_path.write_text(key, encoding="utf-8")
    return key


# ── Entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
