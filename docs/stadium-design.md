# Stadium mode: design

Status: Phase 0 is implemented (the "Stadium" section of `index.html`). Phases 1 and later are still plans.

**Goal.** Every live online match gets its own cube in one shared grid. Through the glass walls, players see the other matches in the neighbouring cubes, like the stadium in Tron Legacy. Today the 5×3×5 grid of neighbour cubes in `index.html` ("Neighboring arenas") is decoration only.

**Constraints from the current code**

- Each match is a closed 1v1 channel: the host simulates discs, hits, score and clock and sends a ~30 Hz snapshot (`netSend`, `k:'h'`); the guest sends its fighter and action counters (`k:'g'`).
- There are two transports. Inside a claude.ai artifact it is the `room` capability, and the sandbox blocks every other server (that's why PeerJS is off there). On GitHub Pages it is PeerJS, where peer ID `discduel-v1-<code>` is the host.
- Nothing lists all the matches. A match exists only as a PeerJS ID or a room name that someone has to know.
- Geometry: each cube is 22 m square with 9 m walls. Cubes are spaced `GAP_X = ARENA + 10 = 32 m` apart horizontally and `GAP_Y = CEIL + 8 = 17 m` vertically. Fog ends at 120 m, so the whole ±2 × ±1 × ±2 grid can be seen faintly.

---

## 1. Discovery: how a page learns which matches exist

Something has to hold a list of live matches that every page can read. The options:

| Option | Cost | Reliability | Code change | Notes |
| --- | --- | --- | --- | --- |
| **Cloudflare Worker + one Durable Object ("stadium hub")** (PartyKit is now Cloudflare's PartyServer, built on the same thing) | Free tier is likely enough for a hobby game (see below) | High. It is a real server with one authoritative slot table | Hub is about 150 lines of TS in a new `stadium-hub/` folder, deployed with `wrangler`. Client is one `WebSocket` | Can batch and filter per viewer (level of detail), which is the main reason to pick it |
| Colyseus | Needs an always-on Node host: Colyseus Cloud is paid, and free tiers like Render and Fly sleep or have shrunk | High once hosted | Bigger: a Colyseus schema and client library | More than we need. Its strength is server-side game simulation, and we already simulate on the host |
| PeerJS "lobby peer" (well-known ID `discduel-v1-lobby`; the first tab to claim it becomes the lobby) | Free, no new infrastructure | Low. The lobby is somebody's browser tab, so it needs re-election when that tab closes. It fans out N WebRTC links from one browser and hits the same strict-NAT failures players already see | Medium: election logic, a list protocol, reconnect handling | Works as a demo with a handful of matches. Breaks without warning |
| Hosted realtime service (Supabase Realtime, Ably, Firebase RTDB) | Free tiers count delivered messages (about 2–6 M per month) or cap connections (100–200) | High | Small: their SDK plus channel pub/sub | Without a server to batch messages, one viewer watching 26 cubes at 10 Hz receives about 260 messages a second, so a free quota runs out in hours |
| claude.ai `room` with a shared stadium room (`dd-stadium`) | Free | As reliable as the match rooms | Small: same API as today's match room | **Works only inside the artifact.** It is the only option that works there at all. Its limits on peers per room and presence size and rate need checking |

**Recommendation**

- **On GitHub Pages: a Cloudflare Worker with one Durable Object as the stadium hub.** It is the only option that is reliable, close to free, and can send each viewer one batched, filtered frame per tick. A single global DO comfortably handles the scale we expect (tens of matches). Match traffic itself stays on PeerJS, so if the hub is down you lose the stadium view but matches still play.
- **Inside the claude.ai artifact: a shared `room` named `dd-stadium`.** The host's presence carries the low-rate digest (section 2), and slots are derived on each page from the sorted host peer IDs (section 3), so no server is needed. This works only if the room's presence rate and size limits allow about 5 Hz with roughly 200 bytes. Check that first; if they don't, the artifact build keeps decorative neighbours.
- Artifact players and GitHub Pages players live in separate stadiums. The artifact sandbox can't reach a Cloudflare hub, so they can't be joined.

Rough cost on the Cloudflare free plan (check current pricing before relying on this): a Durable Object bills incoming WebSocket messages at 20 messages per request. 10 hosts × 5 Hz = 50 msg/s ≈ 2.5 billed requests/s, about 9 k per busy hour against a 100 k per day allowance. Outgoing messages aren't billed per message, and Workers have no egress fees. Active duration is the tighter limit: one DO awake 24/7 uses most of the free GB-seconds. So the hub should go idle (stop its tick timer and use WebSocket hibernation) when no match is live. If it outgrows the free tier, Workers Paid costs $5 a month.

**Hub protocol (JSON to start; switch to binary later if needed)**

```
client → hub  {t:'hello', role:'host'|'viewer', match?:'<code>'}      // a host registers its match
hub → client  {t:'slot', slot:[ix,iy,iz]}                              // host: its own cube
client → hub  {t:'d', s:<digest>}                                       // host only, 5–10 Hz
hub → client  {t:'f', now, m:[[slotKey, digest], ...], gone:[slotKey]} // per viewer, filtered by distance
```

Only the **host** publishes, because it already holds both fighters (its own, plus the guest's from snapshots), both discs and the score. The guest is just a viewer of the hub, whose own slot is told to it by the host (add `sl:[ix,iy,iz]` to the `k:'h'` snapshot).

## 2. Spectator data

**The digest** is a much smaller version of the host snapshot. It keeps only what a viewer 30 m away through glass can see.

```
[tm, scoreA, scoreB, hitSeq,
 fA: x, y, z, yaw, pose,          // pose = bitfield: charging | blocking | sliding | throwing | flash
 fB: x, y, z, yaw, pose,
 dA: state, x, y, z, vx, vy, vz,
 dB: state, x, y, z, vx, vy, vz]
```

That is 28 numbers, about 170 bytes as JSON or about 70 bytes as quantised Int16 (centimetres, 0.01 rad). `hitSeq` lets viewers flash a ring when a hit lands next door, without forwarding the full `fx` log.

**Rates**

- Discs move at up to 46 m/s but travel in straight lines with mirror bounces. A viewer extrapolates them the same way `remoteDisc` already does (velocity plus `BMIN`/`BMAX` reflection), so 5 Hz looks right.
- Fighters change direction often, so they get 10 Hz for close cubes. The host publishes at 10 Hz, and the hub thins it out for distant viewers.

**Level of detail**

The hub filters per viewer, using grid distance `d = max(|Δix|, |Δiy|, |Δiz|)` from that viewer's slot:

| Tier | Cubes | Rate | Rendering |
| --- | --- | --- | --- |
| Adjacent (`d = 1`) | up to 26 | 10 Hz | Full `makeFighterMesh` + `makeDiscMesh` with pose and short disc trails |
| Second ring (`d = 2`) | up to 98 | 2 Hz | Instanced glow capsule + disc ring, no limbs |
| Farther | — | 0.2 Hz, occupancy and score only | Lit floor or edge tint so the cube reads as "live", no figures |

**Bandwidth (JSON, before binary)**

- Host upstream: 170 B × 10 Hz ≈ **1.7 KB/s** extra, much less than the 30 Hz match snapshot it already sends.
- Viewer downstream when every adjacent and second-ring cube is busy: 26 × 1.7 KB/s + 98 × 0.34 KB/s ≈ **78 KB/s**. A realistic 10–20 matches total gives **5–25 KB/s**. Binary cuts these by about 2.5×.
- Hub egress for M matches (2M viewers), each seeing roughly all M at full rate: about 2M × M × 1.7 KB/s. At M = 20 that is about 1.4 MB/s, which is fine for a DO and costs nothing in egress on Cloudflare. Batching one frame per viewer per tick (10 Hz) keeps the message count at 2M × 10 per second no matter how many matches there are.

## 3. Slots and how they appear in the scene

**Slot assignment**

- **Use a fixed grid, filled from the centre outwards.** The grid is 7 × 3 × 7 = 147 slots, the ±2 view grid plus margin. When a match registers, the hub gives it the free slot nearest the centre (sort by `|ix| + |iz| + 2|iy|`; ties in a fixed spiral order), so live matches cluster and neighbours are actually filled.
- Choose fixed over a growing grid: positions never shift while you watch, and the scene stays bounded. If all 147 slots are taken, a new match gets no slot. It plays normally and is simply not shown in the stadium.
- **Each player's own cube stays at the world origin.** Others are drawn at `(slot_other − slot_mine) × (GAP_X, GAP_Y, GAP_X)`. Gameplay coordinates, physics and camera are untouched.
- **When a match ends:** the slot is held for 30 s while it shows `over` (to cover the Rematch button), then freed. On a rematch the host keeps its slot. If a host's WebSocket drops, the slot is freed after a 10 s grace period. Slots never compact; the next new match fills the hole.
- **Inside the artifact (no server):** each page sorts the `dd-stadium` hosts by `(joinedAt, peer)` and gives the i-th host the i-th slot in the same centre-out order. Every page computes the same answer. A match ending can shift later matches by one slot. That's acceptable for a fallback; to avoid it, keep a host's index fixed until it leaves.

**In the scene**

- Add one `THREE.Group` per occupied neighbour slot, positioned at its offset. Inside it, everything is in match-local coordinates, so existing helpers work unchanged:
  - `makeFighterMesh(COL_YOU / COL_CPU)` ×2 and `makeDiscMesh` ×2 for adjacent cubes, taken from a pool of about 12 sets that is reused when a slot changes. Making 26 sets would mean about 1,300 extra draw calls.
  - One `InstancedMesh` each for capsules and discs in the second ring: two draw calls in total.
- **Interpolation:** keep the last 3 digests per match with their arrival times and render fighters at `now − 2 × interval` (200 ms at 10 Hz), lerping position and yaw. Discs use the extrapolation in `remoteDisc`, which already clamps and mirrors inside `BMIN`/`BMAX`. Factor its maths into a pure function so both the opponent disc and neighbour discs can use it. Feed the pose bits into the existing `fighterVisual` fields (`charging`, `blockT`, `slideT`, `throwAnim`).
- **Small touches:**
  - A neighbour cube's edges light up (in the existing `0x8fe8ff` tone) while its match is live.
  - A ring flashes when `hitSeq` increments.
  - A floating score sits above each live cube.
  - No neighbour sound; for later, maybe a faint thud on adjacent hits.
- **Performance budget:** on top of today's frame, at most 12 full fighter/disc sets plus 2 instanced draws. The scene should skip neighbour updates when the tab is hidden and respect `reducedMotion` (no flashes).

## 4. Phased plan

1. **Phase 0: local exhibition matches. No network. Done.** Six neighbour cubes (the four beside you, the one above, one diagonal) each run a small CPU-vs-CPU simulation of their own at 30 Hz. Each one emits a 10 Hz digest, and the cube is drawn only from those digests: fighters are interpolated 200 ms behind, flying discs are extrapolated with their bounces. Live cubes get bright edges, a hit ring and a floating scoreboard labelled EXHIBITION; they use their own colour pairs so they never look like your match. The simulation is separate from the main match (it does not use `aiUpdate`/`updateDisc`, which touch the main game's score, sounds and freeze-frame). It is on by default; `?stadium=0` turns it off. Measured CPU cost: under 0.1 ms per frame for all six.
2. **Phase 1: hub plus host publishing, on GitHub Pages only.**
   - Deploy the Worker/DO hub.
   - Hosts send `hello` and the digest; the host sends its slot to the guest in `sl`.
   - Both players receive filtered frames, and real matches replace the fakes.
   - If the hub is unreachable, fall back to Phase 0 fakes or empty cubes. The match itself is never affected.
3. **Phase 2: spectator mode.** A "Watch the stadium" menu button joins the hub as a viewer with no match. The viewer gets a free-fly or orbit camera that clicks into a cube to follow it, at full rate for that one cube. Optional: "Quick match", where the hub pairs two waiting players and hands out a PeerJS code. This removes manual code sharing.
4. **Phase 3: artifact stadium.** Check `room` presence limits, then add the `dd-stadium` room path with client-derived slots. Skip it if the limits don't fit.
5. **Phase 4: polish and scale.** Binary digests, hub idling and hibernation, rate limits and size checks on the hub (reject digests over 512 B or faster than 15 Hz; clamp values), mixing CPU matches into empty slots, and a "most exciting match" spotlight.

**Open questions for you**

- Should vs-CPU games also publish to the stadium, to fill it out, or only online matches?
- Is a Cloudflare account and a `wrangler` deploy acceptable? It is the only new infrastructure in this plan.
- Should spectators (Phase 2) be visible to players, for example as a crowd glow on the outer walls?
