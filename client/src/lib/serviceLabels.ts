/**
 * serviceLabels.ts
 * Single source of truth for service type labels (Chinese) in the frontend.
 * All pages should import from here instead of defining their own local copies.
 */

export const SERVICE_LABELS: Record<string, string> = {
  corporate_event: "企業活動攝影",
  product: "產品攝影",
  food_beverage: "食物攝影",
  jewelry: "珠寶攝影",
  artwork: "藝術品攝影",
  interior: "建築/室內攝影",
  video_production: "影片製作",
  graphic_design: "平面設計",
  ad_video: "廣告影片",
  web_development: "網頁製作",
  ai_photography: "AI攝影",
  menu_design: "餐牌設計",
  portrait: "人像拍攝",
  "360_photography": "360 拍攝",
  drone: "航拍拍攝",
  kol_mi: "KOL/MI 推廣",
  other: "其他服務",
};

export const SERVICE_LABELS_EN: Record<string, string> = {
  corporate_event: "Corporate Event Photography",
  product: "Product Photography",
  food_beverage: "Food & Beverage Photography",
  jewelry: "Jewelry Photography",
  artwork: "Artwork Photography",
  interior: "Architecture / Interior Photography",
  video_production: "Video Production",
  graphic_design: "Graphic Design",
  ad_video: "Advertisement Video",
  web_development: "Web Development",
  ai_photography: "AI Photography",
  menu_design: "Menu Design",
  portrait: "Portrait Photography",
  "360_photography": "360 Photography",
  drone: "Drone Photography",
  kol_mi: "KOL / Micro Film",
  other: "Other Services",
};
