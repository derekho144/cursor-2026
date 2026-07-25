import React, { createContext, useContext, useState } from "react";

export type Language = "zh" | "en";

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// ── Translation dictionary ────────────────────────────────────────────────────
const translations: Record<Language, Record<string, string>> = {
  zh: {
    // Common
    "loading": "載入中",
    "error.invalidLink": "連結無效或已過期",
    "error.contactUs": "請聯絡 JD Studio HK 獲取新的連結",
    "footer.phone": "+852 9153 1976",
    "footer.website": "www.jdstudiohk.com",

    // SignPage
    "sign.header.label": "報價單簽署",
    "sign.alreadySigned.title": "簽署完成",
    "sign.alreadySigned.signedBy": "已簽署",
    "sign.alreadySigned.thankYou": "感謝您確認報價單，JD Studio HK 將盡快與您聯絡。",
    "sign.alreadySigned.thankYouSub": "Thank you for confirming. We will be in touch shortly.",
    "sign.alreadySigned.emailSent": "確認郵件已發送至",
    "sign.quotation.label": "Quotation",
    "sign.preparedFor": "Prepared For",
    "sign.serviceDetails": "Service Details",
    "sign.shootingDate": "拍攝日期：",
    "sign.shootingLocation": "拍攝地點：",
    "sign.qty": "QTY",
    "sign.description": "Description",
    "sign.unitPrice": "Unit Price",
    "sign.amount": "Amount",
    "sign.included": "Included",
    "sign.subtotal": "Subtotal",
    "sign.discount": "Discount",
    "sign.notes": "Notes",
    "sign.attachments": "Attachments 附件",
    "sign.download": "DOWNLOAD",
    "sign.signature.label": "Signature 簽署確認",
    "sign.signature.consent": "本人已閱讀並同意以上報價單的所有條款及細則，確認委託 JD Studio HK 提供相關服務。",
    "sign.signerName.label": "簽署人姓名 / 公司名稱 *",
    "sign.signerName.placeholder": "請輸入您的全名或公司名稱",
    "sign.canvas.label": "手寫簽名 *",
    "sign.canvas.placeholder": "請在此處簽名",
    "sign.canvas.clear": "清除重簽",
    "sign.terms.label": "條款及細則",
    "sign.terms.1": "訂金不設退款 · Deposit is non-refundable",
    "sign.terms.2": "報價單有效期 14 天 · Quotation valid for 14 days from date of issue",
    "sign.terms.3": "付款後方可確認預約 · Booking confirmed upon receipt of deposit",
    "sign.terms.4": "本報價單經客戶簽署或以任何形式確認後，即視為具有法律效力之合約，雙方均受其條款約束 · This quotation, once signed or confirmed by the client in any form, constitutes a legally binding contract and both parties shall be bound by its terms.",
    "sign.legal.zh": "本人清楚明白此報價單具有法律效力，等同正式合約。簽署後即代表本人同意並接受報價單內所有條款及細則。",
    "sign.legal.en": "I understand that this quotation has legal effect equivalent to a formal contract. By signing, I agree to all terms and conditions stated herein.",
    "sign.submit.pending": "提交中...",
    "sign.submit.button": "確認簽署 SIGN & CONFIRM",
    "sign.toast.noName": "請填寫您的姓名或公司名稱",
    "sign.toast.noSignature": "請在簽名欄簽署",
    "sign.toast.noLegal": "請確認您已閱讀並同意報價單的法律效力",

    // DeliveryPage - Password Gate
    "delivery.welcome": "歡迎，",
    "delivery.photosReady": "您的相片已準備好",
    "delivery.privateGallery": "私人相冊",
    "delivery.enterPassword": "輸入密碼",
    "delivery.verifying": "驗證中...",
    "delivery.accessGallery": "進入相冊",
    "delivery.forAssistance": "如需協助，請聯絡",
    "delivery.error.invalidLink": "連結無效或已過期",
    "delivery.error.contactUs": "如需協助，請聯絡 JD Studio",

    // DeliveryContent
    "delivery.yourPhotos": "您的相片",
    "delivery.openDownload": "開啟下載",
    "delivery.openDownloadSub": "OPEN & DOWNLOAD",
    "delivery.driveHint": "需要 Google 帳號才能存取相片",
    "delivery.generating": "生成中...",
    "delivery.downloadReceipt": "下載收據",
    "delivery.downloadReceiptSub": "DOWNLOAD RECEIPT",
    "delivery.thankYou": "感謝您的支持",
    "delivery.thankYouSub": "THANK YOU FOR YOUR SUPPORT",
    "delivery.message1": "很高興能為您留下這份珍貴的回憶。",
    "delivery.message2": "希望每次翻看，都能重溫那份美好。",
    "delivery.message1En": "We hope these photos bring you joy",
    "delivery.message2En": "every time you look back.",
    "delivery.reviewInvite": "如果您滿意我們的服務，",
    "delivery.reviewInvite2": "請對我們在 Google 留下五星評語。",
    "delivery.reviewInviteEn": "Your review means the world to us—",
    "delivery.reviewInviteEn2": "it helps us serve more clients like you.",
    "delivery.leaveReview": "LEAVE A GOOGLE REVIEW",
    "delivery.contactUs": "CONTACT US · 聯絡我們",
    "delivery.nextStep": "下一步，我們幫到你",
    "delivery.enquireNow": "立即查詢",
    "delivery.enquireNowSub": "ENQUIRE NOW",
    "delivery.receiptError": "生成失敗",
    "delivery.receiptErrorDesc": "Receipt PDF 生成失敗",
    "delivery.waking": "正在連接伺服器，請稍候...",
    "delivery.wakingRetry": "伺服器正在啟動，請稍候（最多 30 秒）",

    // Packages
    "pkg.1.tag": "套餐一",
    "pkg.1.headline": "品牌攝影 + 網頁設計",
    "pkg.1.desc": "一條龍完成品牌視覺形象。專業攝影配合定制網頁，讓您的品牌在線上線下保持一致性。",
    "pkg.1.s1": "品牌攝影", "pkg.1.s2": "網頁設計", "pkg.1.s3": "UI/UX 優化",
    "pkg.2.tag": "套餐二",
    "pkg.2.headline": "食物攝影 + 餐單設計",
    "pkg.2.desc": "適合餐廳、咖啡廳、甜點品牌。專業食物攝影配合完整餐單排版，一次就將形象升級。",
    "pkg.2.s1": "食物攝影", "pkg.2.s2": "餐單排版", "pkg.2.s3": "品牌視覺設計",
    "pkg.3.tag": "套餐三",
    "pkg.3.headline": "品牌攝影 + Google SEO / GEO",
    "pkg.3.desc": "優質品牌相片配合搜尋引擎優化，提升本地搜尋曝光率，吸引更多潛在客戶主動找上門。",
    "pkg.3.s1": "Google SEO", "pkg.3.s2": "GEO 地區優化", "pkg.3.s3": "品牌內容策劃",
    "pkg.4.tag": "套餐四",
    "pkg.4.headline": "商業攝影 + 影片製作 + 社交媒體內容",
    "pkg.4.desc": "一次拍攝，同時完成静態相片、宣傳短片及 Reels 內容。適合品牌長期社交媒體經營。",
    "pkg.4.s1": "商業攝影", "pkg.4.s2": "短片/Reels 製作", "pkg.4.s3": "IG 內容策劃",
  },

  en: {
    // Common
    "loading": "Loading",
    "error.invalidLink": "Invalid or expired link",
    "error.contactUs": "Please contact JD Studio HK for a new link",
    "footer.phone": "+852 9153 1976",
    "footer.website": "www.jdstudiohk.com",

    // SignPage
    "sign.header.label": "Quotation Sign",
    "sign.alreadySigned.title": "Signed",
    "sign.alreadySigned.signedBy": "Signed by",
    "sign.alreadySigned.thankYou": "Thank you for confirming. JD Studio HK will be in touch shortly.",
    "sign.alreadySigned.thankYouSub": "Thank you for confirming. We will be in touch shortly.",
    "sign.alreadySigned.emailSent": "Confirmation email sent to",
    "sign.quotation.label": "Quotation",
    "sign.preparedFor": "Prepared For",
    "sign.serviceDetails": "Service Details",
    "sign.shootingDate": "Shoot Date: ",
    "sign.shootingLocation": "Location: ",
    "sign.qty": "QTY",
    "sign.description": "Description",
    "sign.unitPrice": "Unit Price",
    "sign.amount": "Amount",
    "sign.included": "Included",
    "sign.subtotal": "Subtotal",
    "sign.discount": "Discount",
    "sign.notes": "Notes",
    "sign.attachments": "Attachments",
    "sign.download": "DOWNLOAD",
    "sign.signature.label": "Signature Confirmation",
    "sign.signature.consent": "I have read and agreed to all terms and conditions of the above quotation, and hereby authorize JD Studio HK to provide the relevant services.",
    "sign.signerName.label": "Signatory Name / Company Name *",
    "sign.signerName.placeholder": "Enter your full name or company name",
    "sign.canvas.label": "Handwritten Signature *",
    "sign.canvas.placeholder": "Sign here",
    "sign.canvas.clear": "Clear & Re-sign",
    "sign.terms.label": "Terms & Conditions",
    "sign.terms.1": "Deposit is non-refundable",
    "sign.terms.2": "Quotation valid for 14 days from date of issue",
    "sign.terms.3": "Booking confirmed upon receipt of deposit",
    "sign.terms.4": "This quotation, once signed or confirmed by the client in any form, constitutes a legally binding contract and both parties shall be bound by its terms.",
    "sign.legal.zh": "本人清楚明白此報價單具有法律效力，等同正式合約。簽署後即代表本人同意並接受報價單內所有條款及細則。",
    "sign.legal.en": "I understand that this quotation has legal effect equivalent to a formal contract. By signing, I agree to all terms and conditions stated herein.",
    "sign.submit.pending": "Submitting...",
    "sign.submit.button": "SIGN & CONFIRM",
    "sign.toast.noName": "Please enter your name or company name",
    "sign.toast.noSignature": "Please sign in the signature field",
    "sign.toast.noLegal": "Please confirm you have read and agreed to the terms",

    // DeliveryPage - Password Gate
    "delivery.welcome": "Welcome, ",
    "delivery.photosReady": "Your photos are ready",
    "delivery.privateGallery": "Private Gallery",
    "delivery.enterPassword": "Enter password",
    "delivery.verifying": "Verifying...",
    "delivery.accessGallery": "Access Gallery",
    "delivery.forAssistance": "For assistance, please contact",
    "delivery.error.invalidLink": "Invalid or expired link",
    "delivery.error.contactUs": "For assistance, please contact JD Studio",

    // DeliveryContent
    "delivery.yourPhotos": "Your Photos",
    "delivery.openDownload": "Open & Download",
    "delivery.openDownloadSub": "OPEN & DOWNLOAD",
    "delivery.driveHint": "Google account required to access photos",
    "delivery.generating": "Generating...",
    "delivery.downloadReceipt": "Download Receipt",
    "delivery.downloadReceiptSub": "DOWNLOAD RECEIPT",
    "delivery.thankYou": "Thank You",
    "delivery.thankYouSub": "THANK YOU FOR YOUR SUPPORT",
    "delivery.message1": "It was our pleasure to capture these precious memories for you.",
    "delivery.message2": "We hope they bring joy every time you look back.",
    "delivery.message1En": "We hope these photos bring you joy",
    "delivery.message2En": "every time you look back.",
    "delivery.reviewInvite": "If you enjoyed our service,",
    "delivery.reviewInvite2": "please leave us a 5-star Google review.",
    "delivery.reviewInviteEn": "Your review means the world to us—",
    "delivery.reviewInviteEn2": "it helps us serve more clients like you.",
    "delivery.leaveReview": "LEAVE A GOOGLE REVIEW",
    "delivery.contactUs": "CONTACT US",
    "delivery.nextStep": "What's Next",
    "delivery.enquireNow": "Enquire Now",
    "delivery.enquireNowSub": "ENQUIRE NOW",
    "delivery.receiptError": "Generation Failed",
    "delivery.receiptErrorDesc": "Failed to generate Receipt PDF",
    "delivery.waking": "Connecting to server, please wait...",
    "delivery.wakingRetry": "Server is starting up, please wait (up to 30 seconds)",

    // Packages
    "pkg.1.tag": "Package 1",
    "pkg.1.headline": "Brand Photography + Web Design",
    "pkg.1.desc": "Complete your brand visual identity in one go. Professional photography paired with a custom website keeps your brand consistent online and offline.",
    "pkg.1.s1": "Brand Photography", "pkg.1.s2": "Web Design", "pkg.1.s3": "UI/UX Optimization",
    "pkg.2.tag": "Package 2",
    "pkg.2.headline": "Food Photography + Menu Design",
    "pkg.2.desc": "Perfect for restaurants, cafés, and dessert brands. Professional food photography with complete menu layout — upgrade your image in one session.",
    "pkg.2.s1": "Food Photography", "pkg.2.s2": "Menu Layout", "pkg.2.s3": "Brand Visual Design",
    "pkg.3.tag": "Package 3",
    "pkg.3.headline": "Brand Photography + Google SEO / GEO",
    "pkg.3.desc": "Quality brand photos combined with search engine optimization to boost local search visibility and attract more potential clients.",
    "pkg.3.s1": "Google SEO", "pkg.3.s2": "GEO Local Optimization", "pkg.3.s3": "Brand Content Strategy",
    "pkg.4.tag": "Package 4",
    "pkg.4.headline": "Commercial Photography + Video + Social Media",
    "pkg.4.desc": "One shoot, complete with stills, promotional videos, and Reels content. Ideal for brands with ongoing social media presence.",
    "pkg.4.s1": "Commercial Photography", "pkg.4.s2": "Short Film / Reels", "pkg.4.s3": "IG Content Strategy",
  },
};

