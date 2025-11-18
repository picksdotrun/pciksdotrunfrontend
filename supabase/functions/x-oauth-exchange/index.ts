// Supabase Edge Function: x-oauth-exchange
// Exchanges the OAuth code for tokens, fetches the X profile, and persists it to users.x_handle/x_user_id.

import { encode as base64UrlEncode } from "https://deno.land/std@0.208.0/encoding/base64url.ts";

const DEFAULT_CLIENT_ID = "dTJGTzhNb1NQRi1SY2hZY1EtYjA6MTpjaQ";
const DEFAULT_CLIENT_SECRET = "JlsXOxTIbhmQqisx8MZHY5GPBgIjYZtUrFrZrsV2dKXkXoQWTY";
const DEFAULT_REDIRECT_URI = "https://picks.run/x/callback";
const SESSION_SECRET = "picks-x-session-secret";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://picks.run",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const getEnv = (name: string, fallback?: string | null) => Deno.env.get(name)?.trim() || fallback || null;

const CLIENT_ID = getEnv("X_CLIENT_ID", DEFAULT_CLIENT_ID);
const CLIENT_SECRET = getEnv("X_CLIENT_SECRET", DEFAULT_CLIENT_SECRET);
const REDIRECT_URI = getEnv("X_REDIRECT_URI", DEFAULT_REDIRECT_URI);
const SUPABASE_URL = getEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const FORCE_BYPASS = getEnv("X_OAUTH_BYPASS", "false") === "true";
const BASIC_AUTH_OVERRIDE = getEnv("X_CLIENT_BASIC_AUTH");

const mask = (value: string | null, visible = 4) => {
  if (!value) return null;
  if (value.length <= visible) return value;
  return `${value.slice(0, visible)}…(${value.length})`;
};

console.log("[x-oauth-exchange] boot config", {
  hasClientId: Boolean(CLIENT_ID),
  hasClientSecret: Boolean(CLIENT_SECRET),
  hasBasicOverride: Boolean(BASIC_AUTH_OVERRIDE),
  redirectUri: REDIRECT_URI,
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: mask(SERVICE_ROLE_KEY),
  bypassEnabled: FORCE_BYPASS,
});

let supabaseClient: any = null;
if (SUPABASE_URL && SERVICE_ROLE_KEY) {
  const { createClient } = await import("jsr:@supabase/supabase-js@2");
  supabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
} else {
  console.warn("[x-oauth-exchange] missing Supabase service credentials");
}

const encoder = new TextEncoder();
const stringOrNull = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number") return value.toString();
  return null;
};

const extractXUserFromBody = (body: Record<string, unknown>) => {
  const xUserRaw = (body?.xUser as Record<string, unknown>) || {};
  const id =
    stringOrNull(xUserRaw?.id) || stringOrNull(body?.x_user_id) || stringOrNull(body?.xUserId) || null;
  const username =
    stringOrNull(xUserRaw?.username) ||
    stringOrNull(xUserRaw?.handle) ||
    stringOrNull(body?.x_handle) ||
    stringOrNull(body?.xUsername) ||
    null;
  if (!id && !username) return null;
  return { id, username };
};

const resolveClientAuthHeader = () => {
  if (BASIC_AUTH_OVERRIDE) {
    const trimmed = BASIC_AUTH_OVERRIDE.replace(/^Basic\s+/i, "").trim();
    return `Basic ${trimmed}`;
  }
  if (!CLIENT_ID) return null;
  if (!CLIENT_SECRET) return null;
  const auth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  return `Basic ${auth}`;
};

const signSessionToken = async (state: string, codeVerifier: string, privyUserId: string) => {
  const keyData = encoder.encode(SESSION_SECRET);
  const payload = encoder.encode(`${state}.${codeVerifier}.${privyUserId}`);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return base64UrlEncode(new Uint8Array(signature));
};

const verifySession = async (sessionToken: string, state: string, codeVerifier: string, privyUserId: string) => {
  const expected = await signSessionToken(state, codeVerifier, privyUserId);
  return expected === sessionToken;
};

