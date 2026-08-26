/** Regression briefs for inquiry reading comprehension (not prices). */

export const HKSEA_FIXTURE = `本會將於今年12月舉辦「香港視覺藝術教育節 2026」視藝展暨頒獎禮，擬向貴司查詢攝影報價，詳情請見附件。

=== PDF ATTACHMENT TEXT ===
活動日期：2026年12月19日
地點：香港大會堂
時間：中午12時至下午5時（包括2:30-4:00開幕禮）
作品拍攝：約200件作品特寫，可安排於12月15-22日期間
後期：作品照片需去背
交付：活動後7天內
`;

export const HKRC_FIXTURE = `Need 3 days outdoor photography at the race course. Deliver 120 photos.`;

export const HA_FIXTURE = `Graduation photography 3 hours on 2 Nov 2026 at HA Building, 40 retouched photos.`;

/** Event + 3 edited clips × 20s — next miss after 去背 if we only special-case artwork. */
export const VIDEO_CLIPS_FIXTURE = `活動攝影 5 小時。另外請剪埋三條影片，每條20秒，用於 IG Reels。`;

/**
 * Real inquiry #12480003 (CITIC Securities Futures / Freelance.hk).
 * Body only — no PDF. Multi-scope: 4h meeting + 200 photos + 30 retouch × 3 rounds + 1-min highlight.
 * Photography + video → on-site crew 1P+1V. 「3日內」is a job-board deadline, not 3 shoot days.
 */
export const CITIC_MEETING_FIXTURE = `本週熱門Freelance工作會議攝影攝像先生  李. 查看工作 香港工作位置3日內工作規模HKD $10,000-$50,000預算我司計畫於9月下旬在酒店會議廳舉辦業務會議，規模約60-100人，會議時間 ：下午1點到5點。
提供會議期間的攝影攝像服務，提供1分鐘精選視頻、不少於200張合格照片，及三次根據要求精修不少於30張照片。室內攝影團體攝影活動攝影影片拍攝影片剪接`;
