import { parseAbi } from "viem";
import { HUB_ADDRESS, publicClient } from "./contract";

// The Hub inherits Demurrage and exposes its conversion helpers publicly, so the
// same contract that settles transfers is the source of truth for the math.
// Verified on-chain to return identical values to the standalone helper the
// original crcConverter.html used (0x0d8c4901Dd270Fe101B8014A5dbECC4e4432eB1E).
const demurrageAbi = parseAbi([
  "function convertInflationaryToDemurrageValue(uint256 _inflationaryValue, uint64 _day) pure returns (uint256)",
  "function convertDemurrageToInflationaryValue(uint256 _demurrageValue, uint64 _dayUpdated) pure returns (uint256)",
]);

// Hub.inflationDayZero() — Thursday 15 Oct 2020 00:00 UTC, the Circles v1 launch
// moment. Immutable on-chain; mirrored here so day indices compute locally.
export const INFLATION_DAY_ZERO = 1602720000;
const SECONDS_PER_DAY = 86400;

export function dayOf(timestampSec: number): number {
  return Math.floor((timestampSec - INFLATION_DAY_ZERO) / SECONDS_PER_DAY);
}

const ONE = 10n ** 18n;

export interface DemurrageFactors {
  day: number;
  // Demurraged atto-CRC per 1e18 static units (γ^day at 18 decimals).
  toDemurraged: bigint;
  // Static atto-units per 1e18 demurraged CRC (β^day at 18 decimals).
  toStatic: bigint;
}

// Factors are constant within a day, so fetch once per chosen day and scale
// amounts locally with bigint math instead of an eth_call per keystroke.
export async function fetchDemurrageFactors(
  day: number,
): Promise<DemurrageFactors> {
  const [toDemurraged, toStatic] = await Promise.all([
    publicClient.readContract({
      address: HUB_ADDRESS,
      abi: demurrageAbi,
      functionName: "convertInflationaryToDemurrageValue",
      args: [ONE, BigInt(day)],
    }),
    publicClient.readContract({
      address: HUB_ADDRESS,
      abi: demurrageAbi,
      functionName: "convertDemurrageToInflationaryValue",
      args: [ONE, BigInt(day)],
    }),
  ]);
  return { day, toDemurraged, toStatic };
}

export function staticToDemurraged(atto: bigint, f: DemurrageFactors): bigint {
  return (atto * f.toDemurraged) / ONE;
}

export function demurragedToStatic(atto: bigint, f: DemurrageFactors): bigint {
  return (atto * f.toStatic) / ONE;
}
