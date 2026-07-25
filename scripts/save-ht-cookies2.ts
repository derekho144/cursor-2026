/**
 * Save fresh HelloToby cookies to database.
 */
import { saveHelloTobyCookies } from "../server/db";

const freshCookies = [
  {"name":"nfcountry","value":"HK","domain":".hellotoby.com"},
  {"name":"nfsession","value":"9a8a93d9-8690-4cd4-9c7a-18b98be786cd","domain":".hellotoby.com"},
  {"name":"localeId","value":"zh-hk","domain":".hellotoby.com"},
  {"name":"nftoken","value":"060eb77995a1fe550ba86dd52cccddc99c6341c1b014439ef27dce90eb64dd6b","domain":".hellotoby.com"}
];

console.log("Saving fresh HelloToby cookies...");
await saveHelloTobyCookies(JSON.stringify(freshCookies), "derekho1155@gmail.com");
console.log("✅ Cookies saved!");
process.exit(0);
