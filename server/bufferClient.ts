/**
 * Buffer GraphQL client — schedule posts to LinkedIn via Buffer.
 * Docs: https://developers.buffer.com
 */
import { ENV } from "./_core/env";

const BUFFER_API = "https://api.buffer.com";

export type BufferChannel = {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  type: string;
  isDisconnected: boolean;
};

export type BufferCreateResult = {
  ok: true;
  postId: string;
  dueAt: string | null;
  status: string | null;
} | {
  ok: false;
  error: string;
};

type GqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

function getToken(): string {
  const t = ENV.bufferAccessToken?.trim();
  if (!t) throw new Error("BUFFER_ACCESS_TOKEN 未設定");
  return t;
}

async function bufferGql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as GqlResponse<T>;
  if (!res.ok) {
    throw new Error(`Buffer HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new Error("Buffer: empty response");
  return json.data;
}

export function isBufferConfigured(): boolean {
  return Boolean(ENV.bufferAccessToken?.trim());
}

/** List channels for the first organization; prefer LinkedIn. */
export async function listBufferChannels(): Promise<{
  organizationId: string;
  channels: BufferChannel[];
}> {
  const acct = await bufferGql<{
    account: { organizations: Array<{ id: string; name: string }> };
  }>(`query { account { organizations { id name } } }`);

  const org = acct.account.organizations?.[0];
  if (!org) throw new Error("Buffer: 帳戶未有 organization");

  const ch = await bufferGql<{ channels: BufferChannel[] }>(
    `query Channels($organizationId: OrganizationId!) {
      channels(input: { organizationId: $organizationId }) {
        id name displayName service type isDisconnected
      }
    }`,
    { organizationId: org.id }
  );

  return { organizationId: org.id, channels: ch.channels ?? [] };
}

let cachedLinkedInChannelId: string | null = null;

export async function resolveLinkedInChannelId(): Promise<{
  channelId: string;
  displayName: string;
  service: string;
  type: string;
}> {
  const configured = ENV.bufferLinkedInChannelId?.trim();
  if (configured) {
    cachedLinkedInChannelId = configured;
    return {
      channelId: configured,
      displayName: "configured",
      service: "linkedin",
      type: "unknown",
    };
  }
  if (cachedLinkedInChannelId) {
    return {
      channelId: cachedLinkedInChannelId,
      displayName: "cached",
      service: "linkedin",
      type: "unknown",
    };
  }

  const { channels } = await listBufferChannels();
  const linkedin = channels.find(
    (c) => c.service === "linkedin" && !c.isDisconnected
  );
  if (!linkedin) {
    throw new Error("Buffer: 找不到已連接的 LinkedIn channel，請先喺 Buffer 連 LinkedIn");
  }
  cachedLinkedInChannelId = linkedin.id;
  return {
    channelId: linkedin.id,
    displayName: linkedin.displayName || linkedin.name,
    service: linkedin.service,
    type: linkedin.type,
  };
}

export type ScheduleToBufferParams = {
  text: string;
  /** ISO datetime (UTC) — customScheduled dueAt */
  dueAt: Date;
  /** Public image URLs (max 9 for LinkedIn via Buffer) */
  imageUrls?: string[];
};

/**
 * Create a scheduled Buffer post → auto-publishes to LinkedIn at dueAt.
 */
export async function schedulePostToBuffer(
  params: ScheduleToBufferParams
): Promise<BufferCreateResult> {
  try {
    if (!isBufferConfigured()) {
      return { ok: false, error: "BUFFER_ACCESS_TOKEN 未設定" };
    }

    const { channelId } = await resolveLinkedInChannelId();
    const dueAt = params.dueAt.toISOString();
    const now = Date.now();
    if (params.dueAt.getTime() < now - 60_000) {
      return { ok: false, error: "排程時間已過，請改 scheduledFor 後再推 Buffer" };
    }

    const assets = (params.imageUrls ?? [])
      .filter(Boolean)
      .slice(0, 9)
      .map((url) => ({ image: { url } }));

    const data = await bufferGql<{
      createPost:
        | { post?: { id: string; dueAt: string | null; status: string | null }; message?: string }
        | { message: string };
    }>(
      `mutation Create($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess {
            post { id dueAt status }
          }
          ... on MutationError {
            message
          }
        }
      }`,
      {
        input: {
          text: params.text,
          channelId,
          schedulingType: "automatic",
          mode: "customScheduled",
          dueAt,
          assets,
        },
      }
    );

    const payload = data.createPost as any;
    if (payload?.post?.id) {
      return {
        ok: true,
        postId: String(payload.post.id),
        dueAt: payload.post.dueAt ?? dueAt,
        status: payload.post.status ?? "scheduled",
      };
    }
    return { ok: false, error: payload?.message || "Buffer createPost 失敗" };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function getBufferLinkedInMeta(): Promise<{
  configured: boolean;
  channelId: string | null;
  displayName: string | null;
  type: string | null;
  error: string | null;
}> {
  if (!isBufferConfigured()) {
    return {
      configured: false,
      channelId: null,
      displayName: null,
      type: null,
      error: "未設定 BUFFER_ACCESS_TOKEN",
    };
  }
  try {
    const { channels } = await listBufferChannels();
    const preferred = ENV.bufferLinkedInChannelId?.trim();
    const ch =
      (preferred && channels.find((c) => c.id === preferred)) ||
      channels.find((c) => c.service === "linkedin" && !c.isDisconnected) ||
      null;
    if (!ch) {
      return {
        configured: true,
        channelId: preferred || null,
        displayName: null,
        type: null,
        error: "找不到 LinkedIn channel",
      };
    }
    return {
      configured: true,
      channelId: ch.id,
      displayName: ch.displayName || ch.name,
      type: ch.type,
      error: ch.isDisconnected ? "LinkedIn channel 已斷線，請喺 Buffer 重新連接" : null,
    };
  } catch (err: any) {
    return {
      configured: true,
      channelId: null,
      displayName: null,
      type: null,
      error: err?.message || String(err),
    };
  }
}
