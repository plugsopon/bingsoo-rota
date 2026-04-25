/**
 * Cloudflare Pages Function — /api/rota-finalize
 *
 * Takes a ROTA draft (prose / markdown table from the chat assistant) plus
 * the original context (staff list, dates, week label) and asks Claude
 * Haiku to convert it into the strict rota_json shape that /api/publish-rota
 * expects.
 *
 * This lets us keep the chat assistant cheap & fast — it never has to
 * write JSON. JSON is generated only when the manager picks a draft to
 * publish.
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
    // 1. Auth
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const token = authHeader.slice(7);
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_KEY },
    });
    if (!userRes.ok) return json({ error: 'Unauthorized — invalid session' }, 401);

    // 2. Body
    const { draftText, ctx } = await request.json();
    if (!draftText || !ctx) return json({ error: 'draftText and ctx are required' }, 400);
    if (!ctx.staff || !ctx.days || !ctx.week_label) {
      return json({ error: 'ctx must include staff, days, week_label' }, 400);
    }

    // 3. API key
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

    // 4. Build a strict, minimal prompt for Haiku
    const staffList = ctx.staff.map(s => `- ${s.name} (${s.role || 'Staff'})`).join('\n');
    const dayList   = ctx.days.map(d => `- ${d.date} (${d.day})`).join('\n');

    const system = `You convert a ROTA draft into strict JSON. Output ONLY a single JSON object inside <rota_json>...</rota_json> tags. No prose, no explanation, no markdown.`;

    const userPrompt = `Convert this ROTA draft into the JSON shape below.

WEEK: ${ctx.week_label}
WEEK_START: ${ctx.week_start}
WEEK_END: ${ctx.week_end}
WEEK_NUM: ${ctx.week_num}

STAFF (use these exact names; every person must appear in "shifts" with all 7 days):
${staffList}

DAYS (use these exact dates):
${dayList}

DRAFT (parse the schedule from this — times, days off, etc.):
"""
${draftText}
"""

OUTPUT FORMAT (return EXACTLY this structure inside <rota_json>...</rota_json>):
{
  "week_label": "${ctx.week_label}",
  "week_start": "${ctx.week_start}",
  "week_end":   "${ctx.week_end}",
  "week_num":   ${ctx.week_num},
  "staff": [
    {"name": "Som", "role": "Manager", "contract_hours": 40}
  ],
  "days": [
    {"date": "${ctx.days[0].date}", "day": "${ctx.days[0].day}", "demand": "MEDIUM", "est_revenue": "£?", "weather": "—", "temp": "—", "rain": "—"}
  ],
  "shifts": {
    "Som": {
      "${ctx.days[0].date}": {"start": "07:00", "end": "14:00", "break_hrs": 0.5, "break_start": "10:30", "break_end": "11:00"},
      "${ctx.days[1]?.date || ctx.days[0].date}": "off"
    }
  }
}

RULES:
- Every staff member must have an entry for ALL 7 days under "shifts"
- Use "off" (string) for non-working days
- break_hrs: 0.5 = 30min, 1 = 1h, 0 = none
- break_start/break_end: roughly midpoint of the shift
- "demand": "LOW" | "MEDIUM" | "HIGH" — infer from draft, default MEDIUM
- If the draft does not state weather / revenue, use "—" placeholders
- Times in HH:MM 24h format
- Output ONLY the <rota_json>...</rota_json> block. No other text.`;

    // 5. Call Haiku (fast + cheap, structured task)
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 60_000);

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 8192,
          system,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await res.json();
    if (!res.ok) {
      // Fallback to older Haiku id
      try {
        const res2 = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 8192,
            system,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });
        const data2 = await res2.json();
        if (!res2.ok) {
          return json({ error: data2?.error?.message || JSON.stringify(data2) }, res2.status);
        }
        return parseAndReturn(data2);
      } catch (e) {
        return json({ error: data?.error?.message || JSON.stringify(data) }, res.status);
      }
    }

    return parseAndReturn(data);

  } catch (err) {
    if (err.name === 'AbortError') return json({ error: 'Finalize timed out' }, 504);
    return json({ error: err.message || 'Internal error' }, 500);
  }
}

function parseAndReturn(claudeData) {
  const text = claudeData?.content?.[0]?.text || '';
  // Extract JSON inside <rota_json> tags first
  let jsonStr = null;
  const tag = text.match(/<rota_json>([\s\S]*?)<\/rota_json>/);
  if (tag) jsonStr = tag[1].trim();
  if (!jsonStr) {
    // bracket-count fallback
    const start = text.indexOf('{');
    if (start >= 0) {
      let depth = 0;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { jsonStr = text.slice(start, i + 1); break; } }
      }
    }
  }
  if (!jsonStr) return json({ error: 'Haiku did not return JSON', _raw: text.slice(0, 500) }, 502);

  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch (e) { return json({ error: 'Invalid JSON from Haiku: ' + e.message, _raw: jsonStr.slice(0, 500) }, 502); }

  return json({ rotaJson: parsed });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
