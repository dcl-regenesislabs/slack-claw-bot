import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
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
      ((await config.getString('AUTO_REPLY_CHANNEL_IDS')) ?? '')
        .split(',').map(s => s.trim()).filter(Boolean)
        .map(entry => {
          const [channelId, skill] = entry.split(':').map(s => s.trim())
          return [channelId, skill || 'general'] as [string, string]
        })
    ),
    cfApiToken: await config.getString('CF_API_TOKEN'),
    cfAccountId: await config.getString('CF_ACCOUNT_ID'),
    cfR2Bucket: await config.getString('CF_R2_BUCKET'),
    cfR2PublicUrl: await config.getString('CF_R2_PUBLIC_URL')
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
    gitlabTokenOps: slackConfig.gitlabTokenOps,
    cfApiToken: slackConfig.cfApiToken,
    cfAccountId: slackConfig.cfAccountId,
    cfR2Bucket: slackConfig.cfR2Bucket,
    cfR2PublicUrl: slackConfig.cfR2PublicUrl
  })

  logger.info('Starting Slack bot...')
  await startSlackBot(slackConfig)

  // Schedule runner — checks schedules.json every 60s and fires due tasks
  await startScheduleRunner(slackConfig.slackBotToken, slackConfig.s3Bucket, slackConfig.awsRegion, logger)

  logger.info('Service started')
}

// ---------------------------------------------------------------------------
// Schedule runner — persists to S3 so schedules survive deploys
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

const S3_SCHEDULES_KEY = 'schedules/schedules.json'
const NO_OUTPUT_SENTINEL = 'NO_OUTPUT'

// Hash of last synced content — used to detect local changes made by the skill agent
let lastSyncedHash: string | null = null

export function contentHash(content: string): string {
  // Simple fast hash for change detection
  let h = 0
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

function readSchedules(): ScheduleFile {
  if (!existsSync(SCHEDULES_PATH)) return { schedules: [] }
  try {
    return JSON.parse(readFileSync(SCHEDULES_PATH, 'utf-8'))
  } catch {
    return { schedules: [] }
  }
}

function writeSchedulesLocal(file: ScheduleFile): string {
  const json = JSON.stringify(file, null, 2)
  const dir = SCHEDULES_PATH.includes('/') ? SCHEDULES_PATH.slice(0, SCHEDULES_PATH.lastIndexOf('/')) : '.'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(SCHEDULES_PATH, json, 'utf-8')
  return json
}

async function s3GetSchedules(bucket: string, region: string): Promise<string | null> {
  try {
    const client = new S3Client({ region })
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: S3_SCHEDULES_KEY }))
    return res.Body ? await res.Body.transformToString('utf-8') : null
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null
    throw err
  }
}

async function s3PutSchedules(bucket: string, region: string, json: string): Promise<void> {
  const client = new S3Client({ region })
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: S3_SCHEDULES_KEY,
    Body: json,
    ContentType: 'application/json'
  }))
  lastSyncedHash = contentHash(json)
}

/** Sync local file to S3 if it changed since last sync. */
async function syncToS3IfChanged(bucket: string, region: string, logger: any): Promise<void> {
  try {
    const json = existsSync(SCHEDULES_PATH) ? readFileSync(SCHEDULES_PATH, 'utf-8') : null
    if (!json) return
    const hash = contentHash(json)
    if (hash === lastSyncedHash) return
    await s3PutSchedules(bucket, region, json)
    logger.info(`[schedule] Synced schedules to S3`)
  } catch (err) {
    logger.error(`[schedule] Failed to sync schedules to S3: ${err}`)
  }
}

function updateScheduleStats(id: string, status: string, s3Bucket?: string, s3Region?: string, logger?: any): void {
  const file = readSchedules()
  const entry = file.schedules.find((s) => s.id === id)
  if (!entry) return
  entry.runCount = (entry.runCount || 0) + 1
  entry.lastRunAt = new Date().toISOString()
  entry.lastRunStatus = status
  const json = writeSchedulesLocal(file)
  // Fire-and-forget S3 sync
  if (s3Bucket && s3Region) {
    s3PutSchedules(s3Bucket, s3Region, json).catch((err) => {
      logger?.error(`[schedule] Failed to sync stats to S3: ${err}`)
    })
  }
}

async function startScheduleRunner(slackBotToken: string, s3Bucket: string | undefined, s3Region: string | undefined, logger: any): Promise<void> {
  const scheduler = new AgentScheduler(1) // separate lane, max 1 concurrent

  // Restore schedules from S3 on startup
  if (s3Bucket && s3Region) {
    try {
      const remote = await s3GetSchedules(s3Bucket, s3Region)
      if (remote) {
        const dir = SCHEDULES_PATH.includes('/') ? SCHEDULES_PATH.slice(0, SCHEDULES_PATH.lastIndexOf('/')) : '.'
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(SCHEDULES_PATH, remote, 'utf-8')
        lastSyncedHash = contentHash(remote)
        const parsed = JSON.parse(remote) as ScheduleFile
        logger.info(`[schedule] Restored ${parsed.schedules.length} schedules from S3`)
      } else {
        logger.info(`[schedule] No schedules found in S3, starting fresh`)
      }
    } catch (err) {
      logger.error(`[schedule] Failed to restore schedules from S3: ${err}`)
    }
  }

  setInterval(async () => {
    const file = readSchedules()
    const enabled = file.schedules.filter((s) => s.enabled)
    logger.info(`[schedule] Tick — ${file.schedules.length} schedules, ${enabled.length} enabled`)

    // Sync any local changes (e.g. from skill agent creating/deleting schedules) to S3
    if (s3Bucket && s3Region) {
      await syncToS3IfChanged(s3Bucket, s3Region, logger)
    }

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

            updateScheduleStats(schedule.id, 'ok', s3Bucket, s3Region, logger)
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown error'
            logger.error(`[schedule] Error running "${schedule.description}": ${msg}`)
            updateScheduleStats(schedule.id, `error: ${msg}`, s3Bucket, s3Region, logger)
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

  logger.info(`[schedule] Runner started, checking ${SCHEDULES_PATH} every 60s (S3 sync: ${s3Bucket ? 'enabled' : 'disabled'})`)
}
