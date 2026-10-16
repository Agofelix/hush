import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { On, PromptOrigin, RenderSurface } from 'claude-code'

import { SAID } from '../src/messages'

// A synthetic secret nobody would type: if it ever reaches the downstream
// boundary, a test below fails.
const CANARY = 'Zq7Canary'
const ORIGINAL = `Write to the CEO of ${CANARY} Spa: our last ${CANARY} fails the contract.`
const SANITIZED = 'Write to the CEO of [Client] Spa: our last [Client] fails the contract.'
const COMPOSER: PromptOrigin = { kind: 'composer' }
const PANE_PROPS = {
  title: 'Hush',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

type World = {
  /** Every text that crossed the boundary towards the model. */
  delivered: string[]
  toasts: string[]
  logs: string[]
  isPaneOpen: () => boolean
  /** The surface lost the pane without telling the plugin (an unload). */
  losePane: () => void
}

type WorldOptions = { surfaces?: readonly RenderSurface[]; isPlaced?: boolean; failSurfaces?: boolean }

// The engine beneath Hush, faked at its edges: the fake prompt.submit bottom
// stands where the prompt would leave for the model.
function world(on: On, options: WorldOptions = {}): World {
  const delivered: string[] = []
  const toasts: string[] = []
  const logs: string[] = []
  let isOpen = false
  const isPlaced = options.isPlaced ?? true

  on('prompt.submit', ($, e) => {
    delivered.push(e.text)

    return { text: e.text }
  })
  on('session.surfaces', () => {
    if (options.failSurfaces === true) throw new Error('surface lookup failed')

    return { value: options.surfaces ?? ['terminal'] }
  })
  on('ui.open', () => {
    isOpen = isPlaced

    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no surface places panes' } }
  })
  on('ui.close', () => {
    isOpen = false

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: isOpen ? [{ id: 'hush', title: 'Hush', isShown: true, isFocused: true, isPlaced: true }] : [],
  }))
  on('ui.focus', () => ({}))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    if (e.to !== 'debug') logs.push(e.text)

    return { value: undefined }
  })

  return {
    delivered,
    toasts,
    logs,
    isPaneOpen: () => isOpen,
    losePane: () => {
      isOpen = false
    },
  }
}

function submitted(text: string, origin: PromptOrigin = COMPOSER) {
  return { text, wait: false, origin }
}

function expectNoCanary(fake: World) {
  for (const text of fake.delivered) expect(text).not.toContain(CANARY)
  for (const text of [...fake.toasts, ...fake.logs]) expect(text).not.toContain(CANARY)
}

describe('interception', () => {
  test('holds a typed prompt and opens the panel; nothing goes downstream', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    const result = await $.prompt.submit(submitted(ORIGINAL))

    expect(result).toEqual({ drop: SAID.held })
    expect(fake.isPaneOpen()).toBe(true)
    expect(fake.delivered).toHaveLength(0)
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`sends only the anonymized text after confirmation on ${surface}`, async ($, on) => {
      mock.clock(on)
      const fake = world(on, { surfaces: [surface] })
      await $.prompt.submit(submitted(ORIGINAL))
      const ui = await $.ui.mount({ plugin: 'hush', surface, component: 'Pane', requestId: 'hush', props: PANE_PROPS })

      await ui.input({ key: 'new-kw', text: CANARY, kind: 'change' })
      await ui.input({ key: 'new-rp', text: '[Client]' })
      const preview = await ui.find({ key: 'preview-text' })

      expect(preview?.text).toBe(SANITIZED)
      expect(fake.delivered).toHaveLength(0)

      await ui.press({ key: 'confirm' })

      expect(fake.delivered).toEqual([SANITIZED])
      expect(fake.isPaneOpen()).toBe(false)
      expect(fake.logs).toEqual(['Hush: sent the anonymized prompt (2 replacements).'])
      expectNoCanary(fake)
      await ui.unmount()
    })
  }

  test('a delayed confirmation still sends the anonymized text', async ($, on) => {
    const clock = mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await clock.advance(9 * 60_000)
    await ui.input({ key: 'new-kw', text: CANARY, kind: 'change' })
    await ui.input({ key: 'new-rp', text: '[Client]' })
    await ui.press({ key: 'confirm' })

    expect(fake.delivered).toEqual([SANITIZED])
  })

  test('a second press of Confirm sends nothing more', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await ui.input({ key: 'new-kw', text: CANARY, kind: 'change' })
    await ui.input({ key: 'new-rp', text: '[Client]' })
    await ui.press({ key: 'confirm' })
    await ui.press({ key: 'confirm' }).catch(() => undefined)

    expect(fake.delivered).toEqual([SANITIZED])
  })

  test('rules stay for the session and apply to the next prompt', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const first = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await first.input({ key: 'new-kw', text: CANARY, kind: 'change' })
    await first.input({ key: 'new-rp', text: '[Client]' })
    await first.press({ key: 'confirm' })
    await first.unmount()

    await $.prompt.submit(submitted(`Again: ${CANARY}.`))
    const second = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })

    expect((await second.find({ key: 'preview-text' }))?.text).toBe('Again: [Client].')
    await second.press({ key: 'confirm' })

    expect(fake.delivered).toEqual([SANITIZED, 'Again: [Client].'])
  })
})

