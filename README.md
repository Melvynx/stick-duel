# Stick Duel

Online stickman shooter with destructible, falling-sand pixel maps. Play it at [game.melvynx.dev](https://game.melvynx.dev).

- **1v1 duels**: quick match or private rooms, the host picks the weapon pool.
- **Solo survival**: waves of bots, unlock a new weapon after each wave.
- **Co-op survival**: up to 4 players online, shared crew lives and revives.

Every explosion, rocket and cutter beam carves the terrain; sand and debris fall and settle. Build walls and floors with the builder to hold your ground.

## Run it

Requires Node.js 20+ and pnpm.

```bash
pnpm install
pnpm start      # http://localhost:3030
pnpm dev        # same, restarts on file changes
pnpm test
```

Env vars: `PORT` (default `3030`), `HOST` (default `0.0.0.0`). `GET /healthz` returns server stats. The only runtime dependency is `ws`; there is no build step, the browser loads `public/` and `shared/` as native ES modules.

## Controls

| Key | Action |
| --- | --- |
| `A` / `D` | Run (`Shift` to sprint) |
| `Space` | Jump, again to flip, hold for jetpack |
| `S` | Drop down |
| Left click | Shoot |
| Right click | Grenade / detonate C4 |
| `1`-`9`, wheel, `Q` | Switch weapon, `Q` for the last one |
| `F` | Shove, breaks what blocks you |
| `B` | Builder: aim sideways for a wall, up or down for a floor, `T` for style |
| `H` / `Esc` / `M` | Controls panel / menu and settings / mute |

Keys use physical positions, so ZQSD on AZERTY works like WASD.

## How it works

The Node.js server is authoritative and ticks at 60 Hz. `shared/` is imported by both the server and the browser: player physics, projectiles and the terrain automaton are deterministic, so clients predict their own movement and replay terrain ops in lockstep instead of receiving pixels.

```
server/   lobby, 1v1 rooms, co-op rooms, input queues and snapshots
shared/   game core, weapons, maps, falling-sand sim, survival engine and bots
public/   static client: rendering, prediction, HUD, audio, menus
test/     node:test suite
```

[`AGENTS.md`](AGENTS.md) has the full module map and the wire-format rules (weapon indices, item kinds and op codes are append-only).

## License

[MIT](LICENSE)
