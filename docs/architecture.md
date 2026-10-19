# Architecture

slime-saver is a small pipeline: a **simulation** moves hunters around; every hunter is shown by a running
copy of a play.core program (a **dish**); a **compositor** turns the world into characters for each monitor;
**display clients** print them. The layers are kept apart so each can be tested, and reused, on its own.

```
 ┌───────────────────────── scene process (bin/slime-saver-scene) ─────────────────────────┐
 │                                                                                          │
 │  World (physics)  ──hunters, cookies, links──►  Scene.tick()  ──frames──►  ScreenHub     │ ◄── unix socket ──► display client
 │       ▲                                              │                                   │                     (one per monitor
 │       │                                              ▼                                   │                      window, prints
 │   Rng (seeded)                          DishRegistry ⇄ WorkerPool ⇄ worker threads        │                      the frame)
 │                                              (hunter ↔ dish)      (ProgramInstance ×N)   │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Processes and threads

| Where | What | Code |
|---|---|---|
| `slime-saver` (bash) | opens one foot window per monitor (through Hyprland, so each opens on its own monitor) and starts the scene | `bin/slime-saver`, `bin/slime-saver-window` |
| scene process | owns the world, composes frames, talks to clients | `src/saver/scene-main.mjs` |
| worker threads (4 by default) | run the dishes: many `ProgramInstance`s of the play.core program | `src/saver/worker.mjs` |
| display clients (one per window) | report the window's size, print frames, stop on a key or lost focus | `src/saver/client.mjs` |

Everything the scene sends a client is one string of terminal escape codes per frame. Clients are
deliberately dumb, so the heavy work happens once, however many monitors there are.

## One frame

`Scene.tick` (`src/saver/scene.mjs`), 30 times a second:

1. `arrangeScreens` puts the connected windows side by side (`src/saver/screens.mjs`).
2. `World.step(dt)` advances the simulation (below).
3. `CookieAnimator.update` advances the cookies' fear and shiver (view state, not physics).
4. `DishRegistry.sync` keeps one dish per hunter and eases each dish's window size; `dispatch` gives every
   idle worker its dishes' newest jobs. A slow worker just updates its dishes less often.
5. For every screen: `composeScreen` builds a grid of cells; `gridToAnsi` turns it into one string.
6. `ScreenHub.sendFrame` sends it.

## The physics (`src/physics/`)

`World` (`world.mjs`) holds the state and calls the behaviours in a fixed order each step; each behaviour is
a module that changes the hunters:

| Module | Behaviour |
|---|---|
| `forces.mjs` | repulsion between hunters, screen corners, walls, random drift, sick jolts, integration |
| `hunting.mjs` | who hunts which cookie; the aim → pounce → chase steering |
| `stalking.mjs` | hunters hunting each other: who stalks whom (the bigger one its closest neighbour), the fleeing of the hunted one, the catch |
| `population.mjs` | keeps the number of hunters near the starting number: arrivals from outside the screens, departures through an edge |
| `collisions.mjs` | bouncing, and one roll of the dice for merging per new touch |
| `merging.mjs`, `splitting.mjs` | starting and finishing a merge or a split |
| `animations.mjs` | the animation of both, and how every hunter is drawn (offset, size, fade, fray) |
| `cookies.mjs` | eating, spoiling, spawning |
| `kicks.mjs` | the shuffled turns for the random shoves |
| `hunter.mjs`, `layout.mjs` | the hunter data, the starting placement, the screen corners |

The world wraps around (`physics.wrap`): positions are kept in `[0, w) x [0, h)`, and every distance between two things goes through `World.dx` / `dy` / `distance`, which take the short way round. The compositor draws a hunter, a cookie or a neck at up to nine places (where it is and one area width or height away on each side), so something sitting across an edge shows on both sides.

Units: 1 unit is the height of a terminal row; mass 1 is the base hunter and its area; radius = `r0 * sqrt(mass)`.

The world knows nothing about drawing. A merge or split changes how a hunter is *drawn* (its offset
`ox, oy`, `drawMass`, `alpha`, `fuzz`) while its physical state moves on; `world.links` lists groups joined by
a slime neck. The sizes during an animation are solved geometrically (`src/core/geometry.mjs`) so the drawn
area slides smoothly instead of swelling.

**Determinism.** Everything random goes through an injected `Rng` (`src/core/rng.mjs`); with a seed
(`runtime.seed` or `SLIME_SAVER_SEED`) a run is exactly repeatable. This is what the tests rely on.

## The renderer (`src/render/`)

`composeScreen` (`compositor.mjs`) is a pure function: hunters, links, cookies, each dish's latest picture and
the look settings in; a grid of cells out. Layers, bottom to top: background, hunters (biggest first), necks, cookies.

Hunters are not discs: `body.mjs` gives each one a random skeleton (a U, S, K, C, Y, Z, L, T, worm or starfish)
of thick line segments blended into one smooth body of the same area as a disc. The compositor asks every screen
cell near a hunter whether it is inside the body, and if so shows the dish picture at the matching place (squeezed
a little so that the whole body falls inside the round dish). The skeleton writhes and spins slowly, and a new
hunter grows into its shape. This is only how a hunter is *drawn*: the physics still treats it as a disc.

The background (`background.mjs`) is a slow sinsin_wave in neon green over the combined area of all screens. A second family of stripes, rays from a horizon after `time_frames`, beats against the wave and makes a moire of dark fringes. Its vanishing point starts at a random place and wanders slowly (`Background.wander`), turning back before the edges. On it
runs a Game of Life (`life.mjs`) of little flies: live cells, and their fading trails, light up the dark grass. The life
watches itself: a repeated board hash or a near-empty board triggers a small push (patches, sometimes a glider),
so it never stalls. The scene stirs it with a burst of flies wherever a merge or split happens
(`Scene.stirBackground`).
A hunter is drawn by looking each screen cell up in its dish picture through a warp: its body (`body.mjs`), the ripple
(`wobble.mjs`), the lunge stretch, the dissolve, the frayed edge. Cookies are `cookie-shape.mjs` (which
characters), `cookie-style.mjs` (which colours) and `cookie-animator.mjs` (the shiver).

## The play.core runtime (`src/play/`)

Independent of the screensaver (it powers `bin/play-term` too):

- `module-hooks.mjs`: makes the programs' `/src/modules/...` imports resolve in a play.core checkout.
- `program-host.mjs`: loads a program file (and reloads it after an edit).
- `instance.mjs`: one running copy: boot, then `pre`, `main` per cell, `post` each frame, with its own data and
  size; `clone()` makes an independent copy that continues from the same state (`clone.mjs` is a deep copy that
  keeps class prototypes). A split piece starts as a clone of its parent, which is why a split looks like one
  texture dividing.

## Config (`src/config/`)

`defaults.mjs` is the single, documented list of settings. `index.mjs` merges the user's JSON file and a few
environment variables over it, reporting mistakes as warnings.

## Platform (`src/platform/`)

The only Hyprland-specific code: is our window focused, and how big is a character cell (measured from the
window's pixel size so the dishes come out round). A platform is a two-method object; other desktops get the
null platform (stop on a key press only). `bin/slime-saver` is the other Hyprland-specific part.

## Tests (`test/`)

`npm test` runs everything with Node's built-in runner: unit tests for each layer, the physics invariants
(exact mass accounting, staying in bounds, determinism), the compositor on synthetic input, and end-to-end
tests that start the real scene process with real worker threads and fake display clients over the real socket.

When this code was refactored from a single-file prototype, the old and new physics were run side by side with
the same seed and had to agree bit for bit (8 seeds, 10 simulated minutes each), and the old and new
compositors had to produce identical terminal output (480 screens). (Three bugs the new tests found in the old
code were fixed after that comparison: dropped kicks, cookies frozen when far from every hunter, and split pieces
released outside the area near a wall.) That is the method to reuse when you
change something that should not change behaviour: make both sides deterministic, then diff.

## Where to change things

- **A new cookie colour scheme**: add it to `look.cookies.themes` in your config.
- **A new behaviour of the hunters**: a new module in `src/physics/`, called from `World.step`; add its settings
  to `defaults.mjs` and a test.
- **A different look for the dishes**: `src/render/compositor.mjs` (everything is a pure function of its input).
- **Another desktop**: implement the platform interface in `src/platform/` and a launcher in `bin/`.
- **Another program as the dish**: `slime-saver path/to/program.js`. Hunters are sized assuming the program
  draws its dish at about 91% of its window height (`src/render/dish.mjs`); change that constant for a
  program that fills its window differently, and `look.neckTexture` to match its characters.
