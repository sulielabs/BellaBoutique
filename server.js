'use strict';
/**
 * Bella Boutique — static host + visitor counter + password-protected dashboard.
 * No npm dependencies: Node built-ins only.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------- config
// Trailing spaces, stray newlines and wrapping quotes are the classic
// copy-paste artefacts when setting a variable in a hosting dashboard.
function cleanEnv(v) {
  let out = (v || '').trim();
  if (out.length > 1 && ((out[0] === '"' && out.endsWith('"')) || (out[0] === "'" && out.endsWith("'")))) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

// A stray space or wrong case in the variable NAME is just as common as in its
// value, so match forgivingly rather than failing silently.
const rawEnv = {};
function readEnv(name) {
  let raw = process.env[name];
  if (raw == null) {
    for (const key of Object.keys(process.env)) {
      if (key.trim().toUpperCase() === name) { raw = process.env[key]; break; }
    }
  }
  if (raw == null) return '';
  rawEnv[name] = raw;
  return cleanEnv(raw);
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || __dirname);
const DATA_DIR = path.resolve(readEnv('DATA_DIR') || path.join(__dirname, 'data'));
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const ADMIN_PASSWORD = readEnv('ADMIN_PASSWORD');
const SESSION_SECRET = readEnv('SESSION_SECRET');
const SESSION_HOURS = 12;
const SITE_URL = readEnv('SITE_URL').replace(/\/+$/, '');

function siteUrl(req) {
  if (SITE_URL) return SITE_URL;
  const host = req.headers.host || 'localhost';
  return (isSecure(req) ? 'https://' : 'http://') + host;
}

if (!ADMIN_PASSWORD) {
  console.error('[bella] ADMIN_PASSWORD is NOT SET — the dashboard cannot be opened.');
  const seen = Object.keys(process.env)
    .filter(k => /ADMIN|PASS|SECRET|SESSION|SITE|DATA_DIR/i.test(k))
    .map(k => JSON.stringify(k));
  console.error('[bella] related variable NAMES this service can see (values hidden): '
    + (seen.length ? seen.join(', ') : 'NONE — no variables reached the container at all'));
} else {
  const raw = rawEnv.ADMIN_PASSWORD || '';
  console.log(`[bella] admin password loaded — ${ADMIN_PASSWORD.length} characters`);
  if (raw !== ADMIN_PASSWORD) {
    console.warn(`[bella] NOTE: the stored value had ${raw.length - ADMIN_PASSWORD.length} extra character(s) `
      + '(spaces, a newline, or quotes). They were ignored — type the password without them.');
  }
}
if (!SESSION_SECRET) {
  console.warn('[bella] SESSION_SECRET is not set — sessions will end on every restart.');
}
const SECRET = SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Never served as static files.
const BLOCKED = new Set(['/server.js', '/package.json', '/package-lock.json', '/readme.md']);
const BLOCKED_DIRS = ['/data/', '/admin/', '/.git/', '/node_modules/'];

const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternal|embedly|quora link|pinterest|headless|lighthouse|pagespeed|uptime|monitor|curl\/|wget|python-requests|axios\//i;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.pdf': 'application/pdf'
};

// ---------------------------------------------------------------- storage
let stats = { firstDay: today(), totalViews: 0, totalVisitors: 0, days: {} };
let dirty = false;

function today() {
  // Riyadh is UTC+3 and has no DST, so a fixed offset is accurate year-round.
  return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
}

function loadStats() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.days) stats = parsed;
      console.log('[bella] stats loaded:', Object.keys(stats.days).length, 'days');
    }
  } catch (err) {
    console.error('[bella] could not read stats, starting fresh:', err.message);
  }
}

function saveStats() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(stats));
    fs.renameSync(tmp, STATS_FILE); // atomic: never leaves a half-written file
  } catch (err) {
    console.error('[bella] could not write stats:', err.message);
  }
}

setInterval(saveStats, 10000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { saveStats(); process.exit(0); });
}

function recordVisit(pagePath, isNewVisitor, isNewToday) {
  const d = today();
  const day = stats.days[d] || (stats.days[d] = { views: 0, visitors: 0, pages: {} });
  day.views++;
  stats.totalViews++;
  if (isNewToday) day.visitors++;
  if (isNewVisitor) stats.totalVisitors++;
  day.pages[pagePath] = (day.pages[pagePath] || 0) + 1;
  if (!stats.firstDay || d < stats.firstDay) stats.firstDay = d;
  dirty = true;
}

// ---------------------------------------------------------------- helpers
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function cookie(name, value, req, maxAgeSec) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (maxAgeSec != null) bits.push(`Max-Age=${maxAgeSec}`);
  if (isSecure(req)) bits.push('Secure');
  return bits.join('; ');
}

function sign(exp) {
  return crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
}

function makeSession() {
  const exp = Date.now() + SESSION_HOURS * 3600e3;
  return `${exp}.${sign(exp)}`;
}

function validSession(token) {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = Buffer.from(sign(exp), 'utf8');
  const got = Buffer.from(mac, 'utf8');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function passwordMatches(input) {
  if (!ADMIN_PASSWORD || typeof input !== 'string') return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// crude but effective: slows brute force without any external dependency
const attempts = new Map();
function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > 15 * 60e3) { attempts.delete(ip); return false; }
  return rec.n >= 8;
}
function noteAttempt(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > 15 * 60e3) attempts.set(ip, { n: 1, first: Date.now() });
  else rec.n++;
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers));
  res.end(body);
}
function sendJson(res, code, obj, headers = {}) {
  send(res, code, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
}
function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > limit) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- routes
function loginPage(message) {
  const file = path.join(__dirname, 'admin', 'login.html');
  let html = fs.readFileSync(file, 'utf8');
  return html.replace('<!--MESSAGE-->', message
    ? `<p class="msg" role="alert">${message}</p>` : '');
}

function buildReport(rangeDays) {
  const days = [];
  const now = new Date(Date.now() + 3 * 3600e3);
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400e3).toISOString().slice(0, 10);
    const rec = stats.days[d];
    days.push({ date: d, views: rec ? rec.views : 0, visitors: rec ? rec.visitors : 0 });
  }
  const pages = {};
  for (const { date } of days) {
    const rec = stats.days[date];
    if (!rec) continue;
    for (const [p, n] of Object.entries(rec.pages)) pages[p] = (pages[p] || 0) + n;
  }
  const topPages = Object.entries(pages)
    .sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([path, views]) => ({ path, views }));

  const sum = (arr, k) => arr.reduce((t, x) => t + x[k], 0);
  const last7 = days.slice(-7);
  const prev7 = days.slice(-14, -7);

  return {
    today: days[days.length - 1] || { views: 0, visitors: 0 },
    range: { days: rangeDays, views: sum(days, 'views'), visitors: sum(days, 'visitors') },
    week: { views: sum(last7, 'views'), visitors: sum(last7, 'visitors') },
    prevWeek: { views: sum(prev7, 'views'), visitors: sum(prev7, 'visitors') },
    allTime: { views: stats.totalViews, visitors: stats.totalVisitors, since: stats.firstDay },
    series: days,
    topPages,
    generatedAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------- static
function safePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const resolved = path.resolve(PUBLIC_DIR, '.' + p);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) return null;
  return resolved;
}

function serveStatic(req, res, urlPath) {
  const lower = urlPath.toLowerCase();
  if (BLOCKED.has(lower) || BLOCKED_DIRS.some(d => lower.startsWith(d)) || lower.split('/').some(s => s.startsWith('.'))) {
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const file = safePath(urlPath);
  if (!file) return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    const isHtml = ext === '.html';

    const headers = {
      'Content-Type': type,
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable'
    };
    if (!isHtml) headers['Content-Length'] = st.size;

    // count the page view, and hand out the two counting cookies
    if (isHtml && req.method === 'GET' && !BOT.test(req.headers['user-agent'] || '')) {
      const c = parseCookies(req);
      const d = today();
      const isNewVisitor = !c.bb_vid;
      const isNewToday = c.bb_day !== d;
      const setCookies = [];
      if (isNewVisitor) setCookies.push(cookie('bb_vid', crypto.randomUUID(), req, 400 * 86400));
      if (isNewToday) setCookies.push(cookie('bb_day', d, req, 2 * 86400));
      if (setCookies.length) headers['Set-Cookie'] = setCookies;
      recordVisit(urlPath.split('?')[0] || '/', isNewVisitor, isNewToday);
    }

    if (isHtml) {
      let body;
      try { body = fs.readFileSync(file, 'utf8').split('{{SITE_URL}}').join(siteUrl(req)); }
      catch { return send(res, 500, 'Server error', { 'Content-Type': 'text/plain; charset=utf-8' }); }
      headers['Content-Length'] = Buffer.byteLength(body);
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res).on('error', () => res.end());
  });
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const authed = validSession(parseCookies(req).bb_session);

  try {
    // --- dashboard ---
    if (urlPath === '/admin' || urlPath === '/admin/') {
      if (!authed) {
        return send(res, 200, loginPage(''), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      const html = fs.readFileSync(path.join(__dirname, 'admin', 'dashboard.html'), 'utf8');
      return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    }

    if (urlPath === '/admin/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (tooManyAttempts(ip)) {
        return send(res, 429, loginPage('محاولات كثيرة. انتظري ١٥ دقيقة ثم حاولي مرة أخرى.'),
          { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      const body = await readBody(req);
      const password = (new URLSearchParams(body).get('password') || '').trim();
      if (!passwordMatches(password)) {
        noteAttempt(ip);
        return send(res, 401, loginPage('كلمة المرور غير صحيحة.'),
          { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      attempts.delete(ip);
      return send(res, 302, '', {
        Location: '/admin',
        'Set-Cookie': cookie('bb_session', makeSession(), req, SESSION_HOURS * 3600),
        'Cache-Control': 'no-store'
      });
    }

    if (urlPath === '/admin/logout') {
      return send(res, 302, '', {
        Location: '/admin',
        'Set-Cookie': cookie('bb_session', '', req, 0),
        'Cache-Control': 'no-store'
      });
    }

    if (urlPath === '/admin/api/stats') {
      if (!authed) return sendJson(res, 401, { error: 'unauthorized' });
      const range = Math.min(365, Math.max(7, Number(new URL(req.url, 'http://x').searchParams.get('range')) || 30));
      return sendJson(res, 200, buildReport(range));
    }

    if (urlPath === '/robots.txt') {
      const body = [
        'User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /logo-kit.html', '',
        `Sitemap: ${siteUrl(req)}/sitemap.xml`, ''
      ].join('\n');
      return send(res, 200, body, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    }

    if (urlPath === '/sitemap.xml') {
      const base = siteUrl(req);
      const skip = new Set(['logo-kit.html']);
      let pages;
      try {
        pages = fs.readdirSync(PUBLIC_DIR).filter(f => f.endsWith('.html') && !skip.has(f));
      } catch { pages = ['index.html']; }
      pages.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
      const urls = pages.map(f => {
        let lastmod = '';
        try { lastmod = fs.statSync(path.join(PUBLIC_DIR, f)).mtime.toISOString().slice(0, 10); } catch {}
        const loc = base + '/' + (f === 'index.html' ? '' : f);
        const priority = f === 'index.html' ? '1.0' : f.startsWith('product-') ? '0.8' : '0.5';
        return `  <url>\n    <loc>${loc}</loc>\n` +
               (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
               `    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
      }).join('\n');
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
      return send(res, 200, body, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    }

    if (urlPath === '/healthz') return sendJson(res, 200, { ok: true });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    return serveStatic(req, res, urlPath);
  } catch (err) {
    console.error('[bella]', err);
    if (!res.headersSent) send(res, 500, 'Server error', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

loadStats();
server.listen(PORT, () => console.log(`[bella] listening on ${PORT} — serving ${PUBLIC_DIR}`));
