#!/usr/bin/env python3
"""
memory.py — Unified memory system for Asimov's Mind.

One system, three views:
  TRUST:     Multi-dimensional scoring of repos and agents (evidence-backed)
  KNOWLEDGE: Entity graph — files, packages, patterns that co-occur
  RECALL:    Context retrieval — what's relevant right now?

This replaces the flat trust-tracker, the empty knowledge store, and the
missing RAG layer with a single integrated system that feeds the personality
loader, GitScout, and /friday status.

CLI:
  python memory.py record --type discovery --entity "KellerJordan/Muon" --outcome kept
  python memory.py record --type agent --entity "debugger" --outcome kept
  python memory.py record --type correction --entity "auth-handler.ts" --detail "user rejected fix"
  python memory.py trust --entity "KellerJordan/Muon"
  python memory.py trust --all
  python memory.py recall --context "auth refactor"
  python memory.py graph --entity "session-handler.ts"
  python memory.py status
"""

import argparse
import hashlib
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Vault integration — use encrypted vault for storage when available,
# fall back to raw file I/O otherwise.
# ---------------------------------------------------------------------------
try:
    # Use resolve() so __file__ relative invocations still find the right directory.
    _hooks_dir = str(Path(__file__).resolve().parent.parent / "hooks")
    sys.path.insert(0, _hooks_dir)
    from vault_bridge import vault_available, vault_read, vault_write, vault_append
    _VAULT_OK = vault_available()
except ImportError:
    _VAULT_OK = False


def _vault_read_json(key, default=None):
    """Read a JSON value from the vault, returning default on failure."""
    if not _VAULT_OK:
        return default
    try:
        data = vault_read(key)
        if data is not None:
            return data if isinstance(data, (dict, list)) else json.loads(data)
    except Exception:
        pass
    return default


def _vault_write_json(key, data):
    """Write a JSON value to the vault. Returns True on success."""
    if not _VAULT_OK:
        return False
    try:
        vault_write(key, data)
        return True
    except Exception:
        return False


def _vault_append_line(key, record):
    """Append a record to a vault ledger key. Returns True on success."""
    if not _VAULT_OK:
        return False
    try:
        vault_append(key, record)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

MEMORY_DIR = Path(".asimovs-mind")
EVIDENCE_LOG = MEMORY_DIR / "evidence.jsonl"          # append-only
TRUST_SCORES = MEMORY_DIR / "trust-scores.json"       # computed, regenerable
ENTITY_GRAPH = MEMORY_DIR / "entity-graph.json"       # co-occurrence data
SESSION_SUMMARIES = MEMORY_DIR / "knowledge" / "recent-sessions.json"

TRUST_DIMENSIONS = ["reliability", "quality", "safety", "compatibility", "recency"]
DECAY_HALF_LIFE_DAYS = 30
MIN_EVIDENCE_FOR_SCORE = 2


# ---------------------------------------------------------------------------
# Evidence Recording (append-only ledger)
# ---------------------------------------------------------------------------

