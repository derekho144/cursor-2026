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

  /**
   * Homepage #jdh service tiles: food / video used jsDelivr on a private GitHub
   * branch (Failed to fetch). Force stable public URLs and remount <img> so a
   * prior jsDelivr error state cannot leave a blank/opaque tile.
   */
  var FOOD_TILE =
    "https://jdsys.biz/home-tile-food-crab.jpg";
  var VIDEO_TILE =
    "https://jdsys.biz/home-tile-video-bts.jpg";
  // Same-origin Squarespace CDN fallback if jdsys is blocked for any reason
  var FOOD_TILE_FALLBACK =
    "https://images.squarespace-cdn.com/content/v1/5d6b9dde8a813e0001faeb3c/1769590350460-S4SL1T3H610CVEN0NFKR/1%E9%85%92%E5%BA%97%E9%A3%9F%E7%89%A9%E6%8B%8D%E6%94%9D%E5%8F%8A%E9%A4%90%E5%96%AE%E8%A8%AD%E8%A8%88+JD+STUDIO.png?format=2000w";

  function markTileReady(img) {
    var ph = img && img.closest && img.closest(".ph");
    if (ph) ph.classList.add("is-ready");
  }

  function forceTileSrc(img, url) {
    if (!img || !url) return;
    var cur = img.getAttribute("src") || "";
    if (cur === url && img.complete && img.naturalWidth > 0) {
      markTileReady(img);
      return;
    }
    // Remount so browsers that already failed jsDelivr still fetch cleanly.
    var next = img.cloneNode(false);
    next.removeAttribute("srcset");
    next.loading = "eager";
    next.decoding = "async";
    next.addEventListener("load", function () { markTileReady(next); }, { once: true });
    next.addEventListener(
      "error",
      function () {
        if (url === FOOD_TILE && FOOD_TILE_FALLBACK) {
          forceTileSrc(next, FOOD_TILE_FALLBACK);
        } else {
          markTileReady(next);
        }
      },
      { once: true }
    );
    next.setAttribute("src", url);
    if (img.parentNode) img.parentNode.replaceChild(next, img);
  }

  function needsTileFix(src) {
    if (!src) return true;
    if (/jsdelivr\.net/i.test(src)) return true;
    if (/github\.com\/derekho144\/cursor-2026/i.test(src)) return true;
    if (/homepage-lower-ui-096b/i.test(src)) return true;
    return false;
  }

  function rewriteBrokenTiles() {
    var food =
      document.querySelector('#jdh a[href*="food-photography"] img') ||
      document.querySelector('#jdh a[aria-label*="食物攝影"] img');
    if (food && needsTileFix(food.getAttribute("src") || "")) {
      forceTileSrc(food, FOOD_TILE);
    }

    var video =
      document.querySelector('#jdh a[href*="video-project"] img') ||
      document.querySelector('#jdh a[aria-label*="影片"] img');
    if (video && needsTileFix(video.getAttribute("src") || "")) {
      forceTileSrc(video, VIDEO_TILE);
    }

    // Catch any remaining jsDelivr home-tile imgs outside the selectors above
    var loose = document.querySelectorAll("img[src*='jsdelivr.net'][src*='home-tiles'], img[src*='jsdelivr.net'][src*='food-crab'], img[src*='jsdelivr.net'][src*='video-bts']");
    for (var i = 0; i < loose.length; i++) {
      var img = loose[i];
      var src = img.getAttribute("src") || "";
      if (/food-crab/i.test(src)) forceTileSrc(img, FOOD_TILE);
      else if (/video-bts/i.test(src)) forceTileSrc(img, VIDEO_TILE);
    }
  }

  var tileRewriteQueued = false;
  function queueTileRewrite() {
    if (tileRewriteQueued) return;
    tileRewriteQueued = true;
    setTimeout(function () {
      tileRewriteQueued = false;
      rewriteBrokenTiles();
    }, 0);
  }

  function runAll() {
    run();
    queueTileRewrite();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runAll);
  } else {
    runAll();
  }
  // Also run after full load (lazy tiles further down the page)
  window.addEventListener("load", queueTileRewrite);
  try {
    new MutationObserver(runAll).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (e) {}
})();
