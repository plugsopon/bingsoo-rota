/**
 * CF Pages Function: /api/fetch-url
 * Fetches any public URL server-side and returns plain text.
 * Used by Context Sources "Note with URL" to pull live content (weather, etc.)
 * into the AI system prompt.
 */

export async function onRequestPost(ctx) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  try {
    // ── Auth check ────────────────────────────────────────────────────────
    const authHeader = ctx.request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const SUPABASE_URL = 'https://psxcnlymrttedipuonac.supabase.co';
    const SUPABASE_KEY = ctx.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Kr3F8IwLFSHJRkGmVf86Kw_gmra-svY';

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
    });
    if (!userRes.ok) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: corsHeaders });
    }

    // ── Parse request ─────────────────────────────────────────────────────
    const { url, maxChars = 4000 } = await ctx.request.json();
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers: corsHeaders });
    }

    // Basic URL validation — must be http/https
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Bad protocol');
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: corsHeaders });
    }

    // ── Fetch the target URL ──────────────────────────────────────────────
    const targetRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BingsooBot/1.0)',
        'Accept': 'text/html,text/plain,application/json,text/csv,*/*',
      },
      redirect: 'follow',
      cf: { cacheEverything: true, cacheTtl: 300 }, // cache 5 min
    });

    if (!targetRes.ok) {
      return new Response(JSON.stringify({
        error: `Could not fetch URL (${targetRes.status} ${targetRes.statusText})`,
      }), { status: 502, headers: corsHeaders });
    }

    const contentType = targetRes.headers.get('content-type') || '';
    let text = await targetRes.text();

    // ── HTML → plain text ─────────────────────────────────────────────────
    if (contentType.includes('html')) {
      text = htmlToText(text);
    }

    // Trim whitespace and cap length
    text = text.replace(/\s{3,}/g, '\n\n').trim();
    if (text.length > maxChars) {
      text = text.slice(0, maxChars) + '\n[…content truncated]';
    }

    return new Response(JSON.stringify({ text, contentType, url }), { status: 200, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
}

// ── Minimal HTML → plain text converter ──────────────────────────────────
function htmlToText(html) {
  return html
    // Remove script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    // Block elements → newlines
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(th|td)[^>]*>/gi, ' | ')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&deg;/g, '°')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    // Clean up whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}
