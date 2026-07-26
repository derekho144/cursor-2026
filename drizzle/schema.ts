import {
  int,
  bigint,
  boolean,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  json,
  tinyint,
  mediumtext,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Quotes (報價單) ───────────────────────────────────────────────
export const quotes = mysqlTable("quotes", {
  id: int("id").autoincrement().primaryKey(),
  quoteNumber: varchar("quoteNumber", { length: 32 }).notNull().unique(),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  clientEmail: varchar("clientEmail", { length: 320 }),
  clientPhone: varchar("clientPhone", { length: 64 }),
  clientCompany: varchar("clientCompany", { length: 255 }),
  serviceType: mysqlEnum("serviceType", [
    "corporate_event",
    "product",
    "food_beverage",
    "jewelry",
    "artwork",
    "interior",
    "video_production",
    "graphic_design",
    "ad_video",
    "web_development",
    "ai_photography",
    "menu_design",
    "portrait",
    "360_photography",
    "drone",
    "kol_mi",
    "other",
  ]).notNull(),
  shootingDate: varchar("shootingDate", { length: 32 }),
  shootingLocation: text("shootingLocation"),
  notes: text("notes"),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }).notNull().default("0"), // e.g. 10 = 10% off
  discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }).notNull().default("0"), // computed: discountableSubtotal * discountPercent / 100
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  depositPercent: decimal("depositPercent", { precision: 5, scale: 2 }).notNull().default("50"), // e.g. 50 = 50% deposit
  depositMode: varchar("depositMode", { length: 16 }).notNull().default("percent"), // "percent" | "fixed"
  depositFixedAmount: decimal("depositFixedAmount", { precision: 10, scale: 2 }), // 固定訂金金額（depositMode="fixed" 時使用）
  paymentNetDays: int("paymentNetDays"), // e.g. 30 = Net 30 days (nullable = not specified)
  currency: varchar("currency", { length: 8 }).notNull().default("HKD"),
  status: mysqlEnum("status", ["draft", "sent", "accepted", "rejected", "expired"]).notNull().default("draft"),
  pdfUrl: text("pdfUrl"),
  pdfKey: varchar("pdfKey", { length: 512 }),
  llmDescription: text("llmDescription"),
  clientId: int("clientId"),
  validUntil: varchar("validUntil", { length: 32 }),
  equipment: text("equipment"),
  team: varchar("team", { length: 128 }),
  deliveryMethod: text("deliveryMethod"),
  leadSource: varchar("leadSource", { length: 64 }),
  receiptUrl: text("receiptUrl"),
  receiptKey: varchar("receiptKey", { length: 512 }),
  // Signing
  signToken: varchar("signToken", { length: 128 }).unique(),
  signedAt: timestamp("signedAt"),
  signedByName: varchar("signedByName", { length: 255 }),
  signatureData: text("signatureData"), // base64 PNG of signature
  signAttachments: text("signAttachments"), // JSON array of { name, url, key }
  rejectedReason: varchar("rejected_reason", { length: 255 }),
  reviewEmailSentAt: timestamp("reviewEmailSentAt"), // Google review invite sent timestamp
  // Payment tracking
  depositPaidAmount: decimal("depositPaidAmount", { precision: 10, scale: 2 }), // 已付訂金金額（null = 未記錄）
  depositPaidAt: timestamp("depositPaidAt"), // 訂金付款日期
  balancePaidAmount: decimal("balancePaidAmount", { precision: 10, scale: 2 }), // 已付尾數金額（null = 未記錄）
  balancePaidAt: timestamp("balancePaidAt"), // 尾數付款日期
  paymentStatus: mysqlEnum("paymentStatus", ["unpaid", "deposit_paid", "fully_paid"]).notNull().default("unpaid"), // 付款狀態
  paymentNotes: text("paymentNotes"), // 付款備註
  // Bank Transfer Payment Info
  bankTransferPayee: varchar("bankTransferPayee", { length: 255 }), // 收款人名稱
  bankTransferBank: varchar("bankTransferBank", { length: 255 }), // 銀行名稱
  bankTransferAccount: varchar("bankTransferAccount", { length: 64 }), // 銀行帳號
  bankTransferRef: varchar("bankTransferRef", { length: 64 }), // 轉帳參考編號
  // FPS Payment Info
  fpsPayee: varchar("fpsPayee", { length: 255 }), // FPS 收款人名稱
  fpsPhone: varchar("fpsPhone", { length: 20 }), // FPS 電話號碼
  fpsRef: varchar("fpsRef", { length: 64 }), // FPS 參考編號
  emailInquiryId: int("email_inquiry_id"), // Link to email_inquiries table (for AI pricing accuracy tracking)
  stopFollowUp: boolean("stop_follow_up").notNull().default(false), // Stop automatic follow-up emails for this quote
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = typeof quotes.$inferInsert;

