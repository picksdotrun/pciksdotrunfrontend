// Supabase Edge Function: claim-attention-eligibility
// Confirms whether a user replied under the official X poll for a pick.

import { encode as base64Encode } from 'https://deno.land/std@0.208.0/encoding/base64.ts'

type ClaimPayload = {
  pickId?: string
  tweetId?: string | null
  userId?: string | null
  wallet?: string | null
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })

const getEnv = (name: string) => Deno.env.get(name)?.trim() || null

const SUPABASE_URL = getEnv('SUPABASE_URL')
const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY')
const XAI_API_KEY = getEnv('XAI_API_KEY')
const XAI_MODEL = getEnv('XAI_MODEL') || 'grok-4-fast'
let supabaseClient: any = null
if (SUPABASE_URL && SERVICE_ROLE_KEY) {
  const { createClient } = await import('jsr:@supabase/supabase-js@2')
  supabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
} else {
  console.warn('[claim-attention-eligibility] missing service Supabase credentials')
}

type XCredentials = {
  consumerKey: string
  consumerSecret: string
  accessToken: string
  accessSecret: string
}

const xCreds: XCredentials | null = (() => {
  const consumerKey = getEnv('X_CONSUMER_KEY')
  const consumerSecret = getEnv('X_CONSUMER_SECRET')
  const accessToken = getEnv('X_ACCESS_TOKEN')
  const accessSecret = getEnv('X_ACCESS_TOKEN_SECRET')
  if (consumerKey && consumerSecret && accessToken && accessSecret) {
    return { consumerKey, consumerSecret, accessToken, accessSecret }
  }
  console.warn('[claim-attention-eligibility] missing X credentials')
  return null
})()

const percentEncode = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

const buildAuthHeader = (params: Record<string, string>) =>
  'OAuth ' +
  Object.entries(params)
    .map(([k, v]) => `${k}="${percentEncode(v)}"`)
    .join(', ')

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
    .join('&')

  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(sorted)].join('&')
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`

  const encoder = new TextEncoder()
  const keyData = encoder.encode(signingKey)
  const message = encoder.encode(baseString)

  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message)
  return base64Encode(new Uint8Array(signature))
}

async function createOAuthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  extraParams: Record<string, string> = {},
) {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  }

  const signature = await generateSignature(method, url, { ...extraParams, ...oauthParams }, creds.consumerSecret, creds.accessSecret)
  oauthParams.oauth_signature = signature
  return buildAuthHeader(oauthParams)
}

const sanitizeHandle = (raw: string | null | undefined) => {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.replace(/^@+/, '').trim()
  if (!trimmed) return null
  return trimmed
}

async function fetchUserRecord(userId?: string | null, wallet?: string | null) {
  if (!supabaseClient) throw new Error('Service Supabase client unavailable')
  const normalizedWallet = wallet ? wallet.toString().toLowerCase() : null
  if (!userId && !normalizedWallet) throw new Error('user_identifier_required')
  let query = supabaseClient
    .from('users')
    .select('id,wallet,x_handle,x_user_id,username')
    .limit(1)
  if (userId) {
    query = query.eq('id', userId)
  } else if (normalizedWallet) {
    query = query.eq('wallet', normalizedWallet)
  }
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

async function fetchPickRecord(pickId: string) {
  if (!supabaseClient) throw new Error('Service Supabase client unavailable')
  const { data, error } = await supabaseClient
    .from('picks')
    .select('id,name,x_tweet_id,status,expires_at,yes_label,no_label,description')
    .eq('id', pickId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function fetchTweetConversationId(tweetId: string) {
  if (!xCreds) throw new Error('Missing X credentials')
  const method = 'GET'
  const endpoint = `https://api.twitter.com/2/tweets/${tweetId}`
  const params = new URLSearchParams({
    'tweet.fields': 'conversation_id,referenced_tweets,edit_history_tweet_ids',
  })
  const paramObject: Record<string, string> = {}
  params.forEach((value, key) => {
    paramObject[key] = value
  })
  const authHeader = await createOAuthHeader(method, endpoint, xCreds, paramObject)
  const url = `${endpoint}?${params.toString()}`
  console.log('[claim-attention-eligibility] fetching tweet details', { tweetId, url })
  const response = await fetch(url, { method, headers: { Authorization: authHeader } })
  const bodyText = await response.text()
  let data: any = null
  try {
    data = JSON.parse(bodyText)
  } catch (err) {
    console.warn('[claim-attention-eligibility] tweet details parse error', err)
  }
  if (!response.ok) {
    console.error('[claim-attention-eligibility] tweet details error', response.status, bodyText)
    return null
  }
  const conversationId = data?.data?.conversation_id || null
  const editHistory = Array.isArray((data?.data as any)?.edit_history_tweet_ids)
    ? ((data as any).data.edit_history_tweet_ids as string[])
    : null
  const resolvedConversation = editHistory && editHistory.length ? editHistory[editHistory.length - 1] : conversationId
  console.log('[claim-attention-eligibility] tweet details result', {
    tweetId,
    conversationId,
    resolvedConversation,
    editHistorySize: editHistory?.length || 0,
  })
  return resolvedConversation ? resolvedConversation.toString() : conversationId?.toString() || null
}

