"""Bootstrap helpers for first-run commercial deployments."""

from __future__ import annotations

import argparse
import json

from src.commercial.store import CommercialStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Initialize a commercial Vibe-Trading organization owner")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--organization", default="Default Organization")
    parser.add_argument("--display-name", default="")
    parser.add_argument("--provider", default="siliconflow")
    parser.add_argument("--model", default="deepseek-ai/DeepSeek-V4-Flash")
    parser.add_argument("--base-url", default="https://api.siliconflow.cn/v1")
    parser.add_argument("--api-key", default="")
    args = parser.parse_args(argv)

    store = CommercialStore()
    principal, _token = store.register_owner(
        email=args.email,
        password=args.password,
        organization_name=args.organization,
        display_name=args.display_name,
    )
    provider = store.create_model_provider(
        principal,
        {
            "provider": args.provider,
            "model": args.model,
            "base_url": args.base_url,
            "api_key": args.api_key,
            "enabled": True,
            "is_default": True,
        },
    )
    print(json.dumps(
        {
            "status": "ok",
            "user_id": principal.user_id,
            "organization_id": principal.organization_id,
            "email": principal.email,
            "role": principal.role,
            "default_model_provider_id": provider["id"],
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
