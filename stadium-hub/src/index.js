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
    if (url.pathname !== '/ws') return new Response('Disc Duel stadium hub');
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    // Only the game's own pages may connect (browsers always send Origin on a WebSocket handshake).
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    if (allowed.length && !allowed.includes(origin)) return new Response('Origin not allowed', { status: 403 });
    return env.STADIUM.get(env.STADIUM.idFromName('global')).fetch(req);
  },
};

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
