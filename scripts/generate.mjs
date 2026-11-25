// Generates the profile cards in ../assets from config.json and live GitHub data.
// No dependencies: needs Node 18+ (global fetch). Run: node scripts/generate.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets");
const cfg = JSON.parse(await readFile(path.join(ROOT, "config.json"), "utf8"));

// ── "Trail" palette: night sky, pine forest, moss, granite, trail dust,
//    sunrise orange, snowcap white and the red-and-white trail blaze ─────
const C = {
  night: "#111923", panel: "#16212E", line: "#2A3A4E", dots: "#1F2C3B",
  text: "#F1F3EE", muted: "#9AA8B8",
  forest: "#2F6B4F", forestDk: "#1B4231",
  moss: "#86B04A", mossDk: "#56762C",
  granite: "#4B5B70", graniteDk: "#2E3A4A",
  dust: "#CDA86E", dustDk: "#8C6F40",
  sun: "#EE6B2C", sunDk: "#A2441A",
  snow: "#EEF1EC", snowDk: "#A9B2AA",
  blaze: "#D7263D",
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
// Red-and-white trail blaze, the waymark painted on rocks and trees along mountain paths.
const blaze = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.blaze}"/><circle cx="${cx}" cy="${cy}" r="${(r * 0.45).toFixed(1)}" fill="#FFFFFF"/>`;

const svg = (w, h, body, title, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<defs>
  <pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="${C.dots}"/></pattern>
  ${defs}
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
function hero(height) {
  const H = height;
  const b = H; // ground line
  // Mountain range on the right: far granite ridge, snow-capped mid ridge, dark foreground,
  // with a dashed trail switchbacking up to a summit flag.
  const sky = `<circle cx="792" cy="58" r="24" fill="${C.sun}" opacity=".9"/>
${[[600, 40], [640, 70], [700, 34], [560, 92], [742, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="${C.snow}" opacity=".7"/>`).join("")}`;
  const far = `<path d="M520 ${b} L575 ${b - 95} L612 ${b - 70} L668 ${b - 165} L705 ${b - 120} L748 ${b - 182} L800 ${b - 128} L840 ${b - 160} L840 ${b} Z" fill="${C.granite}" opacity=".55"/>`;
  const mid = `<path d="M560 ${b} L622 ${b - 82} L655 ${b - 62} L722 ${b - 148} L770 ${b - 96} L806 ${b - 120} L840 ${b - 84} L840 ${b} Z" fill="${C.forestDk}"/>
<path d="M722 ${b - 148} L706 ${b - 127} L715 ${b - 130} L722 ${b - 121} L730 ${b - 131} L739 ${b - 126} Z" fill="${C.snow}"/>
<path d="M806 ${b - 120} L796 ${b - 107} L803 ${b - 109} L809 ${b - 103} L815 ${b - 110} Z" fill="${C.snow}"/>`;
  const trail = `<path d="M610 ${b - 6} C660 ${b - 18} 640 ${b - 40} 688 ${b - 52} S678 ${b - 88} 704 ${b - 100} S716 ${b - 126} 722 ${b - 146}" fill="none" stroke="${C.sun}" stroke-width="2.5" stroke-dasharray="5 5" stroke-linecap="round"/>
<line x1="722" y1="${b - 148}" x2="722" y2="${b - 176}" stroke="${C.snow}" stroke-width="2"/>
<polygon points="722,${b - 176} 742,${b - 169} 722,${b - 162}" fill="${C.sun}"/>`;
  const near = `<path d="M590 ${b} Q660 ${b - 34} 712 ${b - 24} T840 ${b - 38} L840 ${b} Z" fill="${C.night}"/>
${[[640, 12], [664, 18], [790, 26], [812, 30]].map(([x, h]) => `<polygon points="${x},${b - h - 18} ${x - 7},${b - h + 2} ${x + 7},${b - h + 2}" fill="${C.forest}"/>`).join("")}`;
  const scene = `<clipPath id="clip"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18"/></clipPath>
