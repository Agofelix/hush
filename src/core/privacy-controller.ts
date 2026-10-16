import type { Phase, Rule, RuleScope } from '../../types'
import { type Anonymized, anonymize } from './replacement-engine'
import { type RuleCheck, checkRules } from './rule-validator'
import { type FinalPhase, Submission } from './submission-state'

export type ControllerOptions = {
  allowUnmodifiedSubmission: boolean
  ruleScope: RuleScope
}

/** A second press the panel is waiting for before it sends. */
export type Awaiting = 'zero-replacements' | 'send-original'

export type Review = {
  id: number
  phase: Phase
  anonymized: Anonymized
  check: RuleCheck
  awaiting: Awaiting | undefined
}

export type Decision =
  | { kind: 'send'; id: number; text: string; replacementCount: number; isOriginal: boolean }
  | { kind: 'confirm-again'; awaiting: Awaiting }
  | { kind: 'refused'; reason: 'invalid-rules' | 'not-allowed' }
  | { kind: 'stale' }

export type Draft = { keyword: string; replacement: string }

type RulePatch = Partial<Omit<Rule, 'id'>>

/**
 * Everything sensitive Hush holds: the prompt under review, the rules and the
 * draft rule. Plain memory of the hooks module, never `$.state` (which any
 * plugin can read) and never `$.store` (which is written to disk).
 */
export class PrivacyController {
  readonly #options: ControllerOptions
  #rules: Rule[] = []
  #draft: Draft = { keyword: '', replacement: '' }
  #current: Submission | undefined
  #awaiting: Awaiting | undefined
  #approved: { id: number; text: string } | undefined
  #disposition: { id: number; phase: FinalPhase } | undefined
  #lastSubmissionId = 0
  #lastRuleId = 0
  #rulesVersion = 0
  #cached: { key: string; review: Pick<Review, 'anonymized' | 'check'> } | undefined

  constructor(options: ControllerOptions) {
    this.#options = options
  }

  get phase(): Phase {
    return this.#current?.phase ?? 'IDLE'
  }

  get isHolding(): boolean {
    return this.#current !== undefined
  }

  get allowsOriginal(): boolean {
    return this.#options.allowUnmodifiedSubmission
  }

  get rules(): readonly Rule[] {
    return this.#rules
  }

  get draft(): Draft {
    return this.#draft
  }

  /** The last held prompt's final phase, for the log line and the tests. */
  get lastDisposition(): { id: number; phase: FinalPhase } | undefined {
    return this.#disposition
  }

