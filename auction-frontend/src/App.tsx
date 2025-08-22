import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, ethers } from "ethers";
import { Routes, Route, Link } from "react-router-dom";
import { AuctionList } from "./pages/AuctionList";
import { AuctionDetail } from "./pages/AuctionDetail";
import { computeBindingHash } from "./lib/eerc";

type Config = {
  chainId: number;
  escrow: string;
  encryptedERC: string;
  registrar: string;
  decimals: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [account, setAccount] = useState<string>("");
  const [auctionId, setAuctionId] = useState<string>("");
  const [amount, setAmount] = useState<string>("10.00");
  const [txHash, setTxHash] = useState<string>("");
  const [bindingHash, setBindingHash] = useState<string>("");
  const [bids, setBids] = useState<any[]>([]);
  const [balance, setBalance] = useState<string>("");
  const [seller, setSeller] = useState<string>("");
  const [payout, setPayout] = useState<any | null>(null);
  const [bidLoading, setBidLoading] = useState(false);
  const [settleLoading, setSettleLoading] = useState(false);
  const [refundLoading, setRefundLoading] = useState(false);
  const [faucetTo, setFaucetTo] = useState<string>("");
  const [faucetAmount, setFaucetAmount] = useState<string>("10.00");
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setCfg);
  }, []);

  const provider = useMemo(
    () =>
      (window as any).ethereum
        ? new BrowserProvider((window as any).ethereum)
        : null,
    []
  );

  async function connect() {
    if (!provider) return alert("No wallet");
    const accs = await provider.send("eth_requestAccounts", []);
    setAccount(accs[0]);
  }

  async function autoRegister() {
    if (!provider) return alert("No wallet");
    if (!account) return alert("No account");
    try {
      setRegLoading(true);
      const signer = await provider.getSigner();
      const message = `eERC\nRegistering user with\n Address:${account.toLowerCase()}`;
      const signature = await signer.signMessage(message);
      const prep = await fetch(`/api/register-prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: account, signature }),
      }).then((r) => r.json());
      if (prep.error) return alert(prep.error);
      if (prep.already) {
        setIsRegistered(true);
        return alert("Already registered");
      }
      const abi = await fetch(`/api/abi/registrar`).then((r) => r.json());
      const c = new Contract(cfg!.registrar, abi, signer);
      const tx = await (c as any).register(prep.calldata);
      const receipt = await tx.wait();
      setIsRegistered(true);
      alert(`Registered. tx=${tx.hash}`);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setRegLoading(false);
    }
  }

  async function createAuction() {
    const r = await fetch("/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });
    const j = await r.json();
    setAuctionId(j.id);
  }

  async function readBalance() {
    if (!provider || !account) return alert("Connect wallet first");
    const signer = await provider.getSigner();
    const message = `eERC\nRegistering user with\n Address:${account.toLowerCase()}`;
    const signature = await signer.signMessage(message);
    const r = await fetch(`/api/balance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: account, signature }),
    });
    const j = await r.json();
    if (j.error) return alert(j.error);
    setBalance(String(j.spendable ?? ""));
  }

  async function sendBidTransfer() {
    if (!cfg) return;
    if (!provider) return alert("No wallet");
    const signer = await provider.getSigner();
    alert(
      "请使用你现有的前端 Real 流程生成 ZK 证明并调用 transfer 到 escrow，获得 txHash 后在此填写"
    );
  }

  async function computeBindingHashAction() {
    if (!cfg || !auctionId || !txHash || !amount || !account) return;
    const raw = BigInt(Math.round(parseFloat(amount) * 100));
    const packed = computeBindingHash(
      cfg.chainId,
      auctionId,
      account,
      cfg.escrow,
      raw,
      txHash
    );
    setBindingHash(packed);
  }

  async function bindBid() {
    if (!auctionId || !txHash || !bindingHash || !account) return;
    const r = await fetch(`/api/auctions/${auctionId}/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash, sender: account, bindingHash }),
    });
    const j = await r.json();
    if (!j.ok && j.error) return alert(j.error);
    await refreshBids();
  }

  async function refreshBids() {
    if (!auctionId) return;
    const r = await fetch(`/api/auctions/${auctionId}/bids`);
    const j = await r.json();
    setBids(j.bids || []);
  }

  async function setSellerAddr() {
    if (!auctionId || !seller) return;
    const r = await fetch(`/api/auctions/${auctionId}/seller`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller }),
    });
    const j = await r.json();
    if (!j.ok && j.error) return alert(j.error);
    alert(`Seller set: ${j.seller}`);
  }

  async function closeAuction() {
    if (!auctionId) return;
    const r = await fetch(`/api/auctions/${auctionId}/close`, {
      method: "POST",
    });
    const j = await r.json();
    if (!j.ok && j.error) return alert(j.error);
    alert(`Auction closed`);
  }

  async function getPayoutPlan() {
    if (!auctionId) return;
    const r = await fetch(`/api/auctions/${auctionId}/payout-plan`);
    const j = await r.json();
    if (j.error) return alert(j.error);
    setPayout(j);
  }

  async function oneClickBid() {
    try {
      if (!provider || !cfg || !account || !auctionId)
        return alert("Missing config");
      setBidLoading(true);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(
        `eERC\nRegistering user with\n Address:${account.toLowerCase()}`
      );
      const amountRaw = BigInt(Math.round(parseFloat(amount) * 100));
      const prep = await fetch(`/api/auctions/${auctionId}/prepare-bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: account,
          signature,
          amount: amountRaw.toString(),
        }),
      }).then((r) => r.json());
      if (prep.error) return alert(prep.error);
      const { calldata, senderBalancePCT } = prep;
      const abi = await fetch(`/api/abi/encrypted-erc`).then((r) => r.json());
      const c = new Contract(cfg.encryptedERC, abi, await provider.getSigner());
      const tx = await c.transfer(cfg.escrow, 0, calldata, senderBalancePCT);
      await tx.wait();
      setTxHash(tx.hash);
      const binding = computeBindingHash(
        cfg.chainId,
        auctionId,
        account,
        cfg.escrow,
        BigInt(Math.round(parseFloat(amount) * 100)),
        tx.hash
      );
      let ok = false;
      let lastErr = "";
      for (let i = 0; i < 20 && !ok; i++) {
        const bindRes = await fetch(`/api/auctions/${auctionId}/bind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash: tx.hash,
            sender: account,
            bindingHash: binding,
          }),
        }).then((r) => r.json());
        ok = bindRes?.ok === true;
        lastErr = bindRes?.error || "";
        if (
          !ok &&
          (lastErr.includes("not mined") || lastErr.includes("not found"))
        ) {
          await sleep(1500);
        }
      }
      if (!ok) {
        alert(`Bid sent but bind failed: ${lastErr || "unknown"}`);
      } else {
        alert(`Bid sent & bound. txHash=${tx.hash}`);
        await refreshBids();
      }
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBidLoading(false);
    }
  }

  async function settleAuction() {
    try {
      if (!auctionId) return;
      setSettleLoading(true);
      const r = await fetch(`/api/auctions/${auctionId}/settle`, {
        method: "POST",
      });
      const j = await r.json();
      if (!j.ok) return alert(j.error || "settle failed");
      alert(`Settled. tx=${j.txHash}`);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setSettleLoading(false);
    }
  }

  async function refundLosers() {
    try {
      if (!auctionId) return;
      setRefundLoading(true);
      const r = await fetch(`/api/auctions/${auctionId}/refund`, {
        method: "POST",
      });
      const j = await r.json();
      if (!j.ok) return alert(j.error || "refund failed");
      alert(`Refunded ${j.results?.length || 0} losers`);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setRefundLoading(false);
    }
  }

  async function faucet() {
    try {
      setFaucetLoading(true);
      const r = await fetch(`/api/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: faucetTo, amount: faucetAmount }),
      });
      const j = await r.json();
      if (!j.ok) return alert(j.error || "faucet failed");
      alert(`Faucet sent. tx=${j.txHash}`);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setFaucetLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <h2 className="brand">eERC Auction</h2>
        <div>
          <button onClick={connect}>Connect Wallet</button>
          <span style={{ marginLeft: 8 }}>{account}</span>
        </div>
      </div>
      <div className="app-nav">
        <Link to="/">Auctions</Link>
        {auctionId && <Link to={`/auction/${auctionId}`}>Current Auction</Link>}
      </div>
      {/* removed debug config dump */}

      <Routes>
        <Route path="/" element={<AuctionList provider={provider} />} />
        <Route
          path="/auction/:id"
          element={
            <AuctionDetail provider={provider} cfg={cfg} account={account} />
          }
        />
      </Routes>
    </div>
  );
}

export default App;