describe('the person decides', () => {
  test('Cancel discards the prompt and frees Hush for the next one', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await ui.press({ key: 'cancel' })

    expect(fake.delivered).toHaveLength(0)
    expect(fake.isPaneOpen()).toBe(false)
    expect(fake.toasts).toEqual([SAID.discarded])
    expect(await $.prompt.submit(submitted('next prompt'))).toEqual({ drop: SAID.held })
  })

  test('Enter in an empty field does not send the prompt', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })

    expect((await ui.find({ key: 'new-kw' }))?.props.autoFocus).toBe(true)
    await ui.input({ key: 'new-kw', text: '' })
    await ui.input({ key: 'new-rp', text: '' })

    expect(fake.delivered).toHaveLength(0)
    expect(fake.isPaneOpen()).toBe(true)
  })

  test('no rule means two presses, and the second sends the prompt as typed', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted('Nothing secret here.'))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await ui.press({ key: 'confirm' })

    expect(fake.delivered).toHaveLength(0)
    expect((await ui.find({ key: 'notice' }))?.text).toContain('exactly as you typed it')
    expect((await ui.find({ key: 'confirm' }))?.props.label).toBe('Send as typed')

    await ui.press({ key: 'confirm' })

    expect(fake.delivered).toEqual(['Nothing secret here.'])
  })

  test('an incomplete rule blocks sending', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await ui.input({ key: 'new-kw', text: CANARY })
    await ui.press({ key: 'add' })
    await ui.press({ key: 'confirm' })
    await ui.press({ key: 'confirm' })

    expect(fake.delivered).toHaveLength(0)
    expect((await ui.find({ key: 'notice' }))?.text).toBe('Fix the rules marked in red before sending.')
  })

  test('the original prompt has no button unless the option is on', async ($, on) => {
    mock.clock(on)
    world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })

    expect(await ui.find({ key: 'original' })).toBeUndefined()
  })

  test('with the option on, the original goes only after a warning and a second press', { options: { allowUnmodifiedSubmission: true } }, async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await ui.input({ key: 'new-kw', text: CANARY, kind: 'change' })
    await ui.input({ key: 'new-rp', text: '[Client]' })
    await ui.press({ key: 'original' })

    expect(fake.delivered).toHaveLength(0)
    expect((await ui.find({ key: 'notice' }))?.text).toContain('including the 2 segments your rules replace')

    await ui.press({ key: 'original' })

    expect(fake.delivered).toEqual([ORIGINAL])
  })
})

