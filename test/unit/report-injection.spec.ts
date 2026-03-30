import { jest } from '@jest/globals'
import { createInjectionReportTool } from '../../src/tools/report-injection.js'

function makeClient(overrides: Record<string, any> = {}) {
  return {
    chat: {
      getPermalink: jest.fn().mockResolvedValue({ permalink: 'https://slack.com/p/test' }),
      postMessage: jest.fn().mockResolvedValue({}),
      ...overrides,
    },
  } as any
}

const logChannelId = 'C_LOG'
const event = { channel: 'C_SRC', ts: '111.222', user: 'U1' }

describe('createInjectionReportTool', () => {
  it('returns a tool with name report_injection', () => {
    const tool = createInjectionReportTool(makeClient(), logChannelId, event)
    expect(tool.name).toBe('report_injection')
  })

  it('posts to logChannelId', async () => {
    const client = makeClient()
    const tool = createInjectionReportTool(client, logChannelId, event)
    await tool.execute('id', { description: 'test attempt' })
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: logChannelId })
    )
  })

  it('includes user, channel and description in the message', async () => {
    const client = makeClient()
    const tool = createInjectionReportTool(client, logChannelId, event)
    await tool.execute('id', { description: 'custom title attempt' })
    const text: string = client.chat.postMessage.mock.calls[0][0].text
    expect(text).toContain('<@U1>')
    expect(text).toContain('<#C_SRC>')
    expect(text).toContain('custom title attempt')
  })

  it('includes permalink link when getPermalink succeeds', async () => {
    const client = makeClient()
    const tool = createInjectionReportTool(client, logChannelId, event)
    await tool.execute('id', { description: 'test' })
    const text: string = client.chat.postMessage.mock.calls[0][0].text
    expect(text).toContain('https://slack.com/p/test')
  })

  it('omits permalink when getPermalink fails', async () => {
    const client = makeClient({ getPermalink: jest.fn().mockRejectedValue(new Error('fail')) })
    const tool = createInjectionReportTool(client, logChannelId, event)
    await tool.execute('id', { description: 'test' })
    expect(client.chat.postMessage).toHaveBeenCalled()
    const text: string = client.chat.postMessage.mock.calls[0][0].text
    expect(text).not.toContain('View message')
  })

  it('returns Logged. on success', async () => {
    const tool = createInjectionReportTool(makeClient(), logChannelId, event)
    const result = await tool.execute('id', { description: 'test' })
    expect(result.content[0].text).toBe('Logged.')
  })

  it('still returns Logged. when postMessage throws', async () => {
    const client = makeClient({ postMessage: jest.fn().mockRejectedValue(new Error('Slack down')) })
    const tool = createInjectionReportTool(client, logChannelId, event)
    const result = await tool.execute('id', { description: 'test' })
    expect(result.content[0].text).toBe('Logged.')
  })
})