async function searchRepliesForHandle(tweetId: string, handle?: string | null, nextToken?: string | null) {
  if (!xCreds) throw new Error('Missing X credentials')
  const method = 'GET'
  const endpoint = 'https://api.twitter.com/2/tweets/search/recent'
  const parts = [`conversation_id:${tweetId}`]
  if (handle) parts.push(`from:${handle}`)
  const queryParam = parts.join(' ')
  const params = new URLSearchParams({
    query: queryParam,
    'tweet.fields': 'author_id,conversation_id,created_at,text,public_metrics',
    expansions: 'author_id',
    'user.fields': 'id,name,username,profile_image_url',
    max_results: '100',
  })
  if (nextToken) {
    params.set('next_token', nextToken)
  }
  const paramObject: Record<string, string> = {}
  params.forEach((value, key) => {
    paramObject[key] = value
  })
  const authHeader = await createOAuthHeader(method, endpoint, xCreds, paramObject)
  const url = `${endpoint}?${params.toString()}`
  console.log('[claim-attention-eligibility] querying X API', { url, query: queryParam })
  const response = await fetch(url, {
    method,
    headers: { Authorization: authHeader },
  })
  const bodyText = await response.text()
  console.log('[claim-attention-eligibility] X API response', {
    status: response.status,
    ok: response.ok,
    body: bodyText,
  })
  let data: Record<string, unknown> | null = null
  try {
    data = JSON.parse(bodyText)
  } catch (err) {
    console.warn('[claim-attention-eligibility] non-json reply from X', err)
  }
  if (!response.ok) {
    console.error('[claim-attention-eligibility] X API error', response.status, bodyText)
    return { error: 'x_api_error', status: response.status, data }
  }
  const tweets = Array.isArray((data as any)?.data) ? ((data as any).data as any[]) : []
  const includes = (data as any)?.includes || {}
  const meta = (data as any)?.meta || {}
  return { tweets, includes, meta }
}

async function fetchUserTimelineTweets(userId: string) {
  if (!xCreds) throw new Error('Missing X credentials')
  const method = 'GET'
  const endpoint = `https://api.twitter.com/2/users/${userId}/tweets`
  const params = new URLSearchParams({
    max_results: '100',
    'tweet.fields': 'author_id,conversation_id,created_at,text,public_metrics,in_reply_to_user_id,referenced_tweets',
    expansions: 'author_id',
    'user.fields': 'id,name,username,profile_image_url',
  })
  const paramObject: Record<string, string> = {}
  params.forEach((value, key) => {
    paramObject[key] = value
  })
  const authHeader = await createOAuthHeader(method, endpoint, xCreds, paramObject)
  const url = `${endpoint}?${params.toString()}`
  console.log('[claim-attention-eligibility] fetching user timeline', { userId, url })
  const response = await fetch(url, {
    method,
    headers: { Authorization: authHeader },
  })
  const bodyText = await response.text()
  console.log('[claim-attention-eligibility] user timeline response', {
    status: response.status,
    ok: response.ok,
    body: bodyText,
  })
  let data: Record<string, unknown> | null = null
  try {
    data = JSON.parse(bodyText)
  } catch (err) {
    console.warn('[claim-attention-eligibility] non-json timeline reply from X', err)
  }
  if (!response.ok) {
    console.error('[claim-attention-eligibility] user timeline error', response.status, bodyText)
    return { error: 'timeline_error', status: response.status, data }
  }
  const tweets = Array.isArray((data as any)?.data) ? ((data as any).data as any[]) : []
  const includes = (data as any)?.includes || {}
  const meta = (data as any)?.meta || {}
  return { tweets, includes, meta }
}

