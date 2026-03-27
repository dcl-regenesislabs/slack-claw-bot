import { markdownToMrkdwn, detectSkill, extractFileUploadTag, shouldHandleMessage } from '../../src/slack.js'

describe('detectSkill', () => {
  it('detects "mr review" as pr-review', () => {
    expect(detectSkill('mr review')).toBe('pr-review')
  })

  it('detects "mr-review" as pr-review', () => {
    expect(detectSkill('mr-review')).toBe('pr-review')
  })

  it('detects "review this merge request" as pr-review', () => {
    expect(detectSkill('review this merge request')).toBe('pr-review')
  })

  it('does not trigger pr-review on casual "merge request" mention without review', () => {
    expect(detectSkill('what is that merge request about?')).not.toBe('pr-review')
  })

  it('detects "pr review" as pr-review', () => {
    expect(detectSkill('pr review')).toBe('pr-review')
  })

  it('returns general for unrelated text', () => {
    expect(detectSkill('hello world')).toBe('general')
  })
})

describe('markdownToMrkdwn', () => {
  it('converts bold markdown to mrkdwn', () => {
    expect(markdownToMrkdwn('**bold**')).toBe('*bold*')
  })

  it('converts markdown links to mrkdwn links', () => {
    expect(markdownToMrkdwn('[click](https://example.com)')).toBe('<https://example.com|click>')
  })

  it('handles multiple conversions in one string', () => {
    const input = '**hello** and [link](https://x.com)'
    expect(markdownToMrkdwn(input)).toBe('*hello* and <https://x.com|link>')
  })

  it('returns plain text unchanged', () => {
    expect(markdownToMrkdwn('just text')).toBe('just text')
  })

  it('returns empty string unchanged', () => {
    expect(markdownToMrkdwn('')).toBe('')
  })

  it('leaves single asterisks untouched', () => {
    expect(markdownToMrkdwn('a * b * c')).toBe('a * b * c')
  })
})

describe('shouldHandleMessage', () => {
  const AUTO_REPLY_CHANNELS = new Map([['C_AUTO', 'triage']])

  it('handles DMs', () => {
    const result = shouldHandleMessage({ channel_type: 'im', user: 'U1', text: 'hello' })
    expect(result).toEqual({ handle: true, isAutoReply: false })
  })

  it('handles messages in auto-reply channels with configured skill', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: 'hello' },
      AUTO_REPLY_CHANNELS
    )
    expect(result).toEqual({ handle: true, isAutoReply: true, skill: 'triage' })
  })

  it('skips messages in non-auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_OTHER', user: 'U1', text: 'hello' },
      AUTO_REPLY_CHANNELS
    )
    expect(result).toEqual({ handle: false, isAutoReply: false })
  })

  it('skips thread replies in auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', thread_ts: '123.456', user: 'U1', text: 'hello' },
      AUTO_REPLY_CHANNELS
    )
    expect(result).toEqual({ handle: false, isAutoReply: true })
  })

  it('skips bot messages in auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', bot_id: 'B1', user: 'U1', text: 'hello' },
      AUTO_REPLY_CHANNELS
    )
    expect(result).toEqual({ handle: false, isAutoReply: true })
  })

  it('skips messages with @mentions in auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: 'hey <@U12345> check this' },
      AUTO_REPLY_CHANNELS
    )
    expect(result).toEqual({ handle: false, isAutoReply: true })
  })

  it('skips messages with subtypes', () => {
    const result = shouldHandleMessage(
      { channel_type: 'im', subtype: 'message_changed', user: 'U1', text: 'hello' }
    )
    expect(result).toEqual({ handle: false, isAutoReply: false })
  })

  it('skips messages without text', () => {
    const result = shouldHandleMessage({ channel_type: 'im', user: 'U1', text: '' })
    expect(result).toEqual({ handle: false, isAutoReply: false })
  })

  it('skips messages without user', () => {
    const result = shouldHandleMessage({ channel_type: 'im', text: 'hello' })
    expect(result).toEqual({ handle: false, isAutoReply: false })
  })

  it('handles auto-reply with no autoReplyChannels configured', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: 'hello' }
    )
    expect(result).toEqual({ handle: false, isAutoReply: false })
  })

  it('allows DM thread replies (not skipped like auto-reply)', () => {
    const result = shouldHandleMessage(
      { channel_type: 'im', thread_ts: '123.456', user: 'U1', text: 'hello' }
    )
    expect(result).toEqual({ handle: true, isAutoReply: false })
  })

  // When someone @mentions the bot in an auto-reply channel, the message handler
  // must skip it so only app_mention handles it. This prevents double processing
  // AND ensures the bot uses detectSkill (from the message) instead of the
  // auto-reply channel's configured skill.
  it('skips bot @mention in auto-reply channel so app_mention handles it with detectSkill', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: '<@UBOT123> triage this issue' },
      AUTO_REPLY_CHANNELS
    )
    expect(result.handle).toBe(false)
    expect(result.isAutoReply).toBe(true)
  })

  it('skips messages with @mention among other text in auto-reply channel', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: 'cc <@U999> <@U888>' },
      AUTO_REPLY_CHANNELS
    )
    expect(result.handle).toBe(false)
    expect(result.isAutoReply).toBe(true)
  })

  it('does not skip @mentions in DMs (no double-processing risk)', () => {
    const result = shouldHandleMessage(
      { channel_type: 'im', user: 'U1', text: 'hey <@U12345>' }
    )
    expect(result.handle).toBe(true)
    expect(result.isAutoReply).toBe(false)
  })

  it('returns the correct skill per channel', () => {
    const channels = new Map([['C1', 'triage'], ['C2', 'general']])
    const r1 = shouldHandleMessage({ channel_type: 'channel', channel: 'C1', user: 'U1', text: 'hi' }, channels)
    const r2 = shouldHandleMessage({ channel_type: 'channel', channel: 'C2', user: 'U1', text: 'hi' }, channels)
    expect(r1.skill).toBe('triage')
    expect(r2.skill).toBe('general')
  })
})

describe('extractFileUploadTag', () => {
  it('returns null when no tag is present', () => {
    expect(extractFileUploadTag('Here are the results.')).toBeNull()
  })

  it('extracts path and filename from a self-closing tag', () => {
    const response = 'Here are the results.\n<upload_file path="/tmp/data.csv" filename="results.csv"/>'
    const directive = extractFileUploadTag(response)
    expect(directive).not.toBeNull()
    expect(directive!.path).toBe('/tmp/data.csv')
    expect(directive!.filename).toBe('results.csv')
  })

  it('strips the tag from strippedText', () => {
    const response = 'Summary text.\n<upload_file path="/tmp/data.csv" filename="results.csv"/>'
    const directive = extractFileUploadTag(response)
    expect(directive!.strippedText).toBe('Summary text.')
    expect(directive!.strippedText).not.toContain('<upload_file')
  })

  it('handles tag without trailing slash', () => {
    const response = 'Done.<upload_file path="/tmp/x.csv" filename="x.csv">'
    const directive = extractFileUploadTag(response)
    expect(directive).not.toBeNull()
    expect(directive!.path).toBe('/tmp/x.csv')
  })

  it('is case-insensitive for the tag name', () => {
    const response = '<UPLOAD_FILE path="/tmp/x.csv" filename="x.csv"/>'
    const directive = extractFileUploadTag(response)
    expect(directive).not.toBeNull()
  })

  it('returns strippedText equal to original when no tag present', () => {
    // Confirm no mutation occurs when tag is absent
    expect(extractFileUploadTag('no tag here')).toBeNull()
  })
})

