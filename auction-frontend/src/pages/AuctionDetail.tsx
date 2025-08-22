import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { BrowserProvider, Contract } from "ethers";
import {
  payoutPlan,
  settle,
  refund,
  getBids,
  setSeller,
} from "../services/api";
import { NFTCard } from "../components/NFTCard";
import { computeBindingHash } from "../lib/eerc";

type Props = {
  provider: BrowserProvider | null;
  cfg: { encryptedERC: string } | null;
  account: string;
};

export function AuctionDetail({ provider, cfg, account }: Props) {
  const { id = "" } = useParams();
  const [bids, setBids] = useState<any[]>([]);
  const [plan, setPlan] = useState<any | null>(null);
  const [seller, setSellerAddr] = useState<string>("");
  const [nftAddr, setNftAddr] = useState<string>("");
  const [nftId, setNftId] = useState<string>("1");
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState<string>("10.00");
  const [bidLoading, setBidLoading] = useState(false);
  const [txHash, setTxHash] = useState<string>("");
  const [bindingHash, setBindingHash] = useState<string>("");
  const [showAdmin, setShowAdmin] = useState<boolean>(false);

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function refreshBids() {
    const j = await getBids(id);
    setBids(j.bids || []);
  }

  useEffect(() => {
    refreshBids();
  }, [id]);

  async function onPlan() {
    const j = await payoutPlan(id);
    setPlan(j);
  }

  async function onSetSeller() {
    if (!seller) return;
    await setSeller(id, seller);
    alert("Seller set");
  }

  async function onSettle() {
    setLoading(true);
    try {
      const r = await settle(id);
      if (!r.ok) return alert(r.error || "settle failed");
      alert(`Settled: ${r.txHash}`);
    } finally {
      setLoading(false);
    }
  }

  async function onRefund() {
    setLoading(true);
    try {
      const r = await refund(id);
      if (!r.ok) return alert(r.error || "refund failed");
      alert(`Refunded ${r.results?.length || 0}`);
    } finally {
      setLoading(false);
    }
  }

  async function transferNftToWinner() {
    try {
      if (!provider) return alert("No wallet");
      if (!plan?.winner) return alert("No winner yet");
      const signer = await provider.getSigner();
      const erc721Abi = [
        "function safeTransferFrom(address from,address to,uint256 tokenId)",
      ];
      const c = new Contract(nftAddr, erc721Abi, signer);
      const tx = await c.safeTransferFrom(
        account,
        plan.winner.from,
        BigInt(nftId)
      );
      await tx.wait();
      alert(`NFT sent to winner. tx=${tx.hash}`);
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  async function oneClickBid() {
    try {
      if (!provider || !cfg || !account || !id) return alert("Missing config");
      setBidLoading(true);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(
        `eERC\nRegistering user with\n Address:${account.toLowerCase()}`
      );
      const amountRaw = BigInt(Math.round(parseFloat(amount) * 100));
      const prep = await fetch(`/api/auctions/${id}/prepare-bid`, {
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
      const c = new Contract(cfg.encryptedERC, abi, signer);
      const tx = await c.transfer(cfg.escrow, 0, calldata, senderBalancePCT);
      await tx.wait();
      setTxHash(tx.hash);

      const binding = computeBindingHash(
        Number((cfg as any).chainId || 0),
        id,
        account,
        (cfg as any).escrow,
        amountRaw,
        tx.hash
      );
      setBindingHash(binding);
      let ok = false;
      let lastErr = "";
      for (let i = 0; i < 20 && !ok; i++) {
        const bindRes = await fetch(`/api/auctions/${id}/bind`, {
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
        await refreshBids();
        alert(`Bid sent & bound. txHash=${tx.hash}`);
      }
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBidLoading(false);
    }
  }

  return (
    <div className="page">
      <h2>Auction Detail</h2>
      <div>ID: {id}</div>

      {/* Bidder panel */}
      <div className="card" style={{ marginTop: 12 }}>
        <b>Place Private Bid</b>
        <div style={{ marginTop: 8 }}>
          <label>Amount (PRIV): </label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ width: 120 }}
          />
          <button
            onClick={oneClickBid}
            disabled={bidLoading}
            style={{ marginLeft: 8 }}
          >
            {bidLoading ? "Sending..." : "One-Click Private Bid"}
          </button>
        </div>
        {txHash && (
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            txHash: {txHash}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <b>Bids</b>
        <div style={{ marginTop: 8 }}>
          <button onClick={refreshBids}>Refresh Bids</button>
        </div>
        <pre>{JSON.stringify(bids, null, 2)}</pre>
      </div>

      {/* Admin panel (seller-only actions) */}
      <div style={{ marginTop: 16 }}>
        <button onClick={() => setShowAdmin((v) => !v)}>
          {showAdmin ? "Hide Admin Panel" : "Show Admin Panel"}
        </button>
      </div>

      {showAdmin && (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Admin</b>
          <div style={{ marginTop: 12 }}>
            <b>Seller</b>
            <div>
              <input
                value={seller}
                onChange={(e) => setSellerAddr(e.target.value)}
                style={{ width: 360 }}
              />
              <button onClick={onSetSeller} style={{ marginLeft: 8 }}>
                Set
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={onPlan}>Get Payout Plan</button>
          </div>

          {plan && (
            <div style={{ marginTop: 12 }}>
              <div>
                Winner: {plan.winner?.from} —{" "}
                {Number(plan.winner?.amount || 0) / 100} PRIV
              </div>
              <div style={{ marginTop: 8 }}>
                <button onClick={onSettle} disabled={loading}>
                  Settle
                </button>
                <button
                  onClick={onRefund}
                  disabled={loading}
                  style={{ marginLeft: 8 }}
                >
                  Refund Losers
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <b>NFT</b>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                marginTop: 8,
              }}
            >
              <div>
                <div>
                  <input
                    placeholder="ERC721 Address"
                    value={nftAddr}
                    onChange={(e) => setNftAddr(e.target.value)}
                    style={{ width: 360 }}
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <input
                    placeholder="Token ID"
                    value={nftId}
                    onChange={(e) => setNftId(e.target.value)}
                    style={{ width: 120 }}
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={transferNftToWinner}
                    disabled={!plan?.winner}
                  >
                    Send to Winner
                  </button>
                </div>
              </div>
              {nftAddr && (
                <NFTCard
                  provider={provider}
                  tokenAddress={nftAddr}
                  tokenId={nftId}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
