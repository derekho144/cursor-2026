/**
 * Sitewide WhatsApp click rewriter for jdstudiohk.com (Squarespace).
 * Inject once: <script src="https://jdsys.biz/wa-track-rewrite.js" defer></script>
 *
 * Classifies src: google_ads | organic | ai | website from landing UTM + document.referrer.
 */
(function () {
  var TRACK = "https://jdsys.biz/api/track/wa";
  var WA_HOSTS =
    /(wa\.me\/85291531976|api\.whatsapp\.com\/send\?.*phone=85291531976|web\.whatsapp\.com\/send\?.*phone=85291531976)/i;

  var PAID_MEDIA = {
    cpc: 1,
    ppc: 1,
    paid: 1,
    paidsearch: 1,
    paid_search: 1,
    display: 1,
    shopping: 1,
    cpm: 1,
  };
  var AI_SOURCES =
    /(chatgpt|openai|perplexity|gemini|copilot|claude|anthropic|you\.com|youcom|phind|poe|deepseek|grok|meta\.ai|metaai)/i;
  var AI_HOST =
    /(chat\.openai\.com|chatgpt\.com|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|claude\.ai|you\.com|phind\.com|poe\.com|meta\.ai|grok\.com)/i;
  var SEARCH_HOST =
    /(google\.|bing\.com|yahoo\.|duckduckgo\.com|baidu\.com|yandex\.|search\.brave\.com)/i;

  function pageLp() {
    try {
      return location.href.split("#")[0];
    } catch (e) {
      return "https://www.jdstudiohk.com/";
    }
  }

  function pageReferrer() {
    try {
      return document.referrer || "";
    } catch (e) {
      return "";
    }
  }

  function paidParamsFromUrl(urlObj) {
    if (!urlObj || !urlObj.searchParams) {
      return { gclid: "", gbraid: "", wbraid: "", cid: "", gadSource: "" };
    }
    var sp = urlObj.searchParams;
    return {
      gclid: sp.get("gclid") || "",
      gbraid: sp.get("gbraid") || "",
      wbraid: sp.get("wbraid") || "",
      cid:
        sp.get("campaign_id") ||
        sp.get("campaignid") ||
        sp.get("gad_campaignid") ||
        "",
      gadSource: sp.get("gad_source") || "",
    };
  }

  function classifySrc(cur, referrer) {
    var paid = paidParamsFromUrl(cur);
    var refPaid = { gclid: "", gbraid: "", wbraid: "", cid: "", gadSource: "" };
    try {
      if (referrer) refPaid = paidParamsFromUrl(new URL(referrer));
    } catch (e) {}
    var utmSource = ((cur && cur.searchParams.get("utm_source")) || "").toLowerCase();
    var utmMedium = ((cur && cur.searchParams.get("utm_medium")) || "").toLowerCase();
    if (
      paid.gclid ||
      paid.gbraid ||
      paid.wbraid ||
      paid.cid ||
      paid.gadSource === "1" ||
      refPaid.gclid ||
      refPaid.gbraid ||
      refPaid.wbraid ||
      refPaid.cid ||
      refPaid.gadSource === "1" ||
      PAID_MEDIA[utmMedium]
    ) {
      return "google_ads";
    }
    if (utmMedium === "ai" || utmMedium === "llm" || utmMedium === "aeo" || AI_SOURCES.test(utmSource)) {
      return "ai";
    }
    if (referrer && AI_HOST.test(referrer)) return "ai";
    if (
      utmMedium === "organic" ||
      utmMedium === "seo" ||
      utmMedium === "geo" ||
      (utmSource &&
        /^(google|bing|yahoo|duckduckgo)/i.test(utmSource) &&
        !PAID_MEDIA[utmMedium])
    ) {
      return "organic";
    }
    if (referrer && SEARCH_HOST.test(referrer)) return "organic";
    return "website";
  }

  function buildTrackHref() {
    var u = new URL(TRACK);
    var cur = null;
    try {
      cur = new URL(location.href);
    } catch (e) {}
    var referrer = pageReferrer();
    var refUrl = null;
    try {
      if (referrer) refUrl = new URL(referrer);
    } catch (e) {}
    if (cur) {
      ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(
        function (k) {
          var v = cur.searchParams.get(k);
          if (v) u.searchParams.set(k, v);
        }
      );
      var cid =
        cur.searchParams.get("campaign_id") ||
        cur.searchParams.get("campaignid") ||
        cur.searchParams.get("gad_campaignid");
      if (cid) u.searchParams.set("campaign_id", cid);
    }
    // If SPA stripped Ads params from the visible URL, recover from document.referrer.
    if (refUrl) {
      ["gclid", "gbraid", "wbraid"].forEach(function (k) {
        if (!u.searchParams.get(k)) {
          var v = refUrl.searchParams.get(k);
          if (v) u.searchParams.set(k, v);
        }
      });
      if (!u.searchParams.get("campaign_id")) {
        var rcid =
          refUrl.searchParams.get("campaign_id") ||
          refUrl.searchParams.get("campaignid") ||
          refUrl.searchParams.get("gad_campaignid");
        if (rcid) u.searchParams.set("campaign_id", rcid);
      }
    }
    var src = classifySrc(cur, referrer);
    u.searchParams.set("src", src);
    u.searchParams.set("lp", pageLp());
    // Capture marketing-page referrer before noreferrer strip on the track hop
    if (referrer) u.searchParams.set("ref", referrer.slice(0, 2048));
    return u.toString();
  }

  function shouldRewrite(href) {
    if (!href) return false;
    if (href.indexOf("jdsys.biz/api/track/wa") !== -1) return false;
    return WA_HOSTS.test(href);
  }

  function rewrite(a) {
    var href = a.getAttribute("href") || "";
    if (!shouldRewrite(href)) return;
    a.setAttribute("href", buildTrackHref());
    var rel = (a.getAttribute("rel") || "").trim();
    if (!/\bnoopener\b/i.test(rel)) rel = (rel + " noopener").trim();
    if (!/\bnoreferrer\b/i.test(rel)) rel = (rel + " noreferrer").trim();
    a.setAttribute("rel", rel);
    if (!a.getAttribute("target")) a.setAttribute("target", "_blank");
  }

  function run() {
    var nodes = document.querySelectorAll(
      'a[href*="wa.me"],a[href*="api.whatsapp.com"],a[href*="web.whatsapp.com"]'
    );
    for (var i = 0; i < nodes.length; i++) rewrite(nodes[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
  try {
    new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