<g clip-path="url(#clip)">${sky}${far}${mid}${trail}${near}</g>`;
  return scene;
}

function heroCard() {
  const logo = `${tile(36, 40, 100, 100, C.forest, C.forestDk)}
<path d="M44 132 L70 96 L82 110 L100 84 L128 132 Z" fill="${C.forestDk}"/>
<path d="M100 84 L93 94 L100 92 L106 97 Z" fill="${C.snow}"/>
<text x="74" y="84" text-anchor="middle" font-family="${SANS}" font-weight="800" font-size="34" fill="${C.text}">${esc(cfg.monogram)}</text>
${blaze(122, 54, 7)}`;

  const tx = 166;
  const text = `<text x="${tx}" y="62" font-family="${MONO}" font-size="15" fill="${C.dust}">${esc(cfg.greeting)}</text>
<text x="${tx}" y="104" font-family="${SANS}" font-weight="800" font-size="42" fill="${C.text}">${esc(cfg.name)}</text>
<path d="M${tx + 2} 120 l14 -6 l12 4 l16 -8 l14 6 l18 -4" fill="none" stroke="${C.sun}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${tx}" y="150" font-family="${SANS}" font-weight="600" font-size="18" fill="${C.text}">${esc(cfg.tagline)}</text>
<text x="${tx}" y="176" font-family="${MONO}" font-size="13" fill="${C.moss}">${esc(cfg.role)}</text>`;

  const colors = [[C.forest, C.forestDk, C.text], [C.sun, C.sunDk, C.night], [C.granite, C.graniteDk, C.text], [C.dust, C.dustDk, C.night], [C.moss, C.mossDk, C.night]];
  let x = tx, y = 196, pills = "";
  cfg.tags.forEach((t, i) => {
    const w = monoWidth(t, 12.5) + 26;
    if (x + w > 575) { x = tx; y += 36; }
    const [f, s, tc] = colors[i % colors.length];
    pills += `<rect x="${x + 2}" y="${y + 3}" width="${w}" height="26" rx="8" fill="${s}"/>
<rect x="${x}" y="${y}" width="${w}" height="26" rx="8" fill="${f}"/>
<text x="${x + w / 2}" y="${y + 17.5}" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="12.5" fill="${tc}">${esc(t)}</text>`;
    x += w + 10;
  });
  const height = Math.max(270, y + 26 + 36);
  return svg(W, height, `${panel(W, height)}\n${hero(height)}\n${logo}\n${text}\n${pills}`, `${cfg.greeting} ${cfg.name}. ${cfg.tagline}`);
}

// ── Link pills ──────────────────────────────────────────────────────────
function linkPill(l) {
  const icon = l.id === "linkedin"
    ? `<rect x="12" y="9" width="20" height="20" rx="4" fill="${C.text}"/><text x="22" y="24" text-anchor="middle" font-family="${SANS}" font-weight="800" font-size="13" fill="${C.forest}">in</text>`
    : `<text x="22" y="24" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="13" fill="${C.text}">&lt;/&gt;</text>`;
  const lw = l.label.length * 8.4;
  const w = Math.ceil(44 + lw + 10 + monoWidth(l.handle, 12.5) + 16);
  return svg(w + 4, 42,
    `<rect x="4" y="5" width="${w - 2}" height="36" rx="9" fill="${C.forestDk}"/>
