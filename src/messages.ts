// Drop reasons and notices are shown to the person and may reach the debug
// log. None of them may quote the prompt or a rule.
export const SAID = {
  held: 'Hush is holding this prompt for review. Nothing has been sent to Claude.',
  busy: 'Hush is already reviewing another prompt. Send or cancel that one first: this prompt was not sent.',
  commandArgs:
    'Hush cannot anonymize slash command arguments, so this command was not run. Run it without arguments, or disable the Hush plugin.',
  attachments:
    'Hush cannot anonymize pasted images or documents, so this prompt was not sent. Remove the attachment and send the text again.',
  noSurface:
    'Hush needs the terminal or the desktop app to show its review panel. This session has neither, so the prompt was not sent.',
  notPlaced: 'Hush could not show its review panel, so the prompt was not sent. Reason:',
  interrupted: 'The submission was interrupted before review. Nothing was sent.',
  failed: 'Hush failed before the review started, so the prompt was not sent.',
  notApproved: 'Hush did not approve this exact text, so it was not sent.',
  discarded: 'Hush discarded the prompt. Nothing was sent.',
  submitFailed: 'Hush could not submit the anonymized prompt. Nothing was sent.',
  drawFailed: 'Hush could not draw its panel, so the held prompt was discarded. Nothing was sent.',
  waiting: 'Hush: a prompt is waiting for your review',
} as const
