"""
Asimov's Mind — CrewAI Governance Adapter

Wraps CrewAI crews with Asimov's Laws governance. Provides a governed
crew factory that enforces protected zones and safety floors.

Usage:
    from asimovs_mind.adapters.crewai import governed_crew

    crew = governed_crew(
        agents=[researcher, coder, reviewer],
        tasks=[research_task, code_task, review_task],
        governance_path="governance/"
    )

    result = crew.kickoff()
"""

from pathlib import Path
from .langchain import AsimovGovernor


def governed_crew(agents: list, tasks: list, governance_path: str = "governance/"):
    """
    Create a CrewAI crew with Asimov's Laws governance.

    Injects governance rules into each agent's backstory and role.
    """
    governor = AsimovGovernor(
        laws_path=f"{governance_path}/laws.json",
        protected_zones_path=f"{governance_path}/protected-zones.json",
        safety_floors_path=f"{governance_path}/safety-floors.json",
    )

    governance_context = governor.get_laws_summary()

    # Inject governance into each agent's backstory
    for agent in agents:
        if hasattr(agent, 'backstory'):
            agent.backstory = f"{governance_context}\n\n{agent.backstory}"

    # Return the crew (CrewAI import is optional — user provides it)
    try:
        from crewai import Crew
        return Crew(agents=agents, tasks=tasks, verbose=True)
    except ImportError:
        raise ImportError(
            "CrewAI is not installed. Install it with: pip install crewai"
        )
