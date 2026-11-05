# asset-monitor

Security-first Next.js portfolio monitor. See `.env.example`.

- Local store: `data/store.json`. Cloud: Turso or memory+/tmp.
- Auth via `DASHBOARD_PASSWORD` env.
- **Scheduled refresh is VPS-only**: systemd/cron on the same host calling `http://127.0.0.1:3000/api/cron/refresh` with `CRON_SECRET`. See `docs/scheduled-refresh.md`. Do not depend on an external Actions scheduler repo.
- On-chain balances: Rabby (+ optional BN Web3 DeFi fallback) and other optional providers.
- After refresh: failed exchanges/wallets keep last balance.

## Gate accounts

Refresh can read up to three read-only Gate accounts and sum them into the exchange total:

| Row | Env (both required) | Notes |
|---|---|---|
| Gate | `GATE_API_KEY` / `GATE_API_SECRET` | Primary account. Encrypted keys saved in the app still work if env is empty. |
| Gate B | `GATE_B_KEY` / `GATE_B_SECRET` | Optional. Skipped when either value is missing (no crash). |
| Gate C | `GATE_C_KEY` / `GATE_C_SECRET` | Optional. Same skip rules as Gate B. |

Each configured account calls Gate `GET /api/v4/wallet/total_balance` (spot + finance/earn, one equity figure). There is no trade, withdraw, or transfer call.

When Gate B or Gate C returns a live total, refresh deletes the matching manual placeholder if the name is `Gate B GHO` or `Gate C GHO` (spaces ignored). That removal is not booked as an outflow.

Authenticated `GET /api/cex-keys` reports `envConfigured.gate`, `envConfigured.gateB`, and `envConfigured.gateC` as booleans. It never returns key material.

### Check balances after deploy

On the host that already has the variables in its env file (do not print the values):

```bash
# names only: each line should say "set" or "missing"
node -e 'for (const k of ["GATE_API_KEY","GATE_API_SECRET","GATE_B_KEY","GATE_B_SECRET","GATE_C_KEY","GATE_C_SECRET"]) console.log(k, process.env[k] && process.env[k].trim() ? "set" : "missing")'

curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://127.0.0.1:3000/api/cron/refresh?mode=fast"
```

Then open the exchanges page. Expect separate live rows for each configured Gate account.
