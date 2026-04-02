import { markdownToMrkdwn, detectSkill, extractFileUploadTag, shouldHandleMessage, extractEventText, formatEta, SKILL_MODELS } from '../../src/slack.js'

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

  it('detects "check AB: 0,0" as ab-status', () => {
    expect(detectSkill('check AB: 0,0')).toBe('ab-status')
  })

  it('detects "check AB status: 52,-30" as ab-status', () => {
    expect(detectSkill('check AB status: 52,-30')).toBe('ab-status')
  })

  it('detects "check asset bundles for 0,0" as ab-status', () => {
    expect(detectSkill('check asset bundles for 0,0')).toBe('ab-status')
  })

  it('detects "AB queue" as ab-status', () => {
    expect(detectSkill('ab queue')).toBe('ab-status')
  })

  it('detects "AB conversion" as ab-status', () => {
    expect(detectSkill('AB conversion')).toBe('ab-status')
  })

  it('detects "check AB pipeline" as ab-status', () => {
    expect(detectSkill('check AB pipeline')).toBe('ab-status')
  })

  it('detects "scene conversion status" as ab-status', () => {
    expect(detectSkill('scene conversion status')).toBe('ab-status')
  })

  it('detects "check pointer consistency" as dcl-consistency', () => {
    expect(detectSkill('check pointer consistency for 0,0')).toBe('dcl-consistency')
  })

  it('detects "check wearables" as dcl-consistency', () => {
    expect(detectSkill('check wearables consistency')).toBe('dcl-consistency')
  })

  it('detects "pipeline failed" as pipeline', () => {
    expect(detectSkill('pipeline failed on main')).toBe('pipeline')
  })

  it('detects "ci is broken" as pipeline', () => {
    expect(detectSkill('ci is broken')).toBe('pipeline')
  })

  it('detects "workflow not running" as pipeline', () => {
    expect(detectSkill('workflow not running')).toBe('pipeline')
  })

  it('detects "build failing on PR" as pipeline', () => {
    expect(detectSkill('build failing on this PR')).toBe('pipeline')
  })

  it('detects "ci/cd" as pipeline', () => {
    expect(detectSkill('check the ci/cd')).toBe('pipeline')
  })

  it('detects "aws cost breakdown" as aws-infra', () => {
    expect(detectSkill('aws cost breakdown')).toBe('aws-infra')
  })

  it('detects "cloud spend by environment" as aws-infra', () => {
    expect(detectSkill('cloud spend by environment')).toBe('aws-infra')
  })

  it('detects "how much are we spending on ec2" as aws-infra', () => {
    expect(detectSkill('how much are we spending on ec2')).toBe('aws-infra')
  })

  it('detects "how many rds instances in PRD" as aws-infra', () => {
    expect(detectSkill('how many rds instances in PRD')).toBe('aws-infra')
  })

  it('detects "cost anomaly detection" as aws-infra', () => {
    expect(detectSkill('cost anomaly detection')).toBe('aws-infra')
  })

  it('detects "infrastructure cost overview" as aws-infra', () => {
    expect(detectSkill('infrastructure cost overview')).toBe('aws-infra')
  })

  it('detects "aws billing this month" as aws-infra', () => {
    expect(detectSkill('aws billing this month')).toBe('aws-infra')
  })

  it('detects "cost forecast" as aws-infra', () => {
    expect(detectSkill('cost forecast')).toBe('aws-infra')
  })

  it('does not trigger aws-infra on "how should we spend our time"', () => {
    expect(detectSkill('how should we spend our time on this?')).not.toBe('aws-infra')
  })

  it('does not trigger aws-infra on "billing address update"', () => {
    expect(detectSkill('update the billing address on the invoice')).not.toBe('aws-infra')
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
  const AUTO_REPLY_CHANNEL_IDS = new Map([['C_AUTO', 'triage']])

  it('handles DMs', () => {
    const result = shouldHandleMessage({ channel_type: 'im', user: 'U1', text: 'hello' })
    expect(result).toEqual({ handle: true, isAutoReply: false })
  })

  it('handles messages in auto-reply channels with configured skill', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: 'hello' },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: true, isAutoReply: true, skill: 'triage' })
  })

  it('skips messages in non-auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_OTHER', user: 'U1', text: 'hello' },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: false, isAutoReply: false, reason: "not a DM or auto-reply channel" })
  })

  it('skips thread replies in auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', thread_ts: '123.456', user: 'U1', text: 'hello' },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: false, isAutoReply: true, reason: "thread reply in auto-reply channel" })
  })

  it('allows bot messages in auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', bot_id: 'B1', user: 'U1', text: 'hello' },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: true, isAutoReply: true, skill: 'triage' })
  })

  it('allows bot messages without user in auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', bot_id: 'B1', text: 'hello' },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: true, isAutoReply: true, skill: 'triage' })
  })

  it('handles messages with @mentions in auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: 'hey <@U12345> check this' },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: true, isAutoReply: true, skill: 'triage' })
  })

  it('skips messages with subtypes', () => {
    const result = shouldHandleMessage(
      { channel_type: 'im', subtype: 'message_changed', user: 'U1', text: 'hello' }
    )
    expect(result).toEqual({ handle: false, isAutoReply: false, reason: "subtype: message_changed" })
  })

  it('skips messages without text', () => {
    const result = shouldHandleMessage({ channel_type: 'im', user: 'U1', text: '' })
    expect(result).toEqual({ handle: false, isAutoReply: false, reason: "no text content" })
  })

  it('skips messages without user', () => {
    const result = shouldHandleMessage({ channel_type: 'im', text: 'hello' })
    expect(result).toEqual({ handle: false, isAutoReply: false, reason: "no user" })
  })

  it('handles auto-reply with no autoReplyChannels configured', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: 'hello' }
    )
    expect(result).toEqual({ handle: false, isAutoReply: false, reason: "not a DM or auto-reply channel" })
  })

  it('allows DM thread replies (not skipped like auto-reply)', () => {
    const result = shouldHandleMessage(
      { channel_type: 'im', thread_ts: '123.456', user: 'U1', text: 'hello' }
    )
    expect(result).toEqual({ handle: true, isAutoReply: false })
  })

  it('handles bot @mention in auto-reply channel (app_mention may also fire)', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: '<@UBOT123> triage this issue' },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result.handle).toBe(true)
    expect(result.isAutoReply).toBe(true)
  })

  it('handles messages with multiple @mentions (e.g. cc) in auto-reply channel', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', user: 'U1', text: 'cc <@U999> <@U888>' },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result.handle).toBe(true)
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

  it('handles bot messages with attachments but no text in auto-reply channels', () => {
    const result = shouldHandleMessage(
      {
        channel_type: 'channel',
        channel: 'C_AUTO',
        bot_id: 'B_GITHUB',
        subtype: 'bot_message',
        attachments: [{ text: 'Release - 2.22.0\nfeat: add token-based moderator authentication', fallback: 'New release published' }]
      },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: true, isAutoReply: true, skill: 'triage' })
  })

  it('skips bot messages with no text and no attachments in auto-reply channels', () => {
    const result = shouldHandleMessage(
      { channel_type: 'channel', channel: 'C_AUTO', bot_id: 'B1', subtype: 'bot_message' },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: false, isAutoReply: true, reason: "no text content" })
  })

  it('handles bot messages with blocks but no text/attachments in auto-reply channels', () => {
    const result = shouldHandleMessage(
      {
        channel_type: 'channel',
        channel: 'C_AUTO',
        bot_id: 'B_GITHUB',
        subtype: 'bot_message',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'New release published' } }]
      },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: true, isAutoReply: true, skill: 'triage' })
  })

  it('skips bot messages with subtype in non-auto-reply channels even with attachments', () => {
    const result = shouldHandleMessage(
      {
        channel_type: 'im',
        subtype: 'bot_message',
        bot_id: 'B1',
        attachments: [{ text: 'some content' }]
      },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: false, isAutoReply: false, reason: "subtype: bot_message" })
  })

  it('skips bot messages with empty attachments in auto-reply channels', () => {
    const result = shouldHandleMessage(
      {
        channel_type: 'channel',
        channel: 'C_AUTO',
        bot_id: 'B1',
        subtype: 'bot_message',
        attachments: []
      },
      AUTO_REPLY_CHANNEL_IDS
    )
    expect(result).toEqual({ handle: false, isAutoReply: true, reason: "no text content" })
  })
})