async function fetchConversationThread(tweetId: string, maxPages = 6) {
  const aggregated: any = { tweets: [], includes: { users: [] }, meta: { result_count: 0, pages: 0 } }
  const seenUserIds = new Set<string>()
  let nextToken: string | null | undefined = null
  for (let page = 0; page < maxPages; page++) {
    const pageResult = await searchRepliesForHandle(tweetId, null, nextToken || undefined)
    if ('error' in pageResult && pageResult.error) {
      return pageResult
    }
    aggregated.tweets.push(...(pageResult.tweets || []))
    if (Array.isArray(pageResult?.includes?.users)) {
      for (const u of pageResult.includes.users) {
        if (u?.id && !seenUserIds.has(u.id)) {
          seenUserIds.add(u.id)
          aggregated.includes.users.push(u)
        }
      }
    }
    aggregated.meta.result_count += pageResult?.meta?.result_count || 0
    aggregated.meta.pages += 1
    aggregated.meta.next_token = pageResult?.meta?.next_token || null
    if (!pageResult?.meta?.next_token) break
    nextToken = pageResult.meta.next_token
  }
  return aggregated
}

const buildConversationEntries = (tweets: any[], includes: any) => {
  const users = Array.isArray(includes?.users) ? includes.users : []
  const userMap = new Map<string, any>()
  for (const user of users) {
    if (user?.id) userMap.set(user.id.toString(), user)
  }
  return (Array.isArray(tweets) ? tweets : []).map((tweet: any) => {
    const authorId = tweet?.author_id ? tweet.author_id.toString() : null
    const authorUser = authorId ? userMap.get(authorId) : null
    return {
      id: tweet?.id,
      text: tweet?.text || '',
      created_at: tweet?.created_at || null,
      author_id: authorId,
      username: typeof authorUser?.username === 'string' ? authorUser.username : null,
      conversation_id: tweet?.conversation_id || null,
    }
  })
}

function extractUserReplies({ tweets, includes }: any, user: any, fallbackHandle?: string | null) {
  if (!Array.isArray(tweets) || !tweets.length) return []
  const normalizedHandle = sanitizeHandle(fallbackHandle || user?.x_handle)
  const handleLower = normalizedHandle ? normalizedHandle.toLowerCase() : null
  const targetUserId = user?.x_user_id ? user.x_user_id.toString() : null
  const includeUsers = Array.isArray(includes?.users) ? includes.users : []
  const userIdSet = new Set<string>()
  if (targetUserId) userIdSet.add(targetUserId)
  if (handleLower) {
    for (const u of includeUsers) {
      const uname = typeof u?.username === 'string' ? u.username.toLowerCase() : ''
      if (uname === handleLower && u?.id) {
        userIdSet.add(u.id.toString())
      }
    }
  }
  return tweets
    .filter((tweet: any) => {
      if (!tweet || typeof tweet !== 'object') return false
      if (!userIdSet.size) return false
      const authorId = tweet?.author_id ? tweet.author_id.toString() : null
      return authorId ? userIdSet.has(authorId) : false
    })
    .map((tweet: any) => ({
      id: tweet?.id,
      text: tweet?.text || '',
      created_at: tweet?.created_at || null,
      author_id: tweet?.author_id || null,
      conversation_id: tweet?.conversation_id || null,
      public_metrics: tweet?.public_metrics || null,
    }))
}

