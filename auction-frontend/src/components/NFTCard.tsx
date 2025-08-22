import { useEffect, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";

type Props = {
  provider: BrowserProvider | null;
  tokenAddress: string;
  tokenId: string;
  onValidChange?: (ok: boolean) => void;
};

const erc721Abi = [
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function name() view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

function toHttpFromIpfs(uri: string): string {
  try {
    if (!uri) return uri;
    if (uri.startsWith("ipfs://")) {
      const path = uri.replace("ipfs://", "").replace(/^ipfs\//, "");
      return `https://ipfs.io/ipfs/${path}`;
    }
    return uri;
  } catch {
    return uri;
  }
}

function parseDataJson(uri: string): any | null {
  try {
    if (uri.startsWith("data:application/json;base64,")) {
      const b64 = uri.replace("data:application/json;base64,", "");
      const jsonStr = atob(b64);
      return JSON.parse(jsonStr);
    }
    if (uri.startsWith("data:application/json,")) {
      const jsonStr = decodeURIComponent(
        uri.replace("data:application/json,", "")
      );
      return JSON.parse(jsonStr);
    }
    return null;
  } catch {
    return null;
  }
}

export function NFTCard({
  provider,
  tokenAddress,
  tokenId,
  onValidChange,
}: Props) {
  const [meta, setMeta] = useState<any>(null);
  const [name, setName] = useState<string>("");
  const [owner, setOwner] = useState<string>("");
  const [imgUrls, setImgUrls] = useState<string[]>([]);
  const [imgIdx, setImgIdx] = useState<number>(0);

  useEffect(() => {
    (async () => {
      try {
        if (!provider) return;
        // Try multiple providers (wallet first, then public RPC fallback)
        const rpcFallback = new JsonRpcProvider(
          "https://api.avax-test.network/ext/bc/C/rpc"
        );
        const providers: any[] = [provider, rpcFallback];
        let n: any, o: any, uriRaw: any;
        let okProv = null as any;
        for (const pr of providers) {
          try {
            const c = new Contract(tokenAddress, erc721Abi, pr);
            const nameP = c.name();
            const ownerP = c.ownerOf(tokenId);
            const uriP = c.tokenURI(tokenId);
            [n, o, uriRaw] = await Promise.all([nameP, ownerP, uriP]);
            okProv = pr;
            break;
          } catch {}
        }
        if (!okProv) {
          setMeta(null);
          setImgUrls([]);
          setImgIdx(0);
          return;
        }
        setName(String(n));
        setOwner(String(o));

        const dataJson = parseDataJson(String(uriRaw));
        if (dataJson) {
          const candidates: string[] = [];
          const fields = [
            "image",
            "image_url",
            "imageURI",
            "imageUrl",
            "animation_url",
            "image_data",
          ];
          for (const f of fields) {
            const v = (dataJson as any)[f];
            if (!v) continue;
            if (
              f === "image_data" &&
              typeof v === "string" &&
              v.includes("<svg")
            ) {
              candidates.push(
                `data:image/svg+xml;utf8,${encodeURIComponent(v)}`
              );
              continue;
            }
            if (typeof v === "string") {
              const http = toHttpFromIpfs(v);
              if (http.startsWith("ipfs://")) {
                const p = http.replace("ipfs://", "").replace(/^ipfs\//, "");
                candidates.push(`https://ipfs.io/ipfs/${p}`);
                candidates.push(`https://cloudflare-ipfs.com/ipfs/${p}`);
                candidates.push(`https://dweb.link/ipfs/${p}`);
              } else {
                candidates.push(http);
              }
            }
          }
          setImgUrls(candidates);
          setImgIdx(0);
          setMeta({ ...dataJson });
          return;
        }

        const uriHttp = toHttpFromIpfs(String(uriRaw));
        const tryUris: string[] = [];
        if (uriHttp.startsWith("ipfs://")) {
          const p = uriHttp.replace("ipfs://", "").replace(/^ipfs\//, "");
          tryUris.push(`https://ipfs.io/ipfs/${p}`);
          tryUris.push(`https://cloudflare-ipfs.com/ipfs/${p}`);
          tryUris.push(`https://dweb.link/ipfs/${p}`);
        } else {
          tryUris.push(uriHttp);
        }

        let text = "";
        let ok = false;
        for (const u of tryUris) {
          try {
            const res = await fetch(u, {
              credentials: "omit",
              headers: { Accept: "application/json" },
            });
            if (!res.ok) continue;
            text = await res.text();
            ok = true;
            break;
          } catch {}
        }
        if (!ok) {
          setMeta(null);
          setImgUrls([]);
          setImgIdx(0);
          onValidChange?.(false);
          return;
        }
        let j: any = {};
        try {
          j = JSON.parse(text);
        } catch {
          j = {};
        }
        const candidates: string[] = [];
        const fields = [
          "image",
          "image_url",
          "imageURI",
          "imageUrl",
          "animation_url",
          "image_data",
        ];
        for (const f of fields) {
          const v = j?.[f];
          if (!v) continue;
          if (
            f === "image_data" &&
            typeof v === "string" &&
            v.includes("<svg")
          ) {
            candidates.push(`data:image/svg+xml;utf8,${encodeURIComponent(v)}`);
            continue;
          }
          if (typeof v === "string") {
            const http = toHttpFromIpfs(v);
            if (http.startsWith("ipfs://")) {
              const p = http.replace("ipfs://", "").replace(/^ipfs\//, "");
              candidates.push(`https://ipfs.io/ipfs/${p}`);
              candidates.push(`https://cloudflare-ipfs.com/ipfs/${p}`);
              candidates.push(`https://dweb.link/ipfs/${p}`);
            } else {
              candidates.push(http);
            }
          }
        }
        setImgUrls(candidates);
        setImgIdx(0);
        setMeta(j);
        onValidChange?.(candidates.length > 0);
      } catch {
        setMeta(null);
        setImgUrls([]);
        setImgIdx(0);
        onValidChange?.(false);
      }
    })();
  }, [provider, tokenAddress, tokenId]);

  return (
    <div className="card nft-card">
      <div className="card-title">
        {name || "NFT"} #{tokenId}
      </div>
      {imgUrls.length > 0 ? (
        <img
          src={imgUrls[Math.min(imgIdx, imgUrls.length - 1)]}
          alt="nft"
          onError={() => setImgIdx((i) => Math.min(i + 1, imgUrls.length))}
        />
      ) : (
        <div className="img-placeholder">Image not available</div>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Owner: {owner}
      </div>
      {meta?.description && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {meta.description}
        </div>
      )}
    </div>
  );
}
