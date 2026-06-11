/**
 * Replenish a Safe avatar's CRC — headless / private-key version of
 * koeppelmann/CirclesTools `replenishMyCRC.html`, built on the official
 * Circles SDK (`@circles-sdk/*`).
 *
 * In Circles v2 your *avatar* (the address registered at the Hub that holds your
 * CRC) is usually a Gnosis Safe, while your private key is merely an *owner/signer*
 * of that Safe. There is no on-chain reverse lookup from a signer to its Safe, and
 * `operateFlowMatrix` must be sent *by the avatar* (the Safe is msg.sender) — so we
 * must be told the Safe address explicitly and route the call through the Safe.
 * `SafeSdkPrivateKeyContractRunner` does exactly that: it builds a Safe transaction,
 * signs it with the owner EOA, and executes it via the Safe.
 *
 * "Replenish" is just a self -> self transitive transfer: the SDK asks the
 * pathfinder for the largest flow you can route from the avatar back to itself,
 * settling in your own personal token, and submits the resulting flow matrix. The
 * net effect: other people's CRC you hold gets converted back into fresh personal
 * CRC of your own.
 *
 * Usage (run with bun; deps: @circles-sdk/sdk, @circles-sdk/adapter-safe):
 *
 *   PRIVATE_KEY=0x... SAFE_ADDRESS=0x... bun run scripts/replenish-crc.ts           # replenish the full max
 *   PRIVATE_KEY=0x... SAFE_ADDRESS=0x... bun run scripts/replenish-crc.ts 250        # replenish 250 CRC
 *   PRIVATE_KEY=0x... SAFE_ADDRESS=0x... DRY_RUN=1 bun run scripts/replenish-crc.ts   # compute, don't send
 *   RPC_URL=https://rpc.gnosischain.com PRIVATE_KEY=0x... SAFE_ADDRESS=0x... bun run ...
 *
 *   - PRIVATE_KEY : owner/signer of the Safe (0x-prefixed). Read from the env only —
 *                   never pass it as a CLI arg (it would land in shell history / `ps`).
 *   - SAFE_ADDRESS: the Circles avatar (the Safe). `AVATAR` is accepted as an alias.
 *   - RPC_URL     : Gnosis RPC used to drive the Safe (defaults to a public node).
 */

import { Sdk, circlesConfig } from "@circles-sdk/sdk";
import { SafeSdkPrivateKeyContractRunner } from "@circles-sdk/adapter-safe";
import { CirclesConverter, type Address } from "@circles-sdk/utils";
import { getAddress } from "viem";

const GNOSIS_CHAIN_ID = 100;
const DEFAULT_RPC_URL = "https://rpc.gnosischain.com";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey)
    throw new Error("set PRIVATE_KEY in the environment (0x-prefixed)");

  const safeRaw = process.env.SAFE_ADDRESS ?? process.env.AVATAR;
  if (!safeRaw) {
    throw new Error(
      "set SAFE_ADDRESS (or AVATAR) to your Circles avatar — the Safe address. " +
        "There is no on-chain way to derive it from PRIVATE_KEY (the key is only a Safe signer).",
    );
  }
  const safeAddress = getAddress(safeRaw) as Address; // checksum + validate
  const rpcUrl = process.env.RPC_URL ?? DEFAULT_RPC_URL;

  // 1. Wire an owner-EOA-signed, Safe-executed contract runner. Every tx the SDK
  //    sends is wrapped in a Safe transaction whose msg.sender is the Safe.
  const runner = new SafeSdkPrivateKeyContractRunner(privateKey, rpcUrl);
  await runner.init(safeAddress);

  const sdk = new Sdk(runner, circlesConfig[GNOSIS_CHAIN_ID]);

  // 2. Load the avatar. getAvatar throws if the Safe isn't signed up at Circles.
  const avatar = await sdk.getAvatar(safeAddress).catch((err) => {
    throw new Error(
      `could not load avatar ${safeAddress} (is this Safe signed up at Circles v2?): ${
        err instanceof Error ? err.message : err
      }`,
    );
  });
  console.log(`Avatar (Safe): ${safeAddress}`);

  // Replenish constraint: the sink must accept ONLY our own personal token, so
  // the pathfinder is forced to route the foreign CRC we hold back into our token.
  // Without this, a self -> self max-flow is a degenerate source==sink query and
  // returns 0. (Mirrors koeppelmann replenishMyCRC's `ToTokens: [self]`.)
  const toTokens = [safeAddress];
  const useWrappedBalances = true; // also consider wrapped (ERC20) foreign balances

  // 3. Discover the maximum replenishable flow (self -> self). Returns whole CRC.
  const maxCrc = await avatar.getMaxTransferableAmount(
    safeAddress,
    undefined, // tokenId — unset, allow transitive routing
    useWrappedBalances,
    undefined, // fromTokens — any source token
    toTokens,
  );
  console.log(`Max replenishable: ${maxCrc} CRC`);
  if (maxCrc <= 0) {
    console.log("Nothing to replenish.");
    return;
  }

  // 4. Decide how much to route. Optional first CLI arg = CRC amount (decimal).
  const arg = process.argv[2];
  let targetCrc = maxCrc;
  if (arg) {
    const requested = Number(arg);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new Error(`invalid CRC amount: ${arg}`);
    }
    targetCrc = Math.min(requested, maxCrc);
  }
  // transfer() expects atto-circles (18 dp); the SDK truncates to 6 dp internally.
  const amount = CirclesConverter.circlesToAttoCircles(targetCrc);
  console.log(`Targeting: ${targetCrc} CRC (${amount} atto)`);

  if (process.env.DRY_RUN) {
    console.log("DRY_RUN set — not sending.");
    return;
  }

  // 5. Execute the self -> self transfer (pathfinder + operateFlowMatrix via the Safe).
  const receipt = await avatar.transfer(
    safeAddress,
    amount,
    undefined, // token — unset, allow transitive routing
    undefined, // txData
    useWrappedBalances,
    undefined, // fromTokens — any source token
    toTokens,
  );
  const hash = (receipt as { hash?: string })?.hash;
  console.log(
    hash ? `Submitted: ${hash}` : `Submitted: ${JSON.stringify(receipt)}`,
  );
}

main().catch((err) => {
  console.error("Full error:", err);
  if (err instanceof Error) {
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);
  }
  process.exit(1);
});
