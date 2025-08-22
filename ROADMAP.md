# Veil Auction — Roadmap (Hack2Build Aligned)

This roadmap aligns Veil Auction with Hack2Build stages, focusing on delivering a production-credible private auction using eERC (EncryptedERC) with a minimally trusted escrow.

## Goals

- Private bidding on-chain with encrypted amounts (eERC Standalone to start)
- One-click bidder UX (proof generation + transfer + bind)
- Seller settlement and loser refunds through escrow
- Clear docs, demoability, and testnet deployment

## Phase 0 — Foundation (Kickoff Weekend: Aug 15–17)

- Repo setup, code audit, and cleanup (done)
- Contracts compile and zkit artifacts generation (postinstall)
- Basic server + frontend skeleton, Vite proxy to server
- Initial README (CN/EN) and environment instructions

## Milestone 1 — MVP Prototype (Aug 18–23)

Deliverables by Aug 23:

- End-to-end private bid flow on Fuji:
  - Standalone deployment (EncryptedERC + Registrar) and addresses exported
  - Wallet registration (server-assisted proof → on-chain register)
  - Proof-assisted bid: server prepares Transfer calldata, frontend submits `transfer`
  - Bind bid via `bindingHash`; server decrypts amounts for sorting
- Auction lifecycle (basic): create, list, close, winner selection, payouts plan
- Settlement and Refund endpoints wired to escrow transfers
- Minimal UI: create/list auctions, one-click bid, admin settle/refund + NFT handover
- Docs: Quickstart, API, Troubleshooting, and this Roadmap
- Optional: short demo video

Acceptance Criteria:

- New user can register, receive PRIV (via mint/faucet), bid privately, get bound
- Admin can settle winner and refund losers; NFT is transferable to winner
- All steps reproducible using README + `.env` templates

KPIs:

- Proof generation time (Transfer): < 25s on laptop; memory stable
- End-to-end one-click bid (user action → bound) < 1 min in normal conditions

Risks & Mitigations:

- RPC rate limits → add retries/backoff, allow custom RPC
- Proof generation variability → log timings, precheck artifacts, basic telemetry
- Wallet/signature mismatches → unify signature message; server double path (i0 mod/no-mod)

## Milestone 2 — Product & Growth (Aug 25 – Sep 07)

Productization and usability:

- Reliability & Persistence
  - Upgrade persistence from JSON file to SQLite/LowDB (optional if time allows)
  - Idempotent bind, duplicate/ordering guards, better log polling windowing
- Auction Features
  - Timed close (endTime), manual override, anti-sniping buffer (optional)
  - Multi-auction support hardening; better seller controls
- UX & DX
  - Separate "Register" and "Balance" panels; faucet UI
  - Progress states, error surfaces, helpful toasts/logs
  - Add a read-only “Public Viewer” mode
- Performance
  - Proof workerization (web worker or server worker queue) to avoid UI blocking
  - ZK artifacts lazy checks; cache hints
- Security & Compliance
  - Auditor key hardening (derivation from escrow; rotation plan documented)
  - Input validation and server request limits
- GTM
  - Landing readme section: value props, screenshots, and demo flow
  - Pitch deck draft and GTM outline

Acceptance Criteria:

- Multiple auctions usable concurrently
- Clear runtime diagnostics for failed binds/settlements
- Pitch deck v1 + GTM outline

KPIs:

- Bind success rate > 95% (with retries)
- UI Time-to-First-Action < 5s on cold start

## Milestone 3 — Testnet & Final Pitch (Sep 08–14)

- Testnet Deployment
  - Server on public host (Railway/Render/Fly/EC2), environment pinned
  - Frontend on Vercel/Netlify; proxy configured to public server URL
  - Contract addresses frozen and documented
- Observability & Stability
  - Basic health, logs, and alerting; graceful restart with state restore
  - Load test with synthetic bids; measure end-to-end times
- Final Polish
  - Feature freeze; bug triage & fixes
  - Recorded demo + live pitch rehearsal

Acceptance Criteria:

- Public URL for server and frontend, with a fresh user able to bid and be part of settlement
- Final pitch + recorded demo ready

KPIs:

- 99% API uptime during demo window
- 100% success on scripted e2e run

## Post-Program (Sep 15+)

- Converter Mode: support wrapping existing ERC20 → private tokens
- Multi-asset and multi-decimals support
- Auditor governance & threshold schemes (multi-sig or threshold decryption)
- Gas & proof performance optimization (circuits, params, caching)
- Security audit and bug bounty plan
- Go-to-market experiments with private sales, ICO-style sealed-bid auctions, and enterprise use cases

## Timeline (Dates)

- Kickoff: Aug 15–17
- Milestone 1 (MVP): Aug 18–23 — Submission Aug 23; winners Aug 25
- Milestone 2 (Product/Growth): Aug 25 – Sep 07 — Submission Sep 07; judging Sep 01; announce Sep 07
- Milestone 3 (Testnet & Pitch): Sep 08–14 — Submission Sep 17; final pitch Sep 17

## Dependencies

- Avalanche Fuji RPC access
- Node 18+, npm 9+, browser wallet (e.g., MetaMask)
- Time budget for ZK proof generation (Transfer)

## Ownership & Roles (suggested)

- Product/PM: scope alignment, judging deliverables, narrative
- Protocol/Backend: contracts, ZK integration, server logic
- Frontend: UX, proof flow integration, error surfaces
- DevOps: hosting, logs, observability, env mgmt
