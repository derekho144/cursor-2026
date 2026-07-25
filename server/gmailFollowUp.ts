/**
 * Gmail Quote Follow-Up Service
 *
 * 掃描邏輯（方案 X — Gmail 標籤觸發）：
 * 1. 掃描 Gmail 中帶有 "jd-followup" 標籤的郵件（可在任何資料夾）
 * 2. 對每個客人，在 Sent Box 中找出你最新發給他的郵件作為追蹤起點
 * 3. 檢查該客人在你最後一封郵件之後是否有回覆（from 必須是客人，不是自己）
 * 4. 無回覆達指定天數則自動在原 thread 內發送一封非催促式跟進郵件
 *
 * 使用方法：
 * - 在 Gmail 建立標籤 "jd-followup"
 * - 對需要跟進的客人郵件（INBOX 或 Sent Box 皆可）貼上此標籤
 * - 系統每小時自動掃描並跟進
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  getFollowUpSettings,
  upsertQuoteFollowUp,
  getPendingFollowUps,
  markFollowUpEmailSent,
  getSentFollowUpMessageIds,
} from "./db";
import { sendViaGmail } from "./resendEmail";
import { withSchedulerLock } from "./schedulerLock";

// ─── IMAP 連線工廠 ────────────────────────────────────────────────────────
function createImapClient(): ImapFlow {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPassword) {
    throw new Error("Gmail credentials not configured (GMAIL_USER / GMAIL_APP_PASSWORD)");
  }
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: gmailUser, pass: gmailPassword },
    logger: false,
  });
}

// ─── 不算作「客人回覆」的寄件人黑名單（通知服務、自動郵件等）────────────────
const REPLY_SENDER_BLACKLIST = [
  "mailsuite.com",
  "notification@mailsuite.com",
  "reminders@mailsuite.com",
  "noreply@",
  "no-reply@",
  "donotreply@",
  "mailer-daemon@",
  "postmaster@",
  "bounce@",
  "notifications@",
  "support@mailsuite.com",
];

/** 判斷某個 email 地址是否屬於黑名單（通知服務，不算客人回覆） */
function isBlacklistedSender(email: string): boolean {
  const lower = email.toLowerCase();
  return REPLY_SENDER_BLACKLIST.some(pattern => lower.includes(pattern));
}

