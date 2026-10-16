import { describe, expect, test } from 'claude-code/testing'

import { PrivacyController } from '../src/core/privacy-controller'
import { Submission, canMove, isFinal } from '../src/core/submission-state'

const CANARY = 'Zq7Canary'
const ORIGINAL = `Scrivi a ${CANARY} Spa: la nostra ${CANARY} non rispetta il contratto.`
const SANITIZED = 'Scrivi a [Cliente] Spa: la nostra [Cliente] non rispetta il contratto.'

function reviewing(options: Partial<ConstructorParameters<typeof PrivacyController>[0]> = {}) {
  const controller = new PrivacyController({ allowUnmodifiedSubmission: false, ruleScope: 'session', ...options })
  const id = controller.intercept(ORIGINAL)
  controller.beginReview(id)

  return { controller, id }
}

describe('submission state machine', () => {
  test('allows only the documented moves', () => {
    expect(canMove('IDLE', 'INTERCEPTED')).toBe(true)
    expect(canMove('INTERCEPTED', 'REVIEWING')).toBe(true)
    expect(canMove('REVIEWING', 'CONFIRMED')).toBe(true)
    expect(canMove('IDLE', 'CONFIRMED')).toBe(false)
    expect(canMove('INTERCEPTED', 'CONFIRMED')).toBe(false)
    expect(canMove('CONFIRMED', 'CANCELLED')).toBe(false)
    expect(canMove('CANCELLED', 'CONFIRMED')).toBe(false)
    for (const phase of ['CONFIRMED', 'CANCELLED', 'BLOCKED', 'ERROR'] as const) expect(isFinal(phase)).toBe(true)
  })

  test('reaches one final phase and then lets go of the prompt', () => {
    const submission = new Submission(1, ORIGINAL)

    expect(submission.move('REVIEWING')).toBe(true)
    expect(submission.move('CANCELLED')).toBe(true)
    expect(submission.move('CONFIRMED')).toBe(false)
    expect(submission.phase).toBe('CANCELLED')
    expect(() => submission.original).toThrow(/no longer holds its prompt/)
  })

  test('errors never quote the prompt', () => {
    const submission = new Submission(1, ORIGINAL)
    submission.move('ERROR')
    let message = ''
    try {
      void submission.original
    } catch (error) {
      message = String(error)
    }

    expect(message).not.toContain(CANARY)
  })
})

