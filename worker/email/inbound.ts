import type { WorkerEnv } from "../lib/env";
import { resolveInboundRoute } from "./inbound-route";
import { parseRawEmail } from "./parse-email";
import { applyParsingRules } from "./parsing-rules";
import { storeInboundEmail } from "./store-email";

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: WorkerEnv
): Promise<
  | (Awaited<ReturnType<typeof storeInboundEmail>> & {
      webhookActions?: ReturnType<typeof applyParsingRules> extends Promise<infer T>
        ? T extends { actions: infer A }
          ? A
          : never
        : never;
      organizationId?: string;
    })
  | null
> {
  const route = await resolveInboundRoute(env.DB, message.to);
  if (route.action === "reject") {
    message.setReject("Unknown recipient.");
    return null;
  }
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await parseRawEmail(raw);
  const organization = route.mailboxId
    ? await env.DB.prepare(
        "SELECT COALESCE(organization_id, 'org_default') AS id FROM mailboxes WHERE id = ?"
      )
        .bind(route.mailboxId)
        .first<{ id: string }>()
    : { id: "org_default" };
  const customized = await applyParsingRules(env.DB, organization?.id ?? "org_default", parsed);
  if (customized.actions.some((action) => action.kind === "reject")) {
    message.setReject("Rejected by organization mail policy.");
    return null;
  }
  const stored = await storeInboundEmail(env.DB, env.MAIL_OBJECTS, {
    envelopeRecipient: message.to,
    mailboxId: route.mailboxId,
    raw,
    parsed: customized.parsed
  });
  return stored.inserted
    ? {
        ...stored,
        webhookActions: customized.actions.filter((action) => action.kind === "webhook"),
        organizationId: organization?.id ?? "org_default"
      }
    : stored;
}
