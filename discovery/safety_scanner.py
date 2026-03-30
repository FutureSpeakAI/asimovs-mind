"""
safety_scanner.py — AST-based static analysis for Asimov's Mind discovery system.

Scans Python source code BEFORE it can be imported into train.py.
This is the most safety-critical module in the system: if it passes code,
that code will execute with access to GPU memory and model weights.

Three-tier finding system:
  Tier 1 (HARD BLOCK):  Network calls, file writes, process execution,
                         blocked imports, monkey-patching, global mutation.
  Tier 2 (SOFT BLOCK):  Risky patterns that raise minimum trust by 0.2.
  Tier 3 (INFO):        Style warnings — assert, print, magic numbers.

Trust scoring: starts at 1.0, subtract 1.0/0.2/0.05 per tier.
Verdict: PASS (score >= 0.8), SOFT_BLOCK (score >= 0.2), HARD_BLOCK (< 0.2).

Uses ONLY Python standard library.
"""

from __future__ import annotations

import ast
import hashlib
import re
from dataclasses import dataclass, field
from typing import List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Modules that are safe to import. Everything else is blocked by default.
ALLOWED_MODULES: Set[str] = {
    "torch", "torch.nn", "torch.nn.functional", "torch.optim",
    "torch.cuda", "torch.amp",
    "math", "os", "sys", "time", "typing", "dataclasses",
    "functools", "itertools", "collections", "abc", "copy",
    "warnings", "contextlib", "pathlib",
    "re", "string", "struct", "io", "enum", "gc", "platform",
    "numpy",
}

# Top-level package names derived from ALLOWED_MODULES (for `import x.y.z`
# where we check that `x` is in our allowed set).
ALLOWED_TOP_LEVEL: Set[str] = {m.split(".")[0] for m in ALLOWED_MODULES}

# Modules that are ALWAYS blocked, even if their top-level parent might
# otherwise look innocuous.  These are explicitly dangerous.
BLOCKED_MODULES: Set[str] = {
    "requests", "urllib", "http", "socket",
    "subprocess", "multiprocessing", "threading",
    "ctypes", "cffi",
    # NOTE: the serialization module that rhymes with "brickle" is blocked.
    # Use torch.save / torch.load instead.
    "pickle",
    "importlib",    # dynamic imports — blocked with dynamic args
}

# Functions / attributes that constitute Tier-1 hard blocks when called.
TIER1_DANGEROUS_CALLS: Set[str] = {
    "eval", "exec", "compile",                          # code execution
    "os.system", "os.popen", "os.exec",                 # process execution
    "os.execl", "os.execle", "os.execlp", "os.execlpe",
    "os.execv", "os.execve", "os.execvp", "os.execvpe",
    "os.spawn", "os.spawnl", "os.spawnle",
    "subprocess.run", "subprocess.call",
    "subprocess.Popen", "subprocess.check_call",
    "subprocess.check_output",
    "__import__",                                        # dynamic import
}

# File-write functions that are hard-blocked.
TIER1_FILE_WRITE_CALLS: Set[str] = {
    "open",     # checked contextually — write modes only
}

# Network-related attribute patterns (Tier 1 — blocked everywhere).
NETWORK_CALL_PATTERNS: Set[str] = {
    "requests.get", "requests.post", "requests.put",
    "requests.delete", "requests.patch", "requests.head",
    "requests.request", "requests.Session",
    "urllib.request.urlopen", "urllib.request.urlretrieve",
    "http.client.HTTPConnection", "http.client.HTTPSConnection",
    "socket.socket", "socket.create_connection",
}

# Monkey-patching targets: assignments to these are Tier 1.
TORCH_INTERNAL_ATTRS: Set[str] = {
    "torch.nn.Module.forward",
    "torch.nn.Module.__call__",
    "torch.autograd.Function",
    "torch.backends",
    "torch._C",
}

