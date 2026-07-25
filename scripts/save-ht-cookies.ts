/**
 * One-time script to save HelloToby session cookies to the database.
 * Run: npx tsx scripts/save-ht-cookies.ts
 */
import { saveHelloTobyCookies } from "../server/db";

const keyCookies = [
  { name: "nfcountry", value: "HK", domain: "www.hellotoby.com" },
  { name: "nfsession", value: "9a8a93d9-8690-4cd4-9c7a-18b98be786cd", domain: "www.hellotoby.com" },
  { name: "localeId", value: "zh-hk", domain: "www.hellotoby.com" },
  { name: "nftoken", value: "060eb77995a1fe550ba86dd52cccddc99c6341c1b014439ef27dce90eb64dd6b", domain: "www.hellotoby.com" },
];

const cookiesJson = JSON.stringify(keyCookies);
console.log("Saving HelloToby cookies to database...");
console.log("Cookies:", keyCookies.map((c) => c.name).join(", "));

await saveHelloTobyCookies(cookiesJson, "derekho1155@gmail.com");
console.log("✅ HelloToby cookies saved successfully!");
process.exit(0);