  intercept(original: string): number {
    if (this.#current !== undefined) throw new Error('Hush is already holding a prompt')
    this.#lastSubmissionId += 1
    this.#current = new Submission(this.#lastSubmissionId, original)
    this.#awaiting = undefined

    return this.#lastSubmissionId
  }

  beginReview(id: number): boolean {
    const current = this.#currentAt(id)

    return current?.move('REVIEWING') ?? false
  }

  review(): Review | undefined {
    const current = this.#current
    if (current === undefined) return undefined
    const key = `${current.id}:${this.#rulesVersion}`
    if (this.#cached?.key !== key) {
      const check = checkRules(this.#rules)
      this.#cached = { key, review: { check, anonymized: anonymize(current.original, check.applied) } }
    }

    return { id: current.id, phase: current.phase, awaiting: this.#awaiting, ...this.#cached.review }
  }

  confirm(id: number): Decision {
    const review = this.review()
    if (review === undefined || review.id !== id || review.phase !== 'REVIEWING') return { kind: 'stale' }
    if (review.check.isBlocked) return { kind: 'refused', reason: 'invalid-rules' }
    // No match means the "sanitized" prompt is the prompt as typed: a first
    // press never reads that as approval, a second one does.
    if (review.anonymized.replacementCount === 0 && this.#awaiting !== 'zero-replacements') {
      this.#awaiting = 'zero-replacements'

      return { kind: 'confirm-again', awaiting: this.#awaiting }
    }

    return this.#send(review.anonymized.text, review.anonymized.replacementCount, false)
  }

  sendOriginal(id: number): Decision {
    if (!this.#options.allowUnmodifiedSubmission) return { kind: 'refused', reason: 'not-allowed' }
    const current = this.#currentAt(id)
    if (current?.phase !== 'REVIEWING') return { kind: 'stale' }
    if (this.#awaiting !== 'send-original') {
      this.#awaiting = 'send-original'

      return { kind: 'confirm-again', awaiting: this.#awaiting }
    }

    return this.#send(current.original, 0, true)
  }

  /** Cancels the held prompt (this one, when `id` is given); false when there was none to cancel. */
  cancel(id?: number): boolean {
    return this.#finish(id, 'CANCELLED')
  }

  block(id: number): boolean {
    return this.#finish(id, 'BLOCKED')
  }

  fail(id?: number): boolean {
    return this.#finish(id, 'ERROR')
  }

  /**
   * Whether `text` is exactly the text this controller approved last; the
   * approval is spent by the check, so it lets one submission through once.
   */
  takeApproved(text: string): boolean {
    const approved = this.#approved
    this.#approved = undefined

    return approved !== undefined && approved.text === text
  }

  forgetApproved(id: number): void {
    if (this.#approved?.id === id) this.#approved = undefined
  }

  setDraft(patch: Partial<Draft>): void {
    this.#draft = { ...this.#draft, ...patch }
    this.#awaiting = undefined
  }

  /** Turns the draft into a rule; nothing happens while the draft has no keyword. */
  addDraftRule(): Rule | undefined {
    if (this.#draft.keyword.trim() === '') return undefined
    const added = this.addRule(this.#draft.keyword, this.#draft.replacement)
    this.#draft = { keyword: '', replacement: '' }

    return added
  }

  addRule(keyword: string, replacement: string, patch: RulePatch = {}): Rule {
    this.#lastRuleId += 1
    const added: Rule = {
      id: `rule-${this.#lastRuleId}`,
      keyword,
      replacement,
      isEnabled: true,
      isCaseSensitive: false,
      isWholeWord: true,
      ...patch,
    }
    this.#changeRules([...this.#rules, added])

    return added
  }

  updateRule(id: string, patch: RulePatch): void {
    this.#changeRules(this.#rules.map(rule => (rule.id === id ? { ...rule, ...patch } : rule)))
  }

  removeRule(id: string): void {
    this.#changeRules(this.#rules.filter(rule => rule.id !== id))
  }

  clearRules(): void {
    this.#changeRules([])
    this.#draft = { keyword: '', replacement: '' }
  }

  /** Forgets everything: the held prompt (cancelled), the rules, the draft, any approval. */
  reset(): void {
    this.#finish(undefined, 'CANCELLED')
    this.#approved = undefined
    this.clearRules()
  }

  #send(text: string, replacementCount: number, isOriginal: boolean): Decision {
    const current = this.#current
    if (current === undefined || !current.move('CONFIRMED')) return { kind: 'stale' }
    this.#approved = { id: current.id, text }
    this.#settle(current, 'CONFIRMED')

    return { kind: 'send', id: current.id, text, replacementCount, isOriginal }
  }

  #finish(id: number | undefined, phase: FinalPhase): boolean {
    const current = id === undefined ? this.#current : this.#currentAt(id)
    if (current === undefined || !current.move(phase)) return false
    this.#settle(current, phase)

    return true
  }

  #settle(submission: Submission, phase: FinalPhase): void {
    this.#disposition = { id: submission.id, phase }
    this.#current = undefined
    this.#awaiting = undefined
    this.#cached = undefined
    if (this.#options.ruleScope === 'prompt') this.clearRules()
  }

  #currentAt(id: number): Submission | undefined {
    return this.#current?.id === id ? this.#current : undefined
  }

  #changeRules(rules: Rule[]): void {
    this.#rules = rules
    this.#rulesVersion += 1
    this.#awaiting = undefined
  }
}
