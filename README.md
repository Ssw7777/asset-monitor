Security-first Next.js portfolio monitor (private backup). See `.env.example`.

- Local store: `data/store.json`. Cloud: Turso or memory+/tmp.
- Auth via `DASHBOARD_PASSWORD` env.
- **Scheduled refresh is VPS-only**: systemd/cron on the same host calling `http://127.0.0.1:3000/api/cron/refresh` with `CRON_SECRET`. See `docs/scheduled-refresh.md`. Do not depend on an external Actions scheduler repo.
- On-chain balances: Rabby (+ optional BN Web3 DeFi fallback) and other optional providers.
- After refresh: failed exchanges/wallets keep last balance.

## Gate accounts

Refresh reads three read-only Gate accounts and sums them into the exchange total:

| Row | Env (both required) | Notes |
|---|---|---|
| Gate | `GATE_API_KEY` / `GATE_API_SECRET` | Existing personal account. Encrypted keys saved in the app still work if env is empty. |
| Gate妈妈 | `GATE_MOM_KEY` / `GATE_MOM_SECRET` | Skipped when either value is missing. No crash, and the refresh is not marked partial for that skip. |
| Gate哥哥 | `GATE_BROTHER_KEY` / `GATE_BROTHER_SECRET` | Same as mom. |

Each configured account calls Gate `GET /api/v4/wallet/total_balance` (spot + finance/earn, including GHO lending, one equity figure). There is no trade, withdraw, or transfer call.

When mom or brother returns a live total, refresh deletes the matching manual placeholder if the name is `妈妈 Gate GHO理财` or `哥哥 Gate GHO理财` (spaces ignored). That removal is not booked as an outflow. If a live row uses a different name, delete it on the 手动 page after the API line is visible, or `DELETE /api/manual?id=<id>` while logged in. Leaving it adds the same money twice.

Authenticated `GET /api/cex-keys` reports `envConfigured.gate`, `envConfigured.gateMom`, and `envConfigured.gateBrother` as booleans. It never returns key material.

### Check three balances after deploy

On the host that already has the six variables in its env file (do not print the values):

```bash
# names only: each line should say "set"
node -e 'for (const k of ["GATE_API_KEY","GATE_API_SECRET","GATE_MOM_KEY","GATE_MOM_SECRET","GATE_BROTHER_KEY","GATE_BROTHER_SECRET"]) console.log(k, process.env[k] && process.env[k].trim() ? "set" : "missing")'

curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://127.0.0.1:3000/api/cron/refresh?mode=fast"
```

Then open 交易所. Expect separate live rows **Gate**, **Gate妈妈**, and **Gate哥哥**, and an exchange total equal to OKX + Binance + those three + Bitget. 手动 should no longer list the two GHO placeholders. The first window’s 交易所变动 treats the new rows as a baseline (no fake deposit). Unset `GATE_MOM_KEY` and refresh again to confirm the mom row is skipped and the process stays up; put the variable back afterward.
