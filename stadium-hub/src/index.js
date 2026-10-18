// Disc Duel stadium hub: one Cloudflare Durable Object that knows every live match.
//
// Each match's host (the online host, or the player in a vs-CPU game) says hello, gets a cube in the
// stadium grid, and sends a small digest of its match ~10 times a second. Every connected page gets one
// batched frame per tick with the matches in the cubes around its own: every tick for the cubes next to it,
// every 5th tick for the ring beyond. Matches themselves never go through the hub; if it's down,
// they play on and the stadium just shows CPU exhibitions.
//
// client → hub  {t:'hello', role:'host', match:'<id>'}      host of a match, asks for a cube
//               {t:'hello', role:'viewer', slot?:[x,y,z]}     anyone else (a guest passes its host's cube)
//               {t:'d', s:<digest object>}                    host only, at most ~15 Hz
//               {t:'idle'}                                     host's round ended; cube is held 30 s for a rematch
// hub → client  {t:'slot', slot:[x,y,z]}
//               {t:'f', m:[[x, y, z, <digest>], ...]}

const TICK_MS = 100;
const FAR_EVERY = 5;            // ticks between updates for the second ring
const DIGEST_MAX = 1200;        // bytes
const DIGEST_MIN_GAP = 60;      // ms between digests from one host
const STALE_MS = 2500;          // a digest older than this isn't sent
const HOLD_MS = 30000;          // a finished or disconnected match keeps its cube this long
const SILENT_MS = 15000;        // a host that stops sending loses its cube after this
const MSG_MAX = 2048;

// Cubes, nearest the centre first, so live matches cluster around the middle of the stadium.
// The centre cube itself is never given out: it's where people on the menu watch from.
const SLOTS = [];
for (let x = -3; x <= 3; x++) for (let y = -1; y <= 1; y++) for (let z = -3; z <= 3; z++) if (x || y || z) SLOTS.push([x, y, z]);
SLOTS.sort((a, b) => (Math.abs(a[0]) + Math.abs(a[2]) + 2 * Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[2]) + 2 * Math.abs(b[1]))
  || Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]) || a[1] - b[1]);
const key = s => s.join(',');
const validSlot = s => Array.isArray(s) && s.length === 3 && s.every(v => Number.isInteger(v) && Math.abs(v) <= 3);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    // Only the game's own pages may connect (browsers always send Origin on WebSockets and cross-site requests).
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const originOk = !allowed.length || allowed.includes(origin);
    if (url.pathname === '/scores') {
      const cors = { 'Access-Control-Allow-Origin': originOk ? origin || '*' : 'null', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (!originOk) return new Response('Origin not allowed', { status: 403, headers: cors });
      const res = await env.BOARD.get(env.BOARD.idFromName('global')).fetch(req);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    }
    if (url.pathname !== '/ws') return new Response('Disc Duel stadium hub');
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (!originOk) return new Response('Origin not allowed', { status: 403 });
    return env.STADIUM.get(env.STADIUM.idFromName('global')).fetch(req);
  },
};

// ---------- Worldwide leaderboard ----------
// GET  /scores?mode=hard          → { runs: [{ name, score, hits, acc, mode, won, opp, at, tag }] } top 20
// POST /scores  { pid, runs: [...] } (1–20 runs, e.g. a player's old local bests the first time)
// Each player (a random id kept in their browser) keeps their best 5 rounds per mode.
// Scores come from players' browsers, so they're checked for sense, not proven.
const MODES = ['hard', 'normal', 'easy', 'online'];
const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
function cleanRun(r) {
  if (!r || typeof r !== 'object') return null;
  const score = Math.round(Number(r.score)), hits = Math.round(Number(r.hits)), acc = Math.round(Number(r.acc)), at = Math.round(Number(r.at));
  if (!MODES.includes(r.mode)) return null;
  // A 90 s round can't plausibly go past these.
  if (!(score > 0 && score <= 2500) || !(hits >= 1 && hits <= 200) || !(acc >= 0 && acc <= 100) || score > hits * 70) return null;
  if (!(at > 1.7e12 && at < Date.now() + 864e5)) return null;
  return { name: cleanName(r.name) || 'Player', score, hits, acc, mode: r.mode, won: r.won ? 1 : 0, opp: cleanName(r.opp) || 'CPU', at };
}
// A short public tag per player: lets a page spot its own rows without revealing the id.
async function tagOf(pid) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('disc-duel:' + pid));
  return [...new Uint8Array(h).slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export class Leaderboard {
  constructor(state) {
    this.sql = state.storage.sql;
    this.last = new Map(); // pid -> last submit time (rate limit)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY, tag TEXT, name TEXT, score INTEGER, hits INTEGER, acc INTEGER,
      mode TEXT, won INTEGER, opp TEXT, at INTEGER)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS runs_mode_score ON runs (mode, score DESC)');
  }
  json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const mode = url.searchParams.get('mode');
      if (!MODES.includes(mode)) return this.json({ error: 'bad mode' }, 400);
      const runs = this.sql.exec('SELECT name, score, hits, acc, mode, won, opp, at, tag FROM runs WHERE mode = ? ORDER BY score DESC, at ASC LIMIT 20', mode).toArray();
      return this.json({ runs });
    }
    if (req.method !== 'POST') return this.json({ error: 'method' }, 405);
    const text = await req.text();
    if (text.length > 8000) return this.json({ error: 'too big' }, 413);
    let body;
    try { body = JSON.parse(text); } catch (e) { return this.json({ error: 'bad json' }, 400); }
    const pid = typeof body.pid === 'string' && /^[a-z0-9]{12,40}$/.test(body.pid) ? body.pid : null;
    if (!pid || !Array.isArray(body.runs) || !body.runs.length || body.runs.length > 20) return this.json({ error: 'bad request' }, 400);
    const now = Date.now();
    if (now - (this.last.get(pid) || 0) < 15000) return this.json({ error: 'slow down' }, 429);
    this.last.set(pid, now);
    if (this.last.size > 5000) this.last.clear();
    const tag = await tagOf(pid);
    let saved = 0;
    for (const raw of body.runs) {
      const r = cleanRun(raw);
      if (!r) continue;
      // Skip an exact repeat (the same round sent twice).
      if (this.sql.exec('SELECT 1 FROM runs WHERE tag = ? AND mode = ? AND at = ? AND score = ?', tag, r.mode, r.at, r.score).toArray().length) continue;
      this.sql.exec('INSERT INTO runs (tag, name, score, hits, acc, mode, won, opp, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        tag, r.name, r.score, r.hits, r.acc, r.mode, r.won, r.opp, r.at);
      saved++;
      // Keep this player's best 5 for the mode, and the best 500 overall per mode.
      this.sql.exec('DELETE FROM runs WHERE tag = ? AND mode = ? AND id NOT IN (SELECT id FROM runs WHERE tag = ? AND mode = ? ORDER BY score DESC, at ASC LIMIT 5)', tag, r.mode, tag, r.mode);
      this.sql.exec('DELETE FROM runs WHERE mode = ? AND id NOT IN (SELECT id FROM runs WHERE mode = ? ORDER BY score DESC, at ASC LIMIT 500)', r.mode, r.mode);
    }
    return this.json({ saved, tag });
  }
}

