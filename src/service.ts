import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { Lifecycle } from '@well-known-components/interfaces'
import { setupRouter } from './controllers/routes.js'
import { AppComponents, GlobalContext, TestComponents } from './types.js'
import { initAgent, runAgent, syncAuth } from './agent.js'
import { startSlackBot } from './slack.js'
import { AgentScheduler } from './concurrency.js'
import { Cron } from 'croner'

export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components, startComponents } = program
  const { config, logs, redis } = components
  const logger = logs.getLogger('service')

  // Pre-load config (WKC config is async — resolve upfront for downstream modules)
  const slackConfig = {
    slackBotToken: await config.requireString('SLACK_BOT_TOKEN'),
    slackAppToken: await config.requireString('SLACK_APP_TOKEN'),
    githubToken: await config.requireString('GITHUB_TOKEN'),
    anthropicOAuthRefreshToken: await config.getString('ANTHROPIC_OAUTH_REFRESH_TOKEN'),
    model: await config.getString('MODEL'),
    maxConcurrentAgents: (await config.getNumber('MAX_CONCURRENT_AGENTS')) ?? 3,
    logChannelId: await config.getString('LOG_CHANNEL_ID'),
    notionToken: await config.getString('NOTION_TOKEN'),
    notionShapeDbId: await config.getString('NOTION_SHAPE_DB_ID'),
    notionShapeParentId: await config.getString('NOTION_SHAPE_PARENT_ID'),
    sentryAuthToken: await config.getString('SENTRY_AUTH_TOKEN'),
    sentryOrg: await config.getString('SENTRY_ORG'),
    gitlabTokenDcl: await config.getString('GITLAB_TOKEN_DCL'),
    gitlabTokenOps: await config.getString('GITLAB_TOKEN_OPS'),
    s3Bucket: await config.getString('S3_BUCKET'),
    awsRegion: (await config.getString('AWS_REGION')) ?? (await config.getString('AWS_DEFAULT_REGION')),
    autoReplyChannels: new Map(
      ((await config.getString('AUTO_REPLY_CHANNELS')) ?? '')
        .split(',').map(s => s.trim()).filter(Boolean)
        .map(entry => {
          const [channelId, skill] = entry.split(':').map(s => s.trim())
          return [channelId, skill || 'general'] as [string, string]
        })
    ),
    netlifyToken: await config.getString('NETLIFY_TOKEN')
  }

  const globalContext: GlobalContext = { components }
  const router = await setupRouter(globalContext)
  components.server.use(router.middleware())
  components.server.use(router.allowedMethods())
  components.server.setContext(globalContext)

  await startComponents()

  logger.info('Initializing Claude agent...')
  await initAgent({
    anthropicOAuthRefreshToken: slackConfig.anthropicOAuthRefreshToken,
    githubToken: slackConfig.githubToken,
    model: slackConfig.model,
    redis,
    sentryAuthToken: slackConfig.sentryAuthToken,
    sentryOrg: slackConfig.sentryOrg,
    gitlabTokenDcl: slackConfig.gitlabTokenDcl,
    gitlabTokenOps: slackConfig.gitlabTokenOps
  })

  logger.info('Starting Slack bot...')
  await startSlackBot(slackConfig)

  // Schedule runner — checks schedules.json every 60s and fires due tasks
  startScheduleRunner(slackConfig.slackBotToken, logger)

  logger.info('Service started')
}

// ---------------------------------------------------------------------------
// Schedule runner
// ---------------------------------------------------------------------------

interface Schedule {
  id: string
  cron: string
  task: string
  description: string
  channel: string
  createdBy: string
  createdAt: string
  enabled: boolean
  runCount: number
  lastRunAt: string | null
  lastRunStatus: string | null
}

interface ScheduleFile {
  schedules: Schedule[]
}

const SCHEDULES_PATH =
  process.env.NODE_ENV === 'production' && existsSync('/data')
    ? '/data/schedules.json'
    : 'data/schedules.json'

const NO_OUTPUT_SENTINEL = 'NO_OUTPUT'

function readSchedules(): ScheduleFile {
  if (!existsSync(SCHEDULES_PATH)) return { schedules: [] }
  try {
    return JSON.parse(readFileSync(SCHEDULES_PATH, 'utf-8'))
  } catch {
    return { schedules: [] }
  }
}

function updateScheduleStats(id: string, status: string): void {
  const file = readSchedules()
  const entry = file.schedules.find((s) => s.id === id)
  if (!entry) return
  entry.runCount = (entry.runCount || 0) + 1
  entry.lastRunAt = new Date().toISOString()
  entry.lastRunStatus = status
  writeFileSync(SCHEDULES_PATH, JSON.stringify(file, null, 2), 'utf-8')
}

function startScheduleRunner(slackBotToken: string, logger: any): void {
  const scheduler = new AgentScheduler(1) // separate lane, max 1 concurrent

  setInterval(async () => {
    const file = readSchedules()
    const enabled = file.schedules.filter((s) => s.enabled)
    logger.info(`[schedule] Tick — ${file.schedules.length} schedules, ${enabled.length} enabled`)
    if (!enabled.length) return

    const now = new Date()

    for (const schedule of enabled) {
      try {
        const cron = new Cron(schedule.cron)
        // Find the next scheduled time after (now - 60s); if it's in the past, it's due
        const since = new Date(now.getTime() - 60_000)
        const next = cron.nextRun(since)
        logger.info(`[schedule] "${schedule.description}" (${schedule.id}) — next after ${since.toISOString()}: ${next?.toISOString() ?? 'none'}`)
        if (!next || next > now) continue

        logger.info(`[schedule] Firing "${schedule.description}" (${schedule.id})`)

        const threadId = `schedule-${schedule.id}`
        const submission = scheduler.submit(threadId, async () => {
          try {
            const { text } = await runAgent({
              threadContent: schedule.task,
              triggeredBy: `schedule:${schedule.id}`
            })
            await syncAuth()

            // Post result to Slack unless sentinel
            if (text && !text.trim().startsWith(NO_OUTPUT_SENTINEL)) {
              await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${slackBotToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  channel: schedule.channel,
                  text: (() => {
                    const footer = `\n\n_Schedule: ${schedule.description} · \`${schedule.cron}\` · ID: ${schedule.id}_`
                    const body = text.length > 3000 ? text.slice(0, 3000) + '\n...(truncated)' : text
                    return body + footer
                  })()
                })
              })
            }

            updateScheduleStats(schedule.id, 'ok')
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown error'
            logger.error(`[schedule] Error running "${schedule.description}": ${msg}`)
            updateScheduleStats(schedule.id, `error: ${msg}`)
          }
        })

        if (submission.status === 'queued-behind-thread') {
          logger.warn(`[schedule] "${schedule.description}" still running, queued behind thread`)
        }
        submission.done.catch((err) => {
          logger.error(`[schedule] Unhandled rejection in "${schedule.description}": ${err}`)
        })
      } catch (err) {
        logger.error(`[schedule] Bad cron for "${schedule.id}": ${err}`)
      }
    }
  }, 60_000)

  logger.info(`[schedule] Runner started, checking ${SCHEDULES_PATH} every 60s`)
}
