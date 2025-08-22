import { ethers } from "ethers";

export function computeBindingHash(
  chainId: number,
  auctionId: string,
  sender: string,
  escrow: string,
  amountRaw: bigint,
  txHash: string
) {
  return ethers.solidityPackedKeccak256(
    ["uint256", "string", "address", "address", "uint256", "bytes32"],
    [chainId, auctionId, sender, escrow, amountRaw, txHash]
  );
}
