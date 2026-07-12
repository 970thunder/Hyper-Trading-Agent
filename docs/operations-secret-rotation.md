# Secret Rotation and Encryption Migration

This runbook covers model provider keys, API access keys, and the migration path from environment-file secrets to encrypted commercial storage.

## Scope

- `API_AUTH_KEY`: protects remote API access.
- `VIBE_TRADING_SECRET_KEY`: signs application secrets and sessions.
- Model provider API keys: SiliconFlow, OpenAI-compatible, OpenRouter, DeepSeek, Qwen/DashScope, Ollama gateway keys, and organization model provider secrets.
- Data provider keys: Tushare, FMP, FRED, broker connector credentials.

## Rotation Policy

- Rotate organization model provider keys every 90 days, immediately after a suspected leak, and before handing an environment to a new operator.
- Rotate `API_AUTH_KEY` whenever the deployment endpoint changes from local-only to network-accessible.
- Do not reuse a personal development key in production.
- Never paste real secrets into Git, issue trackers, screenshots, chat transcripts, audit comments, or run artifacts.

## Model Provider Key Rotation

1. Create the new provider key in the upstream provider console.
2. In Hyper Trading Agent, open Settings -> Model configuration.
3. Edit the affected provider and paste the new key.
4. Run Test connection.
5. Send a short non-sensitive Agent message with that provider selected.
6. Confirm model usage records show the expected provider and model.
7. Revoke the old key in the upstream provider console.
8. Review audit logs for failed calls after rotation.

Expected rollback:

1. Re-enable the old key only if it has not leaked.
2. Paste it back into the provider settings.
3. Test connection again.
4. Revoke the failed new key if needed.

## API Access Key Rotation

For Docker Compose:

```powershell
$newKey = [System.Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
(Get-Content .env.production) -replace '^API_AUTH_KEY=.*', "API_AUTH_KEY=$newKey" | Set-Content .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api frontend
```

After rotation:

- Clear any saved frontend API key in browser settings if remote bearer access is used.
- Re-enter the new API key only for trusted operators.
- Check `/health` locally and then test a protected route.

## Encryption Migration Path

Current MVP deployments may still use environment variables for bootstrap and local compatibility. The commercial path should be:

1. Keep plaintext secrets only in `.env.production` or the platform secret manager during bootstrap.
2. Store organization model provider keys through the commercial model provider API.
3. Encrypt stored provider secrets with an application encryption key derived from `VIBE_TRADING_SECRET_KEY` or a managed KMS key.
4. Return only masked key state to the frontend, never the raw key.
5. Record provider create/update/test/default changes in audit logs.
6. Rotate the encryption root key by decrypting each stored secret with the old key and re-encrypting with the new key during a maintenance window.

Migration checklist:

- [ ] Confirm all production providers are visible in Settings -> Model configuration.
- [ ] Confirm API responses never include raw provider keys.
- [ ] Confirm logs and traces redact `api_key`, `secret`, `token`, `authorization`, and broker credentials.
- [ ] Back up the database before root-key rotation.
- [ ] Run provider connection tests after re-encryption.
- [ ] Revoke any legacy keys left only in `.env.production`.

## Incident Response

If a key is exposed:

1. Revoke it upstream first.
2. Rotate the Hyper Trading Agent configuration.
3. Search audit logs and model usage for unexpected calls.
4. Review run artifacts and traces for accidental secret capture.
5. Document affected provider, time window, users, and remediation.

