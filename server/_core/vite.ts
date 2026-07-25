import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { getDb } from "../db";
import { deliveries } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const DELIVERY_LOGO_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/jd-studio-logo-dark_3217ad3b.png";
const CRAWLER_UA_REGEX = /whatsapp|facebookexternalhit|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|applebot|googlebot|bingbot|crawler|spider|bot/i;

async function buildDeliveryOgHtml(token: string, host: string, protocol: string): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [delivery] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.token, token))
      .limit(1);
    if (!delivery) return null;
    const pageTitle = `${delivery.title} | JD Studio HK`;
    const pageDesc = `${delivery.clientName} 的相片及影片交付 — JD Studio HK 專業攝影及影片製作`;
    const pageUrl = `${protocol}://${host}/delivery/${token}`;
    return `<!DOCTYPE html>
<html lang="zh-HK">
<head>
  <meta charset="UTF-8" />
  <title>${pageTitle}</title>
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:title" content="${pageTitle}" />
  <meta property="og:description" content="${pageDesc}" />
  <meta property="og:image" content="${DELIVERY_LOGO_URL}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="JD Studio HK" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${pageTitle}" />
  <meta name="twitter:description" content="${pageDesc}" />
  <meta name="twitter:image" content="${DELIVERY_LOGO_URL}" />
</head>
<body><p>正在載入...</p></body>
</html>`;
  } catch {
    return null;
  }
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    // ── OG meta injection for delivery pages (social media crawlers) ─────────────────
    const deliveryMatch = url.match(/^\/delivery\/([a-f0-9]{48})/);
    if (deliveryMatch && CRAWLER_UA_REGEX.test(req.headers["user-agent"] || "")) {
      const ogHtml = await buildDeliveryOgHtml(
        deliveryMatch[1],
        req.get("host") || "jdsys.biz",
        req.protocol
      );
      if (ogHtml) {
        return res.status(200).set({ "Content-Type": "text/html" }).end(ogHtml);
      }
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  // But first check if this is a crawler requesting a delivery page
  app.use("*", async (req, res) => {
    const deliveryMatch = req.originalUrl.match(/^\/delivery\/([a-f0-9]{48})/);
    if (deliveryMatch && CRAWLER_UA_REGEX.test(req.headers["user-agent"] || "")) {
      const ogHtml = await buildDeliveryOgHtml(
        deliveryMatch[1],
        req.get("host") || "jdsys.biz",
        req.protocol
      );
      if (ogHtml) {
        return res.status(200).set({ "Content-Type": "text/html" }).end(ogHtml);
      }
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
