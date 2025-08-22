# Veil Auction — Private Auction on eERC

Veil Auction combines EncryptedERC (eERC) private tokens with a minimally trusted escrow auction flow:

- Bidders privately transfer to the escrow address (amounts are hidden on-chain; only a holder of the decryption key can read them).
- The server decrypts just the bid amounts for sorting and settlement, without exposing additional data.
- The frontend offers a one-click flow to place a private bid, bind it to an auction, settle the winner, and refund others.

This repository includes:

- Smart contracts + Hardhat project (root)
- Frontend `auction-frontend/` (Vite + React)
- Server `auction-server/` (Express + Ethers)

[Project Roadmap](./ROADMAP.md)

---

## Hack2Build — Program Context

A 4-week, staged builder program to go from idea to product using encrypted token standards (e.g., eERC20). Each stage has mentorship, workshops, and prizes, with potential entry to the Codebase Accelerator.

### Kickoff Weekend (Aug 15–17)

Workshops to form teams, shape ideas, and understand eERC20.

### Week 1: Round 1 — Build a Prototype (Aug 18–23)

- Deliverables: MVP on GitHub + short growth/product roadmap with milestones
- Support: Telegram chat
- Submission Deadline: August 23
- Winners Announcement: August 25 (non-awarded teams continue building)
- Prizes: $5,000

### Weeks 2–3: Round 2 — Product & Growth Development (Aug 25 – Sep 07)

- Deliverables: Roadmap progress, GTM strategy, pitch deck
- Support: 1:1 mentorship (technical, product, business), DevRel workshops & chat
- Submission Deadline: September 07
- Judging + Pitch Sessions: September 1st
- Announcement: September 07
- Prizes: $5,000

### Week 4: Round 3 — Testnet & Codebase Fastrack Pitch (Sep 08–14)

- Deliverables: Code progress tied to roadmap, deployed product on testnet, final pitch
- Support: Advanced mentorship, marketing spotlight, custom support
- Submission Deadline: September 17
- Final Pitch & Judging: September 17
- Top 3 Winners Announced: September 17

### Post-Program

- Spotlight and social recognition
- Milestone-based grants
- Participation certificates & program recap

### Tracks (Total Prize Pool: $25,000)

- Private DeFi: Private swaps, lending, staking, DAOs using encrypted eERC20
- Privacy Tools & Infra: SDKs, extensions, proof systems, wallet features
- Privacy-First L1s: Encrypted bridges, cross-chain coordination, gas abstractions
- Real Private Use Cases: Privacy for real-world business needs

### Resources & Submission

- Agenda: calendar entries with meet links and reminders
- eERC20 Tooling & Docs, Builder hub, Developer Tools (Avalanche)
- Submission: GitHub repo + slides + supporting files via Avalanche Builder Hub
- Evaluation: value proposition, technical complexity, usage of Avalanche tech

Schedule window: August 15, 2025 – September 12, 2025 (see agenda for live sessions & deadlines).

---

## Why eERC for Auctions

- Bid amounts are encrypted-on-chain; observers cannot infer values.
- Only the escrow (auditor key) can decrypt amounts to compute the winner and refunds.
- Auction state stays minimal on-chain; off-chain server performs safe decryption and orchestration.

---

## Prerequisites

- Node.js 18+
- npm 9+
- Optional: Avalanche Fuji testnet account and AVAX for gas

## Environment Variables

Create a `.env` at the project root (used by Hardhat/contracts):

```
# Avalanche Fuji Testnet RPC
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc

# At least one deploy/interaction private key (0x prefix optional)
PRIVATE_KEY=your_private_key_1
PRIVATE_KEY_2=your_private_key_2

# Hardhat forking (optional)
FORKING=false
```

Create `auction-server/.env` for the server:

```
# Server port
PORT=4001
# Frontend will reach the server via Vite proxy: http://localhost:5173/api → http://localhost:4001

# RPC & escrow account (falls back to root .env if omitted)
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
ESCROW_EVM_PRIVATE_KEY=private_key_used_as_escrow

# Standalone deployment file path
STANDALONE_DEPLOYMENT=../deployments/standalone/latest-standalone.json
```

---

## Install & Build

In the root directory:

```
npm install
# Postinstall triggers: hardhat compile + zkit circuits + verifiers generation
```

Install frontend and server dependencies:

```
cd auction-frontend && npm install
cd ../auction-server && npm install
```

---

## Deploy Contracts (Standalone Mode)

Veil Auction uses eERC Standalone mode with a native privacy token `PRIV` (2 decimals). Execute in order:

