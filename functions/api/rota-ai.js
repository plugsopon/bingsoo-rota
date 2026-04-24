/**
 * Cloudflare Pages Function — /api/rota-ai
 * Proxies requests to Anthropic Claude API.
 * Verifies Supabase session before forwarding.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUPABASE_URL = 'https://psxcnlymrttedipuonac.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Kr3F8IwLFSHJRkGmVf86Kw_gmra-svY';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // ── 1. Auth: verify Supabase session ──────────────────────────────
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.slice(7);

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_KEY,
      },
    });
    if (!userRes.ok) {
      return json({ error: 'Unauthorized – invalid session' }, 401);
    }

    // ── 2. Parse request body ─────────────────────────────────────────
    const body = await request.json();
    const { messages, system } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return json({ error: 'messages array is required' }, 400);
    }

    // ── 3. Check API key ──────────────────────────────────────────────
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return json({ error: 'ANTHROPIC_API_KEY not configured on server' }, 500);
    }

    // ── 4. Discover available model then call Claude API ─────────────
    // Try models in order until one works
    const modelsToTry = [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-haiku-20240307',
      'claude-3-sonnet-20240229',
    ];

    // First, get the list of available models to pick the best one
    let chosenModel = modelsToTry[0];
    try {
      const modelsRes = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        const available = (modelsData.data || []).map(m => m.id);
        // Prefer haiku (cheapest), then sonnet
        const preferred = available.find(id => id.includes('haiku')) ||
                          available.find(id => id.includes('sonnet')) ||
                          available[0];
        if (preferred) chosenModel = preferred;
      }
    } catch (_) { /* use default */ }

    // 90s timeout — full ROTA generation (9 staff × 7 days + reasoning +
    // summary + rota_json block) regularly takes 60-80s on Haiku.
    const claudeController = new AbortController();
    const claudeTimeout = setTimeout(() => claudeController.abort(), 90_000);

    let claudeRes;
    try {
      claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: claudeController.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: chosenModel,
          max_tokens: 8192,
          system: system || 'You are a helpful ROTA scheduling assistant for Bingsoo Cafe, a dessert cafe in the UK.',
          messages,
        }),
      });
    } finally {
      clearTimeout(claudeTimeout);
    }

    const claudeData = await claudeRes.json();

    // If error from Anthropic, return full error details for debugging
    if (!claudeRes.ok) {
      return json({
        error: `[model: ${chosenModel}] ${claudeData?.error?.message || JSON.stringify(claudeData)}`,
        _debug: { status: claudeRes.status, chosenModel, body: claudeData }
      }, claudeRes.status);
    }

    return new Response(JSON.stringify(claudeData), {
      status: claudeRes.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });

  } catch (err) {
    if (err.name === 'AbortError') {
      return json({ error: 'Request timed out — Claude took too long to respond. Please try again.' }, 504);
    }
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
