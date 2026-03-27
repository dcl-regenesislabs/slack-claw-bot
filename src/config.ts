// Config interface used by slack.ts and agent.ts
// Config values are loaded via WKC env-config-provider in service.ts
export interface Config {
  slackBotToken: string
  slackAppToken: string
  githubToken: string
  anthropicOAuthRefreshToken?: string
  model?: string
  maxConcurrentAgents: number
  logChannelId?: string
  notionToken?: string
  notionShapeDbId?: string
  notionShapeParentId?: string
  sentryAuthToken?: string
  sentryOrg?: string
  gitlabTokenDcl?: string
  gitlabTokenOps?: string
  s3Bucket?: string
  awsRegion?: string
  autoReplyChannels?: Map<string, string>  // channelId → skill
}