```
# 1) Base components (verifiers, libs)
npx hardhat run scripts/standalone/01_deploy-basics.ts --network fuji

# 2) Standalone eERC + Registrar
npx hardhat run scripts/standalone/02_deploy-standalone.ts --network fuji

# 3) Register users (buyers/sellers). Switch WALLET_NUMBER=1/2 inside script
npx hardhat run scripts/standalone/03_register-user.ts --network fuji

# 4) Set auditor public key (server decrypts amounts)
npx hardhat run scripts/standalone/04_set-auditor.ts --network fuji

# 5) Mint initial PRIV balances (owner only)
npx hardhat run scripts/standalone/05_mint.ts --network fuji
```

Deployment info is written to `deployments/standalone/latest-standalone.json`, which the server reads.

---

## Run Server & Frontend

Ensure `.env` and `auction-server/.env` are configured.

Start server:

```
cd auction-server
npm run dev
# Listens on :4001 and polls on-chain logs, decrypts bids, and exposes REST APIs
```

Start frontend:

```
cd auction-frontend
npm run dev
# Visit http://localhost:5173
# Vite proxies /api to http://localhost:4001
```

---

## End-to-End Usage

### 1) Create an Auction

- On the home page (Auction List), enter a name and click "Start Auction".
- The server returns `auctionId`; the UI navigates to `/auction/:id`.

### 2) Register Wallet (one-time)

- Use "Register Wallet" in the header or the hidden tools panel.
- The server provides registration calldata via `/register-prepare`; the frontend submits it to the Registrar.

### 3) Read Balance

- Via hidden tools or `/api/balance`: the server derives BabyJub private key from your signature and decrypts PCTs to compute spendable `PRIV`.

### 4) One-Click Private Bid

- On Auction Detail, enter the amount (2 decimals) and click "One-Click Private Bid".
- Frontend:
  - Derives BabyJub SK from signature
  - Calls `/api/auctions/:id/prepare-bid` to let the server prepare Transfer proof and `senderBalancePCT`
  - Sends `EncryptedERC.transfer(escrow, tokenId=0, calldata, senderBalancePCT)` with your wallet
  - Polls `/api/auctions/:id/bind` to bind the transaction as a bid
- Server:
  - Polls `PrivateTransfer` logs and decrypts amounts using the auditor key; stores minimal bid info

### 5) View Bids

- Click "Refresh Bids" to view bids sorted by amount desc (then by block/idx).

### 6) Settlement & Refunds (seller)

- In Admin panel on the detail page:
  - Set `Seller` address (defaults to escrow)
  - "Get Payout Plan" to preview winner and refunds
  - "Settle": escrow → seller (winner amount)
  - "Refund Losers": escrow → other bidders
- If an NFT is involved, input ERC721 address & tokenId and click "Send to Winner" to transfer the NFT to the winner.

---

## REST API (Server)

- `GET /health`: health check
- `GET /config`: chain & contract addresses, escrow, decimals
- `GET /abi/encrypted-erc` / `GET /abi/registrar`: ABIs
- `POST /register-prepare`: `{ address, signature }` → registration calldata
- `POST /balance`: `{ address, signature }` → `{ spendableRaw, spendable, txIndex }`
- `POST /faucet`: `{ to, amount }` → escrow → user private transfer (receiver must be registered)
- `POST /auctions`: create auction, returns `{ id }`
- `GET /auctions`: list auctions
- `GET /auctions/:id/bids`: bids for an auction (decrypted amounts)
- `POST /auctions/:id/bind`: bind a bid `{ txHash, sender, bindingHash }`
- `GET /auctions/:id/payout-plan`: compute winner + refunds
- `POST /auctions/:id/settle`: escrow → seller (winner amount)
- `POST /auctions/:id/refund`: escrow → losers
- `POST /auctions/:id/seller`: set seller

Binding hash computation:

```ts
ethers.solidityPackedKeccak256(
  ["uint256", "string", "address", "address", "uint256", "bytes32"],
  [chainId, auctionId, sender, escrow, amountRaw, txHash]
);
```

---

## Troubleshooting

- ABI not found: run `npm install` in root to compile and generate zkit artifacts; or set `EERC_ABI_PATH`.
- Spendable balance is 0: ensure the wallet is registered, signature format is exactly `eERC\nRegistering user with\n Address:${address.toLowerCase()}`, and funds were received/minted.
- Bind failed: wait until the tx is mined and retry; the frontend auto-retries up to ~20 times (1.5s interval).
- Escrow balance insufficient: top up escrow via server `/faucet` (receiver must be registered) or owner mint in Standalone.
- Local dev: frontend 5173, server 4001; Vite proxies `/api` to the server.

---

## Repository Structure (excerpt)

- `contracts/`: eERC, Registrar, verifiers
- `scripts/standalone/`: Standalone deployment & ops scripts
- `auction-server/`: server (bid capture, decryption, settlement, refund)
- `auction-frontend/`: frontend (React + Vite)

---

## License & Disclaimer

This project demonstrates private tokens and ZK circuits for hackathon and research purposes. Do not use in production without thorough audits and risk assessments.
