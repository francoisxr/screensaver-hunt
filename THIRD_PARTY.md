# Third-party material

slime-saver itself is original work (see `LICENSE`). It is built on, and runs, other people's work. None of
it is included in this repository or redistributed with it; the install script downloads it from its
authors (`scripts/fetch-play-core.sh`), and `.gitignore` keeps it out of the repository.

## play.core

- What: the library and runtime of <https://play.ertdfgcvb.xyz>, by ertdfgcvb (the handle its programs name as author).
- Source: <https://github.com/ertdfgcvb/play.core>
- Licence: Apache License 2.0 (the repository's `LICENSE` is the standard text; it does not name a copyright holder)
- How we use it: slime-saver loads programs written for play.core and resolves their `/src/modules/...`
  imports (for example `vec2.js`, `num.js`) inside a local checkout of that repository. The checkout lives in
  `vendor/` and is fetched at install time. The version this project was tested with is recorded in
  `scripts/fetch-play-core.sh`.

## slime_dish

- What: "Slime Dish", a low-res physarum slime mold simulation, by zspotter (IG @zzz_desu, TW @zspotter),
  a contributed program in play.core: `src/programs/contributed/slime_dish.js`.
- It credits as inspiration <https://sagejenson.com/physarum> and
  <https://uwe-repository.worktribe.com/output/980579>.
- How we use it: it is the default program of the screensaver. The install script copies it from the play.core
  checkout into `programs/slime_dish.js`; it is not part of this repository. It runs unmodified: one copy
  per hunter. Check its header and the play.core repository for the terms that apply to it before you
  redistribute it yourself.

## Inspiration (no code taken)

- The look of the cookies (a ring drawn from a distance field with a density ramp of characters and a bar on
  every second column) follows play.core's `sdf/circle` program by ertdfgcvb. Only the idea is used; the code
  in `src/render/cookie-shape.mjs` is our own.
- The slime neck between merging hunters is a plain metaball field; the merge and split animations, the
  hunting and the physics are original.

## Tools it drives (not distributed)

Node.js, [Hyprland](https://hyprland.org), [foot](https://codeberg.org/dnkl/foot), `hyprctl`, `jq`, `socat`.
