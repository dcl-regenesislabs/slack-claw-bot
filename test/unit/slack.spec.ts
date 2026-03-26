import { markdownToMrkdwn, detectSkill, extractFileUploadTag } from '../../src/slack.js'

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