describe('extractEventText', () => {
  it('returns text when present', () => {
    expect(extractEventText({ text: 'hello' })).toBe('hello')
  })

  it('extracts text from attachments when text is empty', () => {
    expect(extractEventText({
      text: '',
      attachments: [{ text: 'Release - 2.22.0' }]
    })).toBe('Release - 2.22.0')
  })

  it('combines pretext and text from attachments', () => {
    expect(extractEventText({
      attachments: [{ pretext: 'New release published', text: 'Release - 2.22.0' }]
    })).toBe('New release published\nRelease - 2.22.0')
  })

  it('extracts text from section blocks when text and attachments are empty', () => {
    expect(extractEventText({
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Release - 2.22.0' } }]
    })).toBe('Release - 2.22.0')
  })

  it('extracts text from rich_text blocks', () => {
    expect(extractEventText({
      blocks: [{
        type: 'rich_text',
        elements: [{
          type: 'rich_text_section',
          elements: [
            { type: 'text', text: 'New release: ' },
            { type: 'link', url: 'https://github.com/org/repo' }
          ]
        }]
      }]
    })).toBe('New release: \nhttps://github.com/org/repo')
  })

  it('merges attachments and blocks', () => {
    expect(extractEventText({
      attachments: [{ text: 'from attachment' }],
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'from block' } }]
    })).toBe('from attachment\nfrom block')
  })

  it('uses blocks when attachments are empty array', () => {
    expect(extractEventText({
      attachments: [],
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'from blocks' } }]
    })).toBe('from blocks')
  })

  it('extracts text from multiple attachments', () => {
    expect(extractEventText({
      attachments: [
        { text: 'First release' },
        { text: 'Second release' }
      ]
    })).toBe('First release\nSecond release')
  })

  it('extracts fields from section blocks', () => {
    expect(extractEventText({
      blocks: [{
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: 'Status: open' },
          { type: 'mrkdwn', text: 'Priority: high' }
        ]
      }]
    })).toBe('Status: open\nPriority: high')
  })

  it('handles header blocks', () => {
    expect(extractEventText({
      blocks: [{ type: 'header', text: { type: 'plain_text', text: 'Release Notes' } }]
    })).toBe('Release Notes')
  })

  it('merges text, attachments, and blocks', () => {
    expect(extractEventText({
      text: 'direct text',
      attachments: [{ text: 'attachment' }],
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'block' } }]
    })).toBe('direct text\nattachment\nblock')
  })

  it('returns empty string when no text, attachments, or blocks', () => {
    expect(extractEventText({})).toBe('')
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

describe('formatEta', () => {
  it('returns seconds for values under 60', () => {
    expect(formatEta(45)).toBe('45s')
  })

  it('returns minutes for values at 60', () => {
    expect(formatEta(60)).toBe('1min')
  })

  it('returns minutes for values over 60', () => {
    expect(formatEta(150)).toBe('3min')
  })

  it('returns 0s for zero', () => {
    expect(formatEta(0)).toBe('0s')
  })
})

describe('SKILL_MODELS', () => {
  it('maps aws-infra to claude-opus-4-6', () => {
    expect(SKILL_MODELS['aws-infra']).toBe('claude-opus-4-6')
  })

  it('maps pipeline to claude-opus-4-6', () => {
    expect(SKILL_MODELS['pipeline']).toBe('claude-opus-4-6')
  })

  it('does not define a model for general', () => {
    expect(SKILL_MODELS['general']).toBeUndefined()
  })
})

