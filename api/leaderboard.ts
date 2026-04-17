/**
 * Recruiter Leaderboard
 *
 * A single Vercel serverless endpoint that renders a live monthly leaderboard
 * from a Notion "Sendouts" database. Counts per-recruiter contributions on
 * the candidate side and client side (from rollup fields), ranks by total,
 * and returns a standalone HTML page.
 *
 * GET /api/leaderboard              — current month
 * GET /api/leaderboard?month=YYYY-MM — any month
 *
 * Environment variables:
 *   NOTION_API_KEY     — Notion integration token (required)
 *   SENDOUTS_DB_ID     — UUID of your Sendouts database (required)
 *   ORG_NAME           — displayed in the header (default: "Recruiting Team")
 *
 * Expected Notion schema (customize property names in CONFIG below):
 *   - "Interview Date"  (date)        — used to group sendouts by month
 *   - "Candidate Owner" (rollup)      — who owns the candidate side
 *   - "Client Owner"    (rollup)      — who owns the client side
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const NOTION_API_VERSION = "2022-06-28";

const CONFIG = {
  dateProperty: "Interview Date",
  candidateOwnerProperty: "Candidate Owner",
  clientOwnerProperty: "Client Owner",
  orgName: process.env.ORG_NAME || "Recruiting Team",
};

// --- Notion helpers ---

async function notionFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Reads a rollup property and extracts readable text from the first element.
 * Handles the four most common rollup payload shapes: rich_text, title, people, select.
 */
function getRollupText(page: any, prop: string): string {
  const p = page.properties?.[prop];
  if (!p || p.type !== "rollup") return "";
  const arr = p.rollup?.array || [];
  if (!arr.length) return "";
  const first = arr[0];
  if (first.type === "rich_text")
    return first.rich_text?.map((t: any) => t.plain_text).join("") || "";
  if (first.type === "title")
    return first.title?.map((t: any) => t.plain_text).join("") || "";
  if (first.type === "people")
    return first.people?.map((p: any) => p.name).join(", ") || "";
  if (first.type === "select")
    return first.select?.name || "";
  return "";
}

// --- Query sendouts for a month ---