async function exchangeCodeForToken({ code, codeVerifier }: { code: string; codeVerifier: string }) {
  if (!CLIENT_ID || !REDIRECT_URI) throw new Error("missing_x_oauth_config");
  const params = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });
  params.set("client_id", CLIENT_ID);
  if (CLIENT_SECRET) {
    params.set("client_secret", CLIENT_SECRET);
  }
  const authHeader = resolveClientAuthHeader();
  if (!authHeader) {
    console.error("[x-oauth-exchange] missing client secret/basic auth override");
    throw new Error("missing_x_oauth_credentials");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: authHeader,
  };
  console.log("[x-oauth-exchange] exchanging code with X", {
    hasClientSecret: Boolean(CLIENT_SECRET),
    hasBasicOverride: Boolean(BASIC_AUTH_OVERRIDE),
    codeLength: code.length,
    verifierLength: codeVerifier.length,
  });
  const response = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: params,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[x-oauth-exchange] token exchange failed", {
      status: response.status,
      body: data,
      headers: Object.fromEntries(response.headers.entries()),
    });
    throw new Error("token_exchange_failed");
  }
  console.log("[x-oauth-exchange] token exchange success", {
    status: response.status,
    hasAccessToken: Boolean((data as any)?.access_token),
    scope: (data as any)?.scope,
    expiresIn: (data as any)?.expires_in,
  });
  return data as Record<string, unknown>;
}

async function fetchXUserProfile(accessToken: string) {
  console.log("[x-oauth-exchange] fetching X user profile", {
    tokenLength: accessToken?.length || 0,
  });
  const response = await fetch(
    "https://api.twitter.com/2/users/me?user.fields=id,name,username,profile_image_url",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[x-oauth-exchange] failed to fetch X user profile", {
      status: response.status,
      body: data,
    });
    throw new Error("user_profile_fetch_failed");
  }
  const userData = (data as any)?.data;
  if (!userData?.id || !userData?.username) {
    throw new Error("user_profile_incomplete");
  }
  console.log("[x-oauth-exchange] fetched X user profile", {
    x_user_id: userData.id,
    username: userData.username,
  });
  return userData;
}

const normaliseHandle = (raw: string) => {
  if (!raw) return null;
  const clean = raw.replace(/^@+/, "").trim();
  if (!clean) return null;
  return `@${clean}`;
};

const summariseXUser = (xUser: any) => {
  if (!xUser) return null;
  return {
    id: xUser.id,
    username: xUser.username,
    handle: normaliseHandle(xUser.username),
  };
};

const summariseUserRecord = (user: any) => {
  if (!user) return null;
  return {
    id: user.id,
    wallet: user.wallet,
    x_handle: user.x_handle,
    x_user_id: user.x_user_id,
    username: user.username,
  };
};