// ── Provider ──────────────────────────────────────────────────────────────────
interface LanguageProviderProps {
  children: React.ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem("jd-lang");
      if (stored === "en" || stored === "zh") return stored;
    } catch {}
    return "zh";
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    try { localStorage.setItem("jd-lang", newLang); } catch {}
  };

  const t = (key: string): string => {
    return translations[lang][key] ?? translations["zh"][key] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

// ── Language Toggle Button ────────────────────────────────────────────────────
interface LangToggleProps {
  style?: React.CSSProperties;
  /** "light" for dark backgrounds, "dark" for light backgrounds */
  variant?: "light" | "dark";
}

export function LangToggle({ style, variant = "light" }: LangToggleProps) {
  const { lang, setLang } = useLanguage();

  const isLight = variant === "light";
  const activeColor = isLight ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.85)";
  const inactiveColor = isLight ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)";
  const dividerColor = isLight ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0,
        border: `1px solid ${dividerColor}`,
        borderRadius: 3,
        overflow: "hidden",
        ...style,
      }}
    >
      {(["zh", "en"] as Language[]).map((l, i) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          style={{
            padding: "5px 10px",
            background: lang === l
              ? (isLight ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)")
              : "transparent",
            border: "none",
            borderLeft: i > 0 ? `1px solid ${dividerColor}` : "none",
            color: lang === l ? activeColor : inactiveColor,
            fontFamily: "'Montserrat', 'Helvetica Neue', Arial, sans-serif",
            fontSize: 10,
            fontWeight: lang === l ? 600 : 400,
            letterSpacing: "0.1em",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {l === "zh" ? "中文" : "EN"}
        </button>
      ))}
    </div>
  );
}
