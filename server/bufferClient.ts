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

/** Stable public URL Buffer can fetch (Forge storage URLs are auth-gated). */
export function publicLinkedInAssetUrl(assetId: number): string {
  const base = ENV.publicBaseUrl || "https://jdsys.biz";
  return `${base}/api/public/linkedin-asset/${assetId}`;
}

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

/** Cancel / remove a queued Buffer post by id. */
export async function deleteBufferPost(
  postId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!isBufferConfigured()) {
      return { ok: false, error: "BUFFER_ACCESS_TOKEN 未設定" };
    }
    if (!postId?.trim()) {
      return { ok: false, error: "缺少 Buffer post id" };
    }
    const data = await bufferGql<{
      deletePost: { id?: string; message?: string };
    }>(
      `mutation Delete($input: DeletePostInput!) {
        deletePost(input: $input) {
          ... on DeletePostSuccess { id }
          ... on VoidMutationError { message }
          ... on MutationError { message }
        }
      }`,
      { input: { id: postId } }
    );
    const payload = data.deletePost as any;
    if (payload?.id || payload?.__typename === "DeletePostSuccess") {
      return { ok: true };
    }
    // Some Buffer responses only confirm via empty success union
    if (!payload?.message) return { ok: true };
    return { ok: false, error: payload.message || "Buffer deletePost 失敗" };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export type BufferPostMetric = {
  type: string;
  name: string;
  value: number;
  unit: string;
};

function metricsToMap(metrics: BufferPostMetric[] | undefined | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of metrics ?? []) {
    if (!m?.type) continue;
    out[m.type] = Number(m.value) || 0;
  }
  return out;
}

/** Per-post metrics from Buffer (LinkedIn impressions/reactions/etc.). Freshness ~daily. */
export async function fetchBufferPostMetrics(postId: string): Promise<{
  ok: true;
  metrics: Record<string, number>;
  metricsUpdatedAt: string | null;
  list: BufferPostMetric[];
} | {
  ok: false;
  error: string;
}> {
  try {
    if (!isBufferConfigured()) return { ok: false, error: "BUFFER_ACCESS_TOKEN 未設定" };
    if (!postId?.trim()) return { ok: false, error: "缺少 Buffer post id" };

    const data = await bufferGql<{
      post: {
        id: string;
        metrics: BufferPostMetric[] | null;
        metricsUpdatedAt: string | null;
      } | null;
    }>(
      `query PostMetrics($id: PostId!) {
        post(input: { id: $id }) {
          id
          metrics { type name value unit }
          metricsUpdatedAt
        }
      }`,
      { id: postId }
    );

    if (!data.post) return { ok: false, error: "Buffer 找不到該 post（可能未發送或已刪）" };
    const list = data.post.metrics ?? [];
    return {
      ok: true,
      metrics: metricsToMap(list),
      metricsUpdatedAt: data.post.metricsUpdatedAt ?? null,
      list,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Week/channel rollup via Buffer aggregatedPostMetrics (LinkedIn channel only). */
export async function fetchAggregatedLinkedInMetrics(opts: {
  startDateTime: Date;
  endDateTime: Date;
}): Promise<{
  ok: true;
  organizationId: string;
  channelId: string;
  metrics: Record<string, number>;
  metricsUpdatedAt: string | null;
} | {
  ok: false;
  error: string;
}> {
  try {
    if (!isBufferConfigured()) return { ok: false, error: "BUFFER_ACCESS_TOKEN 未設定" };
    const { organizationId } = await listBufferChannels();
    const { channelId } = await resolveLinkedInChannelId();

    const data = await bufferGql<{
      aggregatedPostMetrics: {
        metrics: BufferPostMetric[];
        metricsUpdatedAt: string | null;
      };
    }>(
      `query Agg($input: AggregatedPostMetricsInput!) {
        aggregatedPostMetrics(input: $input) {
          metrics { type name value unit }
          metricsUpdatedAt
        }
      }`,
      {
        input: {
          organizationId,
          startDateTime: opts.startDateTime.toISOString(),
          endDateTime: opts.endDateTime.toISOString(),
          channelIds: [channelId],
        },
      }
    );

    const agg = data.aggregatedPostMetrics;
    return {
      ok: true,
      organizationId,
      channelId,
      metrics: metricsToMap(agg?.metrics),
      metricsUpdatedAt: agg?.metricsUpdatedAt ?? null,
    };
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
