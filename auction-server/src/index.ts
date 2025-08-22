import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ethers } from "ethers";
import {
  decryptAuditorPCT,
  deriveAuditorPrivateKeyFromEscrow,
  getEncryptedERCAbi,
  getEscrowWallet,
  hexArrayToBigints,
  loadStandaloneDeployment,
  i0,
  getRegistrarAbi,
  decryptEGCTBalance,
  buildTransferInputs,
  generateTransferCalldata,
} from "./eerc";
import * as path from "path";
import * as fs from "fs";

dotenv.config();

const RPC_URL =
  process.env.RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const ESCROW_EVM_PRIVATE_KEY =
  process.env.ESCROW_EVM_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
const DEPLOY_FILE =
  process.env.STANDALONE_DEPLOYMENT ||
  "../deployments/standalone/latest-standalone.json";
const ZKIT_ARTIFACTS_DIR =
  process.env.ZKIT_ARTIFACTS_DIR ||
  path.resolve(process.cwd(), "..", "zkit", "artifacts");
const PORT = Number(process.env.PORT || 4001);

if (!ESCROW_EVM_PRIVATE_KEY) {
  throw new Error("ESCROW_EVM_PRIVATE_KEY is required");
}

// in-memory store
type Bid = {
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  amount: string;
  blockNumber: number;
};
const bids: Bid[] = [];
const seen = new Set<string>();
type Auction = {
  id: string;
  name?: string;
  endTime?: number;
  status: "open" | "closed";
  createdAt: number;
};
const auctions: Record<string, Auction> = {};
const auctionBidKeys: Record<string, string[]> = {};
const bidByKey: Record<string, Bid> = {};
const auctionSeller: Record<string, string> = {};

// simple JSON persistence to avoid losing bids on restart
const dataDir = path.resolve(__dirname, "..", "data");
type PersistState = {
  bids?: Bid[];
  auctions?: Record<string, Auction>;
  auctionBidKeys?: Record<string, string[]>;
  auctionSeller?: Record<string, string>;
};

function loadStateFile(): PersistState {
  try {
    const p = path.join(dataDir, "state.json");
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function saveStateFile() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const p = path.join(dataDir, "state.json");
    const s: PersistState = {
      bids,
      auctions,
      auctionBidKeys,
      auctionSeller,
    };
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
  } catch {}
}

function jsonSafe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v));
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

