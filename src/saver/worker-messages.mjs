// The messages between the scene (main thread) and a worker thread that runs dish simulations.
//
//   scene -> worker   init                            load the program
//                     step   { jobs, aspect }         run one frame for each job: { id, cols, rows, time }
//                     clone  { from, to }             dish `to` starts as an exact copy of dish `from`
//                     drop   { ids }                  forget these dishes
//                     reload                          the program file changed: load it again, restart every dish
//   worker -> scene   ready    { settings }           the program is loaded
//                     settings { settings }           ...and again after a reload
//                     out      { results }            the pictures for a `step`: { id, cols, rows, chars, colors?, backs? }
//                     cloned   { from, to, ok }       a `clone` was done (ok is false if `from` was not ready)
//                     error    { error }              something threw

export const TO_WORKER = Object.freeze({
  INIT: 'init',
  STEP: 'step',
  CLONE: 'clone',
  DROP: 'drop',
  RELOAD: 'reload',
})

export const FROM_WORKER = Object.freeze({
  READY: 'ready',
  SETTINGS: 'settings',
  OUT: 'out',
  CLONED: 'cloned',
  ERROR: 'error',
})
