// Supabase Edge Function: x-oauth-start
// Generates an OAuth 2.0 Authorization Code (PKCE) URL for X using
// hard-coded configuration values as requested.

import { encode as base64UrlEncode } from "https://deno.land/std@0.208.0/encoding/base64url.ts";

const AUTH_BASE_URL = "https://x.com/i/oauth2/authorize";
const CLIENT_ID = "dTJGTzhNb1NQRi1SY2hZY1EtYjA6MTpjaQ";
const REDIRECT_URI = "https://picks.run/x/callback";
const SCOPE = "tweet.read users.read offline.access";
const AUDIENCE = "https://api.x.com/2/";
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

const randomBytesBase64Url = (length: number) => {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr);
};

const sha256Base64Url = async (input: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
};

const signSessionToken = async (state: string, codeVerifier: string, wallet: string, secret: string) => {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = encoder.encode(`${state}.${codeVerifier}.${wallet}`);
  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return base64UrlEncode(new Uint8Array(signature));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let payload: { privyUserId?: string } | null = null;
  try {
    payload = await req.json();
  } catch (_) {
    payload = null;
  }

  const privyUserId = payload?.privyUserId?.trim();
  if (!privyUserId) {
    return json(400, { error: "Privy user id is required to start X authorization" });
  }

  try {
    const state = randomBytesBase64Url(32);
    const codeVerifier = randomBytesBase64Url(96);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const sessionToken = await signSessionToken(state, codeVerifier, privyUserId, SESSION_SECRET);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    if (AUDIENCE) params.set("audience", AUDIENCE);

    return json(200, {
      authorizeUrl: `${AUTH_BASE_URL}?${params.toString()}`,
      state,
      codeVerifier,
      sessionToken,
      privyUserId,
      redirectUri: REDIRECT_URI,
      scope: SCOPE,
      audience: AUDIENCE,
    });
  } catch (err) {
    console.error("[x-oauth-start] unexpected error", err);
    return json(500, { error: "Failed to generate authorization URL" });
  }
});
