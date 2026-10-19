// Merging. Two hunters that bounce may merge. The merge is an animation (see animations.mjs): the pair
// eases into one body at its common centre of mass while the bigger hunter carries on as the merged
// one, and the other dissolves into it. The merged hunter has 75% of the combined mass; above 3 base
// masses it gets sick.

import { pruneContacts } from './collisions.mjs'

const IMMUNITY_AFTER_MERGE = 0.5 // seconds the merged hunter cannot merge again

/**
 * Starts merging two hunters.
 * @param {import('./world.mjs').World} world
 */
export function startMerge (world, a, b) {
  const { merging, sickness } = world.cfg
  const keep = a.mass >= b.mass ? a : b
  const gone = keep === a ? b : a
  const total = a.mass + b.mass
  const finalMass = total * (1 - merging.loss)
  // (the short way round when the world wraps, so a pair on either side of an edge merges at the edge)
  const toGoneX = world.dx(gone.x - keep.x)
  const toGoneY = world.dy(gone.y - keep.y)
  const cx = keep.x + toGoneX * gone.mass / total
  const cy = keep.y + toGoneY * gone.mass / total
  const anim = {
    type: 'merge',
    keep,
    gone,
    t0: world.t,
    dur: merging.seconds,
    keepOff: [-toGoneX * gone.mass / total, -toGoneY * gone.mass / total], // where each started, relative to the centre of mass
    goneOff: [toGoneX * keep.mass / total, toGoneY * keep.mass / total],
    keepMass0: keep.mass,
    goneMass0: gone.mass,
    total,
    finalAtStart: finalMass,
    willBeSick: finalMass > sickness.mass,
    p: 0, // progress 0..1
    e: 0, // eased progress
  }

  // The pair is one body from now on: its centre of mass, with momentum conserved.
  keep.vx = (a.vx * a.mass + b.vx * b.mass) / total
  keep.vy = (a.vy * a.mass + b.vy * b.mass) / total
  keep.x = cx
  keep.y = cy
  world.wrapPoint(keep)
  keep.ox = anim.keepOff[0]
  keep.oy = anim.keepOff[1]
  keep.mass = finalMass
  gone.ghost = true
  gone.x = keep.x
  gone.y = keep.y
  gone.vx = keep.vx
  gone.vy = keep.vy
  gone.ox = anim.goneOff[0]
  gone.oy = anim.goneOff[1]
  keep.anim = anim
  gone.anim = anim
  world.log('merge', { keep: keep.id, gone: gone.id, mass: +finalMass.toFixed(2) })
}

/** The merge animation is over: the absorbed hunter is gone, and a heavy result gets sick. */
export function finishMerge (world, anim) {
  const { sickness } = world.cfg
  const { keep, gone } = anim
  world.hunters.splice(world.hunters.indexOf(gone), 1)
  keep.ox = keep.oy = 0
  keep.drawMass = keep.mass
  keep.anim = null
  keep.immuneUntil = world.t + IMMUNITY_AFTER_MERGE
  keep.digestUntil = world.t + world.rng.range(world.cfg.hunting.stalk.digest) // it has just eaten a hunter: no appetite for the next one for a while
  if (keep.mass > sickness.mass) {
    keep.sickUntil = world.t + sickness.seconds
    keep.kickIn = 0
    world.log('sick', { id: keep.id, mass: +keep.mass.toFixed(2) })
  }
  world.log('merged', { keep: keep.id, gone: gone.id, mass: +keep.mass.toFixed(2) })
  pruneContacts(world)
}