<rect x="1" y="1" width="${w - 2}" height="36" rx="9" fill="${C.forest}" stroke="${C.night}" stroke-opacity=".35"/>
${icon}
<text x="42" y="24" font-family="${SANS}" font-weight="700" font-size="14" fill="${C.text}">${esc(l.label)}</text>
<text x="${42 + lw + 10}" y="24" font-family="${MONO}" font-size="12.5" fill="${C.dust}">${esc(l.handle)}</text>`,
    `${l.label} ${l.handle}`);
}

// ── Stats ───────────────────────────────────────────────────────────────
const ICON = {
  map: (c) => `<path d="M1 3L6 1L12 3L17 1V15L12 17L6 15L1 17Z" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 1V15M12 3V17" stroke="${c}" stroke-width="1.5"/>`,
  steps: (c) => `<ellipse cx="5" cy="11" rx="3.2" ry="5" fill="${c}"/><ellipse cx="13" cy="6" rx="3.2" ry="5" fill="${c}"/>`,
  peak: (c) => `<path d="M0 17L7 4L11 10L13 7L19 17Z" fill="${c}"/><path d="M7 4V-2M7 -2L12 0L7 2" fill="${c}" stroke="${c}" stroke-width="1.4"/>`,
  profile: (c) => `<path d="M0 17L4 10L7 13L11 4L15 9L19 6V17Z" fill="${c}"/>`,
  folder: (c) => `<path d="M1 4A2 2 0 0 1 3 2H7L9 4H17A2 2 0 0 1 19 6V14A2 2 0 0 1 17 16H3A2 2 0 0 1 1 14Z" fill="${c}"/>`,
  star: (c) => star(10, 10, 10, c),
  code: (c) => `<path d="M6 3L1 9L6 15M14 3L19 9L14 15" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
};

function stats() {
  const H = 330;
  const head = `${blaze(40, 42, 9)}
<text x="58" y="50" font-family="${SANS}" font-weight="800" font-size="24" fill="${C.text}">Trail log</text>
<text x="${W - 30}" y="48" text-anchor="end" font-family="${MONO}" font-size="12.5" fill="${C.muted}">GitHub activity · redrawn every night · ${human(today)}</text>`;

  const big = [
    { v: fmt(lastYear), l: ["contributions in", "the last year"], f: C.forest, s: C.forestDk, t: C.text, i: "map", ic: C.dust },
    { v: `${cur} day${cur === 1 ? "" : "s"}`, l: ["on the trail now", curStart ? `since ${curStart.getUTCDate()} ${MONTHS[curStart.getUTCMonth()]}` : "next run: today"], f: C.sun, s: C.sunDk, t: C.night, i: "steps", ic: C.night },
    { v: `${best} day${best === 1 ? "" : "s"}`, l: ["longest run", "(best streak)"], f: C.snow, s: C.snowDk, t: C.night, i: "peak", ic: C.blaze },
    { v: fmt(total), l: ["total ascent", `since ${firstYear}`], f: C.granite, s: C.graniteDk, t: C.text, i: "profile", ic: C.moss },
  ];
  const bw = 180, gap = (W - 60 - bw * 4) / 3;
  let body = "";
  big.forEach((b, k) => {
    const x = 30 + k * (bw + gap), y = 80;
    body += `${tile(x, y, bw, 124, b.f, b.s)}
<g transform="translate(${x + bw - 34},${y + 18})">${ICON[b.i](b.ic)}</g>
<text x="${x + 16}" y="${y + 62}" font-family="${SANS}" font-weight="800" font-size="32" fill="${b.t}">${esc(b.v)}</text>
<text x="${x + 16}" y="${y + 88}" font-family="${MONO}" font-size="12.5" fill="${b.t}" fill-opacity=".9">${esc(b.l[0])}</text>
<text x="${x + 16}" y="${y + 105}" font-family="${MONO}" font-size="12.5" fill="${b.t}" fill-opacity=".9">${esc(b.l[1])}</text>`;
  });

  const small = [
    { v: fmt(user.public_repos), l: "public repos", f: C.dust, s: C.dustDk, t: C.night, i: "folder", ic: C.forestDk },
    { v: fmt(stars), l: "stars earned", f: C.forest, s: C.forestDk, t: C.text, i: "star", ic: C.dust },
    { v: topLang, l: "top language", f: C.granite, s: C.graniteDk, t: C.text, i: "code", ic: C.moss },
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

// ── Heatmap: elevation profile of weekly totals + daily grid in topo-map tints ──
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
  // Valley → forest → meadow → scree → snowcap
  const LV = [[C.night, "#3B4B5E"], [C.forest, C.text], [C.moss, C.night], [C.dust, C.night], [C.snow, C.night]];

  const gw = WEEKS * step - (step - cell), x0 = (W - gw) / 2;
  let body = `<text x="${x0}" y="48" font-family="${SANS}" font-size="16" fill="${C.text}"><tspan font-weight="800" font-size="22">${fmt(sum)}</tspan> contributions in the last 6 months</text>`;

  // Elevation profile: one point per week, like a race course profile.
  const weeks = Array.from({ length: WEEKS }, (_, w) => days.slice(w * 7, w * 7 + 7).reduce((s, [, n]) => s + n, 0));
  const pTop = 70, pBot = 150, maxW = Math.max(1, ...weeks);
  const px = (w) => x0 + w * step + cell / 2;
  const py = (n) => pBot - (n / maxW) * (pBot - pTop - 14);
  const line = weeks.map((n, w) => `${w ? "L" : "M"}${px(w).toFixed(1)} ${py(n).toFixed(1)}`).join(" ");
  const peakW = weeks.indexOf(Math.max(...weeks));
  body += `<path d="${line} L${px(WEEKS - 1)} ${pBot} L${px(0)} ${pBot} Z" fill="url(#ridge)"/>
