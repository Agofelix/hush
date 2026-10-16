import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  PromptOrigin,
  PromptSubmitInput,
  PromptSubmitResult,
  Register,
  SessionAppendInput,
  Timer,
} from 'claude-code'

import { type Decision, PrivacyController } from '../src/core/privacy-controller'
import { SAID } from '../src/messages'
import { type PanelActions, PrivacyPanel } from '../src/ui/privacy-panel'

const PANE = 'hush'
const PANE_ROWS = 28
const DEFAULT_TIMEOUT_MINUTES = 10
const revision = atom({ plugin: 'hush', key: 'revision' } as const, 0)

// Prompts nobody typed at this session: the engine's own notices, other
// sessions and agents, schedules, channel relays. Every other origin, an
// unknown one included, is held for review.
const UNREVIEWED_ORIGINS: ReadonlySet<string> = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'coordinator',
  'observer',
  'observer-activity',
  'auto-continuation',
  'channel',
])

/** What one load of the module holds. A reload starts a new one. */
type Hush = {
  controller: PrivacyController
  timeoutMinutes: number
  timer: Timer | undefined
  isPreviewFull: boolean
}

export const register: Register = (on, options) => {
  const hush: Hush = {
    controller: new PrivacyController({
      allowUnmodifiedSubmission: options.allowUnmodifiedSubmission === true,
      ruleScope: options.ruleScope === 'prompt' ? 'prompt' : 'session',
    }),
    timeoutMinutes: positiveMinutes(options.reviewTimeoutMinutes),
    timer: undefined,
    isPreviewFull: false,
  }

  on('session.start', async ($, e, next) => {
    // A reload starts a fresh module: whatever the last one held is gone.
    hush.controller.reset()
    await $.ui.close({ id: PANE })

    return next(e)
  })

  on('session.end', ($, e, next) => {
    hush.timer?.cancel()
    hush.controller.reset()

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // 2.1.299 never runs this hook for Hush's own $.prompt.submit (the engine
    // skips the calling plugin). Should a build deliver it, only the exact
    // approved text passes, and it is never held for review a second time.
    if (e.origin.kind === 'plugin' && e.origin.name === $.plugin.name) {
      return hush.controller.takeApproved(e.text) ? next(e) : { drop: SAID.notApproved }
    }
    if (!isReviewed(e.origin, e.isMeta)) return next(e)
    if (e.command !== undefined) {
      return e.command.args.trim() === '' ? next(e) : { drop: SAID.commandArgs }
    }
    if ((e.attachments?.length ?? 0) > 0) return { drop: SAID.attachments }

    return hold($, hush, e, next.signal)
  }).catch(($, e, next) => (next.called ? next(e) : { drop: SAID.failed }))

  // The message queue writes its own record of a prompt (the transcript's
  // queue-operation entries) with the text as typed, even when Hush drops the
  // prompt. Every prompt Hush reviews is dropped and sent again as Hush's own,
  // so its queue record only ever holds an original: it is kept empty.
  on('session.append', { door: 'queue' }, ($, e, next) =>
    isOwn(e, $.plugin.name) || !isReviewed(e.origin, e.message.isMeta) ? next(e) : next(emptied(e)),
  ).catch(($, e, next) => (next.called ? next(e) : next(emptied(e))))

  on('ui.close', { id: PANE }, ($, e, next) => {
    if (e.origin.kind === 'person' && hush.controller.cancel()) {
      hush.timer?.cancel()
      hush.timer = undefined
      hush.isPreviewFull = false
      $.ui.status(undefined)
      $.ui.toast(SAID.discarded)
    }

    return next(e)
  }).catch(($, e, next) => {
    if (next.error.kind !== 're-entry' && e.origin.kind === 'person') hush.controller.cancel()

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, revision)
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      return (
        <PrivacyPanel
          kit={$.ui.resolve(e)}
          review={hush.controller.review()}
          rules={hush.controller.rules}
          draft={hush.controller.draft}
          allowsOriginal={hush.controller.allowsOriginal}
          columns={e.props.bodyColumns}
          isPreviewFull={hush.isPreviewFull}
          actions={actionsFor($, hush)}
        />
      )
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text>Hush can review prompts only in the terminal or the desktop app.</Text>
        <Button key="cancel" label="Discard the held prompt" onPress={actionsFor($, hush).cancel} />
      </Box>
    )
  }).catch(($, e, next) => {
    if (next.error.kind === 're-entry') return next(e)
    // A panel that cannot be drawn cannot be reviewed: the prompt is let go.
    hush.timer?.cancel()
    hush.controller.fail()
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text color="error">{SAID.drawFailed}</Text>
        <Button key="close" label="Close" onPress={() => void $.ui.close({ id: PANE })} />
      </Box>
    )
  })
}