def record_evidence(evidence_type, entity, outcome, detail="", dimensions=None):
    """Record a piece of evidence about an entity.

    evidence_type: "discovery", "agent", "correction", "session", "interaction"
    entity: the thing being scored (repo name, agent name, file path)
    outcome: "kept", "reverted", "crashed", "rejected", "accepted", "positive", "negative"
    detail: human-readable description
    dimensions: optional dict of dimension-specific signals
    """
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)

    record = {
        "timestamp": datetime.now().isoformat(),
        "type": evidence_type,
        "entity": entity,
        "outcome": outcome,
        "detail": detail,
        "dimensions": dimensions or {},
    }

    # Try vault first, fall back to file
    if not _vault_append_line("evidence-log", record):
        try:
            with open(EVIDENCE_LOG, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError as exc:
            # Non-fatal: log to stderr and continue so callers do not crash.
            import sys as _sys
            print(f"[memory] Warning: could not write evidence log: {exc}", file=_sys.stderr)

    # Recompute trust for this entity
    _recompute_trust(entity)

    # Update entity graph co-occurrence
    if evidence_type == "session":
        _update_graph_from_session(record)

    return record


def load_evidence(entity=None, evidence_type=None, since_days=None):
    """Load evidence records, optionally filtered."""
    # Try vault first
    vault_records = _vault_read_json("evidence-log")
    raw_records = None
    if isinstance(vault_records, list) and vault_records:
        raw_records = vault_records
    elif EVIDENCE_LOG.exists():
        raw_records = []
        for line in EVIDENCE_LOG.read_text(encoding="utf-8").strip().split("\n"):
            if not line.strip():
                continue
            try:
                raw_records.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not raw_records:
        return []

    records = []
    cutoff = None
    if since_days:
        cutoff = datetime.now() - timedelta(days=since_days)

    for r in raw_records:
        if entity and r.get("entity") != entity:
            continue
        if evidence_type and r.get("type") != evidence_type:
            continue
        if cutoff:
            try:
                ts = datetime.fromisoformat(r["timestamp"])
                if ts < cutoff:
                    continue
            except (ValueError, KeyError):
                continue
        records.append(r)

    return records


# ---------------------------------------------------------------------------
# Trust Scoring (hermeneutic re-evaluation)
# ---------------------------------------------------------------------------

def _time_decay(timestamp_str, half_life_days=DECAY_HALF_LIFE_DAYS):
    """Exponential decay weight based on age."""
    try:
        ts = datetime.fromisoformat(timestamp_str)
        age_days = (datetime.now() - ts).total_seconds() / 86400
        return math.exp(-0.693 * age_days / half_life_days)  # ln(2) = 0.693
    except (ValueError, TypeError):
        return 0.5


def _recompute_trust(entity):
    """Hermeneutic re-evaluation: recompute trust from ALL evidence.

    This is the key insight from Agent Friday's trust graph:
    every N observations, recompute from scratch rather than
    incrementally updating. This prevents drift and ensures
    old evidence is properly decayed.
    """
    evidence = load_evidence(entity=entity)
    if len(evidence) < MIN_EVIDENCE_FOR_SCORE:
        return

    # Compute per-dimension scores
    dimension_scores = {}
    for dim in TRUST_DIMENSIONS:
        scores = []
        weights = []

        for e in evidence:
            weight = _time_decay(e.get("timestamp", ""))
            outcome = e.get("outcome", "")
            dim_signal = e.get("dimensions", {}).get(dim)

            # Map outcomes to scores
            if dim_signal is not None:
                scores.append(float(dim_signal))
                weights.append(weight)
            elif outcome in ("kept", "accepted", "positive"):
                scores.append(1.0)
                weights.append(weight)
            elif outcome in ("reverted", "rejected", "negative"):
                scores.append(0.0)
                weights.append(weight)
            elif outcome == "crashed":
                scores.append(0.0)
                weights.append(weight * 2.0)  # crashes weigh double
            # "neutral" outcomes don't contribute

        if scores:
            total_weight = sum(weights)
            if total_weight > 0:
                dimension_scores[dim] = sum(s * w for s, w in zip(scores, weights)) / total_weight
            else:
                dimension_scores[dim] = 0.5

    # Overall trust = weighted average of dimensions
    if dimension_scores:
        overall = sum(dimension_scores.values()) / len(dimension_scores)
    else:
        overall = 0.5

    # Confidence based on evidence count (more evidence = higher confidence)
    confidence = min(1.0, len(evidence) / 20.0)

    trust_entry = {
        "entity": entity,
        "overall": round(overall, 4),
        "confidence": round(confidence, 4),
        "dimensions": {k: round(v, 4) for k, v in dimension_scores.items()},
        "evidence_count": len(evidence),
        "last_updated": datetime.now().isoformat(),
    }

    # Load, update, save trust scores
    scores = _load_trust_scores()
    scores[entity] = trust_entry
    _save_trust_scores(scores)

    return trust_entry


def _load_trust_scores():
    # Try vault first
    vault_data = _vault_read_json("trust-scores")
    if isinstance(vault_data, dict) and vault_data:
        return vault_data
    if not TRUST_SCORES.exists():
        return {}
    try:
        return json.loads(TRUST_SCORES.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_trust_scores(scores):
    # Write to vault first, then file as fallback/mirror
    _vault_write_json("trust-scores", scores)
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    try:
        TRUST_SCORES.write_text(
            json.dumps(scores, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError as exc:
        import sys as _sys
        print(f"[memory] Warning: could not write trust scores: {exc}", file=_sys.stderr)


def get_trust(entity):
    """Get trust score for an entity."""
    scores = _load_trust_scores()
    return scores.get(entity)


def get_all_trust(min_confidence=0.0):
    """Get all trust scores, optionally filtered by confidence."""
    scores = _load_trust_scores()
    if min_confidence > 0:
        return {k: v for k, v in scores.items() if v.get("confidence", 0) >= min_confidence}
    return scores


def recompute_all():
    """Full hermeneutic re-evaluation of all entities."""
    if not EVIDENCE_LOG.exists():
        return 0

    entities = set()
    try:
        raw = EVIDENCE_LOG.read_text(encoding="utf-8")
    except OSError as exc:
        import sys as _sys
        print(f"[memory] Warning: could not read evidence log: {exc}", file=_sys.stderr)
        return 0

    for line in raw.strip().split("\n"):
        if line.strip():
            try:
                r = json.loads(line)
                entities.add(r.get("entity", ""))
            except json.JSONDecodeError:
                continue

    for entity in entities:
        if entity:
            _recompute_trust(entity)

    return len(entities)


# ---------------------------------------------------------------------------
# Entity Graph (co-occurrence knowledge)
# ---------------------------------------------------------------------------

def _load_graph():
    # Try vault first
    vault_data = _vault_read_json("entity-graph")
    if isinstance(vault_data, dict) and vault_data:
        return vault_data
    if not ENTITY_GRAPH.exists():
        return {"nodes": {}, "edges": {}}
    try:
        return json.loads(ENTITY_GRAPH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"nodes": {}, "edges": {}}


def _save_graph(graph):
    # Write to vault first, then file as fallback/mirror
    _vault_write_json("entity-graph", graph)
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    ENTITY_GRAPH.write_text(
        json.dumps(graph, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _edge_key(a, b):
    """Canonical edge key (alphabetical order)."""
    return f"{min(a,b)}|{max(a,b)}"


def record_co_occurrence(entities, context=""):
    """Record that a set of entities appeared together (e.g., files modified in same session)."""
    graph = _load_graph()

    for entity in entities:
        if entity not in graph["nodes"]:
            graph["nodes"][entity] = {"count": 0, "first_seen": datetime.now().isoformat()}
        graph["nodes"][entity]["count"] = graph["nodes"][entity].get("count", 0) + 1
        graph["nodes"][entity]["last_seen"] = datetime.now().isoformat()

    # Record pairwise co-occurrence
    entity_list = sorted(set(entities))
    for i in range(len(entity_list)):
        for j in range(i + 1, len(entity_list)):
            key = _edge_key(entity_list[i], entity_list[j])
            if key not in graph["edges"]:
                graph["edges"][key] = {"count": 0, "contexts": []}
            graph["edges"][key]["count"] += 1
            if context and len(graph["edges"][key]["contexts"]) < 5:
                graph["edges"][key]["contexts"].append(context)

    _save_graph(graph)


def _update_graph_from_session(evidence_record):
    """Extract entities from a session evidence record and update co-occurrence."""
    detail = evidence_record.get("detail", "")
    dims = evidence_record.get("dimensions", {})

    files = dims.get("files_modified", [])
    if isinstance(files, list) and len(files) > 1:
        record_co_occurrence(files, context=f"session:{evidence_record.get('timestamp', '')}")


def get_related(entity, min_co_occurrence=2):
    """Get entities that frequently co-occur with this one."""
    graph = _load_graph()
    related = []

    for key, edge in graph.get("edges", {}).items():
        parts = key.split("|")
        if entity in parts and edge.get("count", 0) >= min_co_occurrence:
            other = parts[0] if parts[1] == entity else parts[1]
            related.append({
                "entity": other,
                "co_occurrences": edge["count"],
                "contexts": edge.get("contexts", []),
            })

    related.sort(key=lambda x: x["co_occurrences"], reverse=True)
    return related


# ---------------------------------------------------------------------------
# Context Recall (vectorless RAG)
# ---------------------------------------------------------------------------

def recall(query, max_results=10):
    """Retrieve relevant context for a query.

    This is vectorless RAG: no embeddings, no vector DB.
    Relevance is computed from:
    1. Entity name matching (direct hits)
    2. Co-occurrence graph (related entities)
    3. Evidence recency (recent > old)
    4. Trust scores (trusted entities surface first)
    """
    results = []
    query_lower = query.lower()
    query_terms = set(query_lower.split())

    # 1. Direct entity matches from trust scores
    trust_scores = _load_trust_scores()
    for entity, trust in trust_scores.items():
        entity_lower = entity.lower()
        # Score by term overlap
        entity_terms = set(entity_lower.replace("/", " ").replace("-", " ").replace(".", " ").split())
        overlap = len(query_terms & entity_terms)
        if overlap > 0 or query_lower in entity_lower or entity_lower in query_lower:
            relevance = overlap / max(len(query_terms), 1)
            if query_lower in entity_lower:
                relevance = max(relevance, 0.8)
            results.append({
                "entity": entity,
                "type": "trust",
                "relevance": relevance,
                "trust": trust.get("overall", 0.5),
                "evidence_count": trust.get("evidence_count", 0),
                "detail": f"Trust: {trust.get('overall', 0.5):.2f} ({trust.get('evidence_count', 0)} observations)",
            })

    # 2. Entity graph matches
    graph = _load_graph()
    for node, data in graph.get("nodes", {}).items():
        node_lower = node.lower()
        node_terms = set(node_lower.replace("/", " ").replace("-", " ").replace(".", " ").split())
        overlap = len(query_terms & node_terms)
        if overlap > 0 or query_lower in node_lower:
            related = get_related(node, min_co_occurrence=1)
            related_names = [r["entity"] for r in related[:5]]
            results.append({
                "entity": node,
                "type": "graph",
                "relevance": overlap / max(len(query_terms), 1),
                "related": related_names,
                "detail": f"Modified {data.get('count', 0)} times. Related: {', '.join(related_names[:3]) or 'none'}",
            })

    # 3. Recent evidence matches
    recent = load_evidence(since_days=30)
    for e in recent:
        entity = e.get("entity", "")
        detail = e.get("detail", "")
        combined = f"{entity} {detail}".lower()
        if any(term in combined for term in query_terms):
            results.append({
                "entity": entity,
                "type": "evidence",
                "relevance": 0.5,
                "timestamp": e.get("timestamp", ""),
                "outcome": e.get("outcome", ""),
                "detail": f"{e.get('type', '')}: {detail or e.get('outcome', '')}",
            })

    # 4. Session summary matches
    if SESSION_SUMMARIES.exists():
        try:
            sessions = json.loads(SESSION_SUMMARIES.read_text(encoding="utf-8"))
            for sess in (sessions if isinstance(sessions, list) else []):
                summary = sess.get("summary", "")
                if any(term in summary.lower() for term in query_terms):
                    results.append({
                        "entity": "session",
                        "type": "session",
                        "relevance": 0.4,
                        "timestamp": sess.get("timestamp", ""),
                        "detail": summary,
                    })
        except (json.JSONDecodeError, OSError):
            pass

    # Deduplicate and sort by relevance
    seen = set()
    unique = []
    for r in results:
        key = f"{r['entity']}:{r['type']}"
        if key not in seen:
            seen.add(key)
            unique.append(r)

    unique.sort(key=lambda x: x.get("relevance", 0), reverse=True)
    return unique[:max_results]


def get_status():
    """Get a summary of the memory system's state."""
    evidence = load_evidence()
    trust = _load_trust_scores()
    graph = _load_graph()

    entity_types = defaultdict(int)
    outcome_counts = defaultdict(int)
    for e in evidence:
        entity_types[e.get("type", "unknown")] += 1
        outcome_counts[e.get("outcome", "unknown")] += 1

    return {
        "total_evidence": len(evidence),
        "evidence_by_type": dict(entity_types),
        "outcome_counts": dict(outcome_counts),
        "trusted_entities": len(trust),
        "high_trust": len([t for t in trust.values() if t.get("overall", 0) >= 0.8]),
        "low_trust": len([t for t in trust.values() if t.get("overall", 0) < 0.5]),
        "graph_nodes": len(graph.get("nodes", {})),
        "graph_edges": len(graph.get("edges", {})),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Asimov's Mind — Unified Memory System")
    sub = parser.add_subparsers(dest="command")

    # record
    rec = sub.add_parser("record", help="Record evidence")
    rec.add_argument("--type", required=True, choices=["discovery", "agent", "correction", "session", "interaction"])
    rec.add_argument("--entity", required=True)
    rec.add_argument("--outcome", required=True)
    rec.add_argument("--detail", default="")

    # trust
    tr = sub.add_parser("trust", help="Query trust scores")
    tr.add_argument("--entity", default=None)
    tr.add_argument("--all", action="store_true")

    # recall
    rc = sub.add_parser("recall", help="Recall relevant context")
    rc.add_argument("--context", required=True)

    # graph
    gr = sub.add_parser("graph", help="Query entity graph")
    gr.add_argument("--entity", required=True)

    # status
    sub.add_parser("status", help="Memory system status")

    # recompute
    sub.add_parser("recompute", help="Full hermeneutic re-evaluation of all trust scores")

    args = parser.parse_args()

    if args.command == "record":
        r = record_evidence(args.type, args.entity, args.outcome, args.detail)
        print(f"Recorded: {args.type} evidence for {args.entity} ({args.outcome})")

    elif args.command == "trust":
        if args.entity:
            t = get_trust(args.entity)
            if t:
                print(f"Trust for {args.entity}:")
                print(f"  Overall: {t['overall']:.2f} (confidence: {t['confidence']:.2f})")
                print(f"  Evidence: {t['evidence_count']} observations")
                for dim, score in t.get("dimensions", {}).items():
                    print(f"  {dim}: {score:.2f}")
            else:
                print(f"No trust data for {args.entity}")
        elif args.all:
            scores = get_all_trust()
            if not scores:
                print("No trust data yet.")
            else:
                print(f"{'Entity':<40} {'Trust':>6} {'Conf':>6} {'Evidence':>8}")
                print("-" * 65)
                for entity, t in sorted(scores.items(), key=lambda x: x[1].get("overall", 0), reverse=True):
                    print(f"{entity:<40} {t['overall']:>6.2f} {t['confidence']:>6.2f} {t['evidence_count']:>8}")

    elif args.command == "recall":
        results = recall(args.context)
        if not results:
            print(f"No relevant context found for: {args.context}")
        else:
            print(f"Context recall for: {args.context}")
            print("=" * 60)
            for r in results:
                print(f"  [{r['type']}] {r['entity']} (relevance: {r.get('relevance', 0):.2f})")
                print(f"    {r.get('detail', '')}")

    elif args.command == "graph":
        related = get_related(args.entity, min_co_occurrence=1)
        if not related:
            print(f"No co-occurrence data for {args.entity}")
        else:
            print(f"Entities related to {args.entity}:")
            for r in related:
                print(f"  {r['entity']} (co-occurred {r['co_occurrences']} times)")

    elif args.command == "status":
        s = get_status()
        print("Memory System Status")
        print("=" * 40)
        print(f"Total evidence:     {s['total_evidence']}")
        print(f"Trusted entities:   {s['trusted_entities']} ({s['high_trust']} high, {s['low_trust']} low)")
        print(f"Graph nodes:        {s['graph_nodes']}")
        print(f"Graph edges:        {s['graph_edges']}")
        if s['evidence_by_type']:
            print(f"Evidence types:     {s['evidence_by_type']}")
        if s['outcome_counts']:
            print(f"Outcomes:           {s['outcome_counts']}")

    elif args.command == "recompute":
        n = recompute_all()
        print(f"Hermeneutic re-evaluation complete. {n} entities recomputed.")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
