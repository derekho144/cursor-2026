import { Redirect } from "wouter";

/**
 * Legacy route: 月度報表 is now a tab inside 廣告開支.
 * Keep /reports bookmarks working via redirect.
 */
export default function MonthlyReport() {
  return <Redirect to="/ad-expenses?tab=report" />;
}
