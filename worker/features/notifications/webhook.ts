import type { WorkerEnv } from "../../lib/env";

export type WebhookEvent = {
  id: string;
  type: string;
  organizationId: string;
  resourceId: string;
  occurredAt: string;
  data: Record<string, unknown>;
};

export async function dispatchOrganizationWebhooks(
  env: WorkerEnv,
  event: WebhookEvent
): Promise<void> {
  const routes = await env.DB.prepare(
    `SELECT endpoint_url, signing_secret_kid FROM audit_subscriptions WHERE organization_id = ? AND enabled = 1`
  )
    .bind(event.organizationId)
    .all<{ endpoint_url: string; signing_secret_kid: string }>();
  const body = JSON.stringify(event);
  await Promise.all(
    (routes.results ?? []).map(async (route) => {
      const url = new URL(route.endpoint_url);
      if (url.protocol !== "https:" || !env.HQBASE_WEBHOOK_SIGNING_KEY) return;
      const signature = await sign(body, env.HQBASE_WEBHOOK_SIGNING_KEY);
      await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "HQBase-Webhook/1",
          "x-hqbase-event-id": event.id,
          "x-hqbase-signature": `sha256=${signature}`,
          "x-hqbase-signing-key-id": route.signing_secret_kid
        },
        body
      });
    })
  );
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
