import { getProductionMotionRuntime } from '../motion/runtimeHost'
import { Anime25DBodyAdapter } from './anime25dAdapter'
import { LocalPerceptionAdapter } from './perceptionAdapter'

/** Live Anime2.5D body. Callers speak and move through this, not drivers. */
export function getProductionBody(): Anime25DBodyAdapter {
  return new Anime25DBodyAdapter(getProductionMotionRuntime())
}

export function getLocalPerception(): LocalPerceptionAdapter {
  return new LocalPerceptionAdapter()
}
