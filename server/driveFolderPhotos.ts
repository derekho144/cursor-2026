/**
 * List image files in a public Google Drive folder for delivery gallery.
 * Prefers GOOGLE_API_KEY / GOOGLE_DRIVE_API_KEY (Drive API v3).
 * Falls back to parsing embeddedfolderview HTML when possible.
 */

export type DrivePhoto = {
  id: string;
  name: string;
  mimeType: string;
  /** Thumbnail / preview URL suitable for <img> */
  src: string;
  /** Larger preview for lightbox */
  fullSrc: string;
  width: number;
  height: number;
};

export function extractDriveFolderId(url: string): string | null {
  const raw = String(url ?? "");
  const folderMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1]!;
  try {
    const u = new URL(raw);
    const id = u.searchParams.get("id");
    if (id && (u.pathname.includes("embeddedfolderview") || u.pathname.includes("folderview"))) {
      return id;
    }
    if (id && u.hostname.includes("drive.google.com")) return id;
  } catch {
    /* ignore */
  }
  return null;
}

function driveApiKey(): string | null {
  const key =
    process.env.GOOGLE_DRIVE_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    "";
  return key || null;
}

function thumbUrl(fileId: string, size: number): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

function viewUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w2400`;
}

async function listViaDriveApi(folderId: string, apiKey: string): Promise<DrivePhoto[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent(
    "nextPageToken,files(id,name,mimeType,imageMediaMetadata(width,height),videoMediaMetadata)"
  );
  const photos: DrivePhoto[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 8; page++) {
    const tokenQ = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}` +
      `&fields=${fields}&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      `&key=${encodeURIComponent(apiKey)}${tokenQ}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Drive API ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        imageMediaMetadata?: { width?: number; height?: number };
      }>;
    };
    for (const f of data.files ?? []) {
      if (!f.mimeType?.startsWith("image/")) continue;
      const width = f.imageMediaMetadata?.width || 1200;
      const height = f.imageMediaMetadata?.height || 800;
      photos.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        src: thumbUrl(f.id, 1200),
        fullSrc: viewUrl(f.id),
        width,
        height,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return photos;
}

/** Best-effort HTML parse of embeddedfolderview for public folders. */
async function listViaEmbedHtml(folderId: string): Promise<DrivePhoto[]> {
  const url = `https://drive.google.com/embeddedfolderview?id=${folderId}&usp=sharing`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const ids = new Set<string>();
  for (const m of html.matchAll(/\/file\/d\/([a-zA-Z0-9_-]{10,})/g)) {
    ids.add(m[1]!);
  }
  for (const m of html.matchAll(/data-id="([a-zA-Z0-9_-]{20,})"/g)) {
    ids.add(m[1]!);
  }
  // Drive often embeds ids as \x22ID\x22
  for (const m of html.matchAll(/\\x22([a-zA-Z0-9_-]{25,33})\\x22/g)) {
    ids.add(m[1]!);
  }
  // Skip the folder id itself
  ids.delete(folderId);
  return Array.from(ids).slice(0, 200).map((id, i) => ({
    id,
    name: `Photo ${i + 1}`,
    mimeType: "image/jpeg",
    src: thumbUrl(id, 1200),
    fullSrc: viewUrl(id),
    width: 1200,
    height: 800,
  }));
}

export async function listDriveFolderPhotos(folderOrUrl: string): Promise<{
  folderId: string | null;
  photos: DrivePhoto[];
  source: "drive_api" | "embed_html" | "none";
  error?: string;
}> {
  const folderId = extractDriveFolderId(folderOrUrl);
  if (!folderId) {
    return { folderId: null, photos: [], source: "none", error: "no_folder_id" };
  }

  const apiKey = driveApiKey();
  if (apiKey) {
    try {
      const photos = await listViaDriveApi(folderId, apiKey);
      if (photos.length > 0) {
        return { folderId, photos, source: "drive_api" };
      }
    } catch (err: any) {
      // fall through to HTML
      const htmlTry = await listViaEmbedHtml(folderId);
      if (htmlTry.length > 0) {
        return { folderId, photos: htmlTry, source: "embed_html" };
      }
      return {
        folderId,
        photos: [],
        source: "none",
        error: err?.message ?? "drive_api_failed",
      };
    }
  }

  try {
    const photos = await listViaEmbedHtml(folderId);
    if (photos.length > 0) {
      return { folderId, photos, source: "embed_html" };
    }
  } catch (err: any) {
    return {
      folderId,
      photos: [],
      source: "none",
      error: err?.message ?? "embed_html_failed",
    };
  }

  return {
    folderId,
    photos: [],
    source: "none",
    error: apiKey ? "empty_folder" : "missing_GOOGLE_API_KEY",
  };
}
