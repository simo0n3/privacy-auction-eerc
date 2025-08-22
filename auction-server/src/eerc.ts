import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import {
  processPoseidonDecryption,
  processPoseidonEncryption,
} from "../../src/poseidon/poseidon";
import { Base8, mulPointEscalar, subOrder } from "@zk-kit/baby-jubjub";
import { formatPrivKeyForBabyJub } from "maci-crypto";
import { encryptMessage, decryptPoint } from "../../src/jub/jub";
import { TransferCircuit } from "../../generated-types/zkit/core/TransferCircuit";

export type StandaloneDeployment = {
  contracts: {
    encryptedERC: string;
    registrar: string;
  };
};

export function loadStandaloneDeployment(
  filePath: string
): StandaloneDeployment {
  const p = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

export function getEncryptedERCAbi(): any {
  const envPath = process.env.EERC_ABI_PATH;
  const candidates = [
    envPath,
    path.resolve(
      __dirname,
      "..",
      "..",
      "artifacts",
      "contracts",
      "EncryptedERC.sol",
      "EncryptedERC.json"
    ),
    path.resolve(
      process.cwd(),
      "..",
      "artifacts",
      "contracts",
      "EncryptedERC.sol",
      "EncryptedERC.json"
    ),
    path.resolve(
      process.cwd(),
      "artifacts",
      "contracts",
      "EncryptedERC.sol",
      "EncryptedERC.json"
    ),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        const json = JSON.parse(raw);
        return json.abi;
      }
    } catch {}
  }
  throw new Error(
    "EncryptedERC ABI not found. Set EERC_ABI_PATH or ensure artifacts are built at ../artifacts/contracts/EncryptedERC.sol/EncryptedERC.json"
  );
}

export function getRegistrarAbi(): any {
  const candidates = [
    path.resolve(
      process.cwd(),
      "..",
      "artifacts",
      "contracts",
      "Registrar.sol",
      "Registrar.json"
    ),
    path.resolve(
      process.cwd(),
      "artifacts",
      "contracts",
      "Registrar.sol",
      "Registrar.json"
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      return JSON.parse(raw).abi;
    }
  }
  throw new Error("Registrar ABI not found. Ensure artifacts exist.");
}

export function getEscrowWallet(
  rpcUrl: string,
  escrowPrivKey: string
): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(escrowPrivKey, provider);
}

export async function deriveAuditorPrivateKeyFromEscrow(
  wallet: ethers.Wallet
): Promise<bigint> {
  const addr = await wallet.getAddress();
  const message = `eERC\nRegistering user with\n Address:${addr.toLowerCase()}`;
  const sig = await wallet.signMessage(message);
  return i0(sig);
}

export function decryptAuditorPCT(
  pct7: bigint[],
  auditorPrivKey: bigint
): bigint {
  // pct7 = [ciphertext(4), authKey(2), nonce(1)]
  const ciphertext = pct7.slice(0, 4);
  const authKey = pct7.slice(4, 6);
  const nonce = pct7[6];
  const out = processPoseidonDecryption(
    ciphertext,
    authKey as any,
    nonce,
    auditorPrivKey,
    1
  );
  return BigInt(out[0]);
}

export function hexArrayToBigints(arr: readonly any[]): bigint[] {
  return arr.map((x) => BigInt(x.toString()));
}

// Local i0 implementation to avoid importing Hardhat-bound utils
export function i0(signature: string): bigint {
  if (typeof signature !== "string" || signature.length < 132) {
    throw new Error("Invalid signature hex string");
  }
  const hash = ethers.keccak256(signature as `0x${string}`);
  const clean = hash.startsWith("0x") ? hash.slice(2) : hash;
  let bytes = ethers.getBytes("0x" + clean);

  // clamp
  bytes[0] &= 0b11111000;
  bytes[31] &= 0b01111111;
  bytes[31] |= 0b01000000;

  const le = Uint8Array.from(bytes).reverse();
  const hex = Buffer.from(le).toString("hex");
  let sk = BigInt("0x" + hex);
  sk %= subOrder as unknown as bigint;
  if (sk === 0n) sk = 1n;
  return sk;
}

export function formatBJJSK(sk: bigint): bigint {
  return formatPrivKeyForBabyJub(sk) % (subOrder as unknown as bigint);
}

export function computeBJJPub(formattedSk: bigint): [bigint, bigint] {
  return mulPointEscalar(Base8, formattedSk).map((x) => BigInt(x)) as [
    bigint,
    bigint,
  ];
}

export function decryptEGCTBalance(
  privateKey: bigint,
  c1: [bigint, bigint],
  c2: [bigint, bigint]
): bigint {
  try {
    const point = decryptPoint(privateKey, c1 as any, c2 as any);
    const value = findDiscreteLogOptimized([point[0], point[1]]);
    return value ?? 0n;
  } catch {
    return 0n;
  }
}