describe('privacy controller', () => {
  test('sends the anonymized text once, then holds nothing', () => {
    const { controller, id } = reviewing()
    controller.addRule(CANARY, '[Cliente]')
    const decision = controller.confirm(id)

    expect(decision).toEqual({ kind: 'send', id, text: SANITIZED, replacementCount: 2, isOriginal: false })
    expect(controller.confirm(id)).toEqual({ kind: 'stale' })
    expect(controller.phase).toBe('IDLE')
    expect(controller.review()).toBeUndefined()
    expect(controller.lastDisposition).toEqual({ id, phase: 'CONFIRMED' })
  })

  test('the preview and the decision carry the same bytes', () => {
    const { controller, id } = reviewing()
    controller.addRule(CANARY, '[Cliente]')
    const previewed = controller.review()?.anonymized.text
    const decision = controller.confirm(id)

    expect(decision.kind === 'send' ? decision.text : undefined).toBe(previewed)
  })

  test('asks twice before sending a prompt no rule changed', () => {
    const { controller, id } = reviewing()

    expect(controller.confirm(id)).toEqual({ kind: 'confirm-again', awaiting: 'zero-replacements' })
    expect(controller.phase).toBe('REVIEWING')
    expect(controller.confirm(id)).toEqual({ kind: 'send', id, text: ORIGINAL, replacementCount: 0, isOriginal: false })
  })

  test('an edit between the two presses asks again', () => {
    const { controller, id } = reviewing()
    controller.confirm(id)
    controller.addRule('nothing here', '[X]')

    expect(controller.confirm(id).kind).toBe('confirm-again')
  })

  test('refuses to send while a rule is incomplete', () => {
    const { controller, id } = reviewing()
    controller.addRule(CANARY, '')

    expect(controller.confirm(id)).toEqual({ kind: 'refused', reason: 'invalid-rules' })
    expect(controller.phase).toBe('REVIEWING')
  })

  test('refuses the original unless the option allows it', () => {
    const { controller, id } = reviewing()

    expect(controller.sendOriginal(id)).toEqual({ kind: 'refused', reason: 'not-allowed' })
    expect(controller.phase).toBe('REVIEWING')
  })

  test('sends the original only on a second press when allowed', () => {
    const { controller, id } = reviewing({ allowUnmodifiedSubmission: true })
    controller.addRule(CANARY, '[Cliente]')

    expect(controller.sendOriginal(id)).toEqual({ kind: 'confirm-again', awaiting: 'send-original' })
    expect(controller.sendOriginal(id)).toEqual({ kind: 'send', id, text: ORIGINAL, replacementCount: 0, isOriginal: true })
  })

  test('a cancelled prompt cannot be sent afterwards', () => {
    const { controller, id } = reviewing()
    controller.addRule(CANARY, '[Cliente]')

    expect(controller.cancel(id)).toBe(true)
    expect(controller.confirm(id)).toEqual({ kind: 'stale' })
    expect(controller.cancel(id)).toBe(false)
    expect(controller.lastDisposition).toEqual({ id, phase: 'CANCELLED' })
  })

  test('holds one prompt at a time, without quoting it when it refuses', () => {
    const { controller } = reviewing()

    expect(() => controller.intercept('another prompt')).toThrow('Hush is already holding a prompt')
  })

  test('an approval lets exactly that text through, once', () => {
    const { controller, id } = reviewing()
    controller.addRule(CANARY, '[Cliente]')
    controller.confirm(id)

    expect(controller.takeApproved(ORIGINAL)).toBe(false)
    expect(controller.takeApproved(SANITIZED)).toBe(false)

    const second = controller.intercept(ORIGINAL)
    controller.beginReview(second)
    controller.confirm(second)

    expect(controller.takeApproved(SANITIZED)).toBe(true)
    expect(controller.takeApproved(SANITIZED)).toBe(false)
  })

  test('keeps rules for the session by default', () => {
    const { controller, id } = reviewing()
    controller.addRule(CANARY, '[Cliente]')
    controller.confirm(id)
    const next = controller.intercept(ORIGINAL)
    controller.beginReview(next)

    expect(controller.review()?.anonymized.text).toBe(SANITIZED)
  })

  test('forgets rules after each prompt when scoped to the prompt', () => {
    const { controller, id } = reviewing({ ruleScope: 'prompt' })
    controller.addRule(CANARY, '[Cliente]')
    controller.setDraft({ keyword: 'half typed' })
    controller.cancel(id)

    expect(controller.rules).toHaveLength(0)
    expect(controller.draft).toEqual({ keyword: '', replacement: '' })
  })

  test('a reset cancels the held prompt and forgets every rule', () => {
    const { controller, id } = reviewing()
    controller.addRule(CANARY, '[Cliente]')
    controller.reset()

    expect(controller.phase).toBe('IDLE')
    expect(controller.rules).toHaveLength(0)
    expect(controller.lastDisposition).toEqual({ id, phase: 'CANCELLED' })
  })

  test('turns the draft into a rule only once it has a keyword', () => {
    const controller = new PrivacyController({ allowUnmodifiedSubmission: false, ruleScope: 'session' })
    controller.setDraft({ replacement: '[X]' })

    expect(controller.addDraftRule()).toBeUndefined()

    controller.setDraft({ keyword: CANARY })
    const added = controller.addDraftRule()

    expect(added?.keyword).toBe(CANARY)
    expect(added?.replacement).toBe('[X]')
    expect(controller.draft).toEqual({ keyword: '', replacement: '' })
  })
})
