/**
 * Cloudflare Pages Function — /api/publish-rota
 * Generates ROTA HTML + CSV from rotaJson and pushes both to GitHub.
 * Also updates index.html sidebar/dropdown to add the new week.
 * Requires: GITHUB_TOKEN env var.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUPABASE_URL = 'https://psxcnlymrttedipuonac.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Kr3F8IwLFSHJRkGmVf86Kw_gmra-svY';

const GH_OWNER = 'plugsopon';
const GH_REPO  = 'bingsoo-rota';
const GH_BRANCH = 'main';

// ── Staff colour map ──────────────────────────────────────────────────────────
const STAFF_COLORS = {
  'Som': '#4A90D9', 'Dongjune': '#E8845A', 'Daeun': '#6BBF6B',
  'Haeun': '#B57BCC', 'Jin': '#E8C45A', 'KaYan': '#5AB8CC',
  'Linna': '#E87A8A', 'Riwon': '#7AB87A', 'Yujin': '#CC8C5A'
};
const COLOR_PALETTE = ['#9B7FD4','#D47F9B','#7FD4C1','#D4A07F','#7F9BD4','#D4D47F'];

function staffColor(name, idx) {
  return STAFF_COLORS[name] || COLOR_PALETTE[idx % COLOR_PALETTE.length];
}

function roleBadge(role) {
  if (role === 'Manager')    return { bg: '#F4ECF7', color: '#6C3483' };
  if (role === 'Supervisor') return { bg: '#EBF5FB', color: '#1A5276' };
  return { bg: '#EAFAF1', color: '#1E8449' };
}

function demandStyle(demand) {
  if (demand === 'HIGH')   return { bg: '#FDEDEC', color: '#E74C3C', emoji: '🔴' };
  if (demand === 'MEDIUM') return { bg: '#FEFDE7', color: '#D4AC0D', emoji: '🟡' };
  return { bg: '#EAFAF1', color: '#1E8449', emoji: '🟢' };
}

// ── Hours calculation ─────────────────────────────────────────────────────────
function parseTime(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function shiftHours(shift) {
  if (!shift || shift === 'off') return 0;
  const mins = parseTime(shift.end) - parseTime(shift.start);
  return Math.round((mins / 60 - (shift.break_hrs || 0)) * 10) / 10;
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #F0F2F5; color: #2C3E50; padding: 24px; }
.header { background: linear-gradient(135deg, #2C3E50 0%, #4A6FA5 100%); color: white; border-radius: 16px; padding: 24px 32px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
.header h1 { font-size: 1.8rem; font-weight: 700; }
.header .week-badge { background: rgba(255,255,255,0.2); border-radius: 8px; padding: 8px 16px; font-size: 0.95rem; font-weight: 500; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.legend-item { display: flex; align-items: center; gap: 6px; background: white; border-radius: 8px; padding: 6px 12px; font-size: 0.82rem; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; }
.table-wrap { background: white; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: auto; }
table { border-collapse: collapse; width: 100%; min-width: 900px; }
.date-header { background: #2C3E50; color: white; text-align: center; padding: 12px 8px; min-width: 130px; }
.day-name { font-size: 0.75rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; }
.day-date { font-size: 1rem; font-weight: 700; margin-top: 2px; }
th.label-th { background: #2C3E50; color: white; text-align: left; padding: 12px 16px; min-width: 150px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; }
th.hours-th { background: #2C3E50; color: white; text-align: center; padding: 12px 8px; min-width: 110px; font-size: 0.85rem; }
.demand-row td { border-bottom: 2px solid #E8ECF0; }
td.label-demand { background: #F8F9FA; padding: 10px 16px; font-size: 0.8rem; font-weight: 600; color: #7F8C8D; text-transform: uppercase; letter-spacing: 0.5px; }
.demand-cell { text-align: center; padding: 10px 6px; border-left: 1px solid #E8ECF0; }
.demand-label { font-size: 0.8rem; font-weight: 700; }
.demand-est { font-size: 0.9rem; font-weight: 600; margin: 2px 0; }
.demand-weather { font-size: 0.75rem; opacity: 0.8; }
tbody tr:not(.totals-row):not(.demand-row):hover td { background: #F8F9FA; }
tr:nth-child(even) .staff-name-cell, tr:nth-child(even) .hours-cell { background: #FAFBFC; }
.staff-name-cell { padding: 12px 16px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #E8ECF0; }
.staff-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.staff-name { font-weight: 600; font-size: 0.95rem; }
.role-badge { display: inline-block; font-size: 0.68rem; font-weight: 600; padding: 2px 7px; border-radius: 20px; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
td.shift { text-align: center; padding: 10px 6px; border-left: 1px solid #E8ECF0; border-bottom: 1px solid #E8ECF0; vertical-align: top; background: #F7FBFF; }
.shift-time { font-size: 0.88rem; font-weight: 700; color: #2C3E50; }
.shift-hrs { font-size: 0.78rem; color: #7F8C8D; margin: 2px 0; }
.break-badge { display: inline-block; background: #FEF9E7; color: #B7950B; font-size: 0.68rem; font-weight: 600; padding: 2px 6px; border-radius: 4px; margin-top: 4px; border: 1px solid #F9E79F; }
td.off { text-align: center; padding: 10px 6px; border-left: 1px solid #E8ECF0; border-bottom: 1px solid #E8ECF0; color: #BDC3C7; font-size: 0.8rem; font-weight: 600; background: #FAFAFA; letter-spacing: 1px; }
.hours-cell { padding: 10px 12px; border-left: 2px solid #E8ECF0; border-bottom: 1px solid #E8ECF0; text-align: center; vertical-align: middle; }
.hours-number { font-weight: 700; font-size: 0.9rem; }
.contract { font-weight: 400; color: #95A5A6; font-size: 0.8rem; }
.hours-bar-bg { background: #ECF0F1; border-radius: 4px; height: 5px; margin-top: 6px; overflow: hidden; }
.hours-bar-fill { height: 100%; border-radius: 4px; }
.totals-row td { background: #2C3E50 !important; color: white; font-weight: 700; padding: 12px 8px; }
.total-label { text-align: left; padding-left: 16px !important; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; }
.total-cell { text-align: center; font-size: 0.95rem; border-left: 1px solid rgba(255,255,255,0.1); }
.total-grand { text-align: center; font-size: 1rem; border-left: 2px solid rgba(255,255,255,0.2); color: #F9E79F; }
.footer { text-align: center; margin-top: 16px; font-size: 0.78rem; color: #95A5A6; }`;

// ── HTML generator ────────────────────────────────────────────────────────────
function generateHtml(rota) {
  const { week_label, staff, days, shifts } = rota;
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // Date header row
  const dateHeaders = days.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    const dayNum = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `<th class="date-header">
      <div class="day-name">${d.day.slice(0, 3).toUpperCase()}</div>
      <div class="day-date">${dayNum}</div>
    </th>`;
  }).join('\n      ');

  // Demand row
  const demandCells = days.map(d => {
    const ds = demandStyle(d.demand);
    return `<td class="demand-cell" style="background:${ds.bg}">
        <div class="demand-label" style="color:${ds.color}">${ds.emoji} ${d.demand}</div>
        <div class="demand-est">${d.est_revenue || ''}</div>
        <div class="demand-weather">${d.weather || ''} ${d.temp || ''} ${d.rain ? '· ' + d.rain : ''}</div>
      </td>`;
  }).join('\n      ');

  // Per-day totals
  const dayTotals = days.map(d => {
    let total = 0;
    staff.forEach(s => {
      const sh = shifts?.[s.name]?.[d.date];
      total += shiftHours(sh);
    });
    return Math.round(total * 10) / 10;
  });
  const grandTotal = Math.round(dayTotals.reduce((a, b) => a + b, 0) * 10) / 10;

  // Staff rows
  const staffRows = staff.map((s, idx) => {
    const color = staffColor(s.name, idx);
    const rb = roleBadge(s.role);
    let totalHrs = 0;

    const shiftCells = days.map(d => {
      const sh = shifts?.[s.name]?.[d.date];
      if (!sh || sh === 'off') {
        return `<td class="off" data-name="${s.name}" data-date="${d.date}">OFF</td>`;
      }
      const hrs = shiftHours(sh);
      totalHrs += hrs;
      let breakBadge = '';
      if (sh.break_start && sh.break_end) {
        const bh = sh.break_hrs === 0.5 ? '0.5h' : `${sh.break_hrs}h`;
        breakBadge = `<span class="break-badge">Break ${sh.break_start}–${sh.break_end} (${bh})</span>`;
      }
      return `<td class="shift" data-name="${s.name}" data-date="${d.date}" style="border-top:3px solid ${color}">
        <div class="shift-time">${sh.start} – ${sh.end}</div>
        <div class="shift-hrs">${hrs}h</div>
        ${breakBadge}
      </td>`;
    }).join('\n      ');

    totalHrs = Math.round(totalHrs * 10) / 10;
    const contract = s.contract_hours || 0;
    const barPct = contract > 0 ? Math.min(100, Math.round((totalHrs / contract) * 100)) : 0;
    const barColor = totalHrs > contract ? '#E74C3C' : color;

    return `<tr>
      <td style="padding:0;border-bottom:1px solid #E8ECF0">
        <div class="staff-name-cell">
          <div class="staff-dot" style="background:${color}"></div>
          <div>
            <div class="staff-name">${s.name}</div>
            <span class="role-badge" style="background:${rb.bg};color:${rb.color}">${s.role}</span>
          </div>
        </div>
      </td>
      ${shiftCells}
      <td class="hours-cell">
        <div class="hours-number" style="color:${barColor}">${totalHrs}h</div>
        <div class="contract">/ ${contract}h</div>
        <div class="hours-bar-bg"><div class="hours-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div>
      </td>
    </tr>`;
  }).join('\n    ');

  // Totals row
  const totalCells = dayTotals.map(t => `<td class="total-cell">${t}h</td>`).join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bingsoo ROTA \u2013 ${week_label}</title>
<style>${CSS}</style>
</head>
<body>

<div class="header">
  <div>
    <div style="font-size:0.8rem;opacity:0.7;margin-bottom:4px">WEEKLY ROTA</div>
    <h1>\uD83E\uDDC1 Bingsoo Cafe</h1>
  </div>
  <div class="week-badge">\uD83D\uDCC5 ${week_label}</div>
</div>

<div class="legend">
  <div class="legend-item"><div class="legend-dot" style="background:#6C3483"></div> Manager (CM)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#1A5276"></div> Supervisor (SV)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#1E8449"></div> Assistant (CA)</div>
  <div class="legend-item">\uD83D\uDFE2 Low demand &nbsp;|&nbsp; \uD83D\uDFE1 Medium &nbsp;|&nbsp; \uD83D\uDD34 High</div>
  <div class="legend-item">\u2600\uFE0F Fine &nbsp;|&nbsp; \uD83C\uDF26\uFE0F Light rain &nbsp;|&nbsp; \uD83C\uDF27\uFE0F Heavy rain</div>
</div>

<div class="table-wrap">
<table>
  <thead>
    <tr>
      <th class="label-th">Staff</th>
      ${dateHeaders}
      <th class="hours-th">Weekly<br>Hours</th>
    </tr>
  </thead>
  <tbody>
    <tr class="demand-row">
      <td class="label-demand">Demand / Revenue</td>
      ${demandCells}
      <td class="hours-cell" style="background:#F8F9FA"></td>
    </tr>
    ${staffRows}
    <tr class="totals-row">
      <td class="total-label">Daily Total Hours</td>
      ${totalCells}
      <td class="total-grand">${grandTotal}h</td>
    </tr>
  </tbody>
</table>
</div>

<div class="footer">Generated by Bingsoo AI \u00B7 ${today}</div>

</body>
</html>`;
}

// ── CSV generator ─────────────────────────────────────────────────────────────
function generateCsv(rota) {
  const { week_label, staff, days, shifts } = rota;

  const headerRow = ['Name', 'Role', ...days.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${d.day} ${dd}/${mm}`;
  }), 'Total Hours'].join(',');

  const dataRows = staff.map(s => {
    let total = 0;
    const cells = days.map(d => {
      const sh = shifts?.[s.name]?.[d.date];
      if (!sh || sh === 'off') return 'OFF';
      const hrs = shiftHours(sh);
      total += hrs;
      return `${sh.start}-${sh.end}`;
    });
    total = Math.round(total * 10) / 10;
    return [s.name, s.role, ...cells, total].join(',');
  });

  return [`Bingsoo ROTA - ${week_label}`, headerRow, ...dataRows].join('\n');
}

// ── GitHub helpers ────────────────────────────────────────────────────────────
async function ghGet(path, token) {
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  return r.ok ? r.json() : null;
}

async function ghPut(path, content, message, sha, token) {
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { msg = JSON.parse(text)?.message || text; } catch(_) {}
    throw new Error(`GitHub API ${r.status}: ${msg}`);
  }
  return JSON.parse(text);
}

// ── index.html updater ────────────────────────────────────────────────────────
function replaceFirst(html, search, replacement) {
  const idx = html.indexOf(search);
  if (idx === -1) return html;
  return html.slice(0, idx) + replacement + html.slice(idx + search.length);
}

function updateIndexHtml(html, filename, rota) {
  const { week_label, week_num } = rota;

  // Parse week_start date parts
  const ws = rota.week_start; // "2026-05-04"
  const [, , startMon, startDay] = ws.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const we = rota.week_end;
  const [endYear] = we.match(/^\d{4}/);

  const wNum       = `W${week_num}`;
  // shortLabel: e.g. "04 May - 10 May" — extract from week_label (drop year)
  // week_label example: "04 May – 10 May 2026"
  const shortLabel = week_label.replace(/\s+\d{4}$/, '').replace('–', '-').trim();
  const mobileLabel = `${wNum} · ${shortLabel}`;

  // Count existing weeks (data-file= occurrences)
  const existingCount = (html.match(/data-file=/g) || []).length;
  const newCount = existingCount + 1;

  // 1. Update week count text
  const oldCountMatch = html.match(/📁 (\d+) weeks? available/);
  if (oldCountMatch) {
    html = replaceFirst(html, oldCountMatch[0], `📁 ${newCount} weeks available`);
  }

  // 2. Deactivate existing active li
  html = html.split('<li class="active"').join('<li class="');

  // 3. Deactivate existing selected option
  html = html.split(' selected>').join('>');

  // 4. Insert new <li> after <ul id="week-list">\n
  const ulMarker = '<ul id="week-list">\n';
  const newLi = `<li class="active" data-file="${filename}" onclick="loadWeek('output/${filename}','${filename}',this)"><span class="wnum">${wNum}</span><span class="wlabel">${shortLabel}</span></li>\n`;
  html = replaceFirst(html, ulMarker, ulMarker + newLi);

  // 5. Insert new <option> after <select id="mobile-week-sel">
  const selMarker = '<select id="mobile-week-sel">';
  const newOption = `\n      <option value="${filename}" selected>${mobileLabel}</option>`;
  html = replaceFirst(html, selMarker, selMarker + newOption);

  // 6. Update iframe src
  const iframeRe = /(<iframe id="rota-frame" src=")output\/[^"]+(")/;
  html = html.replace(iframeRe, `$1output/${filename}$2`);

  // 7. Update toolbar title (span#week-title inner text)
  const titleRe = /(<span id="week-title">)[^<]*(<\/span>)/;
  html = html.replace(titleRe, `$1${wNum} · ${shortLabel} ${endYear}$2`);

  // 8. Update open-btn href
  const openRe = /(<a id="open-btn"[^>]+href=")output\/[^"]+(")/;
  html = html.replace(openRe, `$1output/${filename}$2`);

  // 9. Update csv-btn href
  const csvFilename = filename.replace('.html', '.csv');
  const csvRe = /(<a id="csv-btn"[^>]+href=")output\/[^"]+(")/;
  html = html.replace(csvRe, `$1output/${csvFilename}$2`);

  return html;
}

// ── Filename generator ────────────────────────────────────────────────────────
function buildFilename(rota) {
  // rota_DDMMYYYY_DDMMYYYY.html
  function fmt(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}${m}${y}`;
  }
  return `rota_${fmt(rota.week_start)}_${fmt(rota.week_end)}.html`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
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
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_KEY,
      },
    });
    if (!userRes.ok) {
      return json({ error: 'Unauthorized – invalid session' }, 401);
    }
    const userData = await userRes.json();

    // ── 2. Manager check ──────────────────────────────────────────────
    const staffRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff?select=is_manager&email=eq.${encodeURIComponent(userData.email)}&limit=1`,
      { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY } }
    );
    const staffData = await staffRes.json();
    if (!staffData?.[0]?.is_manager) {
      return json({ error: 'Manager access required' }, 403);
    }

    // ── 3. Parse body ─────────────────────────────────────────────────
    const body = await request.json();
    const { rotaJson } = body;
    if (!rotaJson || !rotaJson.week_start || !rotaJson.week_end) {
      return json({ error: 'rotaJson with week_start and week_end is required' }, 400);
    }

    // ── 4. Check GitHub token ─────────────────────────────────────────
    const ghToken = env.GITHUB_TOKEN;
    if (!ghToken) {
      return json({ error: 'GITHUB_TOKEN not configured on server' }, 500);
    }

    // ── 5. Generate files ─────────────────────────────────────────────
    const filename    = buildFilename(rotaJson);
    const csvFilename = filename.replace('.html', '.csv');
    const htmlContent = generateHtml(rotaJson);
    const csvContent  = generateCsv(rotaJson);

    // ── 6. Push HTML to GitHub ────────────────────────────────────────
    const htmlPath = `output/${filename}`;
    const existingHtml = await ghGet(htmlPath, ghToken);
    const htmlResult = await ghPut(
      htmlPath,
      htmlContent,
      `Add ROTA ${rotaJson.week_label}`,
      existingHtml?.sha || null,
      ghToken
    );
    if (htmlResult.message && !htmlResult.content) {
      return json({ error: `GitHub error (HTML): ${htmlResult.message}` }, 500);
    }

    // ── 7. Push CSV to GitHub ─────────────────────────────────────────
    const csvPath = `output/${csvFilename}`;
    const existingCsv = await ghGet(csvPath, ghToken);
    const csvResult = await ghPut(
      csvPath,
      csvContent,
      `Add ROTA CSV ${rotaJson.week_label}`,
      existingCsv?.sha || null,
      ghToken
    );
    if (csvResult.message && !csvResult.content) {
      return json({ error: `GitHub error (CSV): ${csvResult.message}` }, 500);
    }

    // ── 8. Update index.html ──────────────────────────────────────────
    const indexFile = await ghGet('index.html', ghToken);
    if (indexFile?.content) {
      const rawIndex = decodeURIComponent(escape(atob(indexFile.content.replace(/\n/g, ''))));
      const updatedIndex = updateIndexHtml(rawIndex, filename, rotaJson);
      await ghPut(
        'index.html',
        updatedIndex,
        `Update sidebar for ROTA ${rotaJson.week_label}`,
        indexFile.sha,
        ghToken
      );
    }

    return json({ success: true, filename, weekLabel: rotaJson.week_label });

  } catch (err) {
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
