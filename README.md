# 0xStudy Checker - asset monitor

Next.js portfolio monitor.

## Run

cp .env.example .env.local
npm install
npm run dev

## Build

npm run build

See .env.example for configuration.

## Security

- No secrets in git
- Server-side signing only
- Auth required for APIs
- Rotate keys often
## Vercel

Import the repo, set env from .env.example, deploy.
data/store.json is ephemeral on serverless.

## Seeds

Manual 4 rows = 4013 USD; 20 wallets;
baseline Total~74841 Onchain~22102 CEX~48726

## Remote

git remote add origin <your-github-repo-url>
git push -u origin main

Chinese UI: login, overview, onchain/exchange/manual, portfolio chart.
