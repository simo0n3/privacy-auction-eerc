export type Config = {
  chainId: number;
  escrow: string;
  encryptedERC: string;
  registrar: string;
  decimals: number;
};

export const API_BASE = import.meta.env.VITE_API_BASE || "/api";

export async function getConfig(): Promise<Config> {
  const r = await fetch(`${API_BASE}/config`);
  if (!r.ok) throw new Error("config failed");
  return r.json();
}

export async function createAuction(name: string) {
  const r = await fetch(`${API_BASE}/auctions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return r.json();
}

export async function listAuctions() {
  const r = await fetch(`${API_BASE}/auctions`);
  return r.json();
}

export async function getBids(auctionId: string) {
  const r = await fetch(`${API_BASE}/auctions/${auctionId}/bids`);
  return r.json();
}

export async function setSeller(auctionId: string, seller: string) {
  const r = await fetch(`${API_BASE}/auctions/${auctionId}/seller`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seller }),
  });
  return r.json();
}

export async function closeAuction(auctionId: string) {
  const r = await fetch(`${API_BASE}/auctions/${auctionId}/close`, {
    method: "POST",
  });
  return r.json();
}

export async function payoutPlan(auctionId: string) {
  const r = await fetch(`${API_BASE}/auctions/${auctionId}/payout-plan`);
  return r.json();
}

export async function settle(auctionId: string) {
  const r = await fetch(`${API_BASE}/auctions/${auctionId}/settle`, {
    method: "POST",
  });
  return r.json();
}

export async function refund(auctionId: string) {
  const r = await fetch(`${API_BASE}/auctions/${auctionId}/refund`, {
    method: "POST",
  });
  return r.json();
}
