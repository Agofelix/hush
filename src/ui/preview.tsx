import type { RenderNode } from 'claude-code'

import type { Anonymized } from '../core/replacement-engine'
import type { Kit } from './kit'

/** Above this many characters the preview starts compact, with a toggle. */
export const COMPACT_CHARACTERS = 1200

type PreviewProps = {
  kit: Kit
  anonymized: Anonymized
  isFull: boolean
  onToggle: () => void
}

export function Preview({ kit, anonymized, isFull, onToggle }: PreviewProps) {
  const { Box, Button, Text } = kit
  const total = anonymized.text.length
  const isLong = total > COMPACT_CHARACTERS
  const limit = isFull || !isLong ? total : COMPACT_CHARACTERS
  const shown: RenderNode[] = []
  let used = 0
  for (const segment of anonymized.segments) {
    if (used >= limit) break
    const text = segment.text.slice(0, limit - used)
    used += text.length
    shown.push(
      segment.ruleId === undefined ? (
        text
      ) : (
        <Text color="success" bold>
          {text}
        </Text>
      ),
    )
  }
  const rules = Object.keys(anonymized.countByRule).length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        <Text bold>Preview</Text>
        <Text dimColor>{countLine(anonymized.replacementCount, rules)}</Text>
        {isLong && (
          <Button
            key="preview-toggle"
            plain
            dimColor
            label={isFull ? 'Show less' : 'Show full preview'}
            onPress={onToggle}
          />
        )}
      </Box>
      <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column">
        <Box key="preview-text">
          <Text>{shown}</Text>
        </Box>
        {used < total && (
          <Text dimColor>
            {`Showing ${used.toLocaleString('en')} of ${total.toLocaleString('en')} characters. All of them are sent.`}
          </Text>
        )}
      </Box>
    </Box>
  )
}

function countLine(replacements: number, rules: number): string {
  if (replacements === 0) return 'No replacements yet: this is the prompt as typed.'

  return `${replacements} ${replacements === 1 ? 'replacement' : 'replacements'} from ${rules} ${rules === 1 ? 'rule' : 'rules'}`
}
