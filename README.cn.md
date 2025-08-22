# Veil Auction — 基于 eERC 的隐私拍卖系统

Veil Auction 将 EncryptedERC(eERC) 私密资产与最少信任的“托管竞拍”结合：

- 竞拍人对托管地址进行私密转账（金额仅持有密钥方可解密）。
- 服务端仅解密竞价金额用于排序与结算，不泄露其他信息。
- 前端提供“一键私密出价”、绑定竞价、结算与退款等完整流程。

本工程包含：

- 合约与 Hardhat 工程（根目录）
- 前端 `auction-frontend/`（Vite + React）
- 服务端 `auction-server/`（Express + Ethers）

---

## 环境要求

- Node.js 18+
- npm 9+
- 可选：Avalanche Fuji 测试网账户与 AVAX 测试币（用于合约交互）

## 环境变量

在项目根目录创建 `.env`（用于 Hardhat/合约编译与网络账号）：

```
# Avalanche Fuji Testnet RPC
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc

# 至少提供一个私钥用于部署/交互（0x 前缀可选）
PRIVATE_KEY=你的私钥1
PRIVATE_KEY_2=你的私钥2

# 打开 Hardhat 本地链分叉（可选）
FORKING=false
```

在 `auction-server/.env` 创建服务端配置：

```
# 服务端监听端口
PORT=4001
# 供前端通过 vite 代理访问为 http://localhost:5173/api → http://localhost:4001

# RPC 与托管账户（不填则继承根 .env 中的 RPC_URL 与 PRIVATE_KEY）
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
ESCROW_EVM_PRIVATE_KEY=用于充当托管账户的私钥

# 指向独立部署(Standalone)地址文件（默认已指向 ../deployments/standalone/latest-standalone.json）
STANDALONE_DEPLOYMENT=../deployments/standalone/latest-standalone.json
```

---

## 安装与编译

根目录执行：

```
npm install
# 首次安装会自动 hardhat compile + zkit circuits + 生成 verifiers
```

前端与服务端依赖：

```
cd auction-frontend && npm install
cd ../auction-server && npm install
```

---

## 部署合约（Standalone 模式）

本拍卖使用 eERC 的 Standalone 模式（原生隐私代币 PRIV，2 位小数）。按顺序执行：

```
# 1) 部署基础合约（verifier、库等）
npx hardhat run scripts/standalone/01_deploy-basics.ts --network fuji

# 2) 部署 Standalone eERC 与 Registrar
npx hardhat run scripts/standalone/02_deploy-standalone.ts --network fuji

# 3) 注册用户（买家、卖家等）。脚本内 WALLET_NUMBER=1/2 可切换签名账户
npx hardhat run scripts/standalone/03_register-user.ts --network fuji

# 4) 设置审计公钥（Auditor），用于服务端解密金额
npx hardhat run scripts/standalone/04_set-auditor.ts --network fuji

# 5) 铸造初始 PRIV 余额（仅合约 Owner 可执行）
npx hardhat run scripts/standalone/05_mint.ts --network fuji
```

部署信息会写入 `deployments/standalone/latest-standalone.json`，服务端会读取该文件。

---

## 启动服务端与前端

确保 `.env` 与 `auction-server/.env` 已正确填写。

启动服务端：

```
cd auction-server
npm run dev
# 监听 :4001，提供 REST API 与链上日志轮询/解密
```

启动前端：

```
cd auction-frontend
npm run dev
# 打开 http://localhost:5173
# Vite 代理将 /api 转发到 http://localhost:4001
```

---

## 使用流程（从 0 到一个完整拍卖）

### 1) 创建拍卖

- 前端首页 `Auction List` → 输入名称 → Start Auction
- 服务端返回 `auctionId`，前端可进入 `/auction/:id`

### 2) 钱包注册（一次性）

- 前端顶部/隐藏工具提供“Register Wallet”按钮，或在详情页签名并注册。
- 背后会向服务端请求 `register-prepare` 生成证明，再由前端交易调用 Registrar 的 `register`。

### 3) 读取余额

