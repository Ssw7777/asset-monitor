Security-first Next.js portfolio monitor (private backup). See `.env.example`.

- Local store: `data/store.json`. Cloud: Turso or memory+/tmp.
- Auth via `DASHBOARD_PASSWORD` env.
- **Scheduled refresh is VPS-only**: systemd/cron on the same host calling `http://127.0.0.1:3000/api/cron/refresh` with `CRON_SECRET`. See `docs/scheduled-refresh.md`. Do not depend on an external Actions scheduler repo.
- On-chain balances: Rabby (+ optional BN Web3 DeFi fallback) and other optional providers.
- After refresh: failed exchanges/wallets keep last balance.
