import { Lifecycle } from '@well-known-components/interfaces'
import { setupRouter } from './controllers/routes.js'
import { AppComponents, GlobalContext, TestComponents } from './types.js'
import { initAgent } from './agent.js'
import { startSlackBot } from './slack.js'

export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components, startComponents } = program
  const { config, logs } = components
  const logger = logs.getLogger('service')

  // Pre-load config (WKC config is async — resolve upfront for downstream modules)
  const slackConfig = {
    slackBotToken: await config.requireString('SLACK_BOT_TOKEN'),
    slackAppToken: await config.requireString('SLACK_APP_TOKEN'),
    githubToken: await config.requireString('GITHUB_TOKEN'),
    anthropicOAuthRefreshToken: await config.getString('ANTHROPIC_OAUTH_REFRESH_TOKEN'),
    model: await config.getString('MODEL'),
    maxConcurrentAgents: (await config.getNumber('MAX_CONCURRENT_AGENTS')) ?? 3,
    upstashRedisUrl: await config.getString('UPSTASH_REDIS_REST_URL'),
    upstashRedisToken: await config.getString('UPSTASH_REDIS_REST_TOKEN'),
    logChannelId: await config.getString('LOG_CHANNEL_ID'),
    notionToken: await config.getString('NOTION_TOKEN'),
    notionShapeDbId: await config.getString('NOTION_SHAPE_DB_ID'),
    notionShapeParentId: await config.getString('NOTION_SHAPE_PARENT_ID')
  }

  logger.info('Initializing Claude agent...')
  await initAgent({
    anthropicOAuthRefreshToken: slackConfig.anthropicOAuthRefreshToken,
    githubToken: slackConfig.githubToken,
    model: slackConfig.model,
    upstashRedisUrl: slackConfig.upstashRedisUrl,
    upstashRedisToken: slackConfig.upstashRedisToken
  })

  logger.info('Starting Slack bot...')
  await startSlackBot(slackConfig)

  const globalContext: GlobalContext = { components }
  const router = await setupRouter(globalContext)
  components.server.use(router.middleware())
  components.server.use(router.allowedMethods())
  components.server.setContext(globalContext)

  await startComponents()
  logger.info('Service started')
}
