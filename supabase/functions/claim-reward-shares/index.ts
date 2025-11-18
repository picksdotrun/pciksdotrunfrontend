// Supabase Edge Function: claim-reward-shares
// Uses the company prize wallet to buy 0.01 BNB worth of YES/NO shares and transfers them to the user.

import { ethers } from "npm:ethers@6.11.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const getEnv = (name: string) => Deno.env.get(name)?.trim() || null;

const SUPABASE_URL = getEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const PRIZE_PRIVATE_KEY = getEnv("PRIZE_PRIVATE_KEY");
const BSC_RPC_URL =
  getEnv("BSC_RPC_URL") ||
  "https://rpc.ankr.com/bsc/160d13efb3e044349e40d473f5389b951f34495fa5201b1a47bf9396a06fb693";
const SHARE_PURCHASE_AMOUNT = ethers.parseUnits("0.01", 18);

const MARKET_NATIVE_ABI = [
  "function buyYesWithBNB() payable",
  "function buyNoWithBNB() payable",
  "function yesShare() view returns (address)",
  "function noShare() view returns (address)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address recipient, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

let supabaseClient: any = null;
if (SUPABASE_URL && SERVICE_ROLE_KEY) {
  const { createClient } = await import("jsr:@supabase/supabase-js@2");
  supabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
} else {
  console.warn("[claim-reward-shares] missing Supabase service credentials");
}

const getUserProfile = async (userId: string | null, wallet: string | null) => {
  if (!supabaseClient || (!userId && !wallet)) return null;
  let query = supabaseClient.from("users").select("id,wallet,x_handle,x_user_id,username").limit(1);
  if (userId && wallet) {
    query = query.or(`id.eq.${userId},wallet.eq.${wallet.toLowerCase()}`);
  } else if (userId) {
    query = query.eq("id", userId);
  } else if (wallet) {
    query = query.eq("wallet", wallet.toLowerCase());
  }
  const { data } = await query.maybeSingle();
  return data || null;
};

const getPickRow = async (pickId: string) => {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from("picks")
    .select(
      "id,name,evm_market_address,evm_market_type,evm_yes_token_address,evm_no_token_address,evm_chain"
    )
    .eq("id", pickId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const normalizeAddr = (addr: string | null | undefined) => {
  if (!addr) return null;
  const clean = addr.toLowerCase();
  if (!clean.startsWith("0x") || clean.length !== 42) return null;
  return clean;
};

const resolveShareAddress = async (
  market: ethers.Contract,
  pick: any,
  side: "yes" | "no"
) => {
  const pickAddr =
    side === "yes" ? normalizeAddr(pick?.evm_yes_token_address) : normalizeAddr(pick?.evm_no_token_address);
  if (pickAddr) return pickAddr;
  try {
    const onchain = await (side === "yes" ? market.yesShare() : market.noShare());
    return normalizeAddr(onchain);
  } catch (err) {
    console.warn("[claim-reward-shares] failed to read share address", err);
    return null;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!PRIZE_PRIVATE_KEY) return json(500, { error: "missing_prize_private_key" });

  let payload: Record<string, any> = {};
  try {
    payload = await req.json();
  } catch (err) {
    console.warn("[claim-reward-shares] non-json payload", err);
  }

  const pickId = (payload?.pickId || "").toString().trim();
  const userId = (payload?.userId || "").toString().trim();
  const walletInput = (payload?.wallet || "").toString().trim();
  const choiceRaw = (payload?.choice || "").toString().trim().toLowerCase();
  if (!pickId) return json(400, { error: "pickId_required" });
  if (!userId && !walletInput) {
    return json(400, { error: "user_identifier_required", message: "Provide userId or wallet" });
  }
  if (choiceRaw !== "yes" && choiceRaw !== "no") {
    return json(400, { error: "choice_invalid", message: "Choice must be yes or no." });
  }

  let pickRow: any = null;
  try {
    pickRow = await getPickRow(pickId);
  } catch (err: any) {
    console.error("[claim-reward-shares] pick lookup failed", err?.message || err);
    return json(500, { error: "pick_lookup_failed", message: err?.message || String(err) });
  }
  if (!pickRow) {
    return json(404, { error: "pick_not_found" });
  }
  if ((pickRow.evm_market_type || "").toLowerCase() !== "native_bnb") {
    return json(400, { error: "unsupported_market", message: "Only native BNB markets are supported." });
  }

  let userProfile = null;
  try {
    userProfile = await getUserProfile(userId || null, walletInput || null);
  } catch (err) {
    console.warn("[claim-reward-shares] failed to load user profile", err);
  }
  const userWallet = normalizeAddr(userProfile?.wallet || walletInput);
  if (!userWallet) {
    return json(400, { error: "user_wallet_missing", message: "User wallet address is required." });
  }

  console.log("[claim-reward-shares] purchase request", {
    pickId,
    pickName: pickRow?.name,
    userId: userProfile?.id || userId || null,
    payloadWallet: walletInput || null,
    resolvedWallet: userWallet,
    choice: choiceRaw,
  });

  const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
  let wallet: ethers.Wallet;
  try {
    wallet = new ethers.Wallet(PRIZE_PRIVATE_KEY!, provider);
  } catch (err) {
    console.error("[claim-reward-shares] failed to init wallet", err);
    return json(500, { error: "wallet_init_failed" });
  }

  const marketAddr = normalizeAddr(pickRow.evm_market_address);
  if (!marketAddr) {
    return json(400, { error: "pick_missing_market_address" });
  }
  const market = new ethers.Contract(marketAddr, MARKET_NATIVE_ABI, wallet);
  const side: "yes" | "no" = choiceRaw === "yes" ? "yes" : "no";
  const shareAddr = await resolveShareAddress(market, pickRow, side);
  if (!shareAddr) {
    return json(500, { error: "share_address_unavailable" });
  }
  const shareToken = new ethers.Contract(shareAddr, ERC20_ABI, wallet);

  let balanceBefore = 0n;
  try {
    balanceBefore = await shareToken.balanceOf(wallet.address);
  } catch (err) {
    console.warn("[claim-reward-shares] failed to fetch balance", err);
  }

  const buyMethod = side === "yes" ? "buyYesWithBNB" : "buyNoWithBNB";
  console.log("[claim-reward-shares] executing buy", {
    market: marketAddr,
    method: buyMethod,
    valueWei: SHARE_PURCHASE_AMOUNT.toString(),
  });
  let buyHash = "";
  try {
    const txResponse = await market[buyMethod]({ value: SHARE_PURCHASE_AMOUNT });
    buyHash = txResponse.hash;
    await txResponse.wait(1);
  } catch (err: any) {
    console.error("[claim-reward-shares] market buy failed", err);
    return json(500, { error: "buy_failed", message: err?.message || String(err) });
  }
  console.log("[claim-reward-shares] buy success", { buyHash });

  let minted = 0n;
  try {
    const balanceAfter = await shareToken.balanceOf(wallet.address);
    minted = balanceAfter - balanceBefore;
    if (minted <= 0n) {
      minted = balanceAfter;
    }
  } catch (err) {
    console.warn("[claim-reward-shares] failed to compute minted shares", err);
  }
  if (minted <= 0n) {
    console.error("[claim-reward-shares] zero shares minted");
    return json(500, { error: "mint_zero", message: "Share purchase did not mint any tokens." });
  }
  console.log("[claim-reward-shares] minted shares", {
    shareToken: shareAddr,
    mintedWei: minted.toString(),
  });

  let transferHash = "";
  try {
    const transferTx = await shareToken.transfer(userWallet, minted);
    transferHash = transferTx.hash;
    await transferTx.wait(1);
  } catch (err: any) {
    console.error("[claim-reward-shares] transfer to user failed", {
      error: err?.message || err,
      code: err?.code,
      data: err?.data,
      shortMessage: err?.shortMessage,
      tx: err?.transaction,
    });
    return json(500, {
      error: "transfer_failed",
      message: err?.shortMessage || err?.message || String(err),
      details: {
        code: err?.code || null,
        data: err?.data || null,
      },
    });
  }

  console.log("[claim-reward-shares] claim success", {
    pickId,
    userId: userProfile?.id || userId || null,
    wallet: userWallet,
    side,
    buyHash,
    transferHash,
  });

  return json(200, {
    success: true,
    pickId,
    pickName: pickRow?.name || payload?.pickName || null,
    userId: userProfile?.id || userId || null,
    wallet: userWallet,
    choice: side,
    txHash: buyHash,
    transferHash,
    sharesSentWei: (minted > 0n ? minted.toString() : SHARE_PURCHASE_AMOUNT.toString()),
    message:
      "Reward shares purchased and transferred. Shares remain locked until the pick resolves.",
  });
});
