/**
 * 直接執行 Gmail 掃描邏輯（繞過 tRPC，直接用 Node.js 執行）
 * 用於測試 Freehunter 自動回覆功能
 */
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("❌ Missing Gmail credentials");
  process.exit(1);
}

// ─── Freehunter detection ─────────────────────────────────────────
function isFreehunterEmail(fromEmail) {
  const lower = fromEmail.toLowerCase();
  return lower.includes("freehunter.com.hk") || lower.includes("freehunter.hk");
}

// ─── Excluded senders ─────────────────────────────────────────────
const EXCLUDED_SENDER_PATTERNS = [
  "linkedin.com", "jobalerts-noreply", "jobs-listings",
  "hellotoby.com", "noreply", "no-reply", "donotreply", "mailer-daemon",
  "notifications@", "newsletter", "unsubscribe", "bounce", "postmaster",
  "vimeo.com", "youtube.com", "google.com", "facebook.com", "instagram.com",
  "twitter.com", "apple.com", "microsoft.com", "dropbox.com", "slack.com",
  "support@", "team@", "hello@", "welcome@",
];

function isExcludedSender(fromEmail) {
  const lower = fromEmail.toLowerCase();
  // Freehunter is whitelisted - never exclude
  if (isFreehunterEmail(lower)) return false;
  return EXCLUDED_SENDER_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ─── Trigger keywords ─────────────────────────────────────────────
const TRIGGER_KEYWORDS = [
  "攝影", "photography", "photoshoot", "拍攝", "拍照", "photo",
  "錄影", "video", "影片", "短片", "filming", "videography",
  "平面設計", "graphic design", "餐牌", "menu design", "網頁", "web design",
  "報價", "quotation", "quote", "pricing", "price", "費用", "收費", "enquiry", "inquiry",
  "婚禮", "wedding", "活動", "event",
];

function containsTriggerKeyword(text) {
  const lower = text.toLowerCase();
  return TRIGGER_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// ─── Send auto-reply ──────────────────────────────────────────────
async function sendFreehunterAutoReply({ toEmail, clientName, eventName, replyToMessageId }) {
  const displayName = clientName && clientName !== toEmail ? clientName : "there";
  const body = `Dear ${displayName},\n\nWe are JD STUDIO HK, a production company providing professional photography and video services. We noticed your posting on Freehunter regarding the ${eventName} and are very interested in this project. We would welcome the chance to participate in the event coverage.\n\nCheers!\n\n\nDerek\nJD STUDIO HK\nTel No: (852) 9153 1976\nWeb:  https://jdstudiohk.com/`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const mailOptions = {
    from: `"JD Studio HK" <${GMAIL_USER}>`,
    to: toEmail,
    subject: `Re: ${eventName}`,
    text: body,
  };
  if (replyToMessageId) {
    mailOptions.inReplyTo = replyToMessageId;
    mailOptions.references = replyToMessageId;
  }

  await transporter.sendMail(mailOptions);
  console.log(`   ✅ Auto-reply sent to: ${toEmail}`);
}

// ─── Main scan ────────────────────────────────────────────────────
console.log(`\n🔍 Scanning Gmail inbox: ${GMAIL_USER}`);
console.log("   Looking for recent emails (last 1 day)...\n");

const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  logger: false,
});

try {
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");

  try {
    // Search last 1 day only for this test
    const since = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const uidsRaw = await client.search({ since, not: { from: GMAIL_USER } });
    const uids = Array.isArray(uidsRaw) ? uidsRaw : [];
    
    console.log(`📬 Found ${uids.length} emails in last 24 hours\n`);

    let processed = 0;
    let freehunterFound = 0;

    for await (const message of client.fetch(uids.slice(-30), { source: true, envelope: true })) {
      try {
        const parsed = await simpleParser(message.source);
        const fromAddr = parsed.from?.value?.[0];
        const fromEmail = fromAddr?.address ?? "";
        const fromName = fromAddr?.name ?? "";
        const messageId = parsed.messageId ?? `uid-${message.uid}`;
        const subject = parsed.subject ?? "";
        const bodyText = parsed.text ?? "";
        const receivedAt = parsed.date ?? new Date();

        const isFreehunter = isFreehunterEmail(fromEmail);
        const isExcluded = isExcludedSender(fromEmail);
        const hasKeyword = containsTriggerKeyword(`${subject} ${bodyText}`);

        if (isFreehunter) {
          freehunterFound++;
          console.log(`🟠 FREEHUNTER EMAIL DETECTED!`);
          console.log(`   From: ${fromName} <${fromEmail}>`);
          console.log(`   Subject: ${subject}`);
          console.log(`   Received: ${receivedAt.toLocaleString("zh-HK")}`);
          console.log(`   Message-ID: ${messageId.slice(0, 60)}...`);
          console.log(`   Has keywords: ${hasKeyword}`);
          console.log("");

          // Simulate auto-reply
          console.log("   📤 Sending auto-reply introduction email...");
          const eventName = subject.replace(/【Freehunter】新工作邀請：?/g, "").trim() || subject;
          const clientName = fromName || fromEmail;
          
          try {
            await sendFreehunterAutoReply({
              toEmail: fromEmail,
              clientName,
              eventName,
              replyToMessageId: messageId,
            });
            console.log(`   ✅ Auto-reply sent successfully to: ${fromEmail}`);
          } catch (e) {
            console.error(`   ❌ Auto-reply failed: ${e.message}`);
          }
          console.log("");
        } else if (!isExcluded && hasKeyword) {
          processed++;
          console.log(`📩 Inquiry email: "${subject}" from ${fromEmail}`);
        }
      } catch (e) {
        // skip parse errors
      }
    }

    console.log(`\n📊 Scan Summary:`);
    console.log(`   Freehunter emails found: ${freehunterFound}`);
    console.log(`   Other inquiry emails: ${processed}`);
    
    if (freehunterFound === 0) {
      console.log("\n⚠️  No Freehunter emails found in last 24 hours.");
      console.log("   The test email may not have arrived yet, or the from address");
      console.log("   was not detected as freehunter.com.hk.");
      console.log("   Note: Gmail may have filtered it as spam since the 'From' domain");
      console.log("   was spoofed (sent via Gmail SMTP but claiming to be from freehunter.com.hk)");
    }

  } finally {
    lock.release();
  }
} finally {
  await client.logout();
}