async function main() {
  // restore persisted state early
  try {
    const s = loadStateFile();
    if (s.bids) {
      for (const b of s.bids) {
        const k = `${b.txHash}:${b.logIndex}`;
        if (!seen.has(k)) {
          seen.add(k);
          bids.push(b);
          bidByKey[k] = b;
        }
      }
    }
    if (s.auctions) Object.assign(auctions, s.auctions);
    if (s.auctionBidKeys) Object.assign(auctionBidKeys, s.auctionBidKeys);
    if (s.auctionSeller) Object.assign(auctionSeller, s.auctionSeller);
  } catch {}
  const deployment = loadStandaloneDeployment(DEPLOY_FILE);
  const escrow = getEscrowWallet(RPC_URL, ESCROW_EVM_PRIVATE_KEY);
  const auditorPriv = await deriveAuditorPrivateKeyFromEscrow(escrow);

  const encryptedERC = new ethers.Contract(
    deployment.contracts.encryptedERC,
    getEncryptedERCAbi(),
    escrow
  );

  // Poll logs to avoid RPC filter issues
  const provider = escrow.provider as ethers.JsonRpcProvider;
  const iface = new ethers.Interface(getEncryptedERCAbi());
  let lastBlock = await provider.getBlockNumber();
  const escrowAddr = (await escrow.getAddress()).toLowerCase();
  const { chainId } = await provider.getNetwork();
  setInterval(async () => {
    try {
      const current = await provider.getBlockNumber();
      const fromBlock = lastBlock + 1;
      const toBlock = current;
      if (toBlock < fromBlock) return;

      const baseFilter = (encryptedERC as any).filters?.PrivateTransfer?.();
      const filter: any = {
        address: encryptedERC.target as string,
        topics: baseFilter?.topics,
        fromBlock,
        toBlock,
      };
      const logs = await provider.getLogs(filter);
      for (const log of logs) {
        const key = `${log.transactionHash}:${log.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const parsed = iface.parseLog({
            topics: log.topics as string[],
            data: log.data as string,
          });
          const from = parsed.args[0] as string;
          const to = parsed.args[1] as string;
          const auditorPCT = parsed.args[2] as readonly any[];
          if (to.toLowerCase() !== escrowAddr) continue;

          const amount = decryptAuditorPCT(
            hexArrayToBigints(auditorPCT),
            auditorPriv
          );
          const bid: Bid = {
            txHash: log.transactionHash!,
            logIndex: log.index!,
            from,
            to,
            amount: amount.toString(),
            blockNumber: log.blockNumber!,
          };
          bids.push(bid);
          bidByKey[`${bid.txHash}:${bid.logIndex}`] = bid;
          saveStateFile();
          console.log("[BidCaptured]", {
            from,
            to,
            amount: amount.toString(),
            txHash: log.transactionHash,
          });
        } catch (e) {
          console.error("[ParseError]", e);
        }
      }
      lastBlock = current;
    } catch (e) {
      console.error("[PollError]", e);
    }
  }, 4000);

  const app = express();
  app.use(express.json());
  app.use(cors());

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/config", async (_req, res) => {
    res.json({
      chainId: Number(chainId),
      escrow: escrowAddr,
      encryptedERC: deployment.contracts.encryptedERC,
      registrar: deployment.contracts.registrar,
      decimals: 2,
    });
  });
  app.get("/bids", (_req, res) => res.json({ bids }));

  // Serve Registrar ABI
  app.get("/abi/registrar", (_req, res) => {
    try {
      res.json(getRegistrarAbi());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Debug: dump user registration and balance state
  app.get("/debug/state", async (req, res) => {
    try {
      const address = String(req.query.address || "");
      if (!address) return res.status(400).json({ error: "address required" });
      const registrar = new ethers.Contract(
        deployment.contracts.registrar,
        getRegistrarAbi(),
        escrow
      );
      const isReg = await registrar.isUserRegistered(address);
      const pub = await registrar.getUserPublicKey(address);
      const [eGCT, nonce, amountPCTs, balancePCT, txIndex] = await (
        encryptedERC as any
      ).balanceOf(address, 0);
      res.json({
        isRegistered: !!isReg,
        publicKey: [pub[0]?.toString?.(), pub[1]?.toString?.()],
        eGCT: {
          c1: { x: eGCT?.c1?.x?.toString?.(), y: eGCT?.c1?.y?.toString?.() },
          c2: { x: eGCT?.c2?.x?.toString?.(), y: eGCT?.c2?.y?.toString?.() },
        },
        nonce: Number(nonce ?? 0),
        amountPCTsLen: (amountPCTs || []).length,
        balancePCT: (balancePCT || []).map((x: any) => x?.toString?.()),
        txIndex: Number(txIndex ?? 0),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Compute decrypted balance using user's signature (server-side PCT decryption)
  app.post("/balance", async (req, res) => {
    try {
      const { address, signature } = req.body || {};
      if (!address || !signature)
        return res.status(400).json({ error: "address, signature required" });

      const userSk = i0(signature);
      const tokenId = 0n;
      const [eGCT, nonce, amountPCTs, balancePCT, txIndex] = await (
        encryptedERC as any
      ).balanceOf(address, tokenId);

      const toBigArr = (arr: readonly any[]) =>
        arr.map((x: any) => BigInt(x.toString()));
      const pctVal = (pct: bigint[]) => {
        if (!pct || pct.length !== 7) return 0n;
        try {
          return decryptAuditorPCT(pct, userSk);
        } catch {
          return 0n;
        }
      };

      let total = 0n;
      const balPct = toBigArr(balancePCT as any);
      if (balPct.some((v) => v !== 0n)) total += pctVal(balPct as any);
      for (const a of amountPCTs as any[]) {
        const arr = toBigArr(a.pct ?? a);
        if (arr.some((v) => v !== 0n)) total += pctVal(arr as any);
      }

      res.json({
        spendableRaw: total.toString(),
        spendable: Number(total) / 100,
        txIndex: Number(txIndex ?? 0),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Create auction (single escrow model)
  app.post("/auctions", (req, res) => {
    const { name, endTime } = req.body || {};
    const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    auctions[id] = {
      id,
      name,
      endTime: Number(endTime) || undefined,
      status: "open",
      createdAt: Date.now(),
    };
    auctionBidKeys[id] = [];
    saveStateFile();
    res.json({ id, escrow: escrowAddr, chainId: Number(chainId) });
  });

  app.get("/auctions", (_req, res) => {
    res.json({ auctions: Object.values(auctions) });
  });

  // Registration prepare: derive keys via signature, generate Registration proof calldata (frontend sends tx)
  app.post("/register-prepare", async (req, res) => {
    try {
      const { address, signature } = req.body || {};
      if (!address || !signature)
        return res.status(400).json({ error: "address, signature required" });

      const isReg = await new ethers.Contract(
        deployment.contracts.registrar,
        getRegistrarAbi(),
        escrow
      ).isUserRegistered(address);
      if (isReg) return res.json({ ok: true, already: true });

      const i0 = (sig: string) => {
        const hash = ethers.keccak256(sig as `0x${string}`);
        const clean = hash.startsWith("0x") ? hash.slice(2) : hash;
        const bytes = ethers.getBytes("0x" + clean);
        bytes[0] &= 0b11111000;
        bytes[31] &= 0b01111111;
        bytes[31] |= 0b01000000;
        const le = Uint8Array.from(bytes).reverse();
        const sk = BigInt("0x" + Buffer.from(le).toString("hex"));
        return sk === 0n ? 1n : sk;
      };
      const rawSk = i0(signature);
      const formattedSk = (await import("maci-crypto")).formatPrivKeyForBabyJub(
        rawSk
      ) as any as bigint;
      const pub = (await import("@zk-kit/baby-jubjub")).mulPointEscalar(
        (await import("@zk-kit/baby-jubjub")).Base8,
        formattedSk as any
      ) as unknown as [bigint, bigint];

      const { chainId } = await (
        escrow.provider as ethers.JsonRpcProvider
      ).getNetwork();
      const registrationHash = (await import("poseidon-lite")).poseidon3([
        BigInt(chainId),
        BigInt(formattedSk),
        BigInt(address),
      ]);

      // Build inputs & proof with generated-types zkit RegistrationCircuit
      const { RegistrationCircuit } = await import(
        "../../generated-types/zkit/core/RegistrationCircuit"
      );
      const circuit = new (RegistrationCircuit as any)({
        circuitName: "RegistrationCircuit",
        circuitArtifactsPath: require("path").resolve(
          process.cwd(),
          "..",
          "zkit",
          "artifacts",
          "circom",
          "registration.circom"
        ),
        verifierDirPath: require("path").resolve(
          process.cwd(),
          "..",
          "zkit",
          "artifacts",
          "verifiers"
        ),
      });
      const input = {
        SenderPrivateKey: formattedSk,
        SenderPublicKey: [pub[0], pub[1]],
        SenderAddress: BigInt(address),
        ChainID: BigInt(chainId),
        RegistrationHash: registrationHash,
      };
      const proof = await circuit.generateProof(input as any);
      const calldata = await circuit.generateCalldata(proof as any);

      res.json({ ok: true, calldata });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Faucet: escrow -> target address, for testing
  app.post("/faucet", async (req, res) => {
    try {
      const { to, amount } = req.body || {};
      if (!to || amount === undefined)
        return res.status(400).json({ error: "to, amount required" });

      // amount: accept decimal string (e.g., "12.34") or raw minor units (string/number)
      let amountRaw: bigint;
      if (typeof amount === "string" && amount.includes(".")) {
        const [i, d = ""] = amount.split(".");
        const dec = (d + "00").slice(0, 2);
        amountRaw = BigInt(i) * 100n + BigInt(dec);
      } else {
        amountRaw = BigInt(amount);
      }

      const tokenId = 0n;
      const [eGCT] = await (encryptedERC as any).balanceOf(escrowAddr, tokenId);
      const c1: [bigint, bigint] = [BigInt(eGCT.c1.x), BigInt(eGCT.c1.y)];
      const c2: [bigint, bigint] = [BigInt(eGCT.c2.x), BigInt(eGCT.c2.y)];
      const escrowBalance = decryptEGCTBalance(auditorPriv, c1, c2);
      if (escrowBalance < amountRaw)
        return res.status(400).json({ error: "escrow insufficient balance" });

      const registrar = new ethers.Contract(
        deployment.contracts.registrar,
        getRegistrarAbi(),
        escrow
      );

      const escrowPubArr = await registrar.getUserPublicKey(escrowAddr);
      const recvPubArr = await registrar.getUserPublicKey(to);
      if (BigInt(recvPubArr[0]) === 0n && BigInt(recvPubArr[1]) === 0n) {
        return res.status(400).json({ error: "receiver not registered" });
      }
      const auditorPk = await (encryptedERC as any).auditorPublicKey();
      const escrowPub: [bigint, bigint] = [
        BigInt(escrowPubArr[0]),
        BigInt(escrowPubArr[1]),
      ];
      const recvPub: [bigint, bigint] = [
        BigInt(recvPubArr[0]),
        BigInt(recvPubArr[1]),
      ];
      const auditorPub: [bigint, bigint] = [
        BigInt(auditorPk.x),
        BigInt(auditorPk.y),
      ];

      const senderEncryptedBalance: [bigint, bigint, bigint, bigint] = [
        c1[0],
        c1[1],
        c2[0],
        c2[1],
      ];
      const { input, senderBalancePCT } = buildTransferInputs(
        amountRaw,
        auditorPriv,
        escrowPub,
        escrowBalance,
        senderEncryptedBalance,
        recvPub,
        auditorPub
      );
      const calldata = await generateTransferCalldata(
        ZKIT_ARTIFACTS_DIR,
        input
      );
      const tx = await (encryptedERC as any).transfer(
        to,
        tokenId,
        calldata,
        senderBalancePCT
      );
      const receipt = await tx.wait();
      res.json({
        ok: true,
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Bind a captured on-chain bid to auction with bindingHash verification
  app.post("/auctions/:id/bind", async (req, res) => {
    try {
      const { id } = req.params;
      const { txHash, sender, bindingHash } = req.body || {};
      if (!auctions[id])
        return res.status(404).json({ error: "auction not found" });
      if (!txHash || !sender || !bindingHash)
        return res
          .status(400)
          .json({ error: "txHash, sender, bindingHash required" });

      const txHashLc = String(txHash).toLowerCase();
      let bid = bids.find((b) => {
        if (!b || !b.txHash || !b.to) return false;
        return (
          String(b.txHash).toLowerCase() === txHashLc &&
          String(b.to).toLowerCase() === escrowAddr
        );
      });
      if (!bid) {
        // Fallback with internal retries: fetch receipt and parse logs (handles mining/poller races)
        try {
          const maxAttempts = 5;
          const delayMs = 1500;
          for (let attempt = 0; attempt < maxAttempts && !bid; attempt++) {
            const receipt = await (provider as any).getTransactionReceipt(
              txHash
            );
            if (receipt) {
              for (const log of receipt.logs || []) {
                try {
                  const parsed = iface.parseLog({
                    topics: log.topics as string[],
                    data: log.data as string,
                  });
                  if (parsed?.name !== "PrivateTransfer") continue;
                  const from = parsed.args[0] as string;
                  const to = parsed.args[1] as string;
                  const auditorPCT = parsed.args[2] as readonly any[];
                  if (to.toLowerCase() !== escrowAddr) continue;
                  const amount = decryptAuditorPCT(
                    hexArrayToBigints(auditorPCT),
                    auditorPriv
                  );
                  const newBid: Bid = {
                    txHash: receipt.transactionHash!,
                    logIndex: Number(log.index ?? 0),
                    from,
                    to,
                    amount: amount.toString(),
                    blockNumber: Number(receipt.blockNumber ?? 0),
                  };
                  const k = `${newBid.txHash}:${newBid.logIndex}`;
                  if (!seen.has(k)) {
                    seen.add(k);
                    bids.push(newBid);
                  }
                  bidByKey[k] = newBid;
                  saveStateFile();
                  bid = newBid;
                  break;
                } catch {}
              }
            }
            if (!bid && attempt < maxAttempts - 1) {
              await new Promise((r) => setTimeout(r, delayMs));
            }
          }
          if (!bid) {
            return res
              .status(404)
              .json({ error: "bid (to escrow) not found for txHash" });
          }
        } catch (e) {
          return res
            .status(500)
            .json({ error: `fallback receipt parse failed: ${e}` });
        }
      }

      const amount = BigInt(bid.amount);
      const computed = ethers.solidityPackedKeccak256(
        ["uint256", "string", "address", "address", "uint256", "bytes32"],
        [chainId, id, sender, escrowAddr, amount, txHash]
      );
      if (computed.toLowerCase() !== String(bindingHash).toLowerCase()) {
        return res
          .status(400)
          .json({ error: "bindingHash mismatch", computed });
      }

      const key = `${bid.txHash}:${bid.logIndex}`;
      if (!auctionBidKeys[id].includes(key)) auctionBidKeys[id].push(key);
      saveStateFile();
      res.json({ ok: true, key, bid });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Helper: compute binding hash on server (for前端调试用)
  app.post("/binding-hash", (req, res) => {
    const { auctionId, sender, txHash, amount } = req.body || {};
    try {
      if (!auctionId || !sender || !txHash || amount === undefined) {
        return res
          .status(400)
          .json({ error: "auctionId, sender, txHash, amount required" });
      }
      const computed = ethers.solidityPackedKeccak256(
        ["uint256", "string", "address", "address", "uint256", "bytes32"],
        [chainId, auctionId, sender, escrowAddr, BigInt(amount), txHash]
      );
      res.json({ bindingHash: computed });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Prepare bid (server generates transfer calldata). Frontend will send tx with wallet
  app.post("/auctions/:id/prepare-bid", async (req, res) => {
    try {
      const { id } = req.params;
      const { sender, signature, amount } = req.body || {};
      console.log("[PrepareBid] req", {
        id,
        sender,
        hasSig: !!signature,
        amount,
      });
      if (!auctions[id])
        return res.status(404).json({ error: "auction not found" });
      if (!sender || !signature || amount === undefined)
        return res
          .status(400)
          .json({ error: "sender, signature, amount required" });

      // Derive BJJ SK with compatibility (old/new i0 variants)
      const deriveNoMod = (sig: string) => {
        const hash = ethers.keccak256(sig as `0x${string}`);
        const clean = hash.startsWith("0x") ? hash.slice(2) : hash;
        const bytes = ethers.getBytes("0x" + clean);
        bytes[0] &= 0b11111000;
        bytes[31] &= 0b01111111;
        bytes[31] |= 0b01000000;
        const le = Uint8Array.from(bytes).reverse();
        return BigInt("0x" + Buffer.from(le).toString("hex")) || 1n;
      };
      const skMod = i0(String(signature));
      const skNoMod = deriveNoMod(String(signature));
      const tokenId = 0n;

      // sender balance: use fast PCT sum to avoid heavy EGCT discrete-log
      const [eGCT, , amountPCTs, balancePCT] = await (
        encryptedERC as any
      ).balanceOf(sender, tokenId);
      console.log("[PrepareBid] eGCT", {
        c1x: eGCT?.c1?.x?.toString?.(),
        c1y: eGCT?.c1?.y?.toString?.(),
        c2x: eGCT?.c2?.x?.toString?.(),
        c2y: eGCT?.c2?.y?.toString?.(),
      });
      const toBigArr = (arr: readonly any[]) =>
        arr.map((x: any) => BigInt(x.toString()));
      const sumBySk = (sk: bigint) => {
        let total = 0n;
        const pctVal = (pct: bigint[]) => {
          if (!pct || pct.length !== 7) return 0n;
          try {
            return decryptAuditorPCT(pct, sk);
          } catch {
            return 0n;
          }
        };
        const balPct = toBigArr(balancePCT as any);
        if (balPct.some((v) => v !== 0n)) total += pctVal(balPct as any);
        for (const a of amountPCTs as any[]) {
          const arr = toBigArr(a.pct ?? a);
          if (arr.some((v) => v !== 0n)) total += pctVal(arr as any);
        }
        return total;
      };
      const sum1 = sumBySk(skMod);
      const sum2 = sumBySk(skNoMod);
      const useSk = sum2 > sum1 ? skNoMod : skMod;
      const senderBalance = sum2 > sum1 ? sum2 : sum1;
      console.log("[PrepareBid] senderBalance (PCT)", senderBalance.toString());
      const c1: [bigint, bigint] = [BigInt(eGCT.c1.x), BigInt(eGCT.c1.y)];
      const c2: [bigint, bigint] = [BigInt(eGCT.c2.x), BigInt(eGCT.c2.y)];

      const registrar = new ethers.Contract(
        deployment.contracts.registrar,
        getRegistrarAbi(),
        escrow
      );
      const escrowPubArr = await registrar.getUserPublicKey(escrowAddr);
      const senderPubArr = await registrar.getUserPublicKey(sender);
      const auditorPk = await (encryptedERC as any).auditorPublicKey();
      const escrowPub: [bigint, bigint] = [
        BigInt(escrowPubArr[0]),
        BigInt(escrowPubArr[1]),
      ];
      const senderPub: [bigint, bigint] = [
        BigInt(senderPubArr[0]),
        BigInt(senderPubArr[1]),
      ];
      const auditorPub: [bigint, bigint] = [
        BigInt(auditorPk.x),
        BigInt(auditorPk.y),
      ];

      const senderEncryptedBalance: [bigint, bigint, bigint, bigint] = [
        c1[0],
        c1[1],
        c2[0],
        c2[1],
      ];
      const { input, senderBalancePCT } = buildTransferInputs(
        BigInt(amount),
        useSk,
        senderPub,
        senderBalance,
        senderEncryptedBalance,
        escrowPub,
        auditorPub
      );
      console.log("[PrepareBid] artifactsDir", ZKIT_ARTIFACTS_DIR);
      const calldata = await generateTransferCalldata(
        ZKIT_ARTIFACTS_DIR,
        input
      );
      console.log(
        "[PrepareBid] calldata ok, publicSignals len:",
        (calldata?.publicSignals as any)?.length
      );
      res.json({
        calldata: jsonSafe(calldata),
        senderBalancePCT: senderBalancePCT.map((x) => x.toString()),
      });
    } catch (e: any) {
      console.error("[PrepareBid] error", e);
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Expose EncryptedERC ABI for frontend to instantiate contract
  app.get("/abi/encrypted-erc", (_req, res) => {
    try {
      res.json(getEncryptedERCAbi());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Set seller for an auction
  app.post("/auctions/:id/seller", (req, res) => {
    const { id } = req.params;
    const { seller } = req.body || {};
    if (!auctions[id])
      return res.status(404).json({ error: "auction not found" });
    if (!seller) return res.status(400).json({ error: "seller required" });
    auctionSeller[id] = String(seller);
    saveStateFile();
    res.json({ ok: true, id, seller: auctionSeller[id] });
  });

  // Close auction (no more binds expected)
  app.post("/auctions/:id/close", (req, res) => {
    const { id } = req.params;
    const a = auctions[id];
    if (!a) return res.status(404).json({ error: "auction not found" });
    a.status = "closed";
    saveStateFile();
    res.json({ ok: true, id, status: a.status });
  });

  // Payout plan: seller receives winner amount; refunds for others
  app.get("/auctions/:id/payout-plan", (req, res) => {
    const { id } = req.params;
    const a = auctions[id];
    if (!a) return res.status(404).json({ error: "auction not found" });
    const list = (auctionBidKeys[id] || [])
      .map((k) => bidByKey[k])
      .filter(Boolean);
    if (list.length === 0) return res.status(400).json({ error: "no bids" });
    const sorted = list.slice().sort((x, y) => {
      const ax = BigInt(x.amount);
      const ay = BigInt(y.amount);
      if (ay > ax) return 1;
      if (ay < ax) return -1;
      if (x.blockNumber !== y.blockNumber) return x.blockNumber - y.blockNumber;
      return x.logIndex - y.logIndex;
    });
    const winner = sorted[0];
    const seller = auctionSeller[id] || escrowAddr;
    const toSeller = { seller, amount: winner.amount };
    const refunds = sorted
      .slice(1)
      .map((b) => ({ to: b.from, amount: b.amount }));
    res.json({ toSeller, refunds, totalBids: list.length, winner });
  });

  app.get("/auctions/:id/bids", (req, res) => {
    const { id } = req.params;
    if (!auctions[id])
      return res.status(404).json({ error: "auction not found" });
    const list = (auctionBidKeys[id] || [])
      .map((k) => bidByKey[k])
      .filter(Boolean);
    const sorted = list.sort((a, b) => {
      const aa = BigInt(a.amount);
      const bb = BigInt(b.amount);
      if (bb > aa) return 1;
      if (bb < aa) return -1;
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return a.logIndex - b.logIndex;
    });
    res.json({ bids: sorted });
  });

  app.post("/auctions/:id/winner", (req, res) => {
    const { id } = req.params;
    if (!auctions[id])
      return res.status(404).json({ error: "auction not found" });
    const list = (auctionBidKeys[id] || [])
      .map((k) => bidByKey[k])
      .filter(Boolean);
    if (list.length === 0) return res.status(400).json({ error: "no bids" });
    const winner = list.slice().sort((x, y) => {
      const ax = BigInt(x.amount);
      const ay = BigInt(y.amount);
      if (ay > ax) return 1;
      if (ay < ax) return -1;
      if (x.blockNumber !== y.blockNumber) return x.blockNumber - y.blockNumber;
      return x.logIndex - y.logIndex;
    })[0];
    res.json({ winner, totalBids: list.length });
  });

  // One-click settlement: escrow -> seller (winner amount)
  app.post("/auctions/:id/settle", async (req, res) => {
    try {
      const { id } = req.params;
      const a = auctions[id];
      if (!a) return res.status(404).json({ error: "auction not found" });
      const list = (auctionBidKeys[id] || [])
        .map((k) => bidByKey[k])
        .filter(Boolean);
      if (list.length === 0) return res.status(400).json({ error: "no bids" });
      const winner = list.slice().sort((x, y) => {
        const ax = BigInt(x.amount);
        const ay = BigInt(y.amount);
        if (ay > ax) return 1;
        if (ay < ax) return -1;
        if (x.blockNumber !== y.blockNumber)
          return x.blockNumber - y.blockNumber;
        return x.logIndex - y.logIndex;
      })[0];

      const seller = auctionSeller[id] || escrowAddr;
      const amount = BigInt(winner.amount);
      console.log("[Settle] id, seller, amount", {
        id,
        seller,
        amount: amount.toString(),
      });

      const tokenId = 0n;
      const [eGCT] = await (encryptedERC as any).balanceOf(escrowAddr, tokenId);
      const c1: [bigint, bigint] = [BigInt(eGCT.c1.x), BigInt(eGCT.c1.y)];
      const c2: [bigint, bigint] = [BigInt(eGCT.c2.x), BigInt(eGCT.c2.y)];
      const escrowBalance = decryptEGCTBalance(auditorPriv, c1, c2);
      if (escrowBalance < amount)
        return res.status(400).json({ error: "escrow insufficient balance" });
      console.log("[Settle] escrowBalance", escrowBalance.toString());

      const registrar = new ethers.Contract(
        deployment.contracts.registrar,
        getRegistrarAbi(),
        escrow
      );
      const escrowPubArr = await registrar.getUserPublicKey(escrowAddr);
      const sellerPubArr = await registrar.getUserPublicKey(seller);
      const auditorPk = await (encryptedERC as any).auditorPublicKey();
      const escrowPub: [bigint, bigint] = [
        BigInt(escrowPubArr[0]),
        BigInt(escrowPubArr[1]),
      ];
      const sellerPub: [bigint, bigint] = [
        BigInt(sellerPubArr[0]),
        BigInt(sellerPubArr[1]),
      ];
      const auditorPub: [bigint, bigint] = [
        BigInt(auditorPk.x),
        BigInt(auditorPk.y),
      ];

      const senderEncryptedBalance: [bigint, bigint, bigint, bigint] = [
        c1[0],
        c1[1],
        c2[0],
        c2[1],
      ];
      const { input, senderBalancePCT } = buildTransferInputs(
        amount,
        auditorPriv,
        escrowPub,
        escrowBalance,
        senderEncryptedBalance,
        sellerPub,
        auditorPub
      );
      console.log("[Settle] artifactsDir", ZKIT_ARTIFACTS_DIR);
      const calldata = await generateTransferCalldata(
        ZKIT_ARTIFACTS_DIR,
        input
      );

      const tx = await (encryptedERC as any).transfer(
        seller,
        tokenId,
        calldata,
        senderBalancePCT
      );
      const receipt = await tx.wait();
      res.json({
        ok: true,
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber,
      });
    } catch (e: any) {
      console.error("[Settle] error", e);
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // One-click refunds: escrow -> losers
  app.post("/auctions/:id/refund", async (req, res) => {
    try {
      const { id } = req.params;
      const a = auctions[id];
      if (!a) return res.status(404).json({ error: "auction not found" });
      const list = (auctionBidKeys[id] || [])
        .map((k) => bidByKey[k])
        .filter(Boolean);
      if (list.length < 2)
        return res.status(400).json({ error: "no losers to refund" });
      const sorted = list
        .slice()
        .sort((x, y) => (BigInt(y.amount) > BigInt(x.amount) ? 1 : -1));
      const losers = sorted.slice(1);
      console.log("[Refund] losers count", losers.length);

      const tokenId = 0n;
      const registrar = new ethers.Contract(
        deployment.contracts.registrar,
        getRegistrarAbi(),
        escrow
      );
      const escrowPubArr = await registrar.getUserPublicKey(escrowAddr);
      const auditorPk = await (encryptedERC as any).auditorPublicKey();
      const escrowPub: [bigint, bigint] = [
        BigInt(escrowPubArr[0]),
        BigInt(escrowPubArr[1]),
      ];
      const auditorPub: [bigint, bigint] = [
        BigInt(auditorPk.x),
        BigInt(auditorPk.y),
      ];

      const results: any[] = [];
      for (const loser of losers) {
        console.log("[Refund] processing loser", {
          to: loser.from,
          amount: loser.amount,
        });
        const [eGCT] = await (encryptedERC as any).balanceOf(
          escrowAddr,
          tokenId
        );
        const c1: [bigint, bigint] = [BigInt(eGCT.c1.x), BigInt(eGCT.c1.y)];
        const c2: [bigint, bigint] = [BigInt(eGCT.c2.x), BigInt(eGCT.c2.y)];
        const escrowBalance = decryptEGCTBalance(auditorPriv, c1, c2);
        const amount = BigInt(loser.amount);
        if (escrowBalance < amount)
          throw new Error("escrow insufficient balance for refund");
        console.log(
          "[Refund] escrowBalance, amount",
          escrowBalance.toString(),
          amount.toString()
        );

        const loserPubArr = await registrar.getUserPublicKey(loser.from);
        const loserPub: [bigint, bigint] = [
          BigInt(loserPubArr[0]),
          BigInt(loserPubArr[1]),
        ];
        const senderEncryptedBalance: [bigint, bigint, bigint, bigint] = [
          c1[0],
          c1[1],
          c2[0],
          c2[1],
        ];
        const { input, senderBalancePCT } = buildTransferInputs(
          amount,
          auditorPriv,
          escrowPub,
          escrowBalance,
          senderEncryptedBalance,
          loserPub,
          auditorPub
        );
        console.log("[Refund] artifactsDir", ZKIT_ARTIFACTS_DIR);
        const calldata = await generateTransferCalldata(
          ZKIT_ARTIFACTS_DIR,
          input
        );
        const tx = await (encryptedERC as any).transfer(
          loser.from,
          tokenId,
          calldata,
          senderBalancePCT
        );
        const receipt = await tx.wait();
        results.push({
          to: loser.from,
          amount: loser.amount,
          txHash: tx.hash,
          blockNumber: receipt?.blockNumber,
        });
      }
      res.json({ ok: true, results });
    } catch (e: any) {
      console.error("[Refund] error", e);
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.listen(PORT, () => {
    console.log(`Auction server listening on :${PORT}`);
    console.log(`EncryptedERC: ${deployment.contracts.encryptedERC}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
