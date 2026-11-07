# Whale-Watching Agent — Pharos monitoring architecture

```mermaid
flowchart TD
 U[User creates personal 5-6-address watchlist] --> V[Validate addresses and token thresholds]
 V --> D[SQLite-backed Cloudflare Durable Object per watchlist]
 D --> A[120-second recurring Alarm]
 A --> M[Official read-only Pharos Chain MCP]
 M --> G[6 indexed Transfer log filters for 3 ERC20 tokens]
 M --> B[Verified balanceOf snapshots for tokens and R25/Zona shares]
 G --> L{Threshold met?}
 L -->|Yes| C[Explain direction, amount, source, destination and tx hash]
 L -->|No| IGN[No alert]
 B --> P{Previous snapshot exists?}
 P -->|Yes and significant| POS[Observed new/increased/exited share position]
 P -->|No| BASE[Baseline only, no invented position event]
 C --> EVENTS[(Persistent per-watchlist event history)]
 POS --> EVENTS
 EVENTS --> SUM[24h observed summaries and public dashboard]
 M -->|RPC error| RETRY[Do not advance block cursor; retry next alarm]
 ```

## Scan boundaries and efficiency

The official hosted Pharos MCP supports `get_logs` with at most 1000 blocks per query. This system groups all five/six watched addresses into a topic OR filter for the indexed `from` and `to` address parameters: three tokens × two directional filters = **six log calls per <=1000-block batch**. The scheduler stores `cursor` only after all six succeed. Each poll resumes from the next block to avoid overlapping coverage; delayed monitoring may result in a backlog which is displayed in the UI. It does not claim any chain history before initialization.

A second read-only step checks 3 spot token balances plus 1 R25 vault share balance and, when the Zona pool returns a valid aToken address, a Zona aToken balance per watched address. A monitor's first snapshot is only a baseline. Later nonzero changes exceeding share thresholds and full exits are reported as *observed position changes*.

**Classification safety:** transfer `hash + logIndex + watched wallet` dedupes transfer alerts; an event involving two watched wallets generates one outgoing and one incoming address-level observation, but the dashboard distinguishes the single unique transaction. Share changes have a protocol contract link rather than fabricated exact transaction hashes.

## Trust, privacy, and security

The dashboard's public demo has five verified public addresses (including protocol contracts) and cannot be publicly edited. A personal list is stored in its own Durable Object ID, with a cryptographically random private editing token. Only the hash of the token is persisted; the secret is returned once and retained in the browser's sessionStorage (never in the public share URL). Read-only states are public for reviewer access. Input size, frequency and address counts are capped.

No API key or wallet connection is required, no blockchain write tools are called, and there is no user authorization to make trades. Token thresholds are parsed into exact big integers. Unknown contracts and failed balance calls are explicit warnings rather than synthetic zero balances.

## Data provenance and limitations

- **ERC-20 events:** official hosted Chain MCP `get_logs`, exact token contract, sender, receiver, token integer amount, block height and transaction hash.
- **Position observations:** `eth_call balanceOf`, decoded using actual ERC-20 ABI. Readings do not establish why shares increased or decreased.
- **Cloudflare state:** durable alarm cursor, auth and capped alert history; periodic alarms are best-effort and not a real-time SLA.
- **Absent sources:** no USD price feeds, full chain index, internal traces, mempool or external exchange accounts.

A deterministic high-value transfer test is a local fixture; it must never be passed off as an actual Pharos whale event. Only live Chain MCP data and verified on-chain links may appear in the deployed feed.

## Reviewer evidence

Deterministic tests prove five-address configuration validation, configurable exact-value thresholds, inbound/outbound classification with known labels, new position / full exit logic, 24h summary aggregation, outage handling, alarm persistence and edit-token access control. Independent live tests verify actual Chain MCP logs and token/position reads; deployed verification checks dashboard, saved config, fail-closed editor and real MCP scanning.