// ─── Quote Items (報價單項目) ──────────────────────────────────────
export const quoteItems = mysqlTable("quote_items", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 8, scale: 2 }).notNull().default("1"),
  unit: varchar("unit", { length: 32 }).default("次"),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type QuoteItem = typeof quoteItems.$inferSelect;
export type InsertQuoteItem = typeof quoteItems.$inferInsert;

// ─── Ad Expenses (廣告開支) ────────────────────────────────────────
export const adExpenses = mysqlTable("ad_expenses", {
  id: int("id").autoincrement().primaryKey(),
  platform: mysqlEnum("platform", ["hellotoby", "360pro", "freehunter", "google_ads"]).notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("HKD"),
  impressions: int("impressions"),
  clicks: int("clicks"),
  conversions: int("conversions"),
  notes: text("notes"),
  isAutoSynced: int("isAutoSynced").notNull().default(0),
  refundAmount: decimal("refundAmount", { precision: 10, scale: 2 }).notNull().default("0"),
  rawData: json("rawData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdExpense = typeof adExpenses.$inferSelect;
export type InsertAdExpense = typeof adExpenses.$inferInsert;

// ─── Platform Credentials (平台帳號憑證) ────────────────────────
export const platformCredentials = mysqlTable("platform_credentials", {
  id: int("id").autoincrement().primaryKey(),
  platform: mysqlEnum("platform", ["hellotoby", "360pro", "freehunter", "google_ads"]).notNull().unique(),
  loginEmail: varchar("loginEmail", { length: 320 }),
  loginPassword: text("loginPassword"), // AES-256 encrypted
  accessToken: mediumtext("accessToken"),  // Firebase/OAuth access token (mediumtext for large encrypted storageState)
  refreshToken: text("refreshToken"),     // Firebase/OAuth refresh token
  tokenExpiresAt: bigint("tokenExpiresAt", { mode: "number" }), // Unix ms
  firebaseUid: varchar("firebaseUid", { length: 128 }),
  isActive: int("isActive").notNull().default(1),
  lastVerifiedAt: timestamp("lastVerifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlatformCredential = typeof platformCredentials.$inferSelect;
export type InsertPlatformCredential = typeof platformCredentials.$inferInsert;

// ─── Ad Platform Configs (廣告平台設定) ───────────────────────────
export const adPlatformConfigs = mysqlTable("ad_platform_configs", {
  id: int("id").autoincrement().primaryKey(),
  platform: mysqlEnum("platform", ["hellotoby", "360pro", "freehunter", "google_ads"]).notNull().unique(),
  isEnabled: int("isEnabled").notNull().default(0),
  apiKey: text("apiKey"),
  apiSecret: text("apiSecret"),
  accountId: varchar("accountId", { length: 255 }),
  lastSyncAt: timestamp("lastSyncAt"),
  syncStatus: mysqlEnum("syncStatus", ["idle", "syncing", "success", "error"]).default("idle"),
  syncError: text("syncError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdPlatformConfig = typeof adPlatformConfigs.$inferSelect;
export type InsertAdPlatformConfig = typeof adPlatformConfigs.$inferInsert;

// ─── Ad Sync Logs (同步記錄) ──────────────────────────────────────
export const adSyncLogs = mysqlTable("ad_sync_logs", {
  id: int("id").autoincrement().primaryKey(),
  platform: mysqlEnum("platform", ["hellotoby", "360pro", "freehunter", "google_ads"]).notNull(),
  status: mysqlEnum("status", ["success", "error"]).notNull(),
  message: text("message"),
  recordsUpdated: int("recordsUpdated").default(0),
  syncedAt: timestamp("syncedAt").defaultNow().notNull(),
});

export type AdSyncLog = typeof adSyncLogs.$inferSelect;
export type InsertAdSyncLog = typeof adSyncLogs.$inferInsert;

// ─── Ad Transactions (廣告逐筆交易) ──────────────────────────────
export const adTransactions = mysqlTable("ad_transactions", {
  id: int("id").autoincrement().primaryKey(),
  platform: mysqlEnum("platform", ["hellotoby", "360pro", "freehunter", "google_ads"]).notNull(),
  transId: varchar("transId", { length: 64 }).notNull(),
  transDate: varchar("transDate", { length: 32 }).notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(),
  description: text("description"),
  coins: decimal("coins", { precision: 10, scale: 2 }),
  hkdAmount: decimal("hkdAmount", { precision: 10, scale: 2 }).notNull(),
  exchangeRate: decimal("exchangeRate", { precision: 8, scale: 4 }),
  type: mysqlEnum("type", ["expense", "refund", "topup"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdTransaction = typeof adTransactions.$inferSelect;
export type InsertAdTransaction = typeof adTransactions.$inferInsert;

// ─── Clients (客戶資料庫) ────────────────────────────────────────────
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 64 }),
  address: text("address"),
  notes: text("notes"),
  source: varchar("source", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

// ─── Email Logs (郵件發送記錄) ────────────────────────────────────────
export const emailLogs = mysqlTable("email_logs", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  to: varchar("to", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 512 }).notNull(),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["sent", "failed"]).notNull().default("sent"),
  errorMessage: text("errorMessage"),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  // Resend tracking
  resendMessageId: varchar("resend_message_id", { length: 128 }), // Resend email ID for webhook matching
  openedAt: timestamp("opened_at"), // first open time from Resend webhook
  openCount: int("open_count").default(0).notNull(), // total open count
});

export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = typeof emailLogs.$inferInsert;

// ─── Deliveries (相片交付) ─────────────────────────────────────────────
export const deliveries = mysqlTable("deliveries", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  quoteId: int("quoteId"),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  googleDriveUrl: text("googleDriveUrl").notNull(),
  message: text("message"),
  password: varchar("password", { length: 255 }),
  status: mysqlEnum("status", ["active", "expired", "archived"]).notNull().default("active"),
  downloadCount: int("downloadCount").notNull().default(0),
  receiptUrl: text("receiptUrl"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Delivery = typeof deliveries.$inferSelect;
export type InsertDelivery = typeof deliveries.$inferInsert;

// ─── Email Inquiries (郵件詢價) ──────────────────────────────────────────
export const emailInquiries = mysqlTable("email_inquiries", {
  id: int("id").autoincrement().primaryKey(),
  gmailMessageId: varchar("gmail_message_id", { length: 512 }).notNull().unique(),
  gmailThreadId: varchar("gmail_thread_id", { length: 512 }),
  fromEmail: varchar("from_email", { length: 320 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  subject: varchar("subject", { length: 512 }),
  bodyText: text("body_text"),
  receivedAt: timestamp("received_at").notNull(),
  // AI parsing results
  aiParsed: text("ai_parsed"), // JSON: { clientName, clientEmail, clientPhone, serviceType, notes, suggestedItems }
  aiConfidence: varchar("ai_confidence", { length: 16 }), // 'high' | 'medium' | 'low'
  // Linked quote
  quoteId: int("quote_id"),
  // Status
  status: mysqlEnum("status", ["pending", "approved", "rejected", "ignored", "pending_send"]).notNull().default("pending"),
  rejectedReason: varchar("inq_rejected_reason", { length: 255 }),
  processedAt: timestamp("processed_at"),
  autoRepliedAt: timestamp("auto_replied_at"),
  externalLink: varchar("external_link", { length: 1024 }), // Freehunter 工作頁面連結
  fhJobId: int("fh_job_id"), // 關聯 freehunter_jobs.id（若此詢價來自 FH 工作板）
  // 郵件開啟追蹤（FH 外發回覆郵件）
  replyTrackingId: varchar("reply_tracking_id", { length: 64 }).unique(), // 追蹤像素 ID（舊方案，保留相容）
  replyOpenedAt: timestamp("reply_opened_at"), // 客戶首次開啟時間
  replyOpenCount: int("reply_open_count").default(0).notNull(), // 開啟次數
  replyResendMessageId: varchar("reply_resend_message_id", { length: 128 }), // Resend email ID for webhook matching
  realOpenCount: int("real_open_count").default(0).notNull(), // 過濾機器人後的真實開啟次數
  followUpSentAt: timestamp("follow_up_sent_at"), // FH 跟進郵件發送時間（3 天後自動發送）
  followUpRetryCount: int("follow_up_retry_count").default(0).notNull(), // 重試次數（最多 3 次）
  followUpLastError: varchar("follow_up_last_error", { length: 512 }), // 最後一次失敗的錯誤訊息
  // High-value inquiry meeting flow (HK$5,000+)
  meetingStatus: mysqlEnum("meeting_status", ["none", "pending_meeting", "meeting_scheduled", "meeting_done"]).default("none"),
  estimatedTotal: int("estimated_total"), // AI 估算總額（HKD）
  meetingEmailDraft: text("meeting_email_draft"), // AI 生成的預約會議電郵草稿
  meetingScheduledAt: timestamp("meeting_scheduled_at"), // 會議預約時間
  meetingNotes: text("meeting_notes"), // 會議備忘
  createdAt: timestamp("inq_created_at").defaultNow().notNull(),
  updatedAt: timestamp("inq_updated_at").defaultNow().onUpdateNow().notNull(),
});

export type EmailInquiry = typeof emailInquiries.$inferSelect;
export type InsertEmailInquiry = typeof emailInquiries.$inferInsert;

// ─── Freehunter Jobs (工作板爬取記錄) ─────────────────────────────────
export const freehunterJobs = mysqlTable("freehunter_jobs", {
  id: int("id").autoincrement().primaryKey(),
  jobId: varchar("job_id", { length: 32 }).notNull().unique(), // Freehunter job ID
  title: varchar("title", { length: 512 }).notNull(),
  clientName: varchar("client_name", { length: 255 }),
  clientEmail: varchar("client_email", { length: 320 }),
  budget: varchar("budget", { length: 128 }),
  location: varchar("location", { length: 255 }),
  description: text("description"),
  jobUrl: varchar("job_url", { length: 1024 }).notNull(),
  categories: varchar("categories", { length: 512 }), // comma-separated tags
  postedAt: timestamp("posted_at"),
  status: mysqlEnum("fh_job_status", ["new", "email_fetched", "first_email_sent", "imported", "ignored"]).notNull().default("new"),
  emailInquiryId: int("email_inquiry_id"), // linked email inquiry after import
  firstEmailSentAt: timestamp("first_email_sent_at"), // when the first outreach email was sent
  followUpSentAt: timestamp("follow_up_sent_at"), // when the follow-up email was sent
  aiScore: int("ai_score"), // AI relevance score 0-100 (>=80 = high confidence, auto-send)
  aiScoreReason: varchar("ai_score_reason", { length: 512 }), // AI reasoning for the score
  scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
  createdAt: timestamp("fh_created_at").defaultNow().notNull(),
  updatedAt: timestamp("fh_updated_at").defaultNow().onUpdateNow().notNull(),
});

export type FreehunterJob = typeof freehunterJobs.$inferSelect;
export type InsertFreehunterJob = typeof freehunterJobs.$inferInsert;

// ─── Expenses (支出記錄) ────────────────────────────────────────────
export const expenses = mysqlTable("expenses", {
  id: int("id").autoincrement().primaryKey(),
  date: timestamp("date").notNull(),
  category: mysqlEnum("category", [
    "transport",       // 車費
    "equipment_rent",  // 租用器材
    "equipment_buy",   // 購買器材
    "staff",           // 員工薪酬
    "software",        // 軟件/訂閱
    "marketing",       // 市場推廣
    "office",          // 辦公室/場地
    "other",           // 其他
  ]).notNull(),
  description: varchar("description", { length: 512 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  payee: varchar("payee", { length: 255 }),       // 收款方（人名或公司）
  receiptUrl: varchar("receipt_url", { length: 1024 }), // 收據圖片 URL
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = typeof expenses.$inferInsert;

// ─── Email Open Events (郵件開啟事件記錄) ────────────────────────────────
export const emailOpenEvents = mysqlTable("email_open_events", {
  id: int("id").autoincrement().primaryKey(),
  inquiryId: int("inquiry_id").notNull(), // 關聯 email_inquiries.id
  ip: varchar("ip", { length: 64 }), // 請求 IP
  userAgent: varchar("user_agent", { length: 512 }), // User-Agent
  isBot: tinyint("is_bot").notNull().default(0), // 是否機器人/預覽（0=否, 1=是）
  botReason: varchar("bot_reason", { length: 128 }), // 判定為機器人的原因
  openedAt: timestamp("opened_at").defaultNow().notNull(),
});
export type EmailOpenEvent = typeof emailOpenEvents.$inferSelect;
export type InsertEmailOpenEvent = typeof emailOpenEvents.$inferInsert;

// ─── AI Analysis Reports (AI 分析報告記錄) ──────────────────────────
export const aiAnalysisReports = mysqlTable("ai_analysis_reports", {
  id: int("id").autoincrement().primaryKey(),
  year: int("year").notNull(),
  month: int("month").notNull(),
  analysis: text("analysis").notNull(),
  dataSnapshot: json("data_snapshot"),  // 生成時的數據快照
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
});
export type AiAnalysisReport = typeof aiAnalysisReports.$inferSelect;
export type InsertAiAnalysisReport = typeof aiAnalysisReports.$inferInsert;

// ─── Client Memberships (客戶會員資料) ──────────────────────────────
export const clientMemberships = mysqlTable("client_memberships", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("client_id").notNull().unique(), // 關聯 clients.id
  tier: mysqlEnum("tier", ["silver", "golden", "diamond", "black_diamond"]).notNull().default("silver"),
  totalSpend: decimal("total_spend", { precision: 10, scale: 2 }).notNull().default("0"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  tierUpgradedAt: timestamp("tier_upgraded_at").defaultNow().notNull(),
  notes: text("notes"),
});
export type ClientMembership = typeof clientMemberships.$inferSelect;
export type InsertClientMembership = typeof clientMemberships.$inferInsert;

// ─── Referral Codes (推薦碼) ─────────────────────────────────────────
export const referralCodes = mysqlTable("referral_codes", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 16 }).notNull().unique(),
  referrerId: int("referrer_id").notNull(), // 推薦人 clientId
  usedByClientId: int("used_by_client_id"),
  rewardAmount: decimal("reward_amount", { precision: 10, scale: 2 }).notNull().default("200"),
  status: mysqlEnum("status", ["active", "used", "expired"]).notNull().default("active"),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ReferralCode = typeof referralCodes.$inferSelect;
export type InsertReferralCode = typeof referralCodes.$inferInsert;

// ─── Loyalty Emails Log (再行銷郵件記錄) ─────────────────────────────
export const loyaltyEmailsLog = mysqlTable("loyalty_emails_log", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("client_id").notNull(),
  emailType: mysqlEnum("email_type", [
    "welcome",
    "day30",
    "day90",
    "day180",
    "anniversary",
    "seasonal_cny",
    "seasonal_summer",
    "seasonal_yearend",
    "winback",
    "tier_upgrade",
    "referral_reward",
  ]).notNull(),
  quoteId: int("quote_id"),
  discountCode: varchar("discount_code", { length: 32 }),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});
export type LoyaltyEmailLog = typeof loyaltyEmailsLog.$inferSelect;
export type InsertLoyaltyEmailLog = typeof loyaltyEmailsLog.$inferInsert;

// ─── WhatsApp Click Events (WhatsApp 點擊追蹤) ──────────────────────────
// 追蹤客戶從郵件點擊 WhatsApp 連結的行為，用於計算 WhatsApp 轉化率
export const whatsappClickEvents = mysqlTable("whatsapp_click_events", {
  id: int("id").autoincrement().primaryKey(),
  inquiryId: int("inquiry_id"), // 關聯 email_inquiries.id（FH 工作）
  fhJobId: int("fh_job_id"),    // 關聯 freehunter_jobs.id
  quoteId: int("quote_id"),     // 關聯 quotes.id（如有）
  source: mysqlEnum("source", ["fh_first_email", "fh_follow_up", "quote_email", "review_invite", "other"]).notNull().default("other"),
  ip: varchar("ip", { length: 64 }),
  userAgent: varchar("user_agent", { length: 512 }),
  clickedAt: timestamp("clicked_at").defaultNow().notNull(),
});
export type WhatsappClickEvent = typeof whatsappClickEvents.$inferSelect;
export type InsertWhatsappClickEvent = typeof whatsappClickEvents.$inferInsert;

// ─── Quote Costs (項目直接成本) ──────────────────────────────────────────
// 記錄每張報價單的直接成本，用於計算每個 job 的毛利
export const quoteCosts = mysqlTable("quote_costs", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quote_id").notNull(),             // 關聯 quotes.id
  category: mysqlEnum("category", [
    "freelancer",      // 外判人員（攝影師助手、外判攝影師）
    "venue",           // 拍攝場地費
    "post_production", // 後期製作（剪片、修圖外判）
    "transport",       // 車費/交通
    "equipment_rent",  // 租用器材
    "equipment_buy",   // 購買器材
    "staff",           // 員工薪酬
    "other",           // 其他
  ]).notNull(),
  description: varchar("description", { length: 512 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  payee: varchar("payee", { length: 255 }),        // 收款方（人名或公司）
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type QuoteCost = typeof quoteCosts.$inferSelect;
export type InsertQuoteCost = typeof quoteCosts.$inferInsert;

// ─── Quote Follow-Up Tracking ─────────────────────────────────────────────
// 追蹤 Gmail Sent Box 中帶 PDF 附件且已加星號的報價郵件，
// 偵測客人是否已回覆，未回覆達指定天數則自動發送一封 follow up 郵件。
export const quoteFollowUps = mysqlTable("quote_follow_ups", {
  id: int("id").autoincrement().primaryKey(),
  gmailMessageId: varchar("gmail_message_id", { length: 255 }).notNull().unique(),
  gmailThreadId: varchar("gmail_thread_id", { length: 255 }).notNull(),
  toEmail: varchar("to_email", { length: 255 }).notNull(),
  toName: varchar("to_name", { length: 255 }),
  subject: varchar("subject", { length: 512 }).notNull(),
  sentAt: timestamp("sent_at").notNull(),
  status: mysqlEnum("status", ["pending", "sent", "replied", "skipped"]).notNull().default("pending"),
  followUpSentAt: timestamp("follow_up_sent_at"),
  repliedAt: timestamp("replied_at"),
  notes: text("notes"),
  quoteId: int("quote_id"), // Link to quotes table (optional)
  stopFollowUp: boolean("stop_follow_up").notNull().default(false), // Direct stop flag on follow-up record itself
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type QuoteFollowUp = typeof quoteFollowUps.$inferSelect;
export type InsertQuoteFollowUp = typeof quoteFollowUps.$inferInsert;

// ─── Follow-Up Settings ───────────────────────────────────────────────────
export const followUpSettings = mysqlTable("follow_up_settings", {
  id: int("id").autoincrement().primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  daysAfterSent: int("days_after_sent").notNull().default(3),
  emailSubjectTemplate: varchar("email_subject_template", { length: 512 }).notNull().default("Re: {{original_subject}}"),
  emailBodyTemplate: text("email_body_template").notNull().default("Hi {{client_name}},\n\nI hope you're doing well!\n\nI just wanted to check in to see if you had a chance to review the quotation I sent on {{sent_date}}. If you have any questions or need any clarification, I'd be happy to help.\n\nPlease feel free to reach out at your convenience — there's no rush at all.\n\nLooking forward to hearing from you!\n\nBest regards,\nJD Studio HK\n📧 jdstudiohk@gmail.com\n📱 WhatsApp: +852 6416 2572"),
  sendTimeHktStart: int("send_time_hkt_start").notNull().default(10),
  sendTimeHktEnd: int("send_time_hkt_end").notNull().default(18),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type FollowUpSettings = typeof followUpSettings.$inferSelect;
export type InsertFollowUpSettings = typeof followUpSettings.$inferInsert;

// ─── Scheduler Locks (Distributed Mutex) ─────────────────────────────────────────────────────
// Prevents duplicate execution when both the internal scheduler and external
// Heartbeat endpoints trigger the same job concurrently.
export const schedulerLocks = mysqlTable("scheduler_locks", {
  lockKey: varchar("lock_key", { length: 128 }).primaryKey(),
  lockedAt: timestamp("locked_at").notNull().defaultNow(),
  lockedUntil: timestamp("locked_until").notNull(),
  lockedBy: varchar("locked_by", { length: 64 }).notNull().default("scheduler"),
});
export type SchedulerLock = typeof schedulerLocks.$inferSelect;

// ─── Pitch Leads (自動化客戶開拓) ─────────────────────────────────────────────
// 儲存從招聘網站抓取到的潛在客戶，以及 pitch email 發送狀態
export const pitchLeads = mysqlTable("pitch_leads", {
  id: int("id").autoincrement().primaryKey(),
  // 公司資料
  companyName: varchar("company_name", { length: 255 }).notNull(),
  companyWebsite: varchar("company_website", { length: 512 }),
  industry: varchar("industry", { length: 128 }),
  // 職位資料
  jobTitle: varchar("job_title", { length: 255 }).notNull(),
  jobUrl: varchar("job_url", { length: 1024 }).notNull(),
  jobDescription: mediumtext("job_description"),
  source: mysqlEnum("source", ["jobsdb", "linkedin", "indeed", "ctgoodjobs"]).notNull(),
  jobPostedAt: timestamp("job_posted_at"),
  // 聯絡資料
  contactEmail: varchar("contact_email", { length: 320 }),
  contactName: varchar("contact_name", { length: 255 }),
  emailFoundVia: mysqlEnum("email_found_via", ["job_ad", "company_website", "hunter_io", "manual", "decision_maker_website"]),
  // AI 生成內容
  aiPitchSubject: varchar("ai_pitch_subject", { length: 512 }),
  aiPitchBody: mediumtext("ai_pitch_body"),
  // 發送狀態
  status: mysqlEnum("status", ["pending_email", "pending_review", "approved", "sent", "skipped", "bounced", "replied"]).notNull().default("pending_email"),
  pitchSentAt: timestamp("pitch_sent_at"),
  gmailMessageId: varchar("gmail_message_id", { length: 512 }),
  // 去重：同一公司唔重複發
  companyDomain: varchar("company_domain", { length: 255 }),
  // 備註
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PitchLead = typeof pitchLeads.$inferSelect;
export type InsertPitchLead = typeof pitchLeads.$inferInsert;

// ─── Pitch Send Log ────────────────────────────────────────────────────────
export const pitchSendLog = mysqlTable("pitch_send_log", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("lead_id").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  emailSubject: varchar("email_subject", { length: 512 }),
  emailBody: mediumtext("email_body"),
  toEmail: varchar("to_email", { length: 320 }),
  result: mysqlEnum("result", ["success", "failed", "bounced"]).notNull(),
  errorMessage: text("error_message"),
  gmailMessageId: varchar("gmail_message_id", { length: 512 }),
});
export type PitchSendLog = typeof pitchSendLog.$inferSelect;
export type InsertPitchSendLog = typeof pitchSendLog.$inferInsert;

// ─── LinkedIn Marketing Ops（LinkedIn 營運中台 MVP）──────────────────────────
/** 暖場／DM 階段 */
export const linkedinContactStages = [
  "new",
  "warm_view",
  "warm_like",
  "connected",
  "dm_sent",
  "replied",
  "meeting",
  "won",
  "paused",
  "skipped",
] as const;
export type LinkedInContactStage = (typeof linkedinContactStages)[number];

export const linkedinPlaybooks = [
  "hire_signal", // 見佢哋請攝影師 → 外判
  "winback",
  "general",
] as const;
export type LinkedInPlaybook = (typeof linkedinPlaybooks)[number];

export const linkedinActionTypes = [
  "viewed",
  "liked",
  "commented",
  "connected",
  "dm_sent",
  "follow_up",
  "replied",
  "meeting",
  "won",
  "note",
] as const;
export type LinkedInActionType = (typeof linkedinActionTypes)[number];

/** LinkedIn 聯絡人（一人一間公司／一個訊號） */
export const linkedinContacts = mysqlTable("linkedin_contacts", {
  id: int("id").autoincrement().primaryKey(),
  pitchLeadId: int("pitch_lead_id"), // 可選：來自招聘訊號
  companyName: varchar("company_name", { length: 255 }).notNull(),
  personName: varchar("person_name", { length: 255 }),
  personTitle: varchar("person_title", { length: 255 }),
  linkedInProfileUrl: varchar("linkedin_profile_url", { length: 1024 }),
  linkedInSearchUrl: varchar("linkedin_search_url", { length: 1024 }),
  jobTitle: varchar("job_title", { length: 255 }), // 招聘職位（訊號）
  jobUrl: varchar("job_url", { length: 1024 }),
  stage: mysqlEnum("li_stage", [
    "new",
    "warm_view",
    "warm_like",
    "connected",
    "dm_sent",
    "replied",
    "meeting",
    "won",
    "paused",
    "skipped",
  ]).notNull().default("new"),
  playbook: mysqlEnum("li_playbook", ["hire_signal", "winback", "general"]).notNull().default("hire_signal"),
  dmDraft: mediumtext("dm_draft"),
  nextActionAt: timestamp("next_action_at"),
  lastActionAt: timestamp("last_action_at"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LinkedInContact = typeof linkedinContacts.$inferSelect;
export type InsertLinkedInContact = typeof linkedinContacts.$inferInsert;

/** LinkedIn 動作日誌 */
export const linkedinActions = mysqlTable("linkedin_actions", {
  id: int("id").autoincrement().primaryKey(),
  contactId: int("contact_id").notNull(),
  actionType: mysqlEnum("li_action_type", [
    "viewed",
    "liked",
    "commented",
    "connected",
    "dm_sent",
    "follow_up",
    "replied",
    "meeting",
    "won",
    "note",
  ]).notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LinkedInAction = typeof linkedinActions.$inferSelect;
export type InsertLinkedInAction = typeof linkedinActions.$inferInsert;

// ─── LinkedIn Content Factory（Authority 內容工廠）──────────────────────────
export const linkedinContentTypes = [
  "carousel_case_study", // 輪播成功案例
  "outsource_vs_inhire", // 外包 vs 自聘辯論
  "contrarian_take", // 反常識觀點
] as const;
export type LinkedInContentType = (typeof linkedinContentTypes)[number];

export const linkedinContentStatuses = [
  "draft",
  "pending_review",
  "approved",
  "scheduled",
  "published",
  "rejected",
] as const;
export type LinkedInContentStatus = (typeof linkedinContentStatuses)[number];

export const linkedinContentPosts = mysqlTable("linkedin_content_posts", {
  id: int("id").autoincrement().primaryKey(),
  weekKey: varchar("week_key", { length: 16 }).notNull(), // e.g. 2026-W31
  contentType: mysqlEnum("li_content_type", [
    "carousel_case_study",
    "outsource_vs_inhire",
    "contrarian_take",
  ]).notNull(),
  status: mysqlEnum("li_content_status", [
    "draft",
    "pending_review",
    "approved",
    "scheduled",
    "published",
    "rejected",
  ]).notNull().default("pending_review"),
  title: varchar("title", { length: 512 }).notNull(),
  body: mediumtext("body").notNull(),
  mediaHint: text("media_hint"), // 建議配圖／輪播說明
  /** JSON: [{ id, url, fileName, category, caption, slideOrder }] */
  selectedMedia: mediumtext("selected_media"),
  scheduledFor: timestamp("scheduled_for"),
  publishedAt: timestamp("published_at"),
  approvedAt: timestamp("approved_at"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LinkedInContentPost = typeof linkedinContentPosts.$inferSelect;
export type InsertLinkedInContentPost = typeof linkedinContentPosts.$inferInsert;

/** 內容工廠圖片庫 — 每週生成時自動抽相寫主題 */
export const linkedinAssetCategories = [
  "food",
  "jewellery",
  "product",
  "fashion",
  "commercial",
  "before_after",
  "other",
] as const;
export type LinkedInAssetCategory = (typeof linkedinAssetCategories)[number];

export const linkedinAssetPreferredFor = [
  "any",
  "carousel",
  "debate",
  "contrarian",
] as const;
export type LinkedInAssetPreferredFor = (typeof linkedinAssetPreferredFor)[number];

export const linkedinContentAssets = mysqlTable("linkedin_content_assets", {
  id: int("id").autoincrement().primaryKey(),
  url: varchar("url", { length: 1024 }).notNull(),
  storageKey: varchar("storage_key", { length: 512 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 128 }).notNull(),
  category: mysqlEnum("li_asset_category", [
    "food",
    "jewellery",
    "product",
    "fashion",
    "commercial",
    "before_after",
    "other",
  ])
    .notNull()
    .default("other"),
  preferredFor: mysqlEnum("li_asset_preferred_for", [
    "any",
    "carousel",
    "debate",
    "contrarian",
  ])
    .notNull()
    .default("any"),
  caption: text("caption"),
  aiDescription: text("ai_description"),
  timesUsed: int("times_used").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  active: int("active").notNull().default(1), // 1=active 0=archived
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LinkedInContentAsset = typeof linkedinContentAssets.$inferSelect;
export type InsertLinkedInContentAsset = typeof linkedinContentAssets.$inferInsert;