<path d="${line}" fill="none" stroke="${C.moss}" stroke-width="2" stroke-linejoin="round"/>
<line x1="${x0}" y1="${pBot}" x2="${x0 + gw}" y2="${pBot}" stroke="${C.line}" stroke-width="1.5"/>
<text x="${x0}" y="${pTop + 6}" font-family="${MONO}" font-size="11" fill="${C.muted}">weekly elevation profile</text>`;
  if (weeks[peakW] > 0) {
    const fx = px(peakW), fy = py(weeks[peakW]);
    body += `<line x1="${fx}" y1="${fy}" x2="${fx}" y2="${fy - 22}" stroke="${C.snow}" stroke-width="1.6"/>
<polygon points="${fx},${fy - 22} ${fx + 14},${fy - 17} ${fx},${fy - 12}" fill="${C.sun}"/>
<text x="${fx - 6}" y="${fy - 12}" text-anchor="end" font-family="${MONO}" font-size="11" font-weight="700" fill="${C.sun}">peak ${weeks[peakW]}</text>`;
  }

  const y0 = 184;
  for (let w = 0; w < WEEKS; w++) {
    const sunday = addDays(start, w * 7);
    if (sunday.getUTCDate() <= 7) body += `<text x="${x0 + w * step}" y="${y0 - 10}" font-family="${MONO}" font-size="12.5" fill="${C.dust}">${MONTHS[sunday.getUTCMonth()]}</text>`;
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
  const lx = x0 + gw - 5 * 18 - 90;
  body += `<text x="${lx}" y="${ly + 12}" font-family="${MONO}" font-size="12.5" fill="${C.muted}">Valley</text>`;
  LV.forEach(([bg], k) => (body += `<rect x="${lx + 52 + k * 18}" y="${ly}" width="14" height="14" rx="3" fill="${bg}"${k ? "" : ` stroke="${C.line}"`}/>`));
  body += `<text x="${lx + 52 + 5 * 18 + 4}" y="${ly + 12}" font-family="${MONO}" font-size="12.5" fill="${C.muted}">Summit</text>`;
  const H = ly + 40;
  const defs = `<linearGradient id="ridge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.moss}" stop-opacity=".55"/><stop offset="1" stop-color="${C.forest}" stop-opacity=".08"/></linearGradient>`;
  return svg(W, H, `${panel(W, H)}\n${body}`, `${fmt(sum)} contributions in the last 6 months`, defs);
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "hero.svg"), heroCard());
for (const l of cfg.links) await writeFile(path.join(OUT, `link-${l.id}.svg`), linkPill(l));
await writeFile(path.join(OUT, "stats.svg"), stats());
await writeFile(path.join(OUT, "heatmap.svg"), heatmap());
console.log(`ok · last year ${lastYear} · streak ${cur} (best ${best}) · total ${total} · repos ${user.public_repos} · stars ${stars} · ${topLang}`);
