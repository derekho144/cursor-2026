export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  gmailUser: process.env.GMAIL_USER ?? "",
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  appBaseUrl: process.env.APP_BASE_URL ?? "https://jdsys.manus.space",
  /** Buffer API key — push approved content to LinkedIn via Buffer */
  bufferAccessToken: process.env.BUFFER_ACCESS_TOKEN ?? "",
  /** Optional; if empty, first linkedin channel is auto-selected */
  bufferLinkedInChannelId: process.env.BUFFER_LINKEDIN_CHANNEL_ID ?? "",
};
