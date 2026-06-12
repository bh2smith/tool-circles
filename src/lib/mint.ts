import { encodeFunctionData, parseAbi } from "viem";
import { HUB_ADDRESS, publicClient } from "./contract";
import { circlesQuery } from "./query";

// Personal minting: every human avatar accrues 1 CRC per hour (demurraged),
// claimable with Hub.personalMint(). Accrual stops growing MAX_CLAIM_DURATION
// (2 weeks) after the last mint — unclaimed time beyond that is lost.

export const hubMintAbi = parseAbi([
  "function calculateIssuance(address _human) view returns (uint256 issuance, uint256 startPeriod, uint256 endPeriod)",
  "function isHuman(address) view returns (bool)",
  "function stopped(address) view returns (bool)",
  "function personalMint()",
]);

export const MAX_CLAIM_SECONDS = 14 * 24 * 3600;

export interface MintStatus {
  claimable: bigint; // atto-CRC, demurraged
  // Accrual window as reported by calculateIssuance: startPeriod is the last
  // mint (hour-aligned), endPeriod the last completed hour. All zero when
  // nothing is claimable yet.
  startPeriod: number;
  endPeriod: number;
  isHuman: boolean;
  stopped: boolean;
}

export async function fetchMintStatus(avatar: string): Promise<MintStatus> {
  const a = avatar as `0x${string}`;
  const [issuance, isHuman, stopped] = await publicClient.multicall({
    contracts: [
      {
        address: HUB_ADDRESS,
        abi: hubMintAbi,
        functionName: "calculateIssuance",
        args: [a],
      },
      {
        address: HUB_ADDRESS,
        abi: hubMintAbi,
        functionName: "isHuman",
        args: [a],
      },
      {
        address: HUB_ADDRESS,
        abi: hubMintAbi,
        functionName: "stopped",
        args: [a],
      },
    ],
    allowFailure: false,
  });
  const [claimable, startPeriod, endPeriod] = issuance;
  return {
    claimable,
    startPeriod: Number(startPeriod),
    endPeriod: Number(endPeriod),
    isHuman,
    stopped,
  };
}

export function encodePersonalMint(): `0x${string}` {
  return encodeFunctionData({ abi: hubMintAbi, functionName: "personalMint" });
}

export interface MintEvent {
  timestamp: number;
  amount: bigint; // atto-CRC at mint time
  periodSeconds: number; // accrual window the mint covered
  txHash: string;
}

export async function fetchMintHistory(
  avatar: string,
  limit = 15,
): Promise<MintEvent[]> {
  const rows = await circlesQuery({
    namespace: "CrcV2",
    table: "PersonalMint",
    filter: [{ column: "human", value: avatar.toLowerCase() }],
    order: [{ column: "blockNumber", desc: true }],
    limit,
  });
  return rows.map((r) => ({
    timestamp: Number(r.timestamp),
    amount: BigInt(String(r.amount ?? "0")),
    periodSeconds: Number(r.endPeriod) - Number(r.startPeriod),
    txHash: String(r.transactionHash),
  }));
}
