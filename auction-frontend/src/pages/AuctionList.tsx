import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrowserProvider } from "ethers";
import { createAuction, listAuctions, API_BASE } from "../services/api";
import { NFTCard } from "../components/NFTCard";

type Props = {
  provider: BrowserProvider | null;
};

export function AuctionList({ provider }: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState("Test Auction");
  const [nftAddr, setNftAddr] = useState<string>("");
  const [nftId, setNftId] = useState<string>("1");
  const [showHidden, setShowHidden] = useState<boolean>(false);
  const [balance, setBalance] = useState<string>("");
  // no validation needed per request
  const navigate = useNavigate();

  async function refresh() {
    const j = await listAuctions();
    setItems(j.auctions || []);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onCreate() {
    if (!nftAddr || !nftId) return alert("NFT address and tokenId required");
    const r = await createAuction(name || "Auction");
    await refresh();
    if (r?.id) navigate(`/auction/${r.id}`);
  }

  return (
    <div className="page">
      <h2>Auction List</h2>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? "Hide Dev Tools" : "Show Dev Tools"}
        </button>
      </div>
      {showHidden && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b>Hidden Tools</b>
          <div style={{ marginTop: 8 }}>
            <button
              onClick={async () => {
                try {
                  if (!provider) return alert("No wallet");
                  const accs = await provider.send("eth_requestAccounts", []);
                  const account = accs[0];
                  const signer = await provider.getSigner();
                  const message = `eERC\nRegistering user with\n Address:${account.toLowerCase()}`;
                  const signature = await signer.signMessage(message);
                  const prep = await fetch(`${API_BASE}/register-prepare`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ address: account, signature }),
                  }).then((r) => r.json());
                  if (prep?.already) return alert("Already registered");
                  if (prep?.error) return alert(prep.error);
                  const abi = await fetch(`${API_BASE}/abi/registrar`).then(
                    (r) => r.json()
                  );
                  const { Contract } = await import("ethers");
                  const c = new Contract(
                    (
                      await (await fetch(`${API_BASE}/config`)).json()
                    ).registrar,
                    abi,
                    signer
                  );
                  const tx = await (c as any).register(prep.calldata);
                  await tx.wait();
                  alert(`Registered. tx=${tx.hash}`);
                } catch (e: any) {
                  alert(e?.message || String(e));
                }
              }}
            >
              Register Wallet (Hidden)
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              onClick={async () => {
                try {
                  if (!provider) return alert("No wallet");
                  const accs = await provider.send("eth_requestAccounts", []);
                  const account = accs[0];
                  const signer = await provider.getSigner();
                  const message = `eERC\nRegistering user with\n Address:${account.toLowerCase()}`;
                  const signature = await signer.signMessage(message);
                  const r = await fetch(`${API_BASE}/balance`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ address: account, signature }),
                  });
                  const j = await r.json();
                  if (j.error) return alert(j.error);
                  setBalance(String(j.spendable ?? ""));
                } catch (e: any) {
                  alert(e?.message || String(e));
                }
              }}
            >
              Read Balance (Hidden)
            </button>
            <span style={{ marginLeft: 8 }}>
              {balance ? `${balance} PRIV` : ""}
            </span>
          </div>
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          marginBottom: 8,
        }}
      >
        <div className="card" style={{ width: 520 }}>
          <div>
            <label>Name: </label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ marginTop: 8 }}>
            <label>NFT Address: </label>
            <input
              style={{ width: 360 }}
              value={nftAddr}
              onChange={(e) => setNftAddr(e.target.value)}
              placeholder="0x..."
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <label>Token ID: </label>
            <input
              style={{ width: 120 }}
              value={nftId}
              onChange={(e) => setNftId(e.target.value)}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <button onClick={onCreate}>Start Auction</button>
          </div>
        </div>
        {nftAddr && (
          <NFTCard provider={provider} tokenAddress={nftAddr} tokenId={nftId} />
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Name</th>
            <th style={{ textAlign: "left" }}>Status</th>
            <th style={{ textAlign: "left" }}>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>{a.name || a.id}</td>
              <td>{a.status}</td>
              <td>{new Date(a.createdAt).toLocaleString()}</td>
              <td>
                <a href={`/auction/${a.id}`}>Open</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
