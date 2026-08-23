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
  /**
   * Optional custom-domain From for Resend (only after domain is verified).
   * Leave empty to send as GMAIL_USER (info.exposurehk@gmail.com) via Gmail SMTP.
   * Never set to *@resend.dev — shared domains land in spam.
   */
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "",
  /**
   * Optional separate From for Freehunter / pitch outreach.
   * Leave empty to use GMAIL_USER.
   */
  resendFromOutreach: process.env.RESEND_FROM_OUTREACH ?? "",
  /** Reply-To (defaults to GMAIL_USER / info.exposurehk@gmail.com). */
  emailReplyTo: process.env.EMAIL_REPLY_TO ?? "",
  appBaseUrl: process.env.APP_BASE_URL ?? "https://jdsys.manus.space",
  /**
   * Public HTTPS origin Buffer can fetch without auth.
   * Prefer PUBLIC_APP_URL; fall back to production site.
   */
  publicBaseUrl: (
    process.env.PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    "https://jdsys.biz"
  ).replace(/\/+$/, ""),
  /** Buffer API key — push approved content to LinkedIn via Buffer */
  bufferAccessToken: process.env.BUFFER_ACCESS_TOKEN ?? "",
  /** Optional; if empty, first linkedin channel is auto-selected */
  bufferLinkedInChannelId: process.env.BUFFER_LINKEDIN_CHANNEL_ID ?? "",
  /** Airwallex online payments (Payment Links + webhook) */
  airwallexApiKey: process.env.AIRWALLEX_API_KEY ?? "",
  airwallexClientId: process.env.AIRWALLEX_CLIENT_ID ?? "",
  airwallexEnv: process.env.AIRWALLEX_ENV ?? "production",
  airwallexWebhookSecret: process.env.AIRWALLEX_WEBHOOK_SECRET ?? "",
};
