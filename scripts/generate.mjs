// Generates the profile cards in ../assets from config.json and live GitHub data.
// No dependencies: needs Node 18+ (global fetch). Run: node scripts/generate.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets");
const cfg = JSON.parse(await readFile(path.join(ROOT, "config.json"), "utf8"));

// ── "Bosna" palette: flag blue, flag gold, star white, Neretva teal,
//    Herzegovina pomegranate and Mostar limestone ────────────────────────
const C = {
  night: "#0A1233", panel: "#101B47", line: "#24337A", dots: "#1E2C6B",
  text: "#F5F2EA", muted: "#A9B3D9",
  blue: "#1F3FB0", blueDk: "#122672",
  gold: "#FECB00", goldDk: "#A98700",
  teal: "#12A39A", tealDk: "#0A6560",
  pom: "#B8233C", pomDk: "#741427",
  stone: "#CDBE9E", stoneDk: "#857759",
};
const SANS = "'Segoe UI', 'Helvetica Neue', Ubuntu, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";
const W = 840;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => n.toLocaleString("en-US");
const monoWidth = (s, size) => s.length * size * 0.6;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (d) => d.toISOString().slice(0, 10);
const human = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

function star(cx, cy, r, fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
}

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<defs>
  <pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="${C.dots}"/></pattern>
</defs>
${body}
</svg>
`;

const panel = (w, h) =>
  `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="18" fill="${C.panel}" stroke="${C.line}" stroke-width="2"/>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="18" fill="url(#dots)"/>`;

// A chunky "sticker" tile: offset shadow + face.
const tile = (x, y, w, h, face, shadow) =>
  `<rect x="${x + 4}" y="${y + 5}" width="${w}" height="${h}" rx="12" fill="${shadow}"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${face}" stroke="${C.night}" stroke-opacity=".35" stroke-width="1.5"/>`;

// ── Data ────────────────────────────────────────────────────────────────
const headers = { "User-Agent": "profile-cards-generator", Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function getJSON(url) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

// Reads the public contribution calendar (the same one shown on the profile).
async function calendar(from, to) {
  const url = `https://github.com/users/${cfg.username}/contributions?from=${from}&to=${to}`;
  const r = await fetch(url, { headers: { "User-Agent": headers["User-Agent"] } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const html = await r.text();
  const tips = new Map();
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)</g)) {
    const n = m[2].match(/^\s*([\d,]+) contribution/);
    tips.set(m[1], n ? Number(n[1].replace(/,/g, "")) : 0);
  }
  const days = new Map();
  for (const m of html.matchAll(/<td\b[^>]*>/g)) {
    const date = m[0].match(/data-date="(\d{4}-\d{2}-\d{2})"/)?.[1];
    const id = m[0].match(/\bid="([^"]+)"/)?.[1];
    if (date && id) days.set(date, tips.get(id) ?? 0);
  }
  if (!days.size) throw new Error("Could not read the contribution calendar (GitHub markup may have changed).");
  return days;
}

