import type { Phase } from '../../types'

export type FinalPhase = 'CONFIRMED' | 'CANCELLED' | 'BLOCKED' | 'ERROR'

const MOVES: Readonly<Record<Phase, readonly Phase[]>> = {
  IDLE: ['INTERCEPTED'],
  INTERCEPTED: ['REVIEWING', 'BLOCKED', 'CANCELLED', 'ERROR'],
  REVIEWING: ['CONFIRMED', 'CANCELLED', 'ERROR'],
  CONFIRMED: [],
  CANCELLED: [],
  BLOCKED: [],
  ERROR: [],
}

export function canMove(from: Phase, to: Phase): boolean {
  return MOVES[from].includes(to)
}

export function isFinal(phase: Phase): phase is FinalPhase {
  return MOVES[phase].length === 0
}

/**
 * One held prompt. It reaches exactly one final phase, and reaching it drops
 * the only reference Hush keeps to the original text.
 */
export class Submission {
  readonly id: number
  #phase: Phase = 'INTERCEPTED'
  #original: string | undefined

  constructor(id: number, original: string) {
    this.id = id
    this.#original = original
  }

  get phase(): Phase {
    return this.#phase
  }

  get original(): string {
    if (this.#original === undefined) throw new Error(`Submission ${this.id} no longer holds its prompt`)

    return this.#original
  }

  /** Moves to `to` when the state machine allows it; false leaves it where it was. */
  move(to: Phase): boolean {
    if (!canMove(this.#phase, to)) return false
    this.#phase = to
    // JavaScript cannot zero a string: dropping the reference lets the
    // collector reclaim it, which is the most a plugin can do.
    if (isFinal(to)) this.#original = undefined

    return true
  }
}