const discreteLogCache = new Map<string, bigint>();
let cacheInitialized = false;
function initializeCache() {
  if (cacheInitialized) return;
  for (let i = 0n; i <= 1000n; i++) {
    const p = mulPointEscalar(Base8, i);
    discreteLogCache.set(`${p[0]},${p[1]}`, i);
  }
  const rounds = [100n, 500n, 1000n, 1500n, 2000n, 5000n, 10000n];
  for (const v of rounds) {
    const p = mulPointEscalar(Base8, v);
    discreteLogCache.set(`${p[0]},${p[1]}`, v);
  }
  cacheInitialized = true;
}
function findDiscreteLogOptimized(target: [bigint, bigint]): bigint | null {
  initializeCache();
  const key = `${target[0]},${target[1]}`;
  if (discreteLogCache.has(key)) return discreteLogCache.get(key)!;
  const max = 100000n;
  for (let i = 1001n; i <= max; i++) {
    const p = mulPointEscalar(Base8, i);
    if (p[0] === target[0] && p[1] === target[1]) return i;
  }
  return null;
}

export async function generateTransferCalldata(
  artifactsDir: string,
  inputs: any
) {
  // Debug artifacts presence
  try {
    const base = path.join(artifactsDir, "circom", "transfer.circom");
    const paths = {
      artifactsJson: path.join(base, "TransferCircuit_artifacts.json"),
      zkey: path.join(base, "TransferCircuit.groth16.zkey"),
      wasm: path.join(base, "TransferCircuit_js", "TransferCircuit.wasm"),
    };
    console.log("[ZKIT] artifactsDir:", artifactsDir);
    console.log("[ZKIT] files exist:", {
      artifactsJson: fs.existsSync(paths.artifactsJson),
      zkey: fs.existsSync(paths.zkey),
      wasm: fs.existsSync(paths.wasm),
    });
    console.log(
      "[ZKIT] TransferCircuit typeof:",
      typeof (TransferCircuit as any)
    );
    console.log(
      "[ZKIT] TransferCircuit props:",
      Object.getOwnPropertyNames((TransferCircuit as any) || {})
    );
  } catch (e) {
    console.warn("[ZKIT] artifact precheck failed:", e);
  }

  let circuit: any;
  try {
    const circuitArtifactsPath = path.join(
      artifactsDir,
      "circom",
      "transfer.circom"
    );
    circuit = new (TransferCircuit as any)({
      circuitName: "TransferCircuit",
      circuitArtifactsPath,
      verifierDirPath: path.join(artifactsDir, "verifiers"),
    });
  } catch (e) {
    console.error("[ZKIT] new TransferCircuit(...) failed:", e);
    throw e;
  }

  const t0 = Date.now();
  let proof: any;
  try {
    console.log("[ZKIT] generateProof:start");
    proof = await circuit.generateProof(inputs as any);
    console.log("[ZKIT] generateProof:done in", Date.now() - t0, "ms");
  } catch (e) {
    console.error("[ZKIT] generateProof:error", e);
    throw e;
  }

  try {
    const t1 = Date.now();
    console.log("[ZKIT] generateCalldata:start");
    const calldata = await circuit.generateCalldata(proof as any);
    console.log("[ZKIT] generateCalldata:done in", Date.now() - t1, "ms");
    return calldata;
  } catch (e) {
    console.error("[ZKIT] generateCalldata:error", e);
    throw e;
  }
}

export function buildTransferInputs(
  amount: bigint,
  senderSk: bigint,
  senderPub: [bigint, bigint],
  senderBalance: bigint,
  senderEncryptedBalance: [bigint, bigint, bigint, bigint],
  receiverPub: [bigint, bigint],
  auditorPub: [bigint, bigint]
) {
  const { cipher: senderCipher } = encryptMessage(senderPub as any, amount);
  const { cipher: receiverCipher, random: receiverRandom } = encryptMessage(
    receiverPub as any,
    amount
  );

  const rPct = processPoseidonEncryption([amount], receiverPub as any);
  const aPct = processPoseidonEncryption([amount], auditorPub as any);

  const senderNewBalance = senderBalance - amount;
  const sNewPct = processPoseidonEncryption(
    [senderNewBalance],
    senderPub as any
  );

  const input = {
    ValueToTransfer: amount,
    SenderPrivateKey: formatBJJSK(senderSk),
    SenderPublicKey: senderPub,
    SenderBalance: senderBalance,
    SenderBalanceC1: senderEncryptedBalance.slice(0, 2),
    SenderBalanceC2: senderEncryptedBalance.slice(2, 4),
    SenderVTTC1: senderCipher[0],
    SenderVTTC2: senderCipher[1],
    ReceiverPublicKey: receiverPub,
    ReceiverVTTC1: receiverCipher[0],
    ReceiverVTTC2: receiverCipher[1],
    ReceiverVTTRandom: receiverRandom,
    ReceiverPCT: rPct.ciphertext,
    ReceiverPCTAuthKey: rPct.authKey,
    ReceiverPCTNonce: rPct.nonce,
    ReceiverPCTRandom: rPct.encRandom,
    AuditorPublicKey: auditorPub,
    AuditorPCT: aPct.ciphertext,
    AuditorPCTAuthKey: aPct.authKey,
    AuditorPCTNonce: aPct.nonce,
    AuditorPCTRandom: aPct.encRandom,
  };

  const senderBalancePCT: bigint[] = [
    ...sNewPct.ciphertext,
    ...sNewPct.authKey,
    sNewPct.nonce,
  ];

  return { input, senderBalancePCT };
}