const user = await getJSON(`https://api.github.com/users/${cfg.username}`);
const repos = await getJSON(`https://api.github.com/users/${cfg.username}/repos?per_page=100&type=owner`);
const own = repos.filter((r) => !r.fork);
const stars = own.reduce((s, r) => s + r.stargazers_count, 0);
const langCount = {};
for (const r of own) if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
const topLang = Object.entries(langCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const firstYear = new Date(user.created_at).getUTCFullYear();
const all = new Map();
for (let y = firstYear; y <= today.getUTCFullYear(); y++) {
  for (const [d, n] of await calendar(`${y}-01-01`, `${y}-12-31`)) all.set(d, n);
}
const count = (d) => all.get(iso(d)) ?? 0;

let total = 0, lastYear = 0;
const yearAgo = addDays(today, -365);
for (const [d, n] of all) {
  const t = new Date(d + "T00:00:00Z");
  if (t > today) continue;
  total += n;
  if (t > yearAgo) lastYear += n;
}

// Current streak: today counts if it has activity, otherwise the streak may still be alive from yesterday.
let cur = 0, curStart = null;
for (let d = count(today) ? today : addDays(today, -1); count(d) > 0; d = addDays(d, -1)) { cur++; curStart = d; }
let best = 0, run = 0;
for (const d of [...all.keys()].sort()) {
  if (new Date(d + "T00:00:00Z") > today) break;
  run = all.get(d) > 0 ? run + 1 : 0;
  best = Math.max(best, run);
}

// ── Hero ────────────────────────────────────────────────────────────────
function hero() {
  const H = 270;
  // Bosnian flag corner: gold right triangle, white stars along the diagonal.
  const ax = 690, bx = W, by = H;
  let stars = "";
  for (let i = -1; i <= 7; i++) {
    const t = i / 6.5;
    stars += star(ax + (bx - ax) * t - 26, by * t + 4, 9, C.text);
  }
  const flag = `<clipPath id="clip"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18"/></clipPath>
<g clip-path="url(#clip)"><polygon points="${ax},0 ${W},0 ${W},${H}" fill="${C.gold}"/>${stars}</g>`;

  const logo = `${tile(36, 40, 100, 100, C.blue, C.blueDk)}
<polygon points="76,40 124,40 124,140" fill="${C.gold}"/>
<rect x="36" y="40" width="100" height="100" rx="12" fill="none" stroke="${C.night}" stroke-opacity=".35" stroke-width="1.5"/>
<text x="74" y="106" text-anchor="middle" font-family="${SANS}" font-weight="800" font-size="38" fill="${C.text}">${esc(cfg.monogram)}</text>`;

  const tx = 166;
  const text = `<text x="${tx}" y="62" font-family="${MONO}" font-size="15" fill="${C.stone}">${esc(cfg.greeting)}</text>
<text x="${tx}" y="104" font-family="${SANS}" font-weight="800" font-size="42" fill="${C.text}">${esc(cfg.name)}</text>
<rect x="${tx + 2}" y="116" width="62" height="5" rx="2.5" fill="${C.gold}"/>
<rect x="${tx + 70}" y="116" width="14" height="5" rx="2.5" fill="${C.teal}"/>
<text x="${tx}" y="150" font-family="${SANS}" font-weight="600" font-size="18" fill="${C.text}">${esc(cfg.tagline)}</text>
<text x="${tx}" y="176" font-family="${MONO}" font-size="13" fill="${C.gold}">${esc(cfg.role)}</text>`;

  const colors = [[C.blue, C.blueDk, C.text], [C.teal, C.tealDk, C.text], [C.pom, C.pomDk, C.text], [C.stone, C.stoneDk, C.night]];
  let x = tx, y = 196, pills = "";
  cfg.tags.forEach((t, i) => {
    const w = monoWidth(t, 12.5) + 26;
    if (x + w > 700) { x = tx; y += 36; }
    const [f, s, tc] = colors[i % colors.length];
    pills += `<rect x="${x + 2}" y="${y + 3}" width="${w}" height="26" rx="8" fill="${s}"/>
<rect x="${x}" y="${y}" width="${w}" height="26" rx="8" fill="${f}"/>
<text x="${x + w / 2}" y="${y + 17.5}" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="12.5" fill="${tc}">${esc(t)}</text>`;
    x += w + 10;
  });
  const height = Math.max(H, y + 26 + 40);
  return svg(W, height, `${panel(W, height)}\n${flag}\n${logo}\n${text}\n${pills}`, `${cfg.greeting} ${cfg.name}. ${cfg.tagline}`);
}

// ── Link pills ──────────────────────────────────────────────────────────
function linkPill(l) {
  const icon = l.id === "linkedin"
    ? `<rect x="12" y="9" width="20" height="20" rx="4" fill="${C.text}"/><text x="22" y="24" text-anchor="middle" font-family="${SANS}" font-weight="800" font-size="13" fill="${C.blue}">in</text>`
    : `<text x="22" y="24" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="13" fill="${C.text}">&lt;/&gt;</text>`;
  const lw = l.label.length * 8.4;
  const w = Math.ceil(44 + lw + 10 + monoWidth(l.handle, 12.5) + 16);
  return svg(w + 4, 42,
    `<rect x="4" y="5" width="${w - 2}" height="36" rx="9" fill="${C.blueDk}"/>
<rect x="1" y="1" width="${w - 2}" height="36" rx="9" fill="${C.blue}" stroke="${C.night}" stroke-opacity=".35"/>
${icon}
<text x="42" y="24" font-family="${SANS}" font-weight="700" font-size="14" fill="${C.text}">${esc(l.label)}</text>
<text x="${42 + lw + 10}" y="24" font-family="${MONO}" font-size="12.5" fill="${C.gold}">${esc(l.handle)}</text>`,
    `${l.label} ${l.handle}`);
}

// ── Stats ───────────────────────────────────────────────────────────────
const ICON = {
  calendar: (c) => `<rect x="1" y="3" width="16" height="14" rx="2.5" fill="none" stroke="${c}" stroke-width="2"/><rect x="1" y="3" width="16" height="5" rx="2" fill="${c}"/><rect x="4.5" y="0" width="2" height="5" rx="1" fill="${c}"/><rect x="11.5" y="0" width="2" height="5" rx="1" fill="${c}"/>`,
  flame: (c) => `<path d="M9 0C10 4 15 6 15 11.5A6 6 0 0 1 3 11.5C3 8 5 6.5 6 4C7 6.5 8 7 9 7C9 4.5 9 2.5 9 0Z" fill="${c}"/>`,
  trophy: (c) => `<path d="M4 1H14V7A5 5 0 0 1 4 7Z" fill="${c}"/><path d="M4 3H1V5A3 3 0 0 0 4 8M14 3H17V5A3 3 0 0 1 14 8" fill="none" stroke="${c}" stroke-width="1.6"/><rect x="8" y="11" width="2" height="3" fill="${c}"/><rect x="5" y="14" width="8" height="3" rx="1" fill="${c}"/>`,
  bars: (c) => `<rect x="1" y="9" width="4" height="8" rx="1" fill="${c}"/><rect x="7" y="4" width="4" height="13" rx="1" fill="${c}"/><rect x="13" y="0" width="4" height="17" rx="1" fill="${c}"/>`,
  folder: (c) => `<path d="M1 4A2 2 0 0 1 3 2H7L9 4H17A2 2 0 0 1 19 6V14A2 2 0 0 1 17 16H3A2 2 0 0 1 1 14Z" fill="${c}"/>`,
  star: (c) => star(10, 10, 10, c),
  code: (c) => `<path d="M6 3L1 9L6 15M14 3L19 9L14 15" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
};

function stats() {
  const H = 330;
  const head = `<text x="30" y="50" font-family="${SANS}" font-weight="800" font-size="24" fill="${C.text}">On GitHub</text>
<text x="${W - 30}" y="48" text-anchor="end" font-family="${MONO}" font-size="12.5" fill="${C.muted}">redrawn every night · ${human(today)}</text>`;

  const big = [
    { v: fmt(lastYear), l: ["contributions in", "the last year"], f: C.blue, s: C.blueDk, t: C.text, i: "calendar", ic: C.gold },
    { v: `${cur} day${cur === 1 ? "" : "s"}`, l: ["current streak", curStart ? `since ${curStart.getUTCDate()} ${MONTHS[curStart.getUTCMonth()]}` : "start one today"], f: C.teal, s: C.tealDk, t: C.text, i: "flame", ic: C.gold },
    { v: `${best} day${best === 1 ? "" : "s"}`, l: ["longest streak", "ever"], f: C.gold, s: C.goldDk, t: C.night, i: "trophy", ic: C.pom },
    { v: fmt(total), l: ["contributions", `since ${firstYear}`], f: C.pom, s: C.pomDk, t: C.text, i: "bars", ic: C.gold },
  ];
  const bw = 180, gap = (W - 60 - bw * 4) / 3;
  let body = "";
  big.forEach((b, k) => {
    const x = 30 + k * (bw + gap), y = 80;
    body += `${tile(x, y, bw, 124, b.f, b.s)}
<g transform="translate(${x + bw - 34},${y + 16})">${ICON[b.i](b.ic)}</g>
<text x="${x + 16}" y="${y + 62}" font-family="${SANS}" font-weight="800" font-size="32" fill="${b.t}">${esc(b.v)}</text>
<text x="${x + 16}" y="${y + 88}" font-family="${MONO}" font-size="12.5" fill="${b.t}" fill-opacity=".9">${esc(b.l[0])}</text>
<text x="${x + 16}" y="${y + 105}" font-family="${MONO}" font-size="12.5" fill="${b.t}" fill-opacity=".9">${esc(b.l[1])}</text>`;
  });

  const small = [
    { v: fmt(user.public_repos), l: "public repos", f: C.stone, s: C.stoneDk, t: C.night, i: "folder", ic: C.blue },
    { v: fmt(stars), l: "stars earned", f: C.blue, s: C.blueDk, t: C.text, i: "star", ic: C.gold },
    { v: topLang, l: "top language", f: C.teal, s: C.tealDk, t: C.text, i: "code", ic: C.gold },
  ];
  const sw = (W - 60 - 2 * 18) / 3;
  small.forEach((b, k) => {
    const x = 30 + k * (sw + 18), y = 234;
    body += `${tile(x, y, sw, 60, b.f, b.s)}
<g transform="translate(${x + 18},${y + 21})">${ICON[b.i](b.ic)}</g>
<text x="${x + 50}" y="${y + 39}" font-family="${SANS}" font-weight="800" font-size="24" fill="${b.t}">${esc(b.v)}</text>
<text x="${x + 50 + b.v.length * 14 + 10}" y="${y + 37}" font-family="${MONO}" font-size="12.5" fill="${b.t}" fill-opacity=".9">${esc(b.l)}</text>`;
  });

  return svg(W, H, `${panel(W, H)}\n${head}\n${body}`,
    `${fmt(lastYear)} contributions in the last year, ${cur}-day current streak, ${best}-day longest streak, ${fmt(total)} contributions since ${firstYear}`);
}

// ── Heatmap (last 26 weeks, daily counts written in the cells) ──────────
function heatmap() {
  const WEEKS = 26, cell = 26, step = 30;
  const start = addDays(today, -today.getUTCDay() - (WEEKS - 1) * 7); // a Sunday
  const days = [];
  for (let d = start; d <= today; d = addDays(d, 1)) days.push([d, count(d)]);
  const sum = days.reduce((s, [, n]) => s + n, 0);

  const nz = days.map(([, n]) => n).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] ?? 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const level = (n) => (n === 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4);
  const LV = [[C.night, "#3A4A8C"], [C.blue, C.text], [C.teal, C.text], ["#D9AE0A", C.night], [C.gold, C.night]];

  const gw = WEEKS * step - (step - cell), x0 = (W - gw) / 2, y0 = 92;
  let body = `<text x="${x0}" y="48" font-family="${SANS}" font-size="16" fill="${C.text}"><tspan font-weight="800" font-size="22">${fmt(sum)}</tspan> contributions in the last 6 months</text>`;
  for (let w = 0; w < WEEKS; w++) {
    const sunday = addDays(start, w * 7);
    if (sunday.getUTCDate() <= 7 || w === 0) {
      const m = sunday.getUTCDate() <= 7 ? sunday.getUTCMonth() : -1;
      if (m >= 0) body += `<text x="${x0 + w * step}" y="${y0 - 10}" font-family="${MONO}" font-size="12.5" fill="${C.stone}">${MONTHS[m]}</text>`;
    }
  }
  days.forEach(([d, n], i) => {
    const x = x0 + Math.floor(i / 7) * step, y = y0 + d.getUTCDay() * step;
    const [bg, fg] = LV[level(n)];
    const label = n >= 1000 ? `${Math.floor(n / 1000)}k` : String(n);
    body += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="5" fill="${bg}"${n ? "" : ` stroke="${C.line}"`}><title>${iso(d)}: ${n}</title></rect>
<text x="${x + cell / 2}" y="${y + 17}" text-anchor="middle" font-family="${MONO}" font-size="${label.length > 2 ? 9.5 : 11}" font-weight="700" fill="${fg}">${label}</text>`;
  });
  const ly = y0 + 7 * step + 22;
  body += `<text x="${x0}" y="${ly + 12}" font-family="${MONO}" font-size="12.5" fill="${C.muted}">contributions per day</text>`;
  const lx = x0 + gw - 5 * 18 - 74;
  body += `<text x="${lx}" y="${ly + 12}" font-family="${MONO}" font-size="12.5" fill="${C.muted}">Less</text>`;
  LV.forEach(([bg], k) => (body += `<rect x="${lx + 38 + k * 18}" y="${ly}" width="14" height="14" rx="3" fill="${bg}"${k ? "" : ` stroke="${C.line}"`}/>`));
  body += `<text x="${lx + 38 + 5 * 18 + 4}" y="${ly + 12}" font-family="${MONO}" font-size="12.5" fill="${C.muted}">More</text>`;
  const H = ly + 40;
  return svg(W, H, `${panel(W, H)}\n${body}`, `${fmt(sum)} contributions in the last 6 months`);
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "hero.svg"), hero());
for (const l of cfg.links) await writeFile(path.join(OUT, `link-${l.id}.svg`), linkPill(l));
await writeFile(path.join(OUT, "stats.svg"), stats());
await writeFile(path.join(OUT, "heatmap.svg"), heatmap());
console.log(`ok · last year ${lastYear} · streak ${cur} (best ${best}) · total ${total} · repos ${user.public_repos} · stars ${stars} · ${topLang}`);
