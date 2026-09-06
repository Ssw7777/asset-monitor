Security-first Next.js portfolio monitor. See .env.example.

- Local store: `data/store.json`. Cloud: Turso or memory+/tmp.
- Auth via `DASHBOARD_PASSWORD` env.
- Vercel serverless region pinned to `hkg1` (see `vercel.json`) so Binance is not blocked by US geo-restriction.
- On-chain balances: DeBank OpenAPI (optional key) → Rabby public API → DeBank public fallback.
- After refresh: failed exchanges/wallets keep last balance; status is never left as `baseline`.