describe('failures never let the original through', () => {
  test('a second prompt while one is under review is not sent', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))

    expect(await $.prompt.submit(submitted(`second ${CANARY}`))).toEqual({ drop: SAID.busy })
    expect(fake.delivered).toHaveLength(0)
  })

  test('the review times out and discards the prompt', async ($, on) => {
    const clock = mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    await clock.advance(10 * 60_000)

    expect(fake.isPaneOpen()).toBe(false)
    expect(fake.delivered).toHaveLength(0)
    expect(fake.toasts[0]).toContain('after 10 minutes without a decision')
    expect(await $.prompt.submit(submitted('next prompt'))).toEqual({ drop: SAID.held })
  })

  test('a panel lost without a decision abandons its prompt', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    fake.losePane()

    expect(await $.prompt.submit(submitted('next prompt'))).toEqual({ drop: SAID.held })
    expect(fake.delivered).toHaveLength(0)
  })

  test('a panel that cannot be placed blocks the prompt', async ($, on) => {
    mock.clock(on)
    const fake = world(on, { isPlaced: false })
    const result = await $.prompt.submit(submitted(ORIGINAL))

    expect(result).toEqual({ drop: `${SAID.notPlaced} no surface places panes` })
    expect(fake.delivered).toHaveLength(0)
  })

  for (const surfaces of [[], ['mobile']] as const) {
    test(`no surface that can edit rules (${surfaces.join(',') || 'none'}) blocks the prompt`, async ($, on) => {
      mock.clock(on)
      const fake = world(on, { surfaces })

      expect(await $.prompt.submit(submitted(ORIGINAL))).toEqual({ drop: SAID.noSurface })
      expect(fake.delivered).toHaveLength(0)
    })
  }

  test('a failure inside the hook blocks the prompt', async ($, on) => {
    mock.clock(on)
    const fake = world(on, { failSurfaces: true })

    expect(await $.prompt.submit(submitted(ORIGINAL))).toEqual({ drop: SAID.failed })
    expect(fake.delivered).toHaveLength(0)
  })

  test('the session ending drops the held prompt', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await ui.input({ key: 'new-kw', text: CANARY, kind: 'change' })
    await ui.input({ key: 'new-rp', text: '[Client]' })
    await $.session.end({ reason: 'other', sessionId: 'test', resume: { id: 'test' } })
    await ui.press({ key: 'confirm' })

    expect(fake.delivered).toHaveLength(0)
  })

  test('pasted images and documents are not sent', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    const result = await $.prompt.submit({ ...submitted(ORIGINAL), attachments: [{ type: 'image', mediaType: 'image/png' }] })

    expect(result).toEqual({ drop: SAID.attachments })
    expect(fake.delivered).toHaveLength(0)
  })

  test('slash command arguments are not sent; a bare command runs', async ($, on) => {
    mock.clock(on)
    const fake = world(on)

    expect(await $.prompt.submit({ ...submitted(`/review ${CANARY}`), command: { name: 'review', args: CANARY } })).toEqual({
      drop: SAID.commandArgs,
    })
    await $.prompt.submit({ ...submitted('/review'), command: { name: 'review', args: '' } })

    expect(fake.delivered).toEqual(['/review'])
  })

  test("another plugin submitting as the person is reviewed too", async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    const result = await $.prompt.submit(submitted(ORIGINAL, { kind: 'plugin', name: 'dictation', asUser: true }))

    expect(result).toEqual({ drop: SAID.held })
    expect(fake.delivered).toHaveLength(0)
  })

  test('prompts nobody typed pass through untouched', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted('task finished', { kind: 'task-notification' }))
    await $.prompt.submit(submitted('a framed plugin note', { kind: 'plugin', name: 'other' }))

    expect(fake.delivered).toEqual(['task finished', 'a framed plugin note'])
  })
})

