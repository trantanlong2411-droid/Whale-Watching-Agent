# Reviewer evidence map — Whale-Watching Agent

**Medium / Trading & Monitoring / 100 points (+50 optional video)**

| Scoring criterion | Actual implementation |
| --- | --- |
| At least 5 configurable addresses | Demo seeds 5 known real Pharos public addresses; `POST /api/watch/create` creates 5–6 watched addresses; authenticated `POST /api/watch/:id/config` updates labels, addresses and thresholds |
| Configurable "significant" threshold per token | `validateConfig()` exact integer thresholds for USDC, WPROS, WETH, R25 shares and Zona aTokens; `classifyTransfers` filters only transfers meeting threshold |
| Clear explanation of what moved, how much and where | Sender, receiver, amount and token from actual Transfer log + known wallet label and explorer transaction link; balance snapshot changes link to protocol contract and explain unknown cause |
| Summary of recent monitored addresses | 24h observed alerts, category counts, unique on-chain hashes, per-address counts, token volume by direction and historical feed in a public page |

**Proof links:** [Public Worker](https://whale-watching-agent.trantanlong2411.workers.dev/), [GitHub](https://github.com/trantanlong2411-droid/Whale-Watching-Agent), [CI](https://github.com/trantanlong2411-droid/Whale-Watching-Agent/actions), [Architecture](../ARCHITECTURE.md).

**Honest scope:** The first scan covers only up to the latest 1000 blocks and event history begins at watchlist creation. Position changes are inferred from two validated balances, not a specific deposit/withdraw receipt. A dashboard containing zero alerts does not mean zero real-world whale movements. No alerts are fabricated. Periodic alarms are best-effort, not hard real-time.

No funded transaction or video is required for basic technical demonstration. An optional video for +50 points has not been recorded.
