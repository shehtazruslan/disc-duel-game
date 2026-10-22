# Disc Duel

A 1v1 disc-throwing duel in a neon arena with 9 m glass walls. Discs ricochet off every wall, floor and ceiling; each bounce before a hit adds damage. Nobody has a health bar: deal more damage than your opponent before the 90-second clock runs out.

**Play:** open `index.html` in a browser, or visit the GitHub Pages site for this repository.

## Maps

Pick the map on the menu. Online, the host's map is used.

- **Classic:** a 22 × 32 m rectangle.
- **Plus:** a plus-shaped arena, 14 m wide arms and 58 m tip to tip. Discs can't pass the glass corners, so they're cover; bank shots (and the CPU) reach around them.

## Modes

- **vs CPU** with Easy, Normal and Hard difficulty. Both fighters take the difficulty's build: broad on Easy, athletic on Normal, tall and slim on Hard, with a hitbox that matches (smaller on harder levels). Online matches use the Hard build.
- **Online 1v1.** One player clicks *Create match* and sends the 4-character code; the other clicks *Join*. Browsers connect directly with WebRTC via [PeerJS](https://peerjs.com/). Some strict networks (work, school, mobile) block direct connections.

The glass walls look out on a stadium of other arenas. On the GitHub Pages site, other players' live matches (online or vs CPU) appear in the neighbouring cubes; cubes without a real match run CPU exhibitions. Add `?stadium=0` to the URL to turn the exhibitions off.

**Stadium hub:** `stadium-hub/` is a Cloudflare Worker (deploy with `npx wrangler deploy` from that folder) that assigns cubes, relays match digests and stores the worldwide leaderboard. See [docs/stadium-design.md](docs/stadium-design.md) for the plan to show real online matches there.

## Names, stats and leaderboard

- Set your name on the menu; online, your rival sees it.
- After each round, the results screen compares both players: damage, hits, accuracy, damage per hit, best hit, bank shots, most bounces in one hit, shield reflects, and curve, Heavy and Split hits.
- The leaderboard ranks the best rounds by damage for each mode (Easy, Normal, Hard, Online). On the GitHub Pages site it is **worldwide** (stored on the stadium hub; each player appears once per mode with their best round), with a *This computer* view too; inside the claude.ai artifact it is shared with everyone who can open the page.

## Controls

Default keys; every key can be changed in **Settings & controls**.

| Input | Action |
| --- | --- |
| Mouse | Aim (click the arena to capture the cursor). The crosshair turns orange on your opponent |
| Hold left click | Wind up, release to throw. A tap throws at 30 m/s, a full 0.8 s wind-up at 46 m/s |
| Flick the mouse as you release | Curves the throw that way; most of the spin is lost at the first wall |
| Left click (disc in flight) | Recall the disc |
| Right click / Q | Shield, reflects a disc back at its thrower (disc must be in hand) |
| W A S D | Move |
| Space | Jump; in the air next to a wall, wall jump |
| Left Shift | Dash; once more in the air, holding your height |
| C | Slide, ducking under high discs |
| E / R | Arm a Heavy / Split disc for your next throw |
| V | Switch between first person (default) and over-the-shoulder view |
| M / Esc | Mute / Pause |

## Special discs

Each recharges for 7 s after use.

- **Heavy (E):** about 28% slower and much bigger, +10 damage, and a shield can't reflect it.
- **Split (R):** at its first wall bounce it throws off two shards that live about 1.3 s and hit for 8 each.

## Settings

- **Mouse sensitivity** as a multiplier or in cm/360° (enter your mouse DPI). The game asks for raw mouse input, so cm/360° is exact in Chrome and Edge.
- **Field of view** (horizontal, first person) and **effects volume**.
- **Graphics:** neon glow on/off, floor reflections on/off, ambient occlusion (soft shading where things meet; off by default), matches in the neighboring arenas on/off, and a Fast resolution for slower computers (it also drops the fighters' shadows and the shading).
- **Show frame rate:** frames per second, frame times and, where the browser allows it, how long the graphics card takes per frame.

## Look

Discs leave glowing light trails. Every bounce throws sparks, flashes light onto the walls and floor, and sends a ripple of light through the arena's grid, while pulses of light run along the grid lines; a hit bursts a shockwave off the fighter.

## Sound

Sounds are positioned in 3D (HRTF), so with headphones you can hear which wall a disc bounced off and where a disc in flight is.

## Scoring

Direct hit 12 · each bank +8 · reflect +10 · recall hit 10 · a full wind-up adds up to +10.