- 前端通过“Read Balance (Hidden)”或详情页调用 `/api/balance`，服务端用签名派生密钥解密 PCT 聚合得到可用余额（单位 PRIV）。

### 4) 一键私密出价

- 进入 `Auction Detail`，输入金额（小数 2 位），点击 “One-Click Private Bid”。
- 前端：
  - 用签名派生 BabyJub 私钥；
  - 调用 `/api/auctions/:id/prepare-bid` 由服务端生成 Transfer 证明与 `senderBalancePCT`；
  - 由前端钱包向 `EncryptedERC.transfer(escrow, tokenId=0, calldata, senderBalancePCT)` 发交易；
  - 轮询调用 `/api/auctions/:id/bind` 绑定该交易为本拍卖的一次出价。
- 服务端：
  - 轮询链上 `PrivateTransfer` 日志，使用审计私钥解密金额，仅记录 amount 与 from/to/txHash 等最小信息。

### 5) 查看出价列表

- 详情页点击 “Refresh Bids”，可见按金额降序（同额按区块高与日志序）排列的出价数组。

### 6) 结算与退款（卖家侧）

- 在详情页 Admin 面板：
  - 设定 `Seller` 地址（默认为托管地址）。
  - “Get Payout Plan” 查看赢家与退款列表。
  - “Settle” 执行托管→卖家转账（赢家金额）。
  - “Refund Losers” 对其余出价人逐一退款。
- 若涉及 NFT，可在 Admin 面板配置 ERC721 地址和 TokenId，点击 “Send to Winner” 将 NFT 转给赢家。

---

## 主要 REST API（服务端）

- `GET /health`：健康检查
- `GET /config`：链与合约地址、托管地址、decimals
- `GET /abi/encrypted-erc` / `GET /abi/registrar`：ABI
- `POST /register-prepare`：输入 `{ address, signature }`，返回注册 `calldata`
- `POST /balance`：输入 `{ address, signature }`，返回 `{ spendableRaw, spendable, txIndex }`
- `POST /faucet`：输入 `{ to, amount }`，从托管向指定地址私密转账（需对方已注册）
- `POST /auctions`：创建拍卖，返回 `{ id }`
- `GET /auctions`：拍卖列表
- `GET /auctions/:id/bids`：获取该拍卖已绑定的出价
- `POST /auctions/:id/bind`：绑定某次出价到拍卖，入参 `{ txHash, sender, bindingHash }`
- `GET /auctions/:id/payout-plan`：计算赢家与退款计划
- `POST /auctions/:id/settle`：一键结算（托管→卖家）
- `POST /auctions/:id/refund`：一键退款（托管→落败者）
- `POST /auctions/:id/seller`：设置卖家地址

绑定哈希 `bindingHash` 计算：

```ts
ethers.solidityPackedKeccak256(
  ["uint256", "string", "address", "address", "uint256", "bytes32"],
  [chainId, auctionId, sender, escrow, amountRaw, txHash]
);
```

---

## 常见问题

- 无法找到 ABI：先在根目录执行 `npm install` 以触发编译与 zkit 产物生成，或设置 `EERC_ABI_PATH` 环境变量。
- 余额解密为 0：确保账号已注册、签名消息格式为 `eERC\nRegistering user with\n Address:${address.toLowerCase()}`，且确实收到过转账或铸造。
- 绑定失败：等待交易上链后再重试，前端已实现最多 20 次轮询重试（1.5s 间隔）。
- 托管余额不足：在服务端 `faucet` 或通过 Owner 铸造（Standalone）给托管地址补充 PRIV。
- 本地开发端口：前端 5173，服务端 4001，Vite 已将 `/api` 代理到服务端。

---

## 目录结构（摘）

- `contracts/`：eERC、Registrar、verifiers 等合约
- `scripts/standalone/`：Standalone 部署与操作脚本
- `auction-server/`：后端服务（竞价捕获、解密、结算、退款）
- `auction-frontend/`：前端（React + Vite）

---

## 许可

本仓库基于隐私代币与电路实现，仅供研究与黑客松演示使用，生产环境请进行全面审计与风险评估。