const FALLBACK_YES = ['yes', 'y', 'yeah', 'yup', 'ya', 'sure', 'affirmative', '✅', '☑️', '👍', '1']
const FALLBACK_NO = ['no', 'n', 'nope', 'nah', 'negative', '❌', '🚫', '👎', '0']

function simpleHeuristicClassification(replyText: string | null | undefined) {
  if (!replyText) return null
  const lower = replyText.toLowerCase()
  const contains = (list: string[]) => list.some((token) => lower.includes(token))
  const yes = contains(FALLBACK_YES)
  const no = contains(FALLBACK_NO)
  if (yes && !no) return 'yes'
  if (no && !yes) return 'no'
  return null
}

function parseJsonSnippet(text: string | null | undefined) {
  if (!text) return null
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch (err) {
    console.warn('[claim-attention-eligibility] failed to parse Grok JSON', err)
    return null
  }
}

async function classifyReplyWithGrok({
  conversation,
  userReplies,
  pick,
  handle,
  userId,
}: {
  conversation: any[]
  userReplies: any[]
  pick: any
  handle: string
  userId?: string | null
}) {
  if (!Array.isArray(conversation) || !conversation.length) {
    return { eligible: false, choice: null, reason: 'no_conversation_data', replyText: null, confidence: 0 }
  }

  const fallbackReply = userReplies[0]?.text || null
  const fallbackChoice = simpleHeuristicClassification(fallbackReply)
  if (!XAI_API_KEY) {
    return {
      eligible: Boolean(fallbackChoice),
      choice: fallbackChoice,
      reason: fallbackChoice ? 'heuristic_without_grok' : 'unable_to_parse',
      replyText: fallbackReply,
      confidence: fallbackChoice ? 0.5 : 0,
    }
  }

  const conversationSummary = conversation
    .slice(-80)
    .map((entry, idx) => {
      const ts = entry?.created_at || 'unknown time'
      const author = entry?.username ? `@${entry.username}` : entry?.author_id || 'unknown_author'
      return `${idx + 1}. [${ts}] author:${author} id:${entry?.id || 'unknown_id'} => ${entry?.text || ''}`
    })
    .join('\n')

  const pollPrompt = pick?.name || 'Prediction market'
  const yesLabel = pick?.yes_label || 'YES'
  const noLabel = pick?.no_label || 'NO'
  const description = pick?.description || ''

  const systemMessage = {
    role: 'system',
    content: [
      {
        type: 'text',
        text: [
          'You analyze replies beneath a binary prediction poll (YES/NO).',
          'A user may type words, emojis, or statements like "let\'s go".',
          'Determine if the reply indicates YES or NO. If neither, mark not eligible.',
          'Return ONLY JSON shaped like {"eligible":true|false,"choice":"yes"|"no"|null,"reason":"short","confidence":0-1,"matched_reply_id":"tweet_id_or_null","matched_reply_text":"string_or_null"}.',
          'Use lowercase yes/no. If unsure, set eligible:false and choice:null.',
          'If you cannot find a reply from the specified target user, set eligible:false and matched_reply_id:null.',
        ].join('\n'),
      },
    ],
  }

  const userContent = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: [
          `Poll prompt: ${pollPrompt}`,
          description ? `Description: ${description}` : null,
          `YES option label: ${yesLabel}`,
          `NO option label: ${noLabel}`,
          `Target user handle: @${handle}`,
          userId ? `Target user id: ${userId}` : null,
          'Full conversation transcript (latest entries last):',
          conversationSummary,
          'Return strict JSON only.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  }

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: XAI_MODEL || 'grok-4-fast',
        messages: [systemMessage, userContent],
        temperature: 0.1,
        max_tokens: 180,
      }),
    })
    const textBody = await response.text()
    let parsed: any = null
    try {
      const jsonBody = JSON.parse(textBody)
      const content = jsonBody?.choices?.[0]?.message?.content || jsonBody?.content || ''
      parsed = typeof content === 'string' ? parseJsonSnippet(content) : null
    } catch (err) {
      console.warn('[claim-attention-eligibility] Grok response parse error', err)
      parsed = parseJsonSnippet(textBody)
    }
    if (parsed && typeof parsed === 'object') {
      const choiceRaw = typeof parsed.choice === 'string' ? parsed.choice.toLowerCase() : null
      const choice = choiceRaw === 'yes' || choiceRaw === 'no' ? choiceRaw : null
      const eligible = Boolean(parsed.eligible && choice)
      const matchedReplyId = typeof parsed.matched_reply_id === 'string' ? parsed.matched_reply_id : null
      const matchedReplyText =
        typeof parsed.matched_reply_text === 'string' && parsed.matched_reply_text.trim()
          ? parsed.matched_reply_text
          : fallbackReply
      return {
        eligible,
        choice,
        reason: parsed.reason || 'classified_by_grok',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        replyText: matchedReplyText,
        matchedReplyId,
      }
    }
  } catch (err) {
    console.error('[claim-attention-eligibility] Grok classification failed', err)
  }

  return {
    eligible: Boolean(fallbackChoice),
    choice: fallbackChoice,
    reason: fallbackChoice ? 'heuristic_fallback' : 'unable_to_parse',
    replyText: fallbackReply,
    confidence: fallbackChoice ? 0.3 : 0,
    matchedReplyId: null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  if (!supabaseClient) {
    return json(500, { error: 'supabase_not_configured', message: 'Service client unavailable' })
  }
  if (!xCreds) {
    return json(500, { error: 'x_credentials_missing', message: 'X credentials missing on server' })
  }

  let payload: ClaimPayload = {}
  try {
    payload = (await req.json()) as ClaimPayload
  } catch (err) {
    console.warn('[claim-attention-eligibility] non-json payload', err)
  }
  console.log('[claim-attention-eligibility] incoming payload', payload)

  const pickId = payload?.pickId?.toString().trim()
  if (!pickId) return json(400, { error: 'pickId_required' })

  let userRow: any
  try {
    userRow = await fetchUserRecord(payload?.userId, payload?.wallet)
  } catch (err: any) {
    console.error('[claim-attention-eligibility] user lookup failed', err?.message || err)
    if (err?.message === 'user_identifier_required') {
      return json(400, { error: 'user_identifier_required', message: 'Wallet or user id required.' })
    }
    return json(400, { error: 'user_lookup_failed', details: err?.message || String(err) })
  }
  if (!userRow) {
    return json(404, { error: 'user_not_found', message: 'User profile not found.' })
  }
  console.log('[claim-attention-eligibility] user row', {
    id: userRow?.id,
    wallet: userRow?.wallet,
    x_handle: userRow?.x_handle,
    x_user_id: userRow?.x_user_id,
    username: userRow?.username,
  })

  const normalizedHandle = sanitizeHandle(userRow?.x_handle)
  if (!normalizedHandle) {
    return json(400, { error: 'x_handle_missing', message: 'Connect your X account before claiming.' })
  }

  let pickRow: any
  try {
    pickRow = await fetchPickRecord(pickId)
  } catch (err: any) {
    console.error('[claim-attention-eligibility] pick lookup failed', err?.message || err)
    return json(400, { error: 'pick_lookup_failed', details: err?.message || String(err) })
  }
  if (!pickRow) {
    return json(404, { error: 'pick_not_found', message: 'Prediction not found.' })
  }
  console.log('[claim-attention-eligibility] pick row', {
    id: pickRow?.id,
    name: pickRow?.name,
    status: pickRow?.status,
    expires_at: pickRow?.expires_at,
    tweet_id: pickRow?.x_tweet_id,
  })

  const tweetIdSource = pickRow?.x_tweet_id || payload?.tweetId || ''
  const tweetId = tweetIdSource.toString().trim()
  if (!tweetId) {
    return json(400, {
      error: 'missing_x_tweet_id',
      message: 'This prediction has not been linked to an X poll yet. Please try again soon.',
    })
  }
  const resolvedConversationId = (await fetchTweetConversationId(tweetId)) || tweetId
  console.log('[claim-attention-eligibility] using tweet id', tweetId, 'conversation id', resolvedConversationId, 'handle', normalizedHandle)

  try {
    const conversationResult: any = await fetchConversationThread(resolvedConversationId)
    if ('error' in conversationResult && conversationResult.error) {
      return json(502, { error: conversationResult.error, details: conversationResult.data || null, status: conversationResult.status })
    }
    console.log('[claim-attention-eligibility] conversation meta', conversationResult?.meta || null)
    let conversationEntries = buildConversationEntries(conversationResult?.tweets || [], conversationResult?.includes || {})
    let userReplies = extractUserReplies(conversationResult, userRow, normalizedHandle)
    let meta = conversationResult?.meta || {}
    if (!userReplies.length && userRow?.x_user_id) {
      const timelineResult = await fetchUserTimelineTweets(userRow.x_user_id.toString())
      if ('error' in timelineResult && timelineResult.error) {
        console.warn('[claim-attention-eligibility] timeline fetch error', timelineResult)
      } else {
        console.log('[claim-attention-eligibility] timeline meta', timelineResult?.meta || null)
        const timelineTweets = Array.isArray(timelineResult?.tweets) ? timelineResult.tweets : []
        const filteredTimeline = timelineTweets.filter((tweet: any) => {
          if (!tweet || typeof tweet !== 'object') return false
          const authorId = tweet?.author_id ? tweet.author_id.toString() : null
          if (!authorId || authorId !== userRow.x_user_id?.toString()) return false
          const conversationMatch = tweet?.conversation_id?.toString() === resolvedConversationId
          const referencedMatch = Array.isArray(tweet?.referenced_tweets)
            ? tweet.referenced_tweets.some((ref: any) => {
                const refId = ref?.id ? ref.id.toString() : null
                if (!refId) return false
                return refId === resolvedConversationId || refId === tweetId
              })
            : false
          return conversationMatch || referencedMatch
        })
        if (filteredTimeline.length) {
          userReplies = filteredTimeline.map((tweet: any) => ({
            id: tweet?.id,
            text: tweet?.text || '',
            created_at: tweet?.created_at || null,
            author_id: tweet?.author_id || null,
            conversation_id: tweet?.conversation_id || null,
          }))
          meta = timelineResult?.meta || meta
          if (!conversationEntries.length) {
            conversationEntries = buildConversationEntries(timelineTweets, timelineResult?.includes || {})
          }
        }
      }
    }

    if (!userReplies.length && !conversationEntries.length) {
      return json(200, {
        success: false,
        eligible: false,
        message: 'No reply detected yet. Reply “YES” or “NO” under the poll and try again.',
        tweetId,
        handle: `@${normalizedHandle}`,
        repliesChecked: meta?.result_count ?? conversationEntries.length,
      })
    }

    console.log('[claim-attention-eligibility] user replies sample', userReplies.slice(0, 2))
    const classification = await classifyReplyWithGrok({
      conversation: conversationEntries,
      userReplies,
      pick: pickRow,
      handle: normalizedHandle,
      userId: userRow?.x_user_id ? userRow.x_user_id.toString() : null,
    })
    console.log('[claim-attention-eligibility] classification result', classification)
    const matchedConversationEntry = classification?.matchedReplyId
      ? conversationEntries.find((entry) => entry?.id === classification.matchedReplyId)
      : null
    const replyText = classification.replyText || matchedConversationEntry?.text || userReplies[0]?.text || null
    const repliedAt = matchedConversationEntry?.created_at || userReplies[0]?.created_at || null
    const success = Boolean(classification.eligible && classification.choice)
    const message = success
      ? `Eligible — detected ${classification.choice?.toUpperCase()} reply`
      : 'Reply detected but unable to read a clear YES/NO. Try again with a simple YES or NO reply.'

    return json(200, {
      success,
      eligible: classification.eligible,
      choice: classification.choice,
      message,
      reply: replyText,
      replied_at: repliedAt,
      confidence: classification.confidence,
      reason: classification.reason,
      tweetId,
      handle: `@${normalizedHandle}`,
      repliesChecked: meta?.result_count ?? conversationEntries.length,
    })
  } catch (err: any) {
    console.error('[claim-attention-eligibility] reply search failed', err?.message || err)
    return json(500, { error: 'reply_lookup_failed', message: 'Failed to verify replies. Please try again.' })
  }
})
