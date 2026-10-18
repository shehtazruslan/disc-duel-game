# Disc Duel

A 1v1 disc-throwing duel in a compact neon arena. Discs ricochet off every wall, floor and ceiling; each bounce before a hit adds damage. Nobody has a health bar: deal more damage than your opponent before the two-minute clock runs out.

**Play:** open `index.html` in a browser, or visit the GitHub Pages site for this repository.

## Modes

- **vs CPU** with Easy, Normal and Hard difficulty.
- **Online 1v1.** One player clicks *Create match* and sends the 4-character code; the other clicks *Join*. Browsers connect directly with WebRTC via [PeerJS](https://peerjs.com/). Some strict networks (work, school, mobile) block direct connections.

The glass walls look out on a stadium of other arenas. A few of them run CPU exhibition matches; add `?stadium=0` to the URL to turn those off. See [docs/stadium-design.md](docs/stadium-design.md) for the plan to show real online matches there.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim (click the arena to capture the cursor). The crosshair turns orange on your opponent |
| Hold left click | Wind up, release to throw. A tap throws at 30 m/s, a full 0.8 s wind-up at 46 m/s |
| Left click (disc in flight) | Recall the disc |
| Right click / Q | Shield, reflects a disc back at its thrower (disc must be in hand) |
| W A S D | Move |
| Space | Jump; in the air next to a wall, wall jump |
| Shift | Dash; once more in the air, holding your height |
| C | Slide, ducking under high discs |
| V | Switch between first person (default) and over-the-shoulder view |
| Esc / M | Pause / Mute |

Mouse sensitivity is on the menu and pause screens, as a multiplier or in cm/360° (enter your mouse DPI). The game asks the browser for raw mouse input, so cm/360° is exact in Chrome and Edge.

## Scoring

Direct hit 12 · each bank +8 · reflect +10 · recall hit 10 · a full wind-up adds up to +10.
