/**
 * Sitewide WhatsApp click rewriter for jdstudiohk.com (Squarespace).
 * Inject once: <script src="https://jdsys.biz/wa-track-rewrite.js" defer></script>
 */
(function () {
  var TRACK = "https://jdsys.biz/api/track/wa";
  var WA_HOSTS =
    /(wa\.me\/85291531976|api\.whatsapp\.com\/send\?.*phone=85291531976|web\.whatsapp\.com\/send\?.*phone=85291531976)/i;

  function pageLp() {
    try {
      return location.href.split("#")[0];
    } catch (e) {
      return "https://www.jdstudiohk.com/";
    }
  }

  function buildTrackHref() {
    var u = new URL(TRACK);
    var cur = null;
    try {
      cur = new URL(location.href);
    } catch (e) {}
    var src = "website";
    if (cur) {
      ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(
        function (k) {
          var v = cur.searchParams.get(k);
          if (v) u.searchParams.set(k, v);
        }
      );
      var cid = cur.searchParams.get("campaign_id") || cur.searchParams.get("campaignid");
      if (cid) u.searchParams.set("campaign_id", cid);
      if (cur.searchParams.get("gclid") || cur.searchParams.get("gbraid") || cur.searchParams.get("wbraid") || cid) {
        src = "google_ads";
      }
    }
    u.searchParams.set("src", src);
    u.searchParams.set("lp", pageLp());
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
