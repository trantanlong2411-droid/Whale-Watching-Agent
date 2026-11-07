# Whale-Watching Agent — Pharos Agent Arena

**Task:** Medium · Trading / Monitoring · 100 points (+50 optional video).  
**Repository:** https://github.com/trantanlong2411-droid/Whale-Watching-Agent  
**Live Worker (check production CI before submitting):** https://whale-watching-agent.trantanlong2411.workers.dev/

## What this app really does

An autonomous, persistent, **read-only Pharos Mainnet (chain ID 1672)** address monitor, built on the official hosted [Pharos Chain MCP](https://github.com/PharosNetwork/pharos-mcp). Reviewers can open a demo with five known public addresses or create a separate personal 5–6 address watchlist, customize significant thresholds, inspect real significant token movements and view a recent activity summary with on-chain evidence.

### Task rubric

| Requirement | How the app delivers |
| --- | --- |
| Tracks **at least 5 configurable addresses** | Default five sample addresses; create personal 5–6 address lists (labels editable); edit only with a private access token, no API key or wallet connection needed |
| **Configurable significant threshold per token or value** | Separate native-token-unit thresholds for USDC, WPROS, WETH; R25 vault shares and Zona aTokens. Amounts are parsed exactly from token decimals, no made-up USD market prices. |
| Explain **what, how much, and to where** | ERC-20 `Transfer` logs yield sender, destination, token, quantity, block, transaction explorer link, and known counterparty label when the destination is watched. Position snapshot changes give token, old/new balances and protocol contract link, without pretending a specific causative transaction has been found. |
| **Summary of recent activity** | Dashboard shows observed events in last 24 hours, unique linked transactions, per-address alert counts, direction-specific transfer volumes and detailed feed. |

## Data and monitoring method

1. Each watchlist is a separate **SQLite-backed Cloudflare Durable Object** with persistent address config, alert history, block cursor, two snapshots of monitored balances and a repeating **Alarm approximately every 120 seconds**. On first use, scan the newest **1000 blocks**. Later scans continue from the saved cursor in nonoverlapping, consecutive <=1000-block chunks. If an alarm is delayed or the service is down, it catches up in future polling cycles; the web page shows the backlog. Do **not** claim full historical chain coverage.
2. The app uses the official read-only hosted MCP endpoint `https://mcp.pharos.xyz/mcp` for `get_chain_info`, `get_logs` and `eth_call`. For USDC, WPROS and WETH, query indexed outgoing and incoming Transfer logs with a topic OR filter containing all five or six watched addresses. This requires **6 filtered log calls per scan**, not 6 calls per wallet. Each call covers at most **1000 blocks**, as required by Pharos MCP.
3. For each transfer, verify token contract, ABI event topic, sender and receiver, raw integer amount, block and transaction hash. Compare the precise integer quantity to the appropriate token threshold. If both sender and receiver are watched, record two address-level events but **count unique transaction hashes separately**.
4. Observe each watched address's token balances with read-only `balanceOf`. Additionally, compare balances of R25 Axil ERC-4626 vault shares and Zona USDC aTokens when available. An observed first nonzero position is flagged as a new **balance position**, a return to zero as a **full exit**, and significant increases/decreases as position changes. Full exits are highlighted even if below numeric threshold.
5. The dashboard makes an important distinction: token transfers are tied to **actual transaction hashes**, while R25/Zona position observations are **snapshots, not transaction-level deposit/withdraw proofs**. It does not invent a reason for any change or assert that a whale is manipulating markets.
6. In the event of an MCP log RPC failure, the scheduler records the failure and **does not advance the persisted block cursor**. It retries subsequently. If an optional token or protocol balance is unavailable, the warning is shown and the missing result is not treated as zero.

### Demo watchlist: five on-chain-observed active addresses

The demo has five **public addresses discovered from actual recent USDC and WPROS transfers** on Pharos. This does **not** establish that the addresses belong to whales, an individual, a named organization, or suspicious actors.

| Display label | Verified public address |
| --- | --- |
| Active participant 01 | `0x912c9aDe24D44d8922f0866D8Dcb079f1363f647` |
| Active participant 02 | `0x936564245B69f5a293b42cbd752E0eE3bb68b470` |
| Active participant 03 | `0x1F3546a29EeC2102c8d52E21a45114124014c85C` |
| Active participant 04 | `0x08d1a2dD7C28E4079b7B2efbe0426596F14bB97F` |
| Active participant 05 | `0x88808D768B8bE6a0F2Ff6C903B23Fe3ccc01e67B` |

Known real proof examples from the event discovery run: [425.959773 WPROS transfer](https://pharosscan.xyz/tx/0xe10b8f4331496da0a365051ff89a626eca5bab3c0da82676a12212d7a2a30c8d) at block 22,363,665 and [250 USDC transfer](https://pharosscan.xyz/tx/0x3179cea75b3b353636a0275e56742c482d317c0bd7b41e6881916f1ba4eb5c16) at block 22,363,323.

Default **demo-sensitivity thresholds** are **50 USDC**, **100 WPROS**, **1 WETH**, **5 R25 shares** and **1000 Zona aTokens**. These are illustrative token-unit thresholds chosen so reviewers can observe real activity near deployment. They are *not* economically validated whale thresholds; users should configure thresholds appropriate to their own monitoring goals.

Demo seed version 2 resets the old inactive example set once on deployment, so the first scan starts on a recent 1000-block window with these verified participants. This does not backfill the wallet's full history.

## How to review

1. Open the [live public Worker](https://whale-watching-agent.trantanlong2411.workers.dev/). The demo initializes five watched addresses without requiring any admin key or wallet.
2. Click **Scan latest blocks**. Confirm the Chain MCP block range and six successful ERC-20 log filters. If no significant transfers are observed in the latest 1000 blocks, the UI correctly says there are no *observed* events — not that addresses are inactive.
3. View the **address-level summary**, threshold configuration, source warnings and transaction explorer links for any real recorded movement.
4. Adjust the five addresses and threshold fields, then click **Create personal watchlist**. It creates a distinct public link with a **private edit token** kept in the browser tab. Use **Save my changes** to verify persistent, authorized configuration edits. Anyone with the public watchlist link can read but not edit it.
5. Review [ARCHITECTURE.md](ARCHITECTURE.md), [proof/README.md](proof/README.md), and [GitHub Actions](https://github.com/trantanlong2411-droid/Whale-Watching-Agent/actions) for deterministic transfer/position unit tests and separately verified live Chain MCP reads.

## API

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Public dashboard and configuration editor |
| GET | `/api/health` | Worker availability, capabilities and limitations |
| GET | `/api/config-template` | Default five-address watchlist and thresholds |
| GET | `/api/watch/demo` | Public demo state and summary, auto-seeded on first request |
| POST | `/api/watch/demo/refresh` | Manually request a real MCP scan; 85-second duplicate-scan guard |
| POST | `/api/watch/create` | `{"config":{"addresses":[...],"thresholds":{...}}}` → private owner access token and public link |
| GET | `/api/watch/<id>` | Public read-only history and current configuration |
| POST | `/api/watch/<id>/refresh` | Trigger bounded real scan |
| POST | `/api/watch/<id>/config` | Authenticated update with `Authorization: Bearer <edit token>` |

No wallet signatures, admin key, RPC secret or private key needed. A list's access token is not exposed in public GET responses or share URLs. Losing the token means losing edit rights to that list; users can create a new one.

## Deployment

```sh
npm install
npm test
npm run build         # Wrangler build dry-run, does not deploy
npm run smoke         # Actual read-only Chain MCP snapshot, no transactions
npx wrangler deploy   # Publish to Cloudflare
```

On Cloudflare Workers & Pages, link the repository `trantanlong2411-droid/Whale-Watching-Agent` on branch `main`, project root `/`, deploy command `npx wrangler deploy`, and expected Worker name `whale-watching-agent`. `wrangler.jsonc` automatically provisions the SQLite-backed Durable Object `WhaleWatchlist` with the `v1` migration. After deployment, `GET /api/health` should show `whale-watching-pharos-2026-11-07-v1`.

## Important limitations

- **Not a full chain indexer.** First scan only covers the newest 1000 blocks. Scheduled monitoring continues from that point, within an upstream limit of 1000 blocks per call. A delayed alarm, RPC outage or free-tier quota can cause delayed alerts or backlogs; no hard real-time guarantee.
- Only **USDC, WPROS and WETH** transfer logs are included. Native PROS transfers, internal transfers, other assets, NFT activity, bridges and off-chain exchange positions are not fully indexed.
- A **share/aToken balance change** is evidence of a position balance change, but not evidence of an exact protocol deposit, withdrawal, profit or loss. First snapshots are baselines and do not generate false opening/exit events.
- No USD prices or price-oracle conversion are assumed. Thresholds are in token or share units.
- Recent counts refer to **alerts first observed in the last 24 hours**, not all historical transfers that occurred during that period. The raw event history retains the most recent 150 records.
- No telegram delivery is configured. Notification delivery is the **persisted, publicly viewable watchlist dashboard**.
- No seed phrase, signed transaction, custody or blockchain write is involved. No claim of guaranteed whale or market manipulation detection.

## Sources

- [Official Pharos hosted Chain MCP (get_logs max 1000 blocks)](https://github.com/PharosNetwork/pharos-mcp)
- [Circle USDC on Pharos](https://www.circle.com/multi-chain-usdc/pharos)
- [Cloudflare SQLite-backed Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare Durable Object Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [ERC-20 Transfer event standard](https://eips.ethereum.org/EIPS/eip-20)

An optional bonus video has not been created.