# Global-state mutation targets at module level.
GLOBAL_MUTATION_TARGETS: Set[str] = {
    "sys.path",
    "os.environ",
}

# Tier-2 patterns.
TIER2_PATTERNS: Set[str] = {
    "pickle.load", "pickle.loads",
    "random.seed",
    "torch.compile",
}

# Write-mode indicators for open() calls.
WRITE_MODES = re.compile(r"[waxWAX+]")


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class Finding:
    """A single finding from the safety scan."""
    tier: int                   # 1, 2, or 3
    pattern_name: str           # machine-readable identifier
    line_number: int            # 1-based line in source
    code_snippet: str           # the offending source line (trimmed)
    description: str            # human-readable explanation
    blocking: bool              # True if this finding blocks execution

    def __str__(self) -> str:
        severity = {1: "HARD_BLOCK", 2: "SOFT_BLOCK", 3: "INFO"}
        return (
            f"[Tier {self.tier} / {severity.get(self.tier, '?')}] "
            f"line {self.line_number}: {self.pattern_name} — {self.description}"
        )


@dataclass
class ScanReport:
    """Aggregate result of scanning a single source file."""
    source_hash: str                        # SHA-256 of the source text
    findings: List[Finding] = field(default_factory=list)
    scanner_trust_score: float = 1.0        # starts at 1.0
    verdict: str = "PASS"                   # PASS | SOFT_BLOCK | HARD_BLOCK
    repo_name: str = ""
    file_path: str = ""

    # -- helpers --
    @property
    def has_hard_block(self) -> bool:
        return any(f.tier == 1 for f in self.findings)

    @property
    def has_soft_block(self) -> bool:
        return any(f.tier == 2 for f in self.findings)

    def add(self, finding: Finding) -> None:
        self.findings.append(finding)

    def compute_verdict(self) -> None:
        """Recompute trust score and verdict from accumulated findings."""
        score = 1.0
        for f in self.findings:
            if f.tier == 1:
                score -= 1.0
            elif f.tier == 2:
                score -= 0.2
            elif f.tier == 3:
                score -= 0.05
        self.scanner_trust_score = max(0.0, round(score, 4))

        if self.has_hard_block or self.scanner_trust_score < 0.2:
            self.verdict = "HARD_BLOCK"
        elif self.has_soft_block or self.scanner_trust_score < 0.8:
            self.verdict = "SOFT_BLOCK"
        else:
            self.verdict = "PASS"

    def summary(self) -> str:
        tier_counts = {1: 0, 2: 0, 3: 0}
        for f in self.findings:
            tier_counts[f.tier] = tier_counts.get(f.tier, 0) + 1
        lines = [
            f"Safety Scan Report: {self.file_path} ({self.repo_name})",
            f"  Source hash : {self.source_hash[:16]}...",
            f"  Verdict     : {self.verdict}",
            f"  Trust score : {self.scanner_trust_score}",
            f"  Findings    : {len(self.findings)} total "
            f"(T1={tier_counts[1]}, T2={tier_counts[2]}, T3={tier_counts[3]})",
        ]
        if self.findings:
            lines.append("  Details:")
            for f in self.findings:
                lines.append(f"    {f}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _get_source_line(source_lines: List[str], lineno: int) -> str:
    """Return the trimmed source line at 1-based *lineno*, or '<unknown>'."""
    if 1 <= lineno <= len(source_lines):
        return source_lines[lineno - 1].strip()
    return "<unknown>"


def _dotted_name(node: ast.AST) -> Optional[str]:
    """
    Try to reconstruct a dotted name from an AST node.

    Examples:
        ast.Name(id='os')                  -> 'os'
        ast.Attribute(value=Name('os'),
                      attr='system')       -> 'os.system'
    Returns None if the node shape is not a simple dotted chain.
    """
    parts: List[str] = []
    cur = node
    while True:
        if isinstance(cur, ast.Attribute):
            parts.append(cur.attr)
            cur = cur.value
        elif isinstance(cur, ast.Name):
            parts.append(cur.id)
            break
        else:
            return None
    parts.reverse()
    return ".".join(parts)


def _resolve_import_alias(name: str, aliases: dict) -> str:
    """Resolve an alias back to its original module name if possible."""
    return aliases.get(name, name)


def _is_string_literal(node: ast.AST) -> Optional[str]:
    """Return the string value if *node* is a string constant, else None."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


# ---------------------------------------------------------------------------
# AST Visitor
# ---------------------------------------------------------------------------

class SafetyVisitor(ast.NodeVisitor):
    """
    Walk the AST checking imports, calls, and assignments against the
    three-tier safety policy.

    The visitor maintains a *scope_stack* so it can distinguish module-level
    code (where network/file calls are most dangerous) from code inside
    function or class bodies.
    """

    def __init__(self, source_lines: List[str], report: ScanReport) -> None:
        self.source_lines = source_lines
        self.report = report
        # Track scope: ['module'] at top level; push 'function'/'class'.
        self.scope_stack: List[str] = ["module"]
        # Map alias -> original module name for resolving calls.
        self.import_aliases: dict = {}

    # -- scope helpers --

    @property
    def at_module_level(self) -> bool:
        return len(self.scope_stack) == 1 and self.scope_stack[0] == "module"

    def _push_scope(self, kind: str) -> None:
        self.scope_stack.append(kind)

    def _pop_scope(self) -> None:
        if len(self.scope_stack) > 1:
            self.scope_stack.pop()

    # -- finding helpers --

    def _add(self, tier: int, pattern: str, node: ast.AST, desc: str) -> None:
        lineno = getattr(node, "lineno", 0)
        snippet = _get_source_line(self.source_lines, lineno)
        blocking = tier == 1
        self.report.add(Finding(
            tier=tier,
            pattern_name=pattern,
            line_number=lineno,
            code_snippet=snippet,
            description=desc,
            blocking=blocking,
        ))

    # ----------------------------------------------------------------
    # Import checks
    # ----------------------------------------------------------------

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_import(alias.name, node, alias.asname)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        # Check the base module.
        self._check_import(module, node)
        # Also check each imported name for dangerous sub-modules.
        for alias in node.names:
            full = f"{module}.{alias.name}" if module else alias.name
            # Register alias mapping so we can resolve calls later.
            local_name = alias.asname or alias.name
            self.import_aliases[local_name] = full
            # If the full path matches a blocked module, flag it.
            if self._is_blocked_module(full):
                self._add(
                    1, "blocked_import", node,
                    f"Import of blocked module '{full}'."
                )
        self.generic_visit(node)

    def _check_import(self, module_name: str, node: ast.AST,
                      asname: Optional[str] = None) -> None:
        """Validate a single import against allowlist / blocklist."""
        if not module_name:
            return

        # Register alias.
        if asname:
            self.import_aliases[asname] = module_name
        else:
            top = module_name.split(".")[0]
            self.import_aliases[top] = top

        # Explicit blocklist takes priority.
        if self._is_blocked_module(module_name):
            self._add(
                1, "blocked_import", node,
                f"Import of blocked module '{module_name}'. "
                f"This module is not permitted in discovered code."
            )
            return

        # Check against allowlist (top-level package must be allowed).
        top_level = module_name.split(".")[0]
        if top_level not in ALLOWED_TOP_LEVEL:
            self._add(
                1, "disallowed_import", node,
                f"Import of '{module_name}' is not on the module allowlist. "
                f"Only standard-library and torch/numpy modules are permitted."
            )
            return

        # Special case: gc is allowed but flagged as info.
        if module_name == "gc" or module_name.startswith("gc."):
            self._add(
                3, "gc_import", node,
                "gc module imported — manual garbage collection may "
                "interfere with training memory management."
            )

    def _is_blocked_module(self, module_name: str) -> bool:
        """Return True if *module_name* or any of its parents is blocked."""
        parts = module_name.split(".")
        for i in range(len(parts)):
            prefix = ".".join(parts[: i + 1])
            if prefix in BLOCKED_MODULES:
                return True
        return False

    # ----------------------------------------------------------------
    # Function / class scope tracking
    # ----------------------------------------------------------------

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._push_scope("function")
        self.generic_visit(node)
        self._pop_scope()

    visit_AsyncFunctionDef = visit_FunctionDef  # same treatment

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._push_scope("class")
        self.generic_visit(node)
        self._pop_scope()

    # ----------------------------------------------------------------
    # Call checks
    # ----------------------------------------------------------------

    def visit_Call(self, node: ast.Call) -> None:
        self._check_call(node)
        self.generic_visit(node)

    def _check_call(self, node: ast.Call) -> None:
        """Inspect a function/method call for dangerous patterns."""
        func_name = self._resolve_call_name(node.func)
        if func_name is None:
            # Can't determine the callee — skip.
            return

        # --- Tier 1: hard-blocked calls ---

        # eval / exec / compile / os.system / subprocess.* / __import__
        if func_name in TIER1_DANGEROUS_CALLS:
            self._add(
                1, "dangerous_call", node,
                f"Call to '{func_name}' is unconditionally blocked."
            )
            return

        # Match against prefixes for os.exec* / os.spawn* families.
        for prefix in ("os.exec", "os.spawn"):
            if func_name.startswith(prefix) and func_name not in ALLOWED_MODULES:
                self._add(
                    1, "process_execution", node,
                    f"Call to '{func_name}' — process execution is blocked."
                )
                return

        # Network calls.
        if func_name in NETWORK_CALL_PATTERNS:
            self._add(
                1, "network_call", node,
                f"Network call '{func_name}' is blocked. "
                f"Discovered code must not make network requests."
            )
            return

        # open() with write mode.
        if func_name == "open" or func_name == "builtins.open":
            self._check_open_call(node)
            return

        # importlib with dynamic args (importlib.import_module with variable).
        if func_name in ("importlib.import_module",):
            # If the argument is a string literal of an allowed module, we
            # could theoretically allow it, but the policy says block with
            # dynamic args.  Check if the arg is a literal.
            if node.args:
                lit = _is_string_literal(node.args[0])
                if lit is None:
                    # Dynamic argument — hard block.
                    self._add(
                        1, "dynamic_import", node,
                        "importlib.import_module with non-literal argument. "
                        "Dynamic imports are blocked."
                    )
                    return
                elif self._is_blocked_module(lit):
                    self._add(
                        1, "blocked_dynamic_import", node,
                        f"importlib.import_module('{lit}') — module is blocked."
                    )
                    return
                else:
                    # Literal, allowed module — still flag as info.
                    self._add(
                        3, "importlib_literal", node,
                        f"importlib.import_module('{lit}') — prefer static import."
                    )
                    return
            # No args is a runtime error anyway; flag it.
            self._add(
                1, "dynamic_import", node,
                "importlib.import_module called without arguments."
            )
            return

        # --- Tier 2: soft-blocked calls ---

        # Serialization load without weights_only=True
        if func_name in ("pickle.load", "pickle.loads"):
            self._add(
                2, "unsafe_deserialize", node,
                f"'{func_name}' without weights_only is risky. "
                f"Use torch.load with weights_only=True instead."
            )
            return

        # torch.load without weights_only — also Tier 2
        if func_name == "torch.load":
            has_weights_only = any(
                kw.arg == "weights_only" for kw in node.keywords
            )
            if not has_weights_only:
                self._add(
                    2, "torch_load_no_weights_only", node,
                    "torch.load() called without weights_only=True. "
                    "This can deserialize arbitrary objects."
                )
            return

        # random.seed at module scope
        if func_name == "random.seed" and self.at_module_level:
            self._add(
                2, "random_seed_module_scope", node,
                "random.seed() at module scope may cause reproducibility "
                "issues across training runs."
            )
            return

        # torch.compile with unverified code
        if func_name == "torch.compile":
            self._add(
                2, "torch_compile", node,
                "torch.compile() on unverified code — compiled kernels "
                "may behave unexpectedly."
            )
            return

        # --- Tier 3: info-level ---

        # print calls
        if func_name == "print":
            self._add(
                3, "print_call", node,
                "print() call found — use logging for production code."
            )
            return

    def _check_open_call(self, node: ast.Call) -> None:
        """Check open() for write-mode arguments."""
        mode = self._extract_open_mode(node)
        if mode is not None and WRITE_MODES.search(mode):
            self._add(
                1, "file_write", node,
                f"open() with write mode '{mode}' — file writes are blocked."
            )
        elif mode is None:
            # Could not determine mode statically. If there's a second
            # positional arg or a 'mode' keyword that isn't a literal,
            # we must assume the worst if at module level.
            has_mode_arg = (
                len(node.args) >= 2
                or any(kw.arg == "mode" for kw in node.keywords)
            )
            if has_mode_arg:
                # There IS a mode argument but we couldn't read it — it's
                # dynamic.  Hard-block if at module level, tier-2 otherwise.
                if self.at_module_level:
                    self._add(
                        1, "file_write_dynamic_mode", node,
                        "open() with dynamic mode at module level — "
                        "cannot verify read-only."
                    )
                else:
                    self._add(
                        2, "file_write_dynamic_mode", node,
                        "open() with dynamic mode — cannot verify read-only."
                    )
            # If no mode arg at all, default is 'r' — safe.

    def _extract_open_mode(self, node: ast.Call) -> Optional[str]:
        """Try to extract the mode string from an open() call."""
        # Check keyword argument 'mode'.
        for kw in node.keywords:
            if kw.arg == "mode":
                return _is_string_literal(kw.value)
        # Check second positional argument.
        if len(node.args) >= 2:
            return _is_string_literal(node.args[1])
        return None  # no mode specified — defaults to 'r'

    def _resolve_call_name(self, func_node: ast.AST) -> Optional[str]:
        """
        Resolve the callee to a dotted name string, applying import aliases.
        """
        raw = _dotted_name(func_node)
        if raw is None:
            return None

        parts = raw.split(".")
        # Resolve the leading name through import aliases.
        resolved_head = self.import_aliases.get(parts[0], parts[0])
        if resolved_head != parts[0]:
            # The head was aliased. Rebuild.
            resolved_parts = resolved_head.split(".") + parts[1:]
            return ".".join(resolved_parts)
        return raw

    # ----------------------------------------------------------------
    # Assignment checks
    # ----------------------------------------------------------------

    def visit_Assign(self, node: ast.Assign) -> None:
        self._check_assignment(node, node.targets)
        self.generic_visit(node)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self._check_assignment(node, [node.target])
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.target is not None:
            self._check_assignment(node, [node.target])
        self.generic_visit(node)

    def _check_assignment(self, node: ast.AST,
                          targets: List[ast.AST]) -> None:
        """Check assignment targets for monkey-patching or global mutation."""
        for target in targets:
            dotted = _dotted_name(target)
            if dotted is None:
                continue

            resolved = self._resolve_dotted(dotted)

            # Monkey-patching torch internals (any scope).
            for pattern in TORCH_INTERNAL_ATTRS:
                if resolved == pattern or resolved.startswith(pattern + "."):
                    self._add(
                        1, "monkey_patch_torch", node,
                        f"Assignment to '{resolved}' — monkey-patching "
                        f"torch internals is blocked."
                    )
                    return

            # Global state mutation at module level.
            if self.at_module_level:
                for pattern in GLOBAL_MUTATION_TARGETS:
                    if resolved == pattern or resolved.startswith(pattern + "."):
                        self._add(
                            1, "global_state_mutation", node,
                            f"Module-level mutation of '{resolved}' — "
                            f"global state modification is blocked."
                        )
                        return

    def _resolve_dotted(self, dotted: str) -> str:
        """Resolve import aliases in a dotted name."""
        parts = dotted.split(".")
        resolved_head = self.import_aliases.get(parts[0], parts[0])
        if resolved_head != parts[0]:
            return ".".join(resolved_head.split(".") + parts[1:])
        return dotted

    # ----------------------------------------------------------------
    # Expression statement checks (e.g. sys.path.append(...))
    # ----------------------------------------------------------------

    def visit_Expr(self, node: ast.Expr) -> None:
        # Check for sys.path.append / os.environ.update etc. at module level.
        if self.at_module_level and isinstance(node.value, ast.Call):
            call_name = self._resolve_call_name(node.value.func)
            if call_name:
                for target in GLOBAL_MUTATION_TARGETS:
                    if call_name.startswith(target + "."):
                        self._add(
                            1, "global_state_mutation", node,
                            f"Module-level call '{call_name}' — "
                            f"global state modification is blocked."
                        )
                        break
        self.generic_visit(node)

    # ----------------------------------------------------------------
    # Assert / magic number checks (Tier 3)
    # ----------------------------------------------------------------

    def visit_Assert(self, node: ast.Assert) -> None:
        self._add(
            3, "assert_statement", node,
            "assert statement — asserts are stripped with -O flag "
            "and should not be used for validation."
        )
        self.generic_visit(node)

    def visit_Constant(self, node: ast.Constant) -> None:
        """Flag magic numbers (numeric literals that are not 0, 1, -1, 2)."""
        if isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            # Allow common harmless values.
            if node.value not in (0, 1, -1, 2, 0.0, 1.0, -1.0, 2.0, 0.5):
                # Only flag at module level to avoid flooding on every
                # numeric literal inside functions.
                if self.at_module_level:
                    self._add(
                        3, "magic_number", node,
                        f"Magic number {node.value} at module scope — "
                        f"consider using a named constant."
                    )
        self.generic_visit(node)

    # ----------------------------------------------------------------
    # Subscript assignment to global state (e.g. os.environ["X"] = ...)
    # ----------------------------------------------------------------

    def visit_Subscript(self, node: ast.Subscript) -> None:
        """
        Catch os.environ["KEY"] = value or sys.path[0] = value when
        used as an assignment target at module scope.
        """
        if isinstance(node.ctx, ast.Store) and self.at_module_level:
            dotted = _dotted_name(node.value)
            if dotted:
                resolved = self._resolve_dotted(dotted)
                for target in GLOBAL_MUTATION_TARGETS:
                    if resolved == target or resolved.startswith(target + "."):
                        self._add(
                            1, "global_state_mutation", node,
                            f"Module-level subscript assignment to "
                            f"'{resolved}' — global state modification "
                            f"is blocked."
                        )
                        break
        self.generic_visit(node)

    # ----------------------------------------------------------------
    # Delete checks (e.g., del sys.path[:])
    # ----------------------------------------------------------------

    def visit_Delete(self, node: ast.Delete) -> None:
        if self.at_module_level:
            for target in node.targets:
                dotted = _dotted_name(target)
                if dotted:
                    resolved = self._resolve_dotted(dotted)
                    for pattern in GLOBAL_MUTATION_TARGETS:
                        if resolved == pattern or resolved.startswith(pattern + "."):
                            self._add(
                                1, "global_state_mutation", node,
                                f"Module-level deletion of '{resolved}' — "
                                f"global state modification is blocked."
                            )
                            break
        self.generic_visit(node)


# ---------------------------------------------------------------------------
# Additional regex-based checks (pre-AST or supplementary)
# ---------------------------------------------------------------------------

def _regex_checks(source: str, source_lines: List[str],
                  report: ScanReport) -> None:
    """
    Supplementary regex-based checks for patterns that are hard to catch
    purely via AST (e.g., string-based dynamic attribute access, encoded
    payloads).
    """

    # Check for base64-encoded strings that might hide payloads.
    b64_pattern = re.compile(
        r"""(?:base64\.b64decode|base64\.decodebytes)\s*\(""", re.IGNORECASE
    )
    for i, line in enumerate(source_lines, 1):
        if b64_pattern.search(line):
            report.add(Finding(
                tier=1,
                pattern_name="base64_decode",
                line_number=i,
                code_snippet=line.strip(),
                description=(
                    "base64 decoding detected — may be used to hide "
                    "malicious payloads."
                ),
                blocking=True,
            ))

    # Check for getattr/setattr with dynamic string args that target
    # dangerous modules.
    attr_pattern = re.compile(
        r"""(?:setattr|getattr|delattr)\s*\(\s*"""
        r"""(?:torch|sys|os|builtins)"""
    )
    for i, line in enumerate(source_lines, 1):
        if attr_pattern.search(line):
            report.add(Finding(
                tier=1,
                pattern_name="dynamic_attr_access",
                line_number=i,
                code_snippet=line.strip(),
                description=(
                    "Dynamic attribute access on sensitive module — "
                    "potential bypass of static analysis."
                ),
                blocking=True,
            ))

    # Check for __subclasses__ / __bases__ introspection (class escape).
    escape_pattern = re.compile(r"__(?:subclasses|bases|mro|globals|builtins)__")
    for i, line in enumerate(source_lines, 1):
        if escape_pattern.search(line):
            report.add(Finding(
                tier=1,
                pattern_name="dunder_escape",
                line_number=i,
                code_snippet=line.strip(),
                description=(
                    "Dunder introspection (__subclasses__, __bases__, "
                    "__mro__, __globals__, __builtins__) detected — "
                    "potential sandbox escape."
                ),
                blocking=True,
            ))


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def scan_source(source: str, repo_name: str = "",
                file_path: str = "") -> ScanReport:
    """
    Scan Python source code for safety issues.

    Parameters
    ----------
    source : str
        The full Python source text to scan.
    repo_name : str
        Human-readable identifier for the repository (for reporting).
    file_path : str
        Path of the file within the repository (for reporting).

    Returns
    -------
    ScanReport
        The completed scan report with findings, trust score, and verdict.
    """
    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    report = ScanReport(
        source_hash=source_hash,
        repo_name=repo_name,
        file_path=file_path,
    )

    source_lines = source.splitlines()

    # --- Phase 1: Parse the AST ---
    try:
        tree = ast.parse(source, filename=file_path or "<discovery>")
    except SyntaxError as exc:
        report.add(Finding(
            tier=1,
            pattern_name="syntax_error",
            line_number=exc.lineno or 0,
            code_snippet=(exc.text or "").strip(),
            description=f"Syntax error: {exc.msg}. Cannot verify safety.",
            blocking=True,
        ))
        report.compute_verdict()
        return report

    # --- Phase 2: AST walk ---
    visitor = SafetyVisitor(source_lines, report)
    visitor.visit(tree)

    # --- Phase 3: Regex-based supplementary checks ---
    _regex_checks(source, source_lines, report)

    # --- Phase 4: Compute final verdict ---
    report.compute_verdict()
    return report


# ---------------------------------------------------------------------------
# CLI convenience (for manual / CI use)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys as _sys

    if len(_sys.argv) < 2:
        print("Usage: python safety_scanner.py <file.py> [file2.py ...]")
        _sys.exit(1)

    exit_code = 0
    for path in _sys.argv[1:]:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                src = fh.read()
        except (OSError, IOError) as exc:
            print(f"ERROR: Cannot read {path}: {exc}", file=_sys.stderr)
            exit_code = 1
            continue

        result = scan_source(src, repo_name="cli", file_path=path)
        print(result.summary())
        print()

        if result.verdict == "HARD_BLOCK":
            exit_code = 1

    _sys.exit(exit_code)
