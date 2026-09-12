import JSZip from "jszip";
import { writeFileSync } from "fs";
import { extractTextFromEmailAttachments } from "../server/emailPdfAttachments";
import {
  mentionsRequirementsAttachment,
  resolveAttachmentUnderstanding,
} from "../shared/emailAttachmentUnderstanding";

async function main() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  const rels = zip.folder("_rels");
  rels?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  const word = zip.folder("word");
  word?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>iFX EXPO Asia 2026 photography and videography brief: 2 photographers, 1 videographer, 8 hours.</w:t></w:r></w:p></w:body>
</w:document>`
  );
  const docx = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

  const phrases = [
    "Please see the attachment for details",
    "I have attached the RFQ",
    "PFA the shot list",
    "請查收附件",
    "附上需求說明",
    "We need 3 hours photography",
  ];
  const phraseTable = phrases
    .map((p) => `| ${p} | ${mentionsRequirementsAttachment(p) ? "YES" : "no"} |`)
    .join("\n");

  const extracted = await extractTextFromEmailAttachments([
    {
      filename: "ifx-brief.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: docx,
    },
    {
      filename: "budget.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: Buffer.from("x"),
    },
    {
      filename: "old-brief.doc",
      contentType: "application/msword",
      content: Buffer.from("x"),
    },
  ]);

  const used = resolveAttachmentUnderstanding({
    subject: "iFX EXPO",
    bodyText: "Please see the attachment for details",
    attachmentText: extracted.combinedText,
    attachmentFileCount: extracted.attachmentCount,
    unsupportedFiles: extracted.skippedAttachments.map((s) => s.filename),
  });
  const unsupportedOnly = resolveAttachmentUnderstanding({
    subject: "iFX EXPO",
    bodyText: "Please quote as discussed.",
    attachmentText: "",
    attachmentFileCount: 0,
    unsupportedFiles: ["old-brief.doc"],
  });
  const trueNone = resolveAttachmentUnderstanding({
    subject: "iFX EXPO",
    bodyText: "Please quote as discussed.",
    attachmentText: "",
    attachmentFileCount: 0,
  });

  const md = `# Email attachment understanding — verification

## Mention regex (relaxed)

| phrase | matched |
|---|---|
${phraseTable}

## Word (.docx) extraction

- wordCount: ${extracted.wordCount}
- combinedText includes brief: ${extracted.combinedText.includes("iFX EXPO Asia 2026")}
- text snippet: ${extracted.combinedText.slice(0, 200).replace(/\n/g, " ")}

## Skipped / unsupported recorded

${extracted.skippedAttachments.map((s) => `- ${s.filename} (${s.reason})`).join("\n")}

## Gate status

| case | status |
|---|---|
| docx text + see attachment | ${used.status} |
| only legacy .doc present | ${unsupportedOnly.status} |
| no files / no mention (true none) | ${trueNone.status} |
`;
  writeFileSync("/opt/cursor/artifacts/email-attachment-understanding-verify.md", md);
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
