// Supabase Edge Function: post-to-x
// Posts a newly launched prediction market to the Picks X account using OAuth 1.0a user context.
// Requires the following secrets via environment variables:
// - X_CONSUMER_KEY
// - X_CONSUMER_SECRET
// - X_ACCESS_TOKEN
// - X_ACCESS_TOKEN_SECRET
// Optional:
// - X_POST_PREFIX
// - X_POST_SUFFIX

import { encode as base64Encode } from "https://deno.land/std@0.208.0/encoding/base64.ts";

interface PostBody {
  pickId?: string;
  title?: string;
  line?: string | number | null;
  instructions?: string | null;
  description?: string | null;
  yes_label?: string | null;
  yes_value?: string | null;
  no_label?: string | null;
  no_value?: string | null;
  url?: string | null;
  image?: string | null;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const trimTo280 = (text: string) =>
  text.length <= 280 ? text : `${text.slice(0, 277)}…`;

const percentEncode = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

const buildAuthHeader = (params: Record<string, string>) =>
  "OAuth " +
  Object.entries(params)
    .map(([k, v]) => `${k}="${percentEncode(v)}"`)
    .join(", ");

type OAuthCredentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessSecret: string;
};

async function generateSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
) {
  const sorted = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sorted),
  ].join("&");

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingKey);
  const message = encoder.encode(baseString);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, message);
  return base64Encode(new Uint8Array(signature));
}

async function createOAuthHeader(
  method: string,
  url: string,
  creds: OAuthCredentials,
  extraParams: Record<string, string> = {},
) {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const signature = await generateSignature(
    method,
    url,
    { ...extraParams, ...oauthParams },
    creds.consumerSecret,
    creds.accessSecret,
  );

  oauthParams.oauth_signature = signature;
  return buildAuthHeader(oauthParams);
}

async function uploadImageToX(imageUrl: string | null | undefined, creds: OAuthCredentials) {
  const src = imageUrl?.trim();
  if (!src) return null;

  let imageBytes: Uint8Array;
  let mediaType: string | undefined;

  if (src.startsWith("data:")) {
    const commaIndex = src.indexOf(",");
    if (commaIndex === -1) throw new Error("Invalid data URL for image payload");
    const meta = src.slice(5, commaIndex);
    const base64Data = src.slice(commaIndex + 1);
    const [maybeType] = meta.split(";");
    mediaType = maybeType || undefined;
    const binary = atob(base64Data);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    imageBytes = buffer;
  } else {
    const imageResponse = await fetch(src);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image (${imageResponse.status})`);
    }
    const ct = imageResponse.headers.get("content-type");
    if (ct) mediaType = ct.split(";")[0] || undefined;
    imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
  }

  if (!imageBytes.length) throw new Error("Image download returned empty body");

  const mediaData = base64Encode(imageBytes);
  const uploadEndpoint = "https://upload.twitter.com/1.1/media/upload.json";
  const uploadParams: Record<string, string> = {
    media_data: mediaData,
    media_category: "tweet_image",
  };
  if (mediaType) uploadParams.media_type = mediaType;

  const authHeader = await createOAuthHeader("POST", uploadEndpoint, creds, uploadParams);
  const uploadResponse = await fetch(uploadEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: authHeader,
    },
    body: new URLSearchParams(uploadParams),
  });

  const uploadData = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !uploadData?.media_id_string) {
    console.error("[post-to-x] media upload failed", {
      status: uploadResponse.status,
      body: uploadData,
    });
    throw new Error("Failed to upload media to X");
  }

  console.log("[post-to-x] media upload success", {
    mediaId: uploadData.media_id_string,
    bytes: imageBytes.length,
    mediaType,
  });

  return uploadData.media_id_string as string;
}


Deno.serve(async (req) => {
  console.log("[post-to-x] incoming request", { method: req.method });

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let payload: PostBody;
  try {
    payload = (await req.json()) as PostBody;
  } catch (err) {
    return json(400, { error: "Invalid JSON body", details: String(err?.message || err) });
  }

  const consumerKey = Deno.env.get("X_CONSUMER_KEY")?.trim();
  const consumerSecret = Deno.env.get("X_CONSUMER_SECRET")?.trim();
  const accessToken = Deno.env.get("X_ACCESS_TOKEN")?.trim();
  const accessSecret = Deno.env.get("X_ACCESS_TOKEN_SECRET")?.trim();

  console.log("[post-to-x] secret presence", {
    consumerKey: Boolean(consumerKey),
    consumerSecret: Boolean(consumerSecret),
    accessToken: Boolean(accessToken),
    accessSecret: Boolean(accessSecret),
  });

  if (!consumerKey || !consumerSecret || !accessToken || !accessSecret) {
    return json(500, { error: "Missing X OAuth secrets" });
  }

  const creds: OAuthCredentials = {
    consumerKey,
    consumerSecret,
    accessToken,
    accessSecret,
  };

  const prefix = Deno.env.get("X_POST_PREFIX")?.trim();
  const suffix = Deno.env.get("X_POST_SUFFIX")?.trim();

  const title = (payload.title || "").trim();
  if (!title) return json(400, { error: "title is required" });

  const url = (payload.url || "").trim();
  const description = (payload.description || "").trim();
  const descriptionLine = description ? `Rules: ${description}` : null;
  const instructionsLine =
    `Simply reply "Yes" or "No" underneath this post to instantly place your prediction for free! Claim your earnings as soon as the results are in here: https://picks.run/claim`;

  const segments = [
    prefix,
    "New prediction is live on @picksdotrun",
    descriptionLine,
    instructionsLine,
    url ? `Trade it live: ${url}` : null,
    suffix,
  ].filter(Boolean) as string[];

  const textBody = trimTo280(segments.join("\n\n"));
  console.log("[post-to-x] payload", payload);
  console.log("[post-to-x] composed text", textBody);

  let mediaIds: string[] = [];
  if (payload.image) {
    try {
      const mediaId = await uploadImageToX(payload.image, creds);
      if (mediaId) mediaIds = [mediaId];
    } catch (err) {
      console.error("[post-to-x] media upload error", err);
    }
  }

  const method = "POST";
  const endpoint = "https://api.twitter.com/2/tweets";
  const authHeader = await createOAuthHeader(method, endpoint, creds);

  const tweetPayload: Record<string, unknown> = { text: textBody };
  if (mediaIds.length) {
    tweetPayload.media = { media_ids: mediaIds };
    console.log("[post-to-x] media ids", mediaIds);
  }

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    Authorization: authHeader,
  };

  try {
    const response = await fetch(endpoint, {
      method,
      headers,
      body: JSON.stringify(tweetPayload),
    });

    const data = await response.json().catch(() => ({}));
    console.log("[post-to-x] X response status", response.status, "ok:", response.ok);
    console.log("[post-to-x] X response body", data);

    if (!response.ok) {
      return json(response.status, {
        error: "Failed to post to X",
        details: data,
        composed_text: textBody,
        media_ids: mediaIds,
      });
    }

    return json(200, { success: true, tweet: data, composed_text: textBody, media_ids: mediaIds });
  } catch (err) {
    console.error("[post-to-x] unexpected error", err);
    return json(500, { error: "Unexpected error posting to X", details: String(err?.message || err) });
  }
});
