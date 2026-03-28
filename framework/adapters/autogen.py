"""
Asimov's Mind — AutoGen Governance Adapter

Wraps Microsoft AutoGen agents with Asimov's Laws governance.

Usage:
    from asimovs_mind.adapters.autogen import governed_agent

    agent = governed_agent(
        name="code_improver",
        system_message="You fix code.",
        governance_path="governance/"
    )
"""

from .langchain import AsimovGovernor


def governed_agent(
    name: str,
    system_message: str,
    governance_path: str = "governance/",
    **agent_kwargs,
):
    """
    Create an AutoGen AssistantAgent with Asimov's Laws governance injected
    into its system message.
    """
    governor = AsimovGovernor(
        laws_path=f"{governance_path}/laws.json",
        protected_zones_path=f"{governance_path}/protected-zones.json",
        safety_floors_path=f"{governance_path}/safety-floors.json",
    )

    governance_context = governor.get_laws_summary()
    governed_system_message = f"{governance_context}\n\n{system_message}"

    try:
        from autogen import AssistantAgent
        return AssistantAgent(
            name=name,
            system_message=governed_system_message,
            **agent_kwargs,
        )
    except ImportError:
        raise ImportError(
            "AutoGen is not installed. Install it with: pip install pyautogen"
        )
