# Disc Duel

A 1v1 disc-throwing duel in a compact neon arena. Discs ricochet off every wall, floor and ceiling; each bounce before a hit adds damage. Nobody has a health bar: deal more damage than your opponent before the two-minute clock runs out.

**Play:** open `index.html` in a browser, or visit the GitHub Pages site for this repository.

## Modes

- **vs CPU** with Easy, Normal and Hard difficulty.
- **Online 1v1.** One player clicks *Create match* and sends the 4-character code; the other clicks *Join*. Browsers connect directly with WebRTC via [PeerJS](https://peerjs.com/). Some strict networks (work, school, mobile) block direct connections.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim (click the arena to capture the cursor) |
| Left click | Throw disc, click again to recall it |
| Right click / Q | Shield, reflects a disc back at its thrower (disc must be in hand) |
| W A S D | Move |
| Space / Shift | Jump / Dash |
| Esc / M | Pause / Mute |

## Scoring

Direct hit 12 · each bank +8 · reflect +10 · recall hit 10.