export class StadiumHub {
  constructor(state, env) {
    this.state = state;
    this.clients = new Set();
    this.slots = new Map();   // key -> { slot, match, owner, raw, at, heldUntil }
    this.timer = null;
    this.tick = 0;
  }

  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const c = { ws: server, role: 'viewer', slot: null, origin: [0, 0, 0], lastD: 0 };
    this.clients.add(c);
    server.addEventListener('message', ev => this.onMessage(c, ev.data));
    const done = () => this.onClose(c);
    server.addEventListener('close', done);
    server.addEventListener('error', done);
    if (!this.timer) this.timer = setInterval(() => this.onTick(), TICK_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(c, obj) { try { c.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (e) { /* closing */ } }

  onMessage(c, data) {
    if (typeof data !== 'string' || data.length > MSG_MAX) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    const now = Date.now();
    if (msg.t === 'hello') {
      if (msg.role === 'host' && typeof msg.match === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(msg.match)) {
        this.release(c, now);
        const slot = this.claim(c, msg.match, now);
        c.role = slot ? 'host' : 'viewer';
        c.slot = slot; c.origin = slot || [0, 0, 0];
        this.send(c, { t: 'slot', slot });
      } else {
        this.release(c, now);
        c.role = 'viewer';
        c.origin = validSlot(msg.slot) ? msg.slot : [0, 0, 0];
      }
    } else if (msg.t === 'd' && c.role === 'host' && c.slot) {
      if (now - c.lastD < DIGEST_MIN_GAP) return;
      const e = this.slots.get(key(c.slot));
      if (!e || e.owner !== c || !msg.s || typeof msg.s !== 'object') return;
      const raw = JSON.stringify(msg.s);
      if (raw.length > DIGEST_MAX) return;
      c.lastD = now; e.raw = raw; e.at = now;
    } else if (msg.t === 'idle') {
      this.release(c, now);
    }
  }

  // Give a host the nearest free cube, or its old one back (a rematch, or a reconnect within the hold time).
  claim(c, match, now) {
    for (const e of this.slots.values()) {
      if (e.match === match && (!e.owner || e.owner === c)) { e.owner = c; e.heldUntil = 0; e.at = now; return e.slot; }
    }
    for (const s of SLOTS) {
      if (!this.slots.has(key(s))) { this.slots.set(key(s), { slot: s, match, owner: c, raw: null, at: now, heldUntil: 0 }); return s; }
    }
    return null; // stadium full: the match plays, it just isn't shown
  }
  // The host stops owning its cube; it stays reserved for HOLD_MS (keeping its last picture off the board).
  release(c, now) {
    if (c.role !== 'host' || !c.slot) return;
    const e = this.slots.get(key(c.slot));
    if (e && e.owner === c) { e.owner = null; e.raw = null; e.heldUntil = now + HOLD_MS; }
    c.role = 'viewer';
  }
  onClose(c) {
    this.release(c, Date.now());
    this.clients.delete(c);
  }

  onTick() {
    const now = Date.now();
    this.tick++;
    for (const [k, e] of this.slots) {
      if ((!e.owner && now > e.heldUntil) || (e.owner && now - e.at > SILENT_MS)) {
        if (e.owner) { e.owner.role = 'viewer'; }
        this.slots.delete(k);
      }
    }
    if (!this.clients.size) { clearInterval(this.timer); this.timer = null; return; }
    const live = [];
    for (const e of this.slots.values()) if (e.raw && now - e.at < STALE_MS) live.push(e);
    if (!live.length) return;
    const far = this.tick % FAR_EVERY === 0;
    for (const c of this.clients) {
      const o = c.origin, parts = [];
      for (const e of live) {
        const s = e.slot;
        const d = Math.max(Math.abs(s[0] - o[0]), Math.abs(s[1] - o[1]), Math.abs(s[2] - o[2]));
        if (d === 0 || d > 2 || (d === 2 && !far)) continue;
        parts.push('[' + s[0] + ',' + s[1] + ',' + s[2] + ',' + e.raw + ']');
      }
      if (parts.length) this.send(c, '{"t":"f","m":[' + parts.join(',') + ']}');
    }
  }
}