// ─── 主掃描函數 ───────────────────────────────────────────────────────────
export async function scanSentBoxForFollowUps(): Promise<{
  found: number;
  newTracked: number;
  repliedDetected: number;
}> {
  const settings = await getFollowUpSettings();
  if (!settings.enabled) {
    console.log("[FollowUp] Follow-up is disabled, skipping scan.");
    return { found: 0, newTracked: 0, repliedDetected: 0 };
  }

  const gmailUser = process.env.GMAIL_USER;
  const client = createImapClient();
  let found = 0;
  let newTracked = 0;
  let repliedDetected = 0;

  type TrackEntry = {
    labeledMessageId: string;  // 貼了標籤的那封郵件 Message-ID（用於 In-Reply-To 發送跟進）
    latestSentMessageId: string; // 我們最新發給客人的郵件 Message-ID
    labeledSentAt: Date;       // 貼了標籤的那封郵件發送時間
    toEmail: string;
    toName: string;
    subject: string;
    sentAt: Date;              // 我們最新發給客人的時間（回覆偵測起點）
    hasReply: boolean;
  };

  const toTrack: TrackEntry[] = [];
  const seenEmails = new Set<string>();
  const since60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  try {
    await client.connect();

    // ══════════════════════════════════════════════════════════════════════
    // Step 1: 掃描帶有 "jd-followup" 標籤的郵件
    // Gmail 標籤在 IMAP 中以 mailbox 形式呈現，名稱為 "jd-followup"
    // ══════════════════════════════════════════════════════════════════════
    let labeledUids: number[] = [];

    try {
      const labelLock = await client.getMailboxLock("jd-followup");
      try {
        const uids = await client.search({ since: since60 });
        labeledUids = Array.isArray(uids) ? uids : [];

        if (labeledUids.length > 0) {
          for await (const message of client.fetch(labeledUids, { source: true })) {
            try {
              const parsed: any = await simpleParser(message.source as any);

              const fromAddr = (parsed.from?.value?.[0]?.address ?? "").toLowerCase();
              const toAddr = (parsed.to?.value?.[0]?.address ?? "").toLowerCase();
              const selfAddr = (gmailUser ?? "").toLowerCase();

              // 判斷客人的 email：
              // 如果是客人發給我的（from = 客人），客人 email = fromAddr
              // 如果是我發給客人的（from = 自己），客人 email = toAddr
              let clientEmail = "";
              let clientName = "";

              if (fromAddr && fromAddr !== selfAddr) {
                // 客人發給我的郵件（詢價）
                clientEmail = fromAddr;
                clientName = parsed.from?.value?.[0]?.name ?? "";
              } else if (toAddr && toAddr !== selfAddr) {
                // 我發給客人的郵件（報價）
                clientEmail = toAddr;
                clientName = parsed.to?.value?.[0]?.name ?? "";
              }

              if (!clientEmail) continue;
              if (seenEmails.has(clientEmail)) continue;
              seenEmails.add(clientEmail);

              const subject: string = parsed.subject ?? "(No Subject)";
              const cleanSubject = subject.replace(/^(Re:|Fwd:|回覆:|轉寄:)\s*/gi, "").trim();
              const labeledMessageId: string = parsed.messageId ?? `uid-${message.uid}`;

              // 取得貼了標籤的那封郵件的發送時間（作為回覆偵測起點）
              const labeledSentAt: Date = parsed.date ?? new Date(0);

              toTrack.push({
                labeledMessageId,
                latestSentMessageId: "",  // 稍後在 Sent Box 填入
                labeledSentAt,
                toEmail: clientEmail,
                toName: clientName,
                subject: cleanSubject,
                sentAt: new Date(0),      // 稍後填入
                hasReply: false,
              });
            } catch (e) {
              console.error("[FollowUp] Failed to parse labeled message:", e);
            }
          }
        }
      } finally {
        labelLock.release();
      }
    } catch (e: any) {
      // 如果標籤不存在，記錄警告但不中斷
      if (e?.message?.includes("NONEXISTENT") || e?.message?.includes("NO")) {
        console.warn('[FollowUp] Gmail label "jd-followup" not found. Please create it in Gmail first.');
      } else {
        throw e;
      }
    }

    if (toTrack.length === 0) {
      console.log('[FollowUp] No emails with "jd-followup" label found.');
      return { found: 0, newTracked: 0, repliedDetected: 0 };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Step 2: 在 Sent Box 中找出最新的「非跟進」郵件作為 anchor
    // 關鍵修復：排除已發送的跟進郵件（避免跟進郵件被當作新報價來追蹤）
    // ══════════════════════════════════════════════════════════════════════
    // 取得所有已發送跟進郵件的 Message-ID，用於過濾
    const sentFollowUpIds = await getSentFollowUpMessageIds();

    // 自動偵測正確的 Sent Box 路徑（中英文 Gmail 帳戶路徑不同）
    const mailboxes = await client.list();
    const sentBoxNames = [
      "[Gmail]/寄件備份",     // 繁體中文 Gmail
      "[Gmail]/已發送郵件",   // 簡體中文 Gmail
      "[Gmail]/Sent Mail",   // 英文 Gmail
      "[Gmail]/Sent",
      "Sent",
      "Sent Mail",
      "已發送",
      "已發送郵件",
      "寄件備份",
    ];
    let sentBoxPath = "[Gmail]/Sent Mail"; // 預設
    for (const name of sentBoxNames) {
      if (mailboxes.some((m: any) => m.path === name || m.name === name)) {
        sentBoxPath = name;
        break;
      }
    }
    console.log(`[FollowUp] Using Sent Box: ${sentBoxPath}`);

    const sentLock = await client.getMailboxLock(sentBoxPath);
    try {
      for (const entry of toTrack) {
        const sentToClientUids = await client.search({
          to: entry.toEmail,
          since: since60,
        });

        if (!Array.isArray(sentToClientUids) || sentToClientUids.length === 0) {
          console.log(`[FollowUp] No sent emails found for ${entry.toEmail}, skipping.`);
          continue;
        }

        // 按 UID 從大到小排序，找最新的「非跟進郵件」
        const sortedUids = [...sentToClientUids].sort((a, b) => b - a);
        let foundNonFollowUp = false;
        for (const uid of sortedUids) {
          for await (const msg of client.fetch([uid], { source: true })) {
            try {
              const parsed: any = await simpleParser(msg.source as any);
              const msgId: string = parsed.messageId ?? `uid-${uid}`;
              // 跳過已發送的跟進郵件
              if (sentFollowUpIds.has(msgId)) {
                console.log(`[FollowUp] Skipping follow-up email in Sent for ${entry.toEmail}: ${msgId.substring(0, 30)}`);
                continue;
              }
              // 找到最新的非跟進郵件
              entry.latestSentMessageId = msgId;
              entry.sentAt = parsed.date ?? new Date();
              const sentSubject = (parsed.subject ?? "").replace(/^(Re:|Fwd:|回覆:|轉寄:)\s*/gi, "").trim();
              if (sentSubject) entry.subject = sentSubject;
              foundNonFollowUp = true;
            } catch (e) {
              // ignore
            }
          }
          if (foundNonFollowUp) break;
        }
        if (!foundNonFollowUp) {
          console.log(`[FollowUp] No non-follow-up sent email found for ${entry.toEmail}, skipping.`);
        }
      }
    } finally {
      sentLock.release();
    }

    // ══════════════════════════════════════════════════════════════════════
    // Step 3: 檢查 INBOX 中客人在 Derek 最後一封郵件之後是否有回覆
    //
    // 邏輯（已修正）：
    // - anchorDate = Derek 最後一封已發郵件的時間
    // - 只搜尋 INBOX 中 after:anchorDate 的客人郵件
    // - 有回覆 → replied
    // - 無回覆 → pending（無論之前有沒有來回，一律跟進）
    //
    // 正確結果：
    // - rachel：Derek 最後發 5月7日 18:16，之後 Rachel 無回覆 → pending ✅
    // - kliu：Derek 最後回覆 5月5日，之後 Kaylie 無回覆 → pending ✅
    // - hlyau：Derek 最後發後，客人有回覆 → replied ✅
    // ══════════════════════════════════════════════════════════════════════
    const inboxCheckLock = await client.getMailboxLock("INBOX");
    try {
      for (const entry of toTrack) {
        // 跳過沒有找到已發郵件的記錄
        if (!entry.latestSentMessageId || entry.sentAt.getTime() === 0) continue;

        const anchorDate = entry.sentAt; // Derek 最後一封已發郵件的時間
        // 只搜索 anchorDate 之後的郵件（精確到秒）
        const anchorDatePlusOne = new Date(anchorDate.getTime() + 1000);

        const clientInboxUidsAfterAnchor = await client.search({
          from: entry.toEmail,
          since: anchorDatePlusOne,
        });

        let hasReplyAfterAnchor = false;

        if (Array.isArray(clientInboxUidsAfterAnchor) && clientInboxUidsAfterAnchor.length > 0) {
          for await (const msg of client.fetch(clientInboxUidsAfterAnchor, { envelope: true })) {
            try {
              const fromAddresses = msg.envelope?.from ?? [];
              const fromAddr = (fromAddresses[0]?.address ?? "").toLowerCase();
              // 確認是客人發的，不是我們自己，也不是 Mailsuite 等通知服務
              if (!fromAddr || fromAddr === (gmailUser ?? "").toLowerCase()) continue;
              if (isBlacklistedSender(fromAddr)) continue; // 過濾 Mailsuite 等通知郵件
              const msgDate = msg.envelope?.date;
              if (!msgDate) continue;
              // 雙重確認：郵件時間確實在 anchorDate 之後
              if (msgDate.getTime() > anchorDate.getTime()) {
                hasReplyAfterAnchor = true;
                break; // 找到一封就夠了
              }
            } catch (e) {
              // ignore
            }
          }
        }

        entry.hasReply = hasReplyAfterAnchor;

        const finalStatus: "replied" | "pending" = hasReplyAfterAnchor ? "replied" : "pending";

        // 插入或更新追蹤記錄
        // gmailMessageId: 最新已發郵件的 Message-ID（用於發送跟進時的 In-Reply-To）
        // gmailThreadId: 貼了標籤的郵件 Message-ID（用於識別同一導線）
        await upsertQuoteFollowUp({
          gmailMessageId: entry.latestSentMessageId,
          gmailThreadId: entry.labeledMessageId,
          toEmail: entry.toEmail,
          toName: entry.toName || null,
          subject: entry.subject,
          sentAt: entry.sentAt,
          status: finalStatus,
          repliedAt: hasReplyAfterAnchor ? new Date() : null,
        });

        if (hasReplyAfterAnchor) {
          repliedDetected++;
        } else {
          newTracked++;
        }
      }
    } finally {
      inboxCheckLock.release();
    }

    found = toTrack.filter(e => e.latestSentMessageId).length;
  } finally {
    await client.logout();
  }

  console.log(
    `[FollowUp] Scan complete: found=${found}, newTracked=${newTracked}, repliedDetected=${repliedDetected}`
  );
  return { found, newTracked, repliedDetected };
}

// ─── 發送 follow up 郵件（排程觸發） ────────────────────────────────────
export async function runQuoteFollowUps(): Promise<{
  checked: number;
  sent: number;
  skipped: number;
}> {
  let result: { checked: number; sent: number; skipped: number } = { checked: 0, sent: 0, skipped: 0 };
  await withSchedulerLock("quote-followup", 55 * 60 * 1000, async () => {
  const settings = await getFollowUpSettings();
  if (!settings.enabled) {
    return; // early exit — result stays { checked: 0, sent: 0, skipped: 0 }
  }

  // 檢查當前 HKT 時間是否在發送時間視窗內
  // 正確計算 HKT：UTC+8，取整數小時
  const nowUtcMs = Date.now();
  const hktOffsetMs = 8 * 60 * 60 * 1000;
  const nowHktDate = new Date(nowUtcMs + hktOffsetMs);
  const hourHKT = nowHktDate.getUTCHours(); // 加了 8h 後取 UTC hours = HKT hours
  const sendStart = settings.sendTimeHktStart;
  const sendEnd = settings.sendTimeHktEnd;
  if (hourHKT < sendStart || hourHKT >= sendEnd) {
    console.log(
      `[FollowUp] Outside send window (${sendStart}:00–${sendEnd}:00 HKT, current HKT hour=${hourHKT}), skipping.`
    );
    return; // early exit — result stays { checked: 0, sent: 0, skipped: 0 }
  }

  // 先重新掃描，更新已回覆狀態
  await scanSentBoxForFollowUps();

  // 取得所有 pending 且已超過 daysAfterSent 天的記錄
  const pending = await getPendingFollowUps(settings.daysAfterSent);
  let sent = 0;
  let skipped = 0;

  for (const item of pending) {
    try {
      // 渲染郵件模板
      const sentDateStr = item.sentAt.toLocaleDateString("en-HK", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      // 如果沒有名字，或名字看起來就是電郵前綴（沒有空格且全是小寫英文+數字），改用 Sir/Madam
      const rawName = item.toName || "";
      const emailPrefix = item.toEmail.split("@")[0];
      const looksLikeEmailPrefix = !rawName ||
        rawName.toLowerCase() === emailPrefix.toLowerCase() ||
        /^[a-z0-9._+\-]+$/.test(rawName); // 全小寫英文+數字+符號，沒有大寫字母或空格
      const clientName = looksLikeEmailPrefix ? "Sir/Madam" : rawName;
      const cleanOriginalSubject = item.subject.replace(/^(Re:|Fwd:|回覆:|轉寄:)\s*/gi, "").trim();

      const subject = settings.emailSubjectTemplate
        .replace("{{original_subject}}", cleanOriginalSubject);

      const body = settings.emailBodyTemplate
        .replace(/\{\{client_name\}\}/g, clientName)
        .replace(/\{\{sent_date\}\}/g, sentDateStr)
        .replace(/\{\{original_subject\}\}/g, cleanOriginalSubject);

      // 轉換純文字為 HTML（保留換行，wa.me 連結轉為可點擊超連結）
      const htmlBody = `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">${body
        .split("\n")
        .map((line) => {
          const linkedLine = line.replace(
            /(https?:\/\/wa\.me\/[^\s<>"']+)/g,
            '<a href="$1" style="color: #25D366;">$1</a>'
          );
          return `<p style="margin: 0 0 8px 0;">${linkedLine || "&nbsp;"}</p>`;
        })
        .join("")}</div>`;

      const result = await sendViaGmail({
        to: item.toEmail,
        subject,
        html: htmlBody,
        text: body,
        // Thread continuity: reply in the same email thread as the original quote
        inReplyTo: item.gmailMessageId,
        references: item.gmailMessageId,
      });

      if (result.success) {
        await markFollowUpEmailSent(item.id);
        sent++;
        console.log(`[FollowUp] Sent follow-up to ${item.toEmail} (id=${item.id})`);
      } else {
        console.error(`[FollowUp] Failed to send to ${item.toEmail}:`, result.error);
        skipped++;
      }
    } catch (e) {
      console.error(`[FollowUp] Error processing follow-up id=${item.id}:`, e);
      skipped++;
    }
  }

  result = { checked: pending.length, sent, skipped };
  }); // end withSchedulerLock("quote-followup")
  return result;
}