async function hold(
  $: EngineInterface,
  hush: Hush,
  e: PromptSubmitInput,
  signal: AbortSignal,
): Promise<PromptSubmitResult> {
  const { controller } = hush
  if (controller.isHolding) {
    const isShown = controller.phase !== 'REVIEWING' || (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isShown) return { drop: SAID.busy }
    // Its panel is gone without a decision (a drawing that failed is
    // unloaded without telling the plugin): that prompt is abandoned.
    controller.cancel()
    await wrapUp($, hush)
  }
  const surfaces = await $.session.surfaces()
  if (!surfaces.some(surface => surface === 'terminal' || surface === 'desktop')) {
    return { drop: SAID.noSurface }
  }

  const id = controller.intercept(e.text)
  try {
    const opened = await $.ui.open({
      id: PANE,
      title: 'Hush',
      focus: true,
      closeOnEscape: true,
      holdToasts: true,
      rows: PANE_ROWS,
    })
    if (signal.aborted) {
      controller.cancel(id)
      await wrapUp($, hush)

      return { drop: SAID.interrupted }
    }
    if (!opened.isPlaced) {
      controller.block(id)
      await wrapUp($, hush)

      return { drop: `${SAID.notPlaced} ${opened.reason}` }
    }
    if (!controller.beginReview(id)) {
      await wrapUp($, hush)

      return { drop: SAID.interrupted }
    }
    hush.isPreviewFull = false
    hush.timer?.cancel()
    hush.timer = $.clock.after(hush.timeoutMinutes * 60_000, () => {
      if (!controller.cancel(id)) return
      void wrapUp($, hush).then(() =>
        $.ui.toast(
          `Hush discarded the held prompt after ${plural(hush.timeoutMinutes, 'minute')} without a decision. Nothing was sent.`,
        ),
      )
    })
    $.ui.status(SAID.waiting)
    await redraw($)

    return { drop: SAID.held }
  } finally {
    // Still only intercepted means the panel never took the prompt over.
    if (controller.phase === 'INTERCEPTED') controller.fail(id)
  }
}

// Every way a held prompt ends goes through here: stop the timer, take the
// panel down, clear the status line.
async function wrapUp($: EngineInterface, hush: Hush): Promise<void> {
  hush.timer?.cancel()
  hush.timer = undefined
  hush.isPreviewFull = false
  $.ui.status(undefined)
  await $.ui.close({ id: PANE })
  await redraw($)
}

async function deliver($: EngineInterface, hush: Hush, decision: Decision): Promise<void> {
  if (decision.kind !== 'send') {
    await redraw($)

    return
  }
  await wrapUp($, hush)
  $.ui.log(
    decision.isOriginal
      ? 'Hush: sent the original prompt, as you confirmed.'
      : `Hush: sent the anonymized prompt (${plural(decision.replacementCount, 'replacement')}).`,
  )
  void $.prompt
    .submit({ text: decision.text, asUser: true })
    .then(
      () => undefined,
      () => $.ui.toast(SAID.submitFailed),
    )
    .finally(() => hush.controller.forgetApproved(decision.id))
}

function actionsFor($: EngineInterface, hush: Hush): PanelActions {
  const { controller } = hush
  const heldId = () => controller.review()?.id ?? -1
  const apply = (change: () => void) => {
    change()
    void redraw($)
  }

  return {
    setDraft: patch => apply(() => controller.setDraft(patch)),
    addDraftRule: () => {
      if (controller.addDraftRule() === undefined) return
      void redraw($).then(() => focusOn($, 'new-kw'))
    },
    updateRule: (id, patch) => apply(() => controller.updateRule(id, patch)),
    removeRule: id => apply(() => controller.removeRule(id)),
    clearRules: () => apply(() => controller.clearRules()),
    focus: key => void focusOn($, key),
    togglePreview: () =>
      apply(() => {
        hush.isPreviewFull = !hush.isPreviewFull
      }),
    confirm: () => void deliver($, hush, controller.confirm(heldId())),
    sendOriginal: () => void deliver($, hush, controller.sendOriginal(heldId())),
    cancel: () => {
      if (!controller.cancel()) return
      void wrapUp($, hush).then(() => $.ui.toast(SAID.discarded))
    },
    close: () => void $.ui.close({ id: PANE }),
  }
}

// Moving the focus is a convenience: when the surface refuses it, the person
// still has Tab, so the refusal goes to the debug log and nothing else changes.
function focusOn($: EngineInterface, key: string): Promise<void> {
  return $.ui.focus({ requestId: PANE, key }).then(
    () => undefined,
    (error: unknown) => $.ui.log(`Hush: focus did not move to ${key}: ${String(error)}`, { to: 'debug' }),
  )
}

function redraw($: EngineInterface) {
  return update($, revision, count => count + 1)
}

function isReviewed(origin: SessionAppendInput['origin'], isMeta: boolean | undefined): boolean {
  if (isMeta === true) return false
  if (origin.kind === 'plugin') return 'asUser' in origin && origin.asUser === true

  return !UNREVIEWED_ORIGINS.has(origin.kind)
}

function isOwn(e: { origin: SessionAppendInput['origin'] | PromptOrigin }, self: string): boolean {
  return e.origin.kind === 'plugin' && 'name' in e.origin && e.origin.name === self
}

function emptied(e: SessionAppendInput): SessionAppendInput {
  return { ...e, message: { ...e.message, content: [] } }
}

function positiveMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MINUTES
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
