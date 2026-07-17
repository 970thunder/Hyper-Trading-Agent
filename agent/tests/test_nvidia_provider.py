"""Regression coverage for NVIDIA NIM provider wiring."""

from __future__ import annotations

from cli import _legacy, onboard
from src.providers.capabilities import get_provider_capabilities, provider_env_names


def test_nvidia_nim_uses_compatibility_user_agent_and_alias() -> None:
    capabilities = get_provider_capabilities("nvidia-nim")
    assert capabilities.api_key_env == "NVIDIA_API_KEY"
    assert capabilities.default_headers["User-Agent"].startswith("Hyper-Trading-Agent/")
    assert provider_env_names(None, "nvidia/nemotron-3-ultra-550b-a55b") == ("NVIDIA_API_KEY", "NVIDIA_BASE_URL")


def test_cli_onboarding_paths_offer_nvidia_nim() -> None:
    assert any(provider.key == "nvidia" and provider.key_prefix == "nvapi-" for provider in onboard.PROVIDERS)
    assert any(choice["provider"] == "nvidia" for choice in _legacy._PROVIDER_CHOICES)
    assert _legacy._provider_key_env("nvidia-nim") == "NVIDIA_API_KEY"
