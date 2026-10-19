# screensaver-hunt

> The command is called `slime-saver`.

A terminal screensaver for [Hyprland](https://hyprland.org). Slime-mold dishes drift across all your
monitors as one wide canvas. They are predators: they hunt cookies, bump into each other and sometimes
merge, a hunter that grows too big gets sick and splits, and the cookies shiver in place, helpless.

Every dish is a running copy of an unmodified [play.core](https://play.ertdfgcvb.xyz) program
(by default *Slime Dish* by zspotter, a physarum simulation made of ASCII characters). slime-saver is the
world around them: the physics, the animation, the drawing across screens, and a small runtime that runs
play.core programs in a terminal.

- **Hunting**: a hunter spots a cookie, freezes to take aim, pounces, and chases it. Rivals race it.
- **Hunters hunt hunters**: a hunter that is big enough hunts its closest neighbour, pounces, and sticks with it across the whole wrapped world, lunging at full speed; the prey runs, but slower, so it is always caught (unless it eats its way to the top and turns the tables). A catch merges 30% of the time; the other 70% the hunter bounces off a good distance and the prey bolts for a moment. After eating a cookie a hunter is sluggish for a few seconds.
- **No edges**: the world wraps around. Leave through the bottom and you come back at the top; a hunter can sit half across an edge, shown on both sides.
- **A population that regulates itself**: too few hunters and new ones walk in from outside the screens; too many and one wanders off.
- **Merging and splitting**: animated, not instant: two hunters ease together with a slime neck between
  them; a sick hunter frays, shakes, then pinches into two or three pieces. Areas and masses add up exactly
  (a merge or a split loses 25% of the mass).
- **A living background**: a slow neon-green wave with a drifting moire of dark fringes and swarms of flies (a self-restarting Game of Life) glowing over dark grass like fireflies. Merges and splits stir the swarm where they happen.
- **Organic bodies**: no two hunters look alike: each is a U, S, K, C, Y, Z, L, T, worm or starfish, writhing slowly, with the dish growing inside it. It stretches when it lunges.
- **Several monitors**: one simulation, one slice per monitor, hunters cross from screen to screen.
- **Your own programs**: any play.core program can be the dish.
- **Tunable**: everything is a documented setting; there is a seed for repeatable runs.

## Requirements

- Linux with Hyprland and [foot](https://codeberg.org/dnkl/foot) (1.22+)
- Node.js 22.15 or newer (no npm packages needed)
- `hyprctl`, `jq`, `socat`, `git` (to fetch play.core)
- A monospace font with box-drawing and block characters (JetBrains Mono, for instance)

The simulation, renderer and play.core runtime are plain Node and do not need Hyprland; only the launcher
and the focus handling are Hyprland-specific (`src/platform/`).

## Install

```sh
git clone https://github.com/francoisxr/screensaver-hunt
cd screensaver-hunt
scripts/install.sh          # fetches play.core and slime_dish, links `slime-saver` and `play-term` into ~/.local/bin
```

`scripts/install.sh --uninstall` removes the links. Nothing outside the project and `~/.local/bin` is touched.

## Use

```sh
slime-saver                  # fullscreen on every monitor
slime-saver path/to/program.js   # with another play.core program as the dish
```

Any key press, or moving focus to another window, stops it. To bind it to a key (Hyprland):

```lua
-- ~/.config/hypr/bindings.lua
hl.bind("SUPER + CTRL + M", hl.dsp.exec_cmd("slime-saver"))
```
```
# hyprland.conf
bind = SUPER CTRL, M, exec, slime-saver
```

It does not start by itself when you are idle. Wire it to your idle daemon: with hypridle,
`listener { timeout = 300  on-timeout = slime-saver }`. A key press ends it, and so does moving focus to another window.

### On Omarchy: use it instead of Omarchy's screensaver

Omarchy's idle timer (`idle.screensaver` in `~/.config/omarchy/shell.json`) runs `omarchy-launch-screensaver`. To run
this instead, clone the idle service (Omarchy's supported way to change a built-in) and change the one command it runs:

```sh
omarchy plugin clone omarchy.idle          # creates ~/.config/omarchy/plugins/<you>.idle and switches to it
```

In `~/.config/omarchy/plugins/<you>.idle/Service.qml`, in `launchScreensaver()`, replace `omarchy-launch-screensaver`
with `omarchy-toggle-enabled screensaver-off || ~/.local/bin/slime-saver` (that keeps Omarchy's "screensaver off"
switch working). The windows use Omarchy's `org.omarchy.screensaver` app id, so the rest of its idle handling treats them as
its own. Saving the file reloads the plugin.

## Configure

Put only the settings you want to change in `~/.config/slime-saver/config.json`:

```json
{
  "look": { "cookies": { "theme": "phosphor" } },
  "physics": { "hunting": { "accel": 18 }, "hunters": { "count": 6 } }
}
```

Mistakes (a misspelt name, a wrong type) are reported on stderr and ignored. Every setting, its default and
what it does is listed in [`src/config/defaults.mjs`](src/config/defaults.mjs) and explained in
[docs/configuration.md](docs/configuration.md). A few can also be set from the environment, for example
`SLIME_SAVER_THEME=ember slime-saver`.

## Try and edit play.core programs

`play-term` runs one program fullscreen in the current terminal, with the same runtime the screensaver uses:

```sh
play-term examples/pulse.js
play-term programs/slime_dish.js
```

Save the file and it reloads. `slime-saver` reloads the program live too, while it is running.

## How it works

One scene process runs the physics and drives worker threads, each running many copies of the program (one per
hunter, each at the size of its window). One display client per monitor window prints its slice of the
frame. See [docs/architecture.md](docs/architecture.md) for the map of the code.

## Develop

```sh
npm test                     # 100+ tests, dependency free (node --test)
SLIME_SAVER_SEED=7 SLIME_SAVER_DEBUG=1 slime-saver   # a repeatable run, logging to $XDG_RUNTIME_DIR/slime-saver.log
```

The physics and the compositor are deterministic given a seed and know nothing about sockets or threads, so
they are easy to test and to reuse: `import { World } from './src/physics/world.mjs'`.

## Credits and licence

slime-saver is released under the [0BSD](LICENSE) licence: do what you like with it. It builds on
[play.core](https://github.com/ertdfgcvb/play.core) (Apache-2.0, by ertdfgcvb) and the *Slime Dish* program
by zspotter, which are fetched at install time and not part of this repository; see
[THIRD_PARTY.md](THIRD_PARTY.md).
