# Configuration

Settings live in `~/.config/slime-saver/config.json` (or the file named by `SLIME_SAVER_CONFIG`). Write only
what you want to change; everything else keeps its default. The complete list, with defaults and a comment
on each, is [`src/config/defaults.mjs`](../src/config/defaults.mjs): that file is the reference, this page is
a guided tour.

```json
{
  "look": { "cookies": { "theme": "ember" } },
  "physics": {
    "hunters": { "count": 6 },
    "hunting": { "accel": 18 },
    "merging": { "chance": 0.1 }
  }
}
```

Unknown settings and values of the wrong type are reported on stderr and ignored. Pairs such as
`"burst": [7, 10]` mean "a random value between the two".

## Sections

### `runtime`
Frame rate, number of worker threads (`0` = from the CPU count), the default character-cell shape, a physics
`speed` multiplier (for testing), and a `seed` that makes the physics repeatable.

### `physics`
Distances are in units (1 unit = one terminal row); masses are in base masses (1 = the base hunter).

`wrap` (default `true`): the world has no edges: a hunter that leaves through the right edge comes back in through the left one, and the same top and bottom, and it can sit half across an edge, drawn on both sides. Set `false` for walls.

| Section | What it controls |
|---|---|
| `hunters` | how many at the start, the cap, the size variation (large, and at least one starter is always big enough to hunt), and the `population` control: with fewer than `low` (75%) of the starting number new hunters arrive; with more than `high` (125%) one leaves. With `wrap` they fade in and out; with walls they walk in from outside the screens and off through the nearest edge |
| `repulsion`, `corners`, `walls` | how hunters keep apart from each other, from the screen corners and from the edges |
| `motion` | random drift, drag, top speed |
| `kicks` | the shove one hunter gets every 10-20 s |
| `merging` | the chance per bounce, the mass lost, how long the animation takes, the slime neck |
| `sickness` | the mass above which a hunter gets sick, how long, how it moves, whether eating can make it sick |
| `splitting` | the mass lost, piece size variation, the animation, the neck while parting |
| `hunting` | the predator: steering strength, speed, the pounce, reaction time, rivals, being full. Its `stalk` part is hunters hunting each other (a hunter sticks with the prey it picked, starts with a `pounce`, and runs at `drive`, always harder than the `fleeDrive` of the prey, so chases are fast and long but end): how much bigger a hunter must be than its closest neighbour (`ratio`), how fast the prey runs (`fleeDrive`, always lower than the chaser's `drive`), the chance a catch merges (`catchChance`, 30%; otherwise the hunter bounces off a good distance (`bounce`, `recoil`) and the prey gets a short `boost`), and the `digest` pause after a merge |
| `cookies` | how many, how often, how much mass, how long they last, where they appear, and how long (`slowSeconds`) and how much (`slowPace`, `slowDrag`) a hunter is slowed after eating one |

### `look`
`baseSize` (a hunter's size relative to the screen), `wobble` (the ripple of the outline), `stretch` (the lunge),
`fuzz` (the specks around a sick hunter), `neckTexture`, and `cookies`: the colour `theme`, the `themes`
themselves (add your own: each is one or two colours), how hot/deep the ring's glow is, the `fear` (how scared of
nearby hunters the cookies are) and the ring's `shape`.

`body`: the shapes of the hunters. Every hunter gets one of `shapes` at random (`u`, `c`, `s`, `k`, `y`, `z`, `l`, `t`,
`worm`, `star`; add `blob` for plain round ones). All have the area of a round hunter. `sway` is how much the joints
writhe and `growSeconds` how long a new hunter takes to grow from a disc into its shape. `wobble` is a smaller
ripple on top of the body's outline.

`background`: the neon-green wave with the flies on it (`enabled`, `color`, `brightness`, `speed`, `warp`, `scale`,
`pattern`). Its `moire` section lays rays from a horizon (play.core's `time_frames` demo) over the wave's stripes so
dark interference fringes drift across the grass: `strength` (0 turns it off), `drift` (the vanishing point starts at a random place and wanders slowly across the
screen at about this many columns per second; 0 keeps it still at `horizon`, the middle of the width and a share of the
height), `turn` (how much its path curves), `density` and `speed` of the rays, and `shift`. Its `life` section is the Game of Life of the flies: `stepSeconds` (speed), `density`, `glow` (how
much brighter than the grass they are), `fade` (trail length), the `push` that keeps the board from ever going quiet, and
`mergeBurst` / `splitBurst`, how strongly a merge or a split stirs the flies where it happens. Set
`"background": { "enabled": false }` for a plain black screen.

Built-in themes: `white` (default), `phosphor`, `ember`, `ice`, `neon`, `candy`, `gold`.

## Environment variables

| Variable | Effect |
|---|---|
| `SLIME_SAVER_CONFIG` | path of the configuration file |
| `SLIME_SAVER_THEME` | cookie theme (overrides the file) |
| `SLIME_SAVER_SPEED`, `SLIME_SAVER_ASPECT`, `SLIME_SAVER_SEED`, `SLIME_SAVER_WORKERS` | the matching `runtime` settings |
| `SLIME_SAVER_DEBUG=1` | log to `$XDG_RUNTIME_DIR/slime-saver.log` (or create the file `$XDG_RUNTIME_DIR/slime-saver.debug`) |
| `SLIME_SAVER_WINDOW_CLASS`, `SLIME_SAVER_FOOT_CONFIG` | the launcher's window app id and foot config |
| `PLAY_CORE_DIR` | where play.core is checked out (default `vendor/play.core`) |

## Recipes

- **Different grass**: `"look": { "background": { "color": "#00e5ff", "brightness": 0.3 } }`.
- **Calmer**: `"hunting": { "accel": 12, "burst": [3, 5] }` and `"kicks": { "speed": [6, 10] }`.
- **More dishes, fewer events**: `"hunters": { "count": 12 }` and `"merging": { "chance": 0.1 }`.
- **No hunting, just drifting**: `"hunting": { "accel": 0 }`.
- **A colour scheme of your own**: `"look": { "cookies": { "theme": "mine", "themes": { "mine": ["#ff9900", "#ff0066"] } } }`.
