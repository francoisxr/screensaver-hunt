// How a dish relates to its window. play.core's slime_dish fits its circular dish to the window
// height; it ends up filling about 91% of it, so the dish's radius is 0.455 of the window's rows.
// The physics sizes a base hunter from this, and the renderer reads dishes back with it.

/** A dish's radius, as a share of its window's height in rows. */
export const DISH_RADIUS_PER_ROW = 0.455

/** The radius, in units (rows), of a base hunter whose window is `rows` rows tall. */
export const dishRadius = rows => DISH_RADIUS_PER_ROW * rows
