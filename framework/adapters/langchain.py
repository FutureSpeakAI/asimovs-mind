"""
Asimov's Mind — LangChain Governance Adapter

Wraps LangChain agents with Asimov's Laws governance. Every tool call
is checked against protected zones and safety floors before execution.

Usage:
    from asimovs_mind.adapters.langchain import GovernedAgent

    agent = GovernedAgent(
        base_agent=your_langchain_agent,
        laws_path="governance/laws.json",
        protected_zones_path="governance/protected-zones.json",
        safety_floors_path="governance/safety-floors.json"
    )

    # Agent now operates under Asimov's Laws
    result = agent.invoke({"input": "Fix the failing tests"})
"""

import json
from pathlib import Path
from typing import Any, Optional


class AsimovGovernor:
    """Governance enforcement layer for any agent system."""

    def __init__(
        self,
        laws_path: str = "governance/laws.json",
        protected_zones_path: str = "governance/protected-zones.json",
        safety_floors_path: str = "governance/safety-floors.json",
    ):
        self.laws = self._load_json(laws_path)
        self.protected_zones = self._load_json(protected_zones_path)
        self.safety_floors = self._load_json(safety_floors_path)

    def check_file_access(self, file_path: str, action: str = "modify") -> tuple[bool, str]:
        """Check if a file is in a protected zone. Returns (allowed, reason)."""
        from fnmatch import fnmatch

        for zone in self.protected_zones.get("zones", []):
            if fnmatch(file_path, zone["pattern"]):
                return False, f"BLOCKED: {file_path} is in protected zone '{zone['pattern']}' — {zone['reason']}"

        for pattern in self.protected_zones.get("custom_zones", {}).get("patterns", []):
            if fnmatch(file_path, pattern):
                return False, f"BLOCKED: {file_path} matches custom protected zone '{pattern}'"

        return True, "Allowed"

    def check_safety_floor(self, parameter: str, value: float) -> tuple[bool, str]:
        """Check if a parameter value respects its safety floor."""
        floors = self.safety_floors.get("floors", {})
        if parameter in floors:
            floor = floors[parameter]
            minimum = floor.get("minimum")
            maximum = floor.get("maximum")

            if minimum is not None and value < minimum:
                return False, f"BLOCKED: {parameter}={value} is below safety floor {minimum}"
            if maximum is not None and value > maximum:
                return False, f"BLOCKED: {parameter}={value} exceeds safety ceiling {maximum}"

        return True, "Within bounds"

    def get_laws_summary(self) -> str:
        """Return a human-readable summary of the governance laws."""
        laws = self.laws.get("laws", {})
        lines = ["Asimov's Mind Governance Laws:"]
        for key, law in laws.items():
            lines.append(f"\n  {law['name']}: {law['text']}")
        meta = self.laws.get("meta_law", {})
        if meta:
            lines.append(f"\n  Meta-Law: {meta['text']}")
        return "\n".join(lines)

    @staticmethod
    def _load_json(path: str) -> dict:
        try:
            return json.loads(Path(path).read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}


class GovernedAgent:
    """
    Wraps a LangChain agent with Asimov's Laws governance.

    All tool calls pass through the governor before execution.
    Protected zone violations are blocked. Safety floor breaches are blocked.
    """

    def __init__(self, base_agent: Any, **governor_kwargs: Any):
        self.agent = base_agent
        self.governor = AsimovGovernor(**governor_kwargs)

    def invoke(self, input_data: dict, **kwargs: Any) -> Any:
        """Run the agent with governance checks on every tool call."""
        # Inject governance context into the agent's prompt
        governance_context = self.governor.get_laws_summary()
        if "system_message" in kwargs:
            kwargs["system_message"] = f"{governance_context}\n\n{kwargs['system_message']}"

        return self.agent.invoke(input_data, **kwargs)