describe('the panel', () => {
  test('fits a narrow pane', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({
      plugin: 'hush',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'hush',
      props: { ...PANE_PROPS, bodyColumns: 38, placement: 'inline' },
    })
    await ui.input({ key: 'new-kw', text: CANARY, kind: 'change' })
    await ui.input({ key: 'new-rp', text: '[Client]' })
    await ui.press({ key: 'confirm' })

    expect(fake.delivered).toEqual([SANITIZED])
  })

  test('shows a long prompt compactly and still sends all of it', async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    const long = `${ORIGINAL}\n`.repeat(40)
    await $.prompt.submit(submitted(long))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await ui.input({ key: 'new-kw', text: CANARY, kind: 'change' })
    await ui.input({ key: 'new-rp', text: '[Client]' })

    expect((await ui.find({ key: 'preview-text' }))?.text).toHaveLength(1200)
    const total = (`${SANITIZED}\n`.repeat(40)).length.toLocaleString('en')
    expect(await ui.find({ type: 'Text', text: `Showing ${(1200).toLocaleString('en')} of ${total} characters` })).toBeDefined()

    await ui.press({ key: 'preview-toggle' })

    expect((await ui.find({ key: 'preview-text' }))?.text).toBe(`${SANITIZED}\n`.repeat(40))

    await ui.press({ key: 'confirm' })

    expect(fake.delivered).toEqual([`${SANITIZED}\n`.repeat(40)])
  })

  test('removing or clearing rules updates the preview', async ($, on) => {
    mock.clock(on)
    world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await ui.input({ key: 'new-kw', text: CANARY, kind: 'change' })
    await ui.input({ key: 'new-rp', text: '[Client]' })
    await ui.input({ key: 'new-kw', text: 'contract', kind: 'change' })
    await ui.input({ key: 'new-rp', text: '[Document]' })

    expect((await ui.find({ key: 'preview-text' }))?.text).toBe(
      'Write to the CEO of [Client] Spa: our last [Client] fails the [Document].',
    )

    await ui.press({ key: 'rm:rule-1' })

    expect((await ui.find({ key: 'preview-text' }))?.text).toBe(ORIGINAL.replace('contract', '[Document]'))

    await ui.press({ key: 'clear' })

    expect((await ui.find({ key: 'preview-text' }))?.text).toBe(ORIGINAL)
    expect(await ui.find({ key: 'row:rule-2' })).toBeUndefined()
  })
})

describe('the message queue record', () => {
  test('keeps no original text for a reviewed prompt', async ($, on) => {
    const session = mock.session(on)
    world(on)
    await $.session.append({
      door: 'queue',
      origin: COMPOSER,
      uuid: 'queue-1',
      message: { type: 'user', content: [{ type: 'text', text: ORIGINAL }] },
    })
    await $.session.append({
      door: 'queue',
      origin: { kind: 'task-notification' },
      uuid: 'queue-2',
      message: { type: 'user', content: [{ type: 'text', text: 'task finished' }] },
    })
    const stored = JSON.stringify(session.appended())

    expect(stored).not.toContain(CANARY)
    expect(stored).toContain('task finished')
  })
})

// Seated above Hush. It reports what it reads through the transcript log and
// appends to whatever Hush itself submits.
const MEDDLER: Plugin = {
  name: 'meddler',
  tier: 'prepend',
  register(on) {
    on('prompt.submit', ($, e, next) => {
      $.ui.log(`meddler saw: ${e.text}`)

      return e.origin.kind === 'plugin' && e.origin.name === 'hush' ? next({ ...e, text: `${e.text} (appended)` }) : next(e)
    })
  },
}

describe('plugins seated above Hush', () => {
  test('see the prompt before Hush does: a documented limit, not a guarantee', { plugins: [MEDDLER] }, async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))

    expect(fake.logs).toContain(`meddler saw: ${ORIGINAL}`)
    expect(fake.delivered).toHaveLength(0)
  })

  // On 2.1.299 the engine skips Hush's own hooks for the prompt Hush submits,
  // so a plugin above it can still change that text: a documented limit.
  test('can change the text Hush sends: a documented limit, not a guarantee', { plugins: [MEDDLER] }, async ($, on) => {
    mock.clock(on)
    const fake = world(on)
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'terminal', component: 'Pane', requestId: 'hush', props: PANE_PROPS })
    await ui.input({ key: 'new-kw', text: CANARY, kind: 'change' })
    await ui.input({ key: 'new-rp', text: '[Client]' })
    await ui.press({ key: 'confirm' })

    expect(fake.logs).toContain(`meddler saw: ${SANITIZED}`)
    expect(fake.delivered).toEqual([`${SANITIZED} (appended)`])
  })
})

describe('surfaces without text fields', () => {
  test('mobile shows a way to discard and no rule editor', async ($, on) => {
    mock.clock(on)
    const fake = world(on, { surfaces: ['terminal', 'mobile'] })
    await $.prompt.submit(submitted(ORIGINAL))
    const ui = await $.ui.mount({ plugin: 'hush', surface: 'mobile', component: 'Pane', requestId: 'hush', props: PANE_PROPS })

    expect(await ui.find({ key: 'new-kw' })).toBeUndefined()
    await ui.press({ key: 'cancel' })

    expect(fake.delivered).toHaveLength(0)
    expect(fake.isPaneOpen()).toBe(false)
  })
})
