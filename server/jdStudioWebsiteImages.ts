/**
 * Harvest portfolio images from jdstudiohk.com (Squarespace)
 * when the LinkedIn content library has no usable photos.
 */
import { getDb } from "./db";
import { linkedinContentAssets, type LinkedInContentAsset } from "../drizzle/schema";
import { eq, like, or } from "drizzle-orm";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

type AssetCategory =
  | "food"
  | "jewellery"
  | "product"
  | "fashion"
  | "commercial"
  | "before_after"
  | "event"
  | "other";

type PreferredFor = "any" | "project" | "education" | "data";

type SourcePage = {
  path: string;
  category: AssetCategory;
  label: string;
};

const SOURCE_PAGES: SourcePage[] = [
  { path: "/services/product-photography", category: "product", label: "產品攝影" },
  { path: "/services/food-photography", category: "food", label: "食物攝影" },
  { path: "/services/jewelry-photography", category: "jewellery", label: "珠寶攝影" },
  { path: "/services/event-photography", category: "event", label: "活動攝影" },
  { path: "/services/corporate-event-photography", category: "event", label: "企業活動" },
  { path: "/services/interior-photography", category: "commercial", label: "室內攝影" },
  { path: "/services/art-photography", category: "other", label: "藝術攝影" },
  { path: "/services/gallery", category: "other", label: "Gallery" },
];

const SKIP_NAME =
  /logo|favicon|封面|cover|imgg-demo|sprite|icon|avatar|og-image|social/i;

function normalizeImageUrl(raw: string): string | null {
  let u = raw.trim();
  if (u.startsWith("//")) u = `https:${u}`;
  if (u.startsWith("http://")) u = u.replace(/^http:\/\//i, "https://");
  if (!/^https:\/\//i.test(u)) return null;
  if (!/\.(jpe?g|png|webp)(\?|$)/i.test(u) && !u.includes("squarespace-cdn.com")) {
    return null;
  }
  // Prefer larger Squarespace format when possible
  if (u.includes("squarespace-cdn.com") && !/[?&]format=/.test(u)) {
    u += (u.includes("?") ? "&" : "?") + "format=1500w";
  }
  return u.split("#")[0];
}

function extractImageUrls(html: string): string[] {
  const found: string[] = [];
  const re =
    /(https?:)?\/\/[^"'\\\s>]+\.(?:jpe?g|png|webp)|https?:\/\/images\.squarespace-cdn\.com\/[^"'\\\s>]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const n = normalizeImageUrl(m[0]);
    if (!n) continue;
    if (SKIP_NAME.test(n)) continue;
    found.push(n);
  }
  return Array.from(new Set(found));
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "JDStudioContentBot/1.0 (+https://jdsys.biz)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.warn("[JdWebsiteImages] fetch HTML failed:", url, err);
    return null;
  }
}

async function downloadImage(
  url: string
): Promise<{ buf: Buffer; mime: string; fileName: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "JDStudioContentBot/1.0 (+https://jdsys.biz)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!mime.startsWith("image/")) return null;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length < 8_000 || buf.length > 12 * 1024 * 1024) return null;
    const base = decodeURIComponent(url.split("/").pop() || "image.jpg")
      .split("?")[0]
      .replace(/[^\w.\-一-龥]+/g, "_")
      .slice(0, 100);
    const fileName = /\.(jpe?g|png|webp)$/i.test(base) ? base : `${base}.jpg`;
    return { buf, mime, fileName };
  } catch (err) {
    console.warn("[JdWebsiteImages] download failed:", url, err);
    return null;
  }
}

/**
 * Crawl JD Studio service pages, upload new images into the content library.
 * Returns newly inserted assets.
 */
export async function harvestJdStudioWebsiteImages(opts?: {
  maxNew?: number;
  preferredFor?: PreferredFor;
}): Promise<LinkedInContentAsset[]> {
  const db = await getDb();
  if (!db) return [];

  const maxNew = opts?.maxNew ?? 8;
  const preferredFor = opts?.preferredFor ?? "any";
  const inserted: LinkedInContentAsset[] = [];

  for (const page of SOURCE_PAGES) {
    if (inserted.length >= maxNew) break;
    const pageUrl = `https://www.jdstudiohk.com${page.path}`;
    const html = await fetchHtml(pageUrl);
    if (!html) continue;

    const urls = extractImageUrls(html);
    for (const imgUrl of urls) {
      if (inserted.length >= maxNew) break;
      if (SKIP_NAME.test(imgUrl)) continue;

      const sourceTag = `source:${imgUrl.slice(0, 180)}`;
      const existing = await db
        .select({ id: linkedinContentAssets.id })
        .from(linkedinContentAssets)
        .where(
          or(
            eq(linkedinContentAssets.url, imgUrl),
            like(linkedinContentAssets.aiDescription, `${sourceTag}%`)
          )
        )
        .limit(1);
      if (existing.length) continue;

      const dl = await downloadImage(imgUrl);
      if (!dl) continue;

      const fileKey = `linkedin-content/website/${Date.now()}-${nanoid(6)}-${dl.fileName}`;
      let storedUrl: string;
      try {
        ({ url: storedUrl } = await storagePut(fileKey, dl.buf, dl.mime));
      } catch (err: any) {
        console.warn("[JdWebsiteImages] storagePut failed:", err?.message);
        continue;
      }

      await db.insert(linkedinContentAssets).values({
        url: storedUrl,
        storageKey: fileKey,
        fileName: dl.fileName,
        mimeType: dl.mime,
        category: page.category,
        preferredFor,
        caption: `${page.label} · 官網 ${page.path}`,
        aiDescription: sourceTag,
        active: 1,
      });

      const rows = await db
        .select()
        .from(linkedinContentAssets)
        .where(eq(linkedinContentAssets.storageKey, fileKey))
        .limit(1);
      if (rows[0]) inserted.push(rows[0]);
      console.log(`[JdWebsiteImages] imported ${dl.fileName} from ${page.path}`);
    }
  }

  return inserted;
}
