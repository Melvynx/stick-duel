# Stick Duel

Online stickman shooter with destructible pixel maps: 1v1 duels, solo survival waves and online co-op survival (up to 4). Node.js authoritative server (`server/`), shared simulation (`shared/`, imported by both server and browser), static browser client (`public/`). No build step.

## Commands

- `pnpm start` - start the server on `PORT` (default 3030)
- `pnpm test` - run the node test suite

## Rules

- Use pnpm, never npm.
- `shared/` runs on both sides: player and projectile physics must stay deterministic and identical for client prediction.
- NEVER use `rm -rf`; use `trash`.
- Weapon indices, `ITEM` kinds and `OP` codes are wire format: only ever append.
- Every terrain change on the authority goes through `world.op()` so clients replay it; never mutate `terrain` directly from game code.

## Module map

Read only the module you need; each file starts with a comment saying what it owns.

- `shared/game.js` - authoritative `Game` core (players, ticks, snapshots, armory timer). Behaviour is mixed in from `shared/game/`: `combat.js` (firing, continuous tools), `blast.js` (damage, explosions, projectile flight), `items.js` (crates/ammo/packs, `grant`, `nextLocked`), `world.js` (`op` -> sandbox).
- `shared/sim.js` - deterministic falling-sand automaton (`TerrainSim`). Lockstep: ops `[simTick, OP, ...]` are sent in snapshots (`o`, `os`, `st`) and replayed identically; late joiners get `mapState()` (`{id, seed, ops, st}`).
- `shared/weapons.js` - `WEAPONS` stats, `UNLOCKS` order, `START_OWNED`/`ALL_OWNED`/`owns`, weapon pools (`FULL_POOL`, `BASIC_POOL`, `POOLS`, `sanitizePool`, `poolBar`, `poolStart`), `KILL_NAMES`. `shared/materials.js` - material tables. `shared/maps/` - one builder per map.
- `shared/survival.js` - survival engine (`Survival`: waves, enemy roster, shared crew lives, revives) for 1-4 humans; bot brain in `survival-bots.js`. Runs in the browser for solo and on the server for co-op.
- `server/` - `lobby.js` (connections, 60 Hz loop), `room.js` (1v1 match flow, weapon pool option), `coop.js` (co-op survival room), `inputs.js` (input queues, snapshot fan-out shared by both rooms).
- `public/js/game.js` - `ClientGame` core (prediction, render loop, `hud()`), with mixins in `public/js/client/`: `shots.js` (weapon switch, shot fx), `events.js` (server events, unlocks), `interp.js` (remotes, items, projectiles), `terrain-sync.js` (op replay; `attach()` in solo where the local authority owns the terrain).
- `public/js/solo.js` - `SoloServer`: runs `Survival` locally with one human and feeds snapshots like a co-op room.
- `public/js/ui/hud.js` - hotbar, unlock banner, stamina, armory countdown, kill feed. `public/js/ui/feel.js` - low-HP vignette and heartbeat, hit direction arcs, multi-kill/streak callouts, "killed by" recap. `main.js` - menus, pause settings (prefs in localStorage `sd-prefs`) and wiring.
- Tool add-ons are mixed into base classes: `fx-tools.js` (Fx), `audio-tools.js` (Sfx), `sprites-tools.js` (gun/pickup sprites).

## Weapon progression

Every match has a weapon pool (`Game.pool`, a bitmask of `SELECTABLE` = `UNLOCKS`; the pistol is always in it, SANDSTORM and QUAKE are retired and never selectable). Clients get it as `wp` in `mapState()` and `pool` in room / co-op info, and build the hotbar from it (`poolBar`: keys 1..n, builder on B).

- 1v1 (quick match and private rooms): default `FULL_POOL`, the host can pick `BASIC` or toggle weapons (`setopts {pool}` while waiting). Both players own the whole pool from the start: no armory, crates only heal and refill.
- Survival (solo, and co-op where anyone in the lobby can change the pool): start with the first 4 pool weapons in `UNLOCKS` order (pistol, smg, shotgun, builder by default), each cleared wave and crate unlocks the next locked pool weapon (`nextLocked`). Unlocks are events `{e:'u', s, w}` (`s = -1` for everyone, armory only).

## Deploy

Production is https://game.melvynx.dev on `ssh hostinger-demo`: code in `/srv/stick-duel` (owner `stickduel`), systemd unit `stick-duel` on `127.0.0.1:3030`, Caddy site block in `/etc/caddy/Caddyfile` (TLS + WebSocket proxy). DNS is a Cloudflare DNS-only A record. Redeploy:

```bash
rsync -az --delete --exclude node_modules --exclude .git ./ hostinger-demo:/srv/stick-duel/ && ssh hostinger-demo 'cd /srv/stick-duel && pnpm install --prod && chown -R stickduel:stickduel . && systemctl restart stick-duel'
```

## Development servers

- Always use Portly (`portly ...`) to start, stop, restart, inspect, or keep local development servers running.
- Start with `portly status`. Use `portly status --details` only for the full inventory and metrics, and `--json` only for machine-readable fields. Reuse a healthy managed server; if an in-scope server is running outside Portly, register it and use `portly take-over <project/server> --json`.
- For long-lived or reusable work, create a project and server.
- For builds, tests, code generation, previews, demos, and other bounded one-off work, run `job_id="$(portly temp '<command>' --path <folder> --timeout 30m)"`, then `portly wait "$job_id"`. `temp` returns immediately with an ID; `wait` prints captured logs and exits with the command's real code. A timeout kills the whole process group and exits with code `124`.
- Never launch persistent development servers directly, in the background, or through another supervisor.
