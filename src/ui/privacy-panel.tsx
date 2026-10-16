import type { Rule } from '../../types'
import type { Draft, Review } from '../core/privacy-controller'
import { type Kit, WIDE_COLUMNS } from './kit'
import { Preview } from './preview'
import { RuleEditor } from './rule-editor'

export type PanelActions = {
  setDraft: (patch: Partial<Draft>) => void
  addDraftRule: () => void
  updateRule: (id: string, patch: Partial<Omit<Rule, 'id'>>) => void
  removeRule: (id: string) => void
  clearRules: () => void
  focus: (key: string) => void
  togglePreview: () => void
  confirm: () => void
  sendOriginal: () => void
  cancel: () => void
  close: () => void
}

type PanelProps = {
  kit: Kit
  review: Review | undefined
  rules: readonly Rule[]
  draft: Draft
  allowsOriginal: boolean
  columns: number
  isPreviewFull: boolean
  actions: PanelActions
}

export function PrivacyPanel(props: PanelProps) {
  const { kit, review, actions } = props
  const { Box, Button, Text } = kit
  const header = (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        <Text bold>HUSH.</Text>
        <Text dimColor>Privacy before prompting</Text>
      </Box>
      {review !== undefined && <Text>Anonymize your prompt?</Text>}
    </Box>
  )

  if (review === undefined) {
    return (
      <Box flexDirection="column" rowGap={1} paddingX={1}>
        {header}
        <Text dimColor>No prompt is waiting for review.</Text>
        <Box flexDirection="row">
          <Button key="close" label="Close" onPress={actions.close} />
        </Box>
      </Box>
    )
  }

  const { anonymized, check, awaiting } = review
  const notice = noticeFor(review)

  return (
    <Box flexDirection="column" rowGap={1} paddingX={1}>
      {header}
      <RuleEditor
        kit={kit}
        rules={props.rules}
        issues={check.issues}
        countByRule={anonymized.countByRule}
        draft={props.draft}
        isWide={props.columns >= WIDE_COLUMNS}
        actions={actions}
      />
      <Preview kit={kit} anonymized={anonymized} isFull={props.isPreviewFull} onToggle={actions.togglePreview} />
      {notice !== undefined && (
        <Box key="notice">
          <Text color={notice.isError ? 'error' : 'warning'}>{notice.text}</Text>
        </Box>
      )}
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Button
          key="confirm"
          variant="primary"
          label={awaiting === 'zero-replacements' ? 'Send as typed' : 'Confirm and send'}
          onPress={actions.confirm}
        />
        {props.allowsOriginal && (
          <Button
            key="original"
            label={awaiting === 'send-original' ? 'Yes, send the original' : 'Send original prompt'}
            onPress={actions.sendOriginal}
          />
        )}
        <Button key="cancel" label="Cancel" onPress={actions.cancel} />
      </Box>
      <Text dimColor>Tab moves between fields. Enter confirms a field. Esc cancels and discards the prompt.</Text>
    </Box>
  )
}

function noticeFor(review: Review): { text: string; isError: boolean } | undefined {
  if (review.awaiting === 'send-original') {
    const count = review.anonymized.replacementCount
    const hidden = count === 0 ? '' : `, including the ${count} ${count === 1 ? 'segment' : 'segments'} your rules replace`

    return { text: `This sends the original prompt to Claude${hidden}. Press again to confirm.`, isError: false }
  }
  if (review.check.isBlocked) return { text: 'Fix the rules marked in red before sending.', isError: true }
  if (review.awaiting === 'zero-replacements') {
    return {
      text: 'No rule matched, so Claude would receive the prompt exactly as you typed it. Press "Send as typed" to confirm, or add a rule.',
      isError: false,
    }
  }

  return undefined
}