async function querySendouts(year: number, month: number): Promise<any[]> {
  const dbId = process.env.SENDOUTS_DB_ID;
  if (!dbId) throw new Error("SENDOUTS_DB_ID env variable is required");

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  let all: any[] = [];
  let cursor: string | undefined;

  do {
    const body: any = {
      filter: {
        and: [
          { property: CONFIG.dateProperty, date: { on_or_after: startDate } },
          { property: CONFIG.dateProperty, date: { before: endDate } },
        ],
      },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const res = await notionFetch(`/databases/${dbId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    all = all.concat(res.results || []);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return all;
}

// --- Build recruiter scores ---

interface RecruiterScore {
  name: string;
  candidate: number;
  client: number;
  total: number;
}

function buildScores(sendouts: any[]): RecruiterScore[] {
  const scores: Record<string, { candidate: number; client: number }> = {};

  for (const s of sendouts) {
    const candOwner = getRollupText(s, CONFIG.candidateOwnerProperty).trim();
    const clientOwner = getRollupText(s, CONFIG.clientOwnerProperty).trim();

    if (candOwner) {
      if (!scores[candOwner]) scores[candOwner] = { candidate: 0, client: 0 };
      scores[candOwner].candidate++;
    }
    if (clientOwner) {
      if (!scores[clientOwner]) scores[clientOwner] = { candidate: 0, client: 0 };
      scores[clientOwner].client++;
    }
  }

  return Object.entries(scores)
    .map(([name, s]) => ({ name, candidate: s.candidate, client: s.client, total: s.candidate + s.client }))
    .sort((a, b) => b.total - a.total);
}

// --- Render HTML ---

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function rankIcon(i: number): string {
  if (i === 0) return `<td style="padding:14px 16px;text-align:center;font-size:22px">🥇</td>`;
  if (i === 1) return `<td style="padding:14px 16px;text-align:center;font-size:22px">🥈</td>`;
  if (i === 2) return `<td style="padding:14px 16px;text-align:center;font-size:22px">🥉</td>`;
  return `<td style="padding:14px 16px;text-align:center;font-size:14px"><span style="color:#888">#${i + 1}</span></td>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderHTML(scores: RecruiterScore[], year: number, month: number): string {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const isCurrentMonth = year === curYear && month === curMonth;
  const totalSendouts = scores.reduce((s, r) => s + r.candidate + r.client, 0);
  const topScore = scores.length > 0 ? scores[0].total : 0;

  // Build month tabs — current month + 5 past months
  const months: { y: number; m: number }[] = [];
  for (let i = 0; i < 6; i++) {
    let my = curMonth - i;
    let yy = curYear;
    if (my <= 0) { my += 12; yy--; }
    months.push({ y: yy, m: my });
  }

  const currentTab = months[0];
  const currentTabHTML = `
    <a href="/api/leaderboard" style="text-decoration:none">
      <button style="padding:8px 16px;border-radius:8px;${
        isCurrentMonth
          ? "background:#fff;color:#1a1a2e;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,0.15);"
          : "background:transparent;color:rgba(255,255,255,0.6);font-weight:500;"
      }font-size:13px;cursor:pointer;border:none;">
        ${MONTH_SHORT[currentTab.m - 1]} ${currentTab.y}
      </button>
    </a>`;

  const pastTabsHTML = months.slice(1).map((t) => {
    const isActive = t.y === year && t.m === month;
    return `
    <a href="/api/leaderboard?month=${t.y}-${String(t.m).padStart(2, "0")}" style="text-decoration:none">
      <button style="padding:8px 16px;border-radius:8px;${
        isActive
          ? "background:#fff;color:#1a1a2e;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,0.15);"
          : "background:transparent;color:rgba(255,255,255,0.6);font-weight:500;"
      }font-size:13px;cursor:pointer;border:none;">${MONTH_SHORT[t.m - 1]} ${t.y}</button>
    </a>`;
  }).join("\n");

  const rowsHTML = scores.map((r, i) => `
        <tr style="background:${i % 2 === 0 ? "#fff" : "#fafafa"}">
          ${rankIcon(i)}
          <td style="padding:14px 16px;font-weight:600;color:#1a1a2e;font-size:15px">${esc(r.name)}</td>
          <td style="padding:14px 16px;text-align:center;font-weight:600;color:#27AE60;font-size:15px">${r.candidate}</td>
          <td style="padding:14px 16px;text-align:center;font-weight:600;color:#2980B9;font-size:15px">${r.client}</td>
          <td style="padding:14px 16px;text-align:center;font-weight:700;color:#C0392B;font-size:18px">${r.total}</td>
        </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${MONTH_NAMES[month - 1]} ${year} Leaderboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f0f2f5;
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container { max-width: 740px; margin: 0 auto; }
    .card { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 32px rgba(0,0,0,0.10); }
    .header { background: #1a1a2e; padding: 28px 32px 0; }
    .header-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .header h1 { color: #fff; font-size: 26px; font-weight: 700; }
    .live-badge {
      background: #C0392B; color: #fff; font-size: 11px; font-weight: 700;
      padding: 3px 9px; border-radius: 10px; letter-spacing: 1px;
    }
    .header-sub { color: rgba(255,255,255,0.5); font-size: 14px; margin-bottom: 20px; }
    .tabs-row { display: flex; align-items: center; gap: 6px; padding-bottom: 20px; flex-wrap: wrap; }
    .tabs-divider { width: 1px; background: rgba(255,255,255,0.15); margin: 0 4px; align-self: stretch; }
    .tabs-past-label {
      color: rgba(255,255,255,0.35); font-size: 11px; font-weight: 600;
      letter-spacing: 0.5px; text-transform: uppercase; padding: 0 4px; white-space: nowrap;
    }
    .stats { display: flex; border-bottom: 1px solid #eee; }
    .stat { flex: 1; padding: 18px 24px; border-right: 1px solid #eee; }
    .stat:last-child { border-right: none; }
    .stat-value { font-size: 26px; font-weight: 700; color: #1a1a2e; line-height: 1; margin-bottom: 4px; }
    .stat-label { font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #2C3E50; }
    thead th {
      padding: 12px 16px; color: rgba(255,255,255,0.75);
      font-size: 11px; font-weight: 600; text-align: center;
      text-transform: uppercase; letter-spacing: 0.8px;
    }
    thead th:nth-child(2) { text-align: left; }
    thead th.green { color: #A9DFBF; }
    thead th.blue  { color: #AED6F1; }
    thead th.red   { color: #F1948A; }
    tbody tr { border-bottom: 1px solid #f0f0f0; transition: background 0.1s; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: #f0f7ff !important; }
    .footer { padding: 16px 24px; border-top: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
    .legend { display: flex; gap: 20px; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #999; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .refresh { font-size: 11px; color: #ccc; margin-top: 2px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="header-top">
          <h1>🏆 Recruiter Leaderboard</h1>
          <span class="live-badge">LIVE</span>
        </div>
        <div class="header-sub">${MONTH_NAMES[month - 1]} ${year} · ${esc(CONFIG.orgName)}</div>
        <div class="tabs-row">
          ${currentTabHTML}
          <span class="tabs-divider"></span>
          <span class="tabs-past-label">Past</span>
          ${pastTabsHTML}
        </div>
      </div>

      <div class="stats">
        <div class="stat">
          <div class="stat-value">${totalSendouts}</div>
          <div class="stat-label">Total Sendouts</div>
        </div>
        <div class="stat">
          <div class="stat-value">${scores.length}</div>
          <div class="stat-label">Recruiters</div>
        </div>
        <div class="stat">
          <div class="stat-value">${topScore}</div>
          <div class="stat-label">Top Score</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:60px">Rank</th>
            <th style="text-align:left">Recruiter</th>
            <th class="green">Candidate</th>
            <th class="blue">Client</th>
            <th class="red">Total</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>

      <div class="footer">
        <div>
          <div class="legend">
            <span class="legend-item"><span class="dot" style="background:#27AE60"></span>Candidate Owner</span>
            <span class="legend-item"><span class="dot" style="background:#2980B9"></span>Client Owner</span>
          </div>
          <div class="refresh">Refreshes on every page load</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// --- Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;

    const monthParam = (req.query.month as string) || "";
    if (/^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split("-").map(Number);
      if (m >= 1 && m <= 12) { year = y; month = m; }
    }

    const sendouts = await querySendouts(year, month);
    const scores = buildScores(sendouts);
    const html = renderHTML(scores, year, month);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).send(html);
  } catch (err: any) {
    console.error("Leaderboard error:", err);
    res.setHeader("Content-Type", "text/html");
    return res.status(500).send(`<h1>Error</h1><pre>${esc(err.message)}</pre>`);
  }
}
