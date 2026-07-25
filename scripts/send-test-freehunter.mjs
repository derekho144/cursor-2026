/**
 * 測試腳本：模擬 Freehunter 發送詢價通知郵件到 JD Studio Gmail 信箱
 * 郵件寄件人偽裝成 noreply@freehunter.com.hk，收件人是 JD Studio Gmail
 * 
 * 執行方式：node scripts/send-test-freehunter.mjs
 */

import nodemailer from "nodemailer";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("❌ GMAIL_USER or GMAIL_APP_PASSWORD not set in .env");
  process.exit(1);
}

console.log(`📧 Gmail account: ${GMAIL_USER}`);
console.log("📤 Sending mock Freehunter inquiry email...\n");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});

// 模擬 Freehunter 通知郵件格式
const mockFreehunterEmail = {
  from: `"Freehunter 自由工作平台" <noreply@freehunter.com.hk>`,
  to: GMAIL_USER,
  subject: "【Freehunter】新工作邀請：婚禮攝影及錄影服務",
  text: `您好，

您在 Freehunter 收到了一個新的工作邀請！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
工作詳情
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

客戶姓名：陳小明 (Chan Siu Ming)
聯絡電話：9876 5432
電郵地址：chansiuming@gmail.com
公司名稱：個人客戶

服務類型：婚禮攝影及錄影
活動名稱：Chan & Lee Wedding Ceremony
拍攝日期：2026年5月15日（星期五）
拍攝地點：香港大會堂 + 銅鑼灣某酒店宴會廳

工作描述：
我們計劃在香港大會堂舉行婚禮儀式，然後移師銅鑼灣酒店宴會廳舉行晚宴。
需要攝影師及錄影師各一名，全程記錄婚禮。
希望包括：
- 婚禮儀式全程攝影及錄影
- 宴會廳晚宴拍攝
- 婚禮當天精華相片（約200張）
- 婚禮精華短片（約3-5分鐘）
- 原片交付

預算：HK$8,000 - HK$12,000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

請登入 Freehunter 平台查看完整工作詳情並提交報價：
https://www.freehunter.com.hk/job/12345

此郵件由 Freehunter 系統自動發送，請勿直接回覆此郵件。

Freehunter 自由工作平台
https://www.freehunter.com.hk`,
  html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #f5a623; padding: 20px; text-align: center;">
    <h1 style="color: white; margin: 0;">Freehunter</h1>
    <p style="color: white; margin: 5px 0;">自由工作平台</p>
  </div>
  
  <div style="padding: 30px; background: #ffffff;">
    <h2 style="color: #333;">您好，</h2>
    <p>您在 Freehunter 收到了一個新的工作邀請！</p>
    
    <div style="background: #f9f9f9; border-left: 4px solid #f5a623; padding: 20px; margin: 20px 0;">
      <h3 style="color: #f5a623; margin-top: 0;">工作詳情</h3>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 120px;"><strong>客戶姓名：</strong></td>
          <td style="padding: 8px 0;">陳小明 (Chan Siu Ming)</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;"><strong>聯絡電話：</strong></td>
          <td style="padding: 8px 0;">9876 5432</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;"><strong>電郵地址：</strong></td>
          <td style="padding: 8px 0;">chansiuming@gmail.com</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;"><strong>服務類型：</strong></td>
          <td style="padding: 8px 0;">婚禮攝影及錄影</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;"><strong>活動名稱：</strong></td>
          <td style="padding: 8px 0;">Chan & Lee Wedding Ceremony</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;"><strong>拍攝日期：</strong></td>
          <td style="padding: 8px 0;">2026年5月15日（星期五）</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;"><strong>拍攝地點：</strong></td>
          <td style="padding: 8px 0;">香港大會堂 + 銅鑼灣某酒店宴會廳</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;"><strong>預算：</strong></td>
          <td style="padding: 8px 0; color: #e74c3c;"><strong>HK$8,000 - HK$12,000</strong></td>
        </tr>
      </table>
      
      <div style="margin-top: 15px;">
        <strong style="color: #666;">工作描述：</strong>
        <p style="margin: 8px 0; line-height: 1.6;">
          我們計劃在香港大會堂舉行婚禮儀式，然後移師銅鑼灣酒店宴會廳舉行晚宴。
          需要攝影師及錄影師各一名，全程記錄婚禮。
        </p>
        <ul style="margin: 8px 0; padding-left: 20px; line-height: 1.8;">
          <li>婚禮儀式全程攝影及錄影</li>
          <li>宴會廳晚宴拍攝</li>
          <li>婚禮當天精華相片（約200張）</li>
          <li>婚禮精華短片（約3-5分鐘）</li>
          <li>原片交付</li>
        </ul>
      </div>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="https://www.freehunter.com.hk/job/12345" 
         style="background: #f5a623; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
        前往平台查看並提交報價
      </a>
    </div>
    
    <p style="color: #999; font-size: 12px; border-top: 1px solid #eee; padding-top: 15px;">
      此郵件由 Freehunter 系統自動發送，請勿直接回覆此郵件。<br>
      Freehunter 自由工作平台 | https://www.freehunter.com.hk
    </p>
  </div>
</div>`,
};

try {
  const info = await transporter.sendMail(mockFreehunterEmail);
  console.log("✅ Test email sent successfully!");
  console.log(`   Message ID: ${info.messageId}`);
  console.log(`   From: noreply@freehunter.com.hk (spoofed)`);
  console.log(`   To: ${GMAIL_USER}`);
  console.log(`   Subject: ${mockFreehunterEmail.subject}`);
  console.log("\n📬 Now trigger a Gmail scan in the admin system to test auto-reply.");
} catch (err) {
  console.error("❌ Failed to send test email:", err.message);
  process.exit(1);
}