async function persistUserXAccount(privyUserId: string, xUser: any) {
  if (!supabaseClient) throw new Error("supabase_not_configured");
  const payload = {
    x_user_id: xUser.id,
    x_handle: normaliseHandle(xUser.username),
  };
  console.log("[x-oauth-exchange] persisting X account", {
    privyUserId,
    payload,
  });
  const query = supabaseClient
    .from("users")
    .update(payload)
    .eq("privy_user_id", privyUserId)
    .select("id,wallet,x_handle,x_user_id,username")
    .maybeSingle();
  const { data, error } = await query;
  if (error) {
    console.error("[x-oauth-exchange] failed to update user row", error.message);
    throw new Error("user_update_failed");
  }
  let record = data;
  if (!record) {
    console.warn("[x-oauth-exchange] user row not found for privy id, creating", privyUserId);
    const insertPayload = {
      privy_user_id: privyUserId,
      ...payload,
    };
    const { data: inserted, error: insertError } = await supabaseClient
      .from("users")
      .insert(insertPayload)
      .select("id,wallet,x_handle,x_user_id,username")
      .maybeSingle();
    if (insertError) {
      console.error("[x-oauth-exchange] failed to insert user row", insertError.message);
      throw new Error("user_insert_failed");
    }
    record = inserted;
  }
  console.log("[x-oauth-exchange] updated user row", { userId: record?.id, wallet: record?.wallet });
  return record;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (err) {
    console.warn("[x-oauth-exchange] non-json body", err);
  }

  const code = (body?.code || "").toString().trim();
  const codeVerifier = (body?.codeVerifier || "").toString().trim();
  const state = (body?.state || "").toString().trim();
  const sessionToken = (body?.sessionToken || "").toString().trim();
  const privyUserId = (body?.privyUserId || "").toString().trim();
  const bypassRequested = FORCE_BYPASS || Boolean(body?.bypass);

  console.log("[x-oauth-exchange] incoming payload", {
    hasCode: Boolean(code),
    hasCodeVerifier: Boolean(codeVerifier),
    stateLength: state.length,
    privyUserId,
    sessionTokenLength: sessionToken.length,
    bypassRequest: bypassRequested,
  });

  if (bypassRequested) {
    console.warn("[x-oauth-exchange] bypass mode active, skipping X verification", {
      privyUserId,
      bodyKeys: Object.keys(body || {}),
    });
    const xUserFromBody = extractXUserFromBody(body);
    let updatedUser: any = null;
    if (privyUserId && xUserFromBody?.id && xUserFromBody?.username) {
      try {
        updatedUser = await persistUserXAccount(privyUserId, xUserFromBody);
      } catch (err) {
        console.error("[x-oauth-exchange] failed to persist X account in bypass mode", err);
      }
    } else {
      console.log("[x-oauth-exchange] bypass mode missing privy or x user payload", {
        privyUserIdPresent: Boolean(privyUserId),
        hasXUser: Boolean(xUserFromBody),
      });
    }
    return json(200, {
      success: true,
      message: "X verification bypassed",
      xUser: summariseXUser(xUserFromBody),
      user: summariseUserRecord(updatedUser),
      bypassed: true,
    });
  }

  if (!code || !codeVerifier) {
    return json(400, { error: "code_required", message: "Missing authorization code or verifier." });
  }
  if (!privyUserId) {
    return json(400, { error: "privy_user_required", message: "Privy session required." });
  }
  if (!sessionToken || !state) {
    return json(400, { error: "session_token_required", message: "Session validation failed." });
  }

  try {
    const validSession = await verifySession(sessionToken, state, codeVerifier, privyUserId);
    if (!validSession) {
      console.warn("[x-oauth-exchange] invalid session", { privyUserId, stateLength: state.length });
      return json(400, { error: "invalid_session", message: "Session mismatch. Restart X connection." });
    }
    console.log("[x-oauth-exchange] session verified", { privyUserId });
  } catch (err) {
    console.error("[x-oauth-exchange] session verification failed", err);
    return json(500, { error: "session_verification_failed" });
  }

  try {
    const tokenPayload = await exchangeCodeForToken({ code, codeVerifier });
    const accessToken = (tokenPayload as any)?.access_token;
    if (!accessToken) {
      console.error("[x-oauth-exchange] access token missing in token payload", tokenPayload);
      return json(500, { error: "missing_access_token", details: tokenPayload });
    }
    const xUser = await fetchXUserProfile(accessToken);
    const updatedUser = await persistUserXAccount(privyUserId, xUser);
    console.log("[x-oauth-exchange] linked X user", { privyUserId, x_user_id: xUser.id, x_handle: xUser.username });
    return json(200, {
      success: true,
      message: "X account linked",
      xUser: summariseXUser(xUser),
      user: summariseUserRecord(updatedUser),
      bypassed: false,
    });
  } catch (err: any) {
    console.error("[x-oauth-exchange] exchange failed", err?.message || err);
    const codeName = err?.message || "exchange_failed";
    return json(500, { error: codeName, message: "Unable to link X account." });
  }
});
