import { ImapFlow } from "imapflow";
import * as dotenv from "dotenv";
dotenv.config();

async function testManusBillingEmails() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  
  if (!gmailUser || !gmailPassword) {
    console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD");
    process.exit(1);
  }

  console.log(`Connecting to Gmail as ${gmailUser}...`);
  
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: gmailUser, pass: gmailPassword },
    logger: false,
  });

  await client.connect();
  console.log("Connected!");

  const lock = await client.getMailboxLock("INBOX");
  try {
    // Search for Manus billing emails
    const searches = [
      'FROM "manus.im"',
      'FROM "stripe.com" SUBJECT "manus"',
      'SUBJECT "receipt" SUBJECT "manus"',
      'SUBJECT "Your Manus"',
      'FROM "receipts@stripe.com"',
    ];

    for (const searchQuery of searches) {
      console.log(`\nSearching: ${searchQuery}`);
      try {
        const uids = await client.search({ text: searchQuery } as any);
        console.log(`  Found ${uids.length} messages`);
        
        if (uids.length > 0) {
          // Read the first message
          const uid = uids[uids.length - 1]; // latest
          for await (const msg of client.fetch([uid], { 
            envelope: true, 
            bodyStructure: true,
            source: true 
          })) {
            console.log(`  Subject: ${msg.envelope?.subject}`);
            console.log(`  From: ${msg.envelope?.from?.[0]?.address}`);
            console.log(`  Date: ${msg.envelope?.date}`);
            // Print first 500 chars of source
            const sourceStr = msg.source?.toString() || "";
            console.log(`  Source preview: ${sourceStr.substring(0, 500)}`);
          }
        }
      } catch (e: any) {
        console.log(`  Error: ${e.message}`);
      }
    }
  } finally {
    lock.release();
  }

  await client.logout();
}

testManusBillingEmails().catch(console.error);
