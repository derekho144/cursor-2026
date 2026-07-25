/**
 * Batch clean all freehunter_jobs.client_name values using the same
 * cleanClientName() logic as the email sender.
 *
 * Run: node scripts/clean-client-names.mjs
 */

import { createConnection } from "mysql2/promise";

const FH_NAME_PREFIX_WORDS = [
  "reels", "reel", "photo", "photos", "photography", "photographer",
  "video", "videos", "videography", "videographer", "film", "films", "filmmaker",
  "studio", "studios", "production", "productions", "media", "creative",
  "design", "designs", "designer", "art", "arts", "artist",
  "drone", "aerial", "360", "vr", "live", "event", "events",
  "wedding", "portrait", "commercial", "corporate",
  "management", "manager", "marketing", "content", "social", "digital",
  "brand", "branding", "agency", "freelance", "freelancer", "consultant",
  "director", "editor", "coordinator", "executive", "officer",
  "hk", "hong", "kong",
  "channel", "specialist", "creator", "new", "youtube", "instagram", "tiktok",
  "project", "service", "services", "solution", "solutions",
  "team", "group", "company", "co", "ltd", "limited",
  "professional", "pro", "expert", "senior", "junior",
  "and", "or", "for", "of", "the", "a", "an", "with", "in", "on", "at", "by", "to",
  "online", "web", "mobile", "app", "platform",
  "sme", "spot", "spots", "revamp", "filter", "enhance",
  "host", "booking", "book",
  // Interior/design related
  "interior", "exterior", "architect", "architecture",
];

const FH_PREFIX_SET = new Set(FH_NAME_PREFIX_WORDS.map(w => w.toLowerCase()));

// Prefixes to EXCLUDE from Step 4 to avoid false-matching real names
const FH_STEP4_EXCLUDED = new Set(["and", "or", "for", "of", "the", "a", "an", "with", "in", "on", "at", "by", "to", "co", "vr"]);

function cleanClientName(raw) {
  if (!raw || !raw.trim()) return "Sir/Madam";
  let name = raw.trim();

  // Step 1: Strip leading CJK block
  name = name.replace(/^[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u3010-\u301f\u3040-\u309f\u30a0-\u30ff]+/, "").trim();

  // Step 1b: Extract last English name segment if CJK appears in the middle
  const cjkInMiddle = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u3010-\u301f\u3040-\u309f\u30a0-\u30ff]/;
  if (cjkInMiddle.test(name)) {
    const segments = name.split(/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u3010-\u301f\u3040-\u309f\u30a0-\u30ff]+/);
    const lastEnglish = segments[segments.length - 1].trim();
    if (lastEnglish && lastEnglish.length > 1) {
      name = lastEnglish;
    }
  }

  // Step 1c: Strip leading truncated fragments (1-2 chars followed by a space)
  // ONLY if the NEXT word is a known prefix word
  {
    const firstSpaceIdx = name.indexOf(" ");
    if (firstSpaceIdx > 0 && firstSpaceIdx <= 2) {
      const rest = name.slice(firstSpaceIdx + 1).trim();
      const secondWord = rest.split(/\s+/)[0] || "";
      if (FH_PREFIX_SET.has(secondWord.toLowerCase())) {
        name = rest;
      }
    }
  }

  // Step 2: Strip known prefix words (space-separated or concatenated before uppercase)
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of FH_NAME_PREFIX_WORDS) {
      const reSpaced = new RegExp(`^${prefix}(?=\\s)`, "i");
      const reConcatenated = new RegExp(`^${prefix}(?=[A-Z][a-z])`, "i");
      let after = null;
      if (reSpaced.test(name)) {
        after = name.replace(reSpaced, "").trim();
      } else if (reConcatenated.test(name)) {
        const matchLen = prefix.length;
        const nextChar = name[matchLen];
        if (nextChar && /[A-Z]/.test(nextChar)) {
          after = name.slice(matchLen).trim();
        }
      }
      if (after !== null && after !== name && after.length > 0) {
        name = after;
        changed = true;
        break;
      }
    }
  }

  if (!name) {
    const parts = raw.trim().split(/\s+/);
    name = parts.slice(-2).join(" ");
  }

  // Step 3: If still more than 3 words, take last 2
  const parts = name.split(/\s+/);
  if (parts.length > 3) name = parts.slice(-2).join(" ");

  // Step 4: Final pass — clean concatenated prefix in first word
  // Only use prefixes with length >= 3 to avoid false matches on name initials
  const finalParts = name.split(/\s+/);
  if (finalParts.length > 0) {
    let firstWord = finalParts[0];
    for (const prefix of FH_NAME_PREFIX_WORDS) {
      if (prefix.length < 3) continue;
      if (FH_STEP4_EXCLUDED.has(prefix.toLowerCase())) continue;
      const reConcatenatedAny = new RegExp(`^${prefix}(?=[A-Za-z])`, "i");
      if (reConcatenatedAny.test(firstWord)) {
        const matchLen = prefix.length;
        const nextChar = firstWord[matchLen];
        if (nextChar && /[A-Za-z]/.test(nextChar)) {
          const candidate = firstWord.slice(matchLen);
          if (candidate.length >= 2) {
            firstWord = candidate;
            finalParts[0] = firstWord;
            name = finalParts.join(" ");
            break;
          }
        }
      }
    }
  }

  return name || "Sir/Madam";
}

const conn = await createConnection(process.env.DATABASE_URL);

// Fetch all jobs
const [rows] = await conn.execute("SELECT id, client_name FROM freehunter_jobs");
console.log(`Total records: ${rows.length}`);

let updated = 0;
let skipped = 0;

for (const row of rows) {
  const cleaned = cleanClientName(row.client_name || "");
  if (cleaned !== row.client_name) {
    console.log(`  id=${row.id}: "${row.client_name}" → "${cleaned}"`);
    await conn.execute("UPDATE freehunter_jobs SET client_name = ? WHERE id = ?", [cleaned, row.id]);
    updated++;
  } else {
    skipped++;
  }
}

console.log(`\nDone. Updated: ${updated}, Skipped (unchanged): ${skipped}`);
await conn.end();
