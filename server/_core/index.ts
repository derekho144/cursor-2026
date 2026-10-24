import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startScheduler } from "../scheduler";
import { updateEmailLogTracking, updateEmailInquiryTracking, updateEmailLogOpenTracking, updateEmailInquiryOpenById, recordWhatsappClick, backfillEmailInquiryLeadSources, ensureAdsQuoteAttributionSchema } from "../db";
import { ENV } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Increase headersTimeout to 180s (default 60s is too short for multi-step LLM calls)
  server.headersTimeout = 180_000;
  server.requestTimeout = 300_000;

  // Airwallex webhook — raw body required for HMAC verification (before JSON parser)
  app.post(
    "/api/webhooks/airwallex",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      try {
        const { handleAirwallexWebhook } = await import("../airwallexWebhook");
        await handleAirwallexWebhook(req, res);
      } catch (err) {
        console.error("[Airwallex Webhook] Error:", err);
        res.status(200).json({ received: true });
      }
    }
  );

  // WhatsApp Cloud API — Meta webhook verification + inbound messages
  app.get("/api/webhooks/whatsapp", async (req, res) => {
    try {
      const { verifyWhatsappWebhookChallenge, isWhatsappCloudConfigured } = await import(
        "./whatsappCloud"
      );
      if (!isWhatsappCloudConfigured()) {
        res.status(503).type("text/plain").send("WhatsApp Cloud API not configured");
        return;
      }
      const challenge = verifyWhatsappWebhookChallenge({
        "hub.mode": typeof req.query["hub.mode"] === "string" ? req.query["hub.mode"] : undefined,
        "hub.verify_token":
          typeof req.query["hub.verify_token"] === "string"
            ? req.query["hub.verify_token"]
            : undefined,
        "hub.challenge":
          typeof req.query["hub.challenge"] === "string" ? req.query["hub.challenge"] : undefined,
      });
      if (challenge == null) {
        res.status(403).type("text/plain").send("Forbidden");
        return;
      }
      res.status(200).type("text/plain").send(challenge);
    } catch (err) {
      console.error("[WhatsApp Webhook] verify error:", err);
      res.status(500).type("text/plain").send("error");
    }
  });

  app.post(
    "/api/webhooks/whatsapp",
    express.raw({ type: "application/json", limit: "2mb" }),
    async (req, res) => {
      try {
        const {
          verifyWhatsappSignature,
          parseWhatsappWebhookPayload,
          isWhatsappCloudConfigured,
        } = await import("./whatsappCloud");
        const { recordWhatsappInboundMessage } = await import("../db");

        if (!isWhatsappCloudConfigured()) {
          res.status(503).json({ error: "not_configured" });
          return;
        }

        const raw: Buffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
        const sig = req.headers["x-hub-signature-256"];
        if (!verifyWhatsappSignature(raw, typeof sig === "string" ? sig : undefined)) {
          console.warn("[WhatsApp Webhook] bad signature");
          res.status(401).json({ error: "invalid_signature" });
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch {
          res.status(400).json({ error: "invalid_json" });
          return;
        }

        const messages = parseWhatsappWebhookPayload(payload);
        for (const msg of messages) {
          const saved = await recordWhatsappInboundMessage({
            waMessageId: msg.waMessageId,
            fromPhone: msg.fromPhone,
            contactName: msg.contactName,
            body: msg.body,
            waTimestamp: msg.waTimestamp,
            rawJson: raw.toString("utf8").slice(0, 100_000),
          });
          console.log(
            `[WhatsApp Webhook] inbound from=${msg.fromPhone} match=${saved?.matchReason || "?"} click=${saved?.matchedClickId ?? "-"}`
          );
        }

        // Meta requires 200 quickly
        res.status(200).json({ ok: true, received: messages.length });
      } catch (err) {
        console.error("[WhatsApp Webhook] Error:", err);
        res.status(200).json({ ok: true, received: 0 });
      }
    }
  );

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // ─── Health Check: keep-alive ping for external uptime monitors ─────────
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  // ─── Google Calendar ICS: accepted quotes by shootingDate ───────────────
  // Subscribe in Google Calendar → Settings → Add calendar → From URL
  app.get("/api/calendar/accepted.ics", async (req, res) => {
    try {
      const {
        getCalendarFeedToken,
        timingSafeEqualToken,
        renderAcceptedShootsIcsFeed,
      } = await import("../acceptedCalendarIcs");
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!timingSafeEqualToken(token, getCalendarFeedToken())) {
        res.status(401).type("text/plain").send("Unauthorized");
        return;
      }
      const ics = await renderAcceptedShootsIcsFeed();
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="jd-studio-shoots.ics"');
      res.setHeader("Cache-Control", "no-cache, max-age=300");
      res.status(200).send(ics);
    } catch (err) {
      console.error("[Calendar ICS] Error:", err);
      res.status(500).type("text/plain").send("Calendar feed unavailable");
    }
  });
  // ─── Scheduled: keep-alive (Heartbeat cron, every 5 min) ─────────────────
  // Heartbeat cron pings this every 5 minutes to prevent Cloud Run cold starts
  app.post("/api/scheduled/keep-alive", (_req, res) => {
    console.log(`[KeepAlive] Pinged at ${new Date().toISOString()}`);
    res.json({ ok: true, ts: new Date().toISOString(), message: "Server is alive" });
  });

  // ─── Scheduled: Airwallex payment sync (backup if webhook missed) ────────
  app.post("/api/scheduled/airwallex-sync", async (req, res) => {
    const { requireScheduledAuth } = await import("./scheduledAuth");
    if (!(await requireScheduledAuth(req, res))) return;
    res.json({ ok: true, started: true, time: new Date().toISOString() });
    import("../airwallexPayment")
      .then(({ syncRecentAirwallexPayments }) => syncRecentAirwallexPayments(48))
      .then((r) => console.log(`[Airwallex Sync] scanned=${r.scanned} applied=${r.applied}`))
      .catch((err) => console.error("[Airwallex Sync] Error:", err));
  });

  // ─── Resend Webhook: email open tracking ─────────────────────────────
  // Resend sends POST to /api/webhooks/resend when an email is opened
  // Event types: email.opened, email.clicked, email.delivered, email.bounced
  app.post("/api/webhooks/resend", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body);
      const { type, data } = body;
      console.log(`[Resend Webhook] Event: ${type}, emailId: ${data?.email_id}`);

      if (type === "email.opened" && data?.email_id) {
        const openedAt = new Date(data.created_at || Date.now());
        // Try to match against email_logs (quotation emails)
        await updateEmailLogTracking(data.email_id, openedAt);
        // Try to match against email_inquiries (FH reply emails)
        await updateEmailInquiryTracking(data.email_id, openedAt);
        console.log(`[Resend Webhook] Recorded open for email_id: ${data.email_id}`);
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error("[Resend Webhook] Error processing webhook:", err);
      res.status(200).json({ received: true }); // Always 200 to prevent Resend retries
    }
  });

  // ─── Tracking Pixel: email open tracking (works with any email provider) ──
  // When client opens email, browser loads this 1x1 GIF and we record the open time
  app.get("/api/track/open/:logId", async (req, res) => {
    const logId = parseInt(req.params.logId, 10);
    if (!isNaN(logId) && logId > 0) {
      // Fire-and-forget: don't block the response
      updateEmailLogOpenTracking(logId).catch(err =>
        console.error("[TrackPixel] Failed to record open:", err)
      );
    }
    // Return 1x1 transparent GIF
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64"
    );
    res.set({
      "Content-Type": "image/gif",
      "Content-Length": String(gif.length),
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(gif);
  });

  // ─── Public LinkedIn asset proxy (Buffer needs unauthenticated HTTPS URLs) ─
  app.get("/api/public/linkedin-asset/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || id < 1) {
        res.status(400).send("bad id");
        return;
      }
      const { getDb } = await import("../db");
      const { linkedinContentAssets } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const { storageGet } = await import("../storage");
      const db = await getDb();
      if (!db) {
        res.status(503).send("db unavailable");
        return;
      }
      const [asset] = await db
        .select()
        .from(linkedinContentAssets)
        .where(and(eq(linkedinContentAssets.id, id), eq(linkedinContentAssets.active, 1)))
        .limit(1);
      if (!asset?.storageKey) {
        res.status(404).send("not found");
        return;
      }

      // Buffer cannot follow redirects reliably — always stream image bytes (200),
      // never 302 to Squarespace / Forge signed URLs.
      const sourceMatch = asset.aiDescription?.match(/^source:(https:\/\/\S+)/);
      const candidates: string[] = [];
      if (sourceMatch?.[1]) candidates.push(sourceMatch[1]);
      try {
        const { url } = await storageGet(asset.storageKey);
        if (url) candidates.push(url);
      } catch (err: any) {
        console.warn("[PublicAsset] storageGet failed:", err?.message || err);
      }
      if (!candidates.length) {
        res.status(404).send("not found");
        return;
      }

      let upstream: Response | null = null;
      let lastStatus = 0;
      for (const url of candidates) {
        try {
          const resUp = await fetch(url, {
            redirect: "follow",
            headers: {
              // Prefer raster formats LinkedIn/Buffer accept well
              Accept: "image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5",
              "User-Agent": "JDStudio-PublicAssetProxy/1.0",
            },
          });
          lastStatus = resUp.status;
          if (resUp.ok) {
            upstream = resUp;
            break;
          }
        } catch (err: any) {
          console.warn("[PublicAsset] upstream fetch error:", err?.message || err);
        }
      }
      if (!upstream) {
        res.status(502).send(`upstream fetch failed (${lastStatus || "network"})`);
        return;
      }
      const mime =
        asset.mimeType ||
        upstream.headers.get("content-type") ||
        "image/jpeg";
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", mime.split(";")[0].trim());
      res.setHeader("Content-Length", String(buf.length));
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(buf);
    } catch (err: any) {
      console.error("[PublicAsset] error:", err?.message || err);
      res.status(500).send("error");
    }
  });

  // ─── Tracking Pixel: FH email open tracking ──────────────────────────────
  // Same mechanism as /api/track/open/:logId but targets emailInquiries.replyOpenedAt
  app.get("/api/track/fh/:inquiryId", async (req, res) => {
    const inquiryId = parseInt(req.params.inquiryId, 10);
    if (!isNaN(inquiryId) && inquiryId > 0) {
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
      const userAgent = req.headers["user-agent"] ?? "";
      updateEmailInquiryOpenById(inquiryId, { ip, userAgent }).catch(err =>
        console.error("[TrackPixel FH] Failed to record open:", err)
      );
    }
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64"
    );
    res.set({
      "Content-Type": "image/gif",
      "Content-Length": String(gif.length),
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(gif);
  });

  // ─── WhatsApp Click Tracking ──────────────────────────────────────────────
  // When client clicks WhatsApp link from email, redirect to WhatsApp and record the click
  // URL format: /api/track/wa?src=fh_first_email&inq=123&fhj=456
  // Prefill wording differs from the official-site button (same meaning, no "Email" label)
  // so staff can tell email-link vs website-button from the first chat line.
  app.get("/api/track/wa", async (req, res) => {
    const { waMeUrlWithPrefill, generateWaRefCode } = await import("./waTracking");
    const {
      parseAdsAttribution,
      hasAdsAttribution,
      hasMarketingAttribution,
      landingPageFromReferer,
    } = await import("./adsAttribution");
    const { inferWaTrackSource } = await import("../../shared/leadChannels");
    const sourceRaw = (req.query.src as string) || "other";
    const inquiryId = req.query.inq ? parseInt(req.query.inq as string, 10) : undefined;
    const fhJobId = req.query.fhj ? parseInt(req.query.fhj as string, 10) : undefined;
    const quoteId = req.query.q ? parseInt(req.query.q as string, 10) : undefined;
    const attr = parseAdsAttribution(req.query as Record<string, unknown>);
    const headerReferer =
      typeof req.headers.referer === "string"
        ? req.headers.referer
        : typeof req.headers.referrer === "string"
          ? req.headers.referrer
          : null;
    if (!attr.landingPageUrl) {
      attr.landingPageUrl = landingPageFromReferer(headerReferer);
    }
    if (!attr.pageReferrer && headerReferer) {
      // Prefer explicit ?ref= from site script; header is fallback when not noreferrer
      attr.pageReferrer = landingPageFromReferer(headerReferer);
    }
    // Prefer explicit src; re-classify from UTM / referrer / gclid when src is generic
    const allowed = [
      "fh_first_email",
      "fh_follow_up",
      "quote_email",
      "review_invite",
      "google_ads",
      "organic",
      "ai",
      "website",
      "other",
    ] as const;
    let source: (typeof allowed)[number] = allowed.includes(sourceRaw as any)
      ? (sourceRaw as (typeof allowed)[number])
      : "other";
    if (
      source === "other" ||
      source === "website"
    ) {
      const inferred = inferWaTrackSource({ ...attr, src: source });
      if (inferred !== "website" || source === "other") {
        source = inferred;
      }
    }
    if (source === "other" && hasAdsAttribution(attr)) source = "google_ads";
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    const userAgent = req.headers["user-agent"] ?? "";
    // Prefer website prefill when traffic is from the marketing site / Ads / organic / AI
    const prefill =
      source === "google_ads" ||
      source === "website" ||
      source === "organic" ||
      source === "ai"
        ? "website"
        : "email";
    // Staff-only match label in quote form dropdown — never shown in customer WA text.
    const wantsRef = source === "google_ads" || hasAdsAttribution(attr);
    const refCode = wantsRef ? generateWaRefCode() : null;

    // Fire-and-forget: record click (+ Ads attribution / staff ref) then redirect
    recordWhatsappClick({
      inquiryId: inquiryId && !isNaN(inquiryId) ? inquiryId : undefined,
      fhJobId: fhJobId && !isNaN(fhJobId) ? fhJobId : undefined,
      quoteId: quoteId && !isNaN(quoteId) ? quoteId : undefined,
      source,
      ip,
      userAgent,
      refCode,
      ...attr,
    }).catch((err) => console.error("[WA Track] Failed:", err));
    if (hasMarketingAttribution(attr) || refCode) {
      console.log(
        `[WA Track] attribution src=${source} ref=${refCode || "-"} gclid=${attr.gclid ? "yes" : "no"} utm=${attr.utmSource || "-"}/${attr.utmMedium || "-"} campaign=${attr.adsCampaignId || attr.utmCampaign || "-"}`
      );
    }
    // Clean opener only — same as Squarespace button (no weird codes for the customer)
    res.redirect(waMeUrlWithPrefill(prefill));
  });

  // ─── Heartbeat: FH job board scrape (every 30 min, 08:00-21:00 HKT) ──────
  app.post("/api/scheduled/fh-scrape", async (req, res) => {
    const { requireScheduledAuth } = await import("./scheduledAuth");
    if (!(await requireScheduledAuth(req, res))) return;
    // Time-of-day guard: only run 08:00-21:00 HKT
    const nowHKT = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const hourHKT = nowHKT.getUTCHours();
    if (hourHKT < 8 || hourHKT >= 21) {
      res.json({ ok: true, skipped: true, reason: "outside active hours (08:00-21:00 HKT)" }); return;
    }
    res.json({ ok: true, started: true, time: new Date().toISOString() });
    // Use locked scheduler entry (avoids concurrent scrape with in-process timer)
    import("../scheduler").then(({ runScheduledFreehunterScrape }) =>
      runScheduledFreehunterScrape()
    ).then(() => {
      console.log(`[Heartbeat/fh-scrape] Done`);
    }).catch((err) => console.error("[Heartbeat/fh-scrape] Error:", err));
  });

  // ─── Heartbeat: Gmail scan (every 30 min, 09:00-21:00 HKT) ───────────────
  app.post("/api/scheduled/gmail-scan", async (req, res) => {
    const { requireScheduledAuth } = await import("./scheduledAuth");
    if (!(await requireScheduledAuth(req, res))) return;
    const nowHKT = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const hourHKT = nowHKT.getUTCHours();
    if (hourHKT < 9 || hourHKT >= 21) {
      res.json({ ok: true, skipped: true, reason: "outside active hours (09:00-21:00 HKT)" }); return;
    }
    res.json({ ok: true, started: true, time: new Date().toISOString() });
    import("../scheduler").then(({ runScheduledGmailScan }) =>
      runScheduledGmailScan()
    ).then(() => console.log("[Heartbeat/gmail-scan] Done"))
     .catch((err) => console.error("[Heartbeat/gmail-scan] Error:", err));
  });

  // ─── Heartbeat: Quote follow-up emails (every hour) ───────────────────────
  app.post("/api/scheduled/quote-followup", async (req, res) => {
    const { requireScheduledAuth } = await import("./scheduledAuth");
    if (!(await requireScheduledAuth(req, res))) return;
    res.json({ ok: true, started: true, time: new Date().toISOString() });
    import("../gmailFollowUp").then(({ runQuoteFollowUps }) =>
      runQuoteFollowUps()
    ).then(() => console.log("[Heartbeat/quote-followup] Done"))
     .catch((err) => console.error("[Heartbeat/quote-followup] Error:", err));
  });

  // ─── Heartbeat: FH follow-up + backfill emails (every hour) ──────────────
  app.post("/api/scheduled/fh-followup", async (req, res) => {
    const { requireScheduledAuth } = await import("./scheduledAuth");
    if (!(await requireScheduledAuth(req, res))) return;
    res.json({ ok: true, started: true, time: new Date().toISOString() });
    Promise.all([
      import("../scheduler").then(({ runFHFollowUpEmails, runFHHighConfidenceBackfill }) =>
        Promise.all([runFHFollowUpEmails(), runFHHighConfidenceBackfill()])
      ),
      import("../watchdog").then(({ runWatchdog }) => runWatchdog()),
    ]).then(() => console.log("[Heartbeat/fh-followup] Done (follow-up + backfill + watchdog)"))
     .catch((err) => console.error("[Heartbeat/fh-followup] Error:", err));
  });

  // ─── Heartbeat: Pitch Outreach (daily 09:00 HKT) ─────────────────────────────
  app.post("/api/scheduled/pitch-outreach", async (req, res) => {
    const { requireScheduledAuth } = await import("./scheduledAuth");
    if (!(await requireScheduledAuth(req, res))) return;
    res.json({ ok: true, started: true, time: new Date().toISOString() });
    // Use locked scheduler entry (avoids concurrent outreach with in-process timer)
    import("../scheduler")
      .then(({ runScheduledPitchOutreach }) => runScheduledPitchOutreach())
      .then(() => console.log("[Heartbeat/pitch-outreach] Done"))
      .catch((err) => console.error("[Heartbeat/pitch-outreach] Error:", err));
  });

  // ─── Heartbeat: Loyalty remarketing — seasonal + winback (hourly) ───────────
  app.post("/api/scheduled/loyalty-remarketing", async (req, res) => {
    const { requireScheduledAuth } = await import("./scheduledAuth");
    if (!(await requireScheduledAuth(req, res))) return;
    res.json({ ok: true, started: true, time: new Date().toISOString() });
    import("../scheduler")
      .then(({ runScheduledLoyaltyRemarketing }) => runScheduledLoyaltyRemarketing())
      .then(() => console.log("[Heartbeat/loyalty-remarketing] Done"))
      .catch((err) => console.error("[Heartbeat/loyalty-remarketing] Error:", err));
  });
  // ─── Google Ads OAuth2 Re-authorization ─────────────────────────────────
  // Step 1: Generate Google OAuth2 authorization URL and redirect
  app.get("/api/google-ads/auth-url", async (req, res) => {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    if (!clientId) {
      res.status(500).json({ error: "GOOGLE_ADS_CLIENT_ID not configured" });
      return;
    }
    const returnTo = (req.query.origin as string) || ENV.appBaseUrl;
    let appOrigin = ENV.appBaseUrl;
    try {
      appOrigin = new URL(returnTo).origin;
    } catch {
      appOrigin = returnTo.replace(/\/$/, "");
    }
    const redirectUri = `${appOrigin}/api/google-ads/oauth-callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/adwords",
      access_type: "offline",
      prompt: "consent",
      state: returnTo,
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    // Redirect directly to Google
    res.redirect(authUrl);
  });

  // Step 2: Handle OAuth2 callback, exchange code for refresh token
  app.get("/api/google-ads/oauth-callback", async (req, res) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;
    let appOrigin = ENV.appBaseUrl;
    let returnPath = "/ad-sync";
    if (state) {
      try {
        const u = new URL(state);
        appOrigin = u.origin;
        returnPath = u.pathname || "/ad-sync";
      } catch {
        appOrigin = state.replace(/\/$/, "");
      }
    }
    const redirectBack = (params: string) =>
      res.redirect(`${appOrigin}${returnPath}?${params}`);

    if (error) {
      redirectBack(`google_auth=error&msg=${encodeURIComponent(error)}`);
      return;
    }
    if (!code) {
      redirectBack("google_auth=error&msg=no_code");
      return;
    }

    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const redirectUri = `${appOrigin}/api/google-ads/oauth-callback`;

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });
      const tokenJson = await tokenRes.json() as any;

      if (!tokenJson.refresh_token) {
        console.error("[Google Ads OAuth] No refresh_token in response:", JSON.stringify(tokenJson));
        const msg = "No refresh token received. Please go to https://myaccount.google.com/permissions and revoke JD Studio access, then try again.";
        redirectBack(`google_auth=error&msg=${encodeURIComponent(msg)}`);
        return;
      }

      const { saveGoogleAdsRefreshToken } = await import("../googleAds");
      await saveGoogleAdsRefreshToken(tokenJson.refresh_token);
      console.log("[Google Ads OAuth] New refresh token saved to DB successfully");
      redirectBack("google_auth=success");
    } catch (err: any) {
      console.error("[Google Ads OAuth] Callback error:", err);
      redirectBack(`google_auth=error&msg=${encodeURIComponent(err?.message ?? "Unknown error")}`);
    }
  });

  // ─── Google Search Console OAuth2 ───────────────────────────────────────
  // Reuses GOOGLE_ADS_CLIENT_ID/SECRET; scope = webmasters.readonly
  app.get("/api/google-search-console/auth-url", async (req, res) => {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    if (!clientId) {
      res.status(500).json({ error: "GOOGLE_ADS_CLIENT_ID not configured" });
      return;
    }
    const returnTo = (req.query.origin as string) || ENV.appBaseUrl;
    let appOrigin = ENV.appBaseUrl;
    try {
      appOrigin = new URL(returnTo).origin;
    } catch {
      appOrigin = returnTo.replace(/\/$/, "");
    }
    const redirectUri = `${appOrigin}/api/google-search-console/oauth-callback`;
    const { gscOAuthScope } = await import("../googleSearchConsole");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: gscOAuthScope(),
      access_type: "offline",
      prompt: "consent",
      state: returnTo,
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/google-search-console/oauth-callback", async (req, res) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;
    let appOrigin = ENV.appBaseUrl;
    let returnPath = "/ad-sync";
    if (state) {
      try {
        const u = new URL(state);
        appOrigin = u.origin;
        returnPath = u.pathname || "/ad-sync";
      } catch {
        appOrigin = state.replace(/\/$/, "");
      }
    }
    const redirectBack = (params: string) =>
      res.redirect(`${appOrigin}${returnPath}?${params}`);

    if (error) {
      redirectBack(`gsc_auth=error&msg=${encodeURIComponent(error)}`);
      return;
    }
    if (!code) {
      redirectBack("gsc_auth=error&msg=no_code");
      return;
    }

    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const redirectUri = `${appOrigin}/api/google-search-console/oauth-callback`;

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });
      const tokenJson = (await tokenRes.json()) as {
        refresh_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenJson.refresh_token) {
        console.error("[GSC OAuth] No refresh_token:", JSON.stringify(tokenJson));
        const msg =
          "No refresh token received. Revoke JD Studio at https://myaccount.google.com/permissions then retry GSC authorize.";
        redirectBack(`gsc_auth=error&msg=${encodeURIComponent(msg)}`);
        return;
      }

      const { saveGscRefreshToken, touchGscCredentialVerified } = await import(
        "../googleSearchConsole"
      );
      await saveGscRefreshToken(tokenJson.refresh_token);
      await touchGscCredentialVerified();
      console.log("[GSC OAuth] Refresh token saved (google_search_console)");
      redirectBack("gsc_auth=success");
    } catch (err: any) {
      console.error("[GSC OAuth] Callback error:", err);
      redirectBack(`gsc_auth=error&msg=${encodeURIComponent(err?.message ?? "Unknown error")}`);
    }
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Start background scheduler (PRO360 auto-sync every 10 days)
    startScheduler();
    // Self-heal legacy quote leadSource = email_inquiry (non-blocking)
    setImmediate(() => {
      backfillEmailInquiryLeadSources()
        .then((r) => {
          if (r.scanned > 0) {
            console.log(`[Startup] leadSource backfill: updated ${r.updated}/${r.scanned} quotes`);
          }
        })
        .catch((err) => console.error("[Startup] leadSource backfill failed:", err));
      ensureAdsQuoteAttributionSchema()
        .then(() => console.log("[Startup] ads quote attribution schema OK"))
        .catch((err) => console.error("[Startup] ads attribution schema failed:", err));
    });
  });
}

startServer().catch(console.error);

  // ─── Heartbeat: Daily Outreach (daily 09:00 HKT) ─────────────────────────────
