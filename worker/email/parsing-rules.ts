import type { ParsedEmail } from "./parse-email";

export type ParsingRuleAction = {
  kind: "tag" | "assign" | "reject" | "webhook";
  spec: Record<string, unknown>;
  ruleId: string;
};

type RuleRow = {
  id: string;
  match_kind: "header" | "attachment_mime" | "subject_regex";
  match_spec_json: string;
  action_kind: ParsingRuleAction["kind"];
  action_spec_json: string;
};

export async function applyParsingRules(
  db: D1Database,
  organizationId: string,
  parsed: ParsedEmail
): Promise<{ parsed: ParsedEmail; actions: ParsingRuleAction[] }> {
  const result = await db
    .prepare(
      `SELECT id, match_kind, match_spec_json, action_kind, action_spec_json
       FROM parsing_rules
       WHERE organization_id = ? AND enabled = 1
       ORDER BY priority ASC, id ASC`
    )
    .bind(organizationId)
    .all<RuleRow>();
  const headers = { ...(parsed.headers ?? {}) };
  const actions: ParsingRuleAction[] = [];
  for (const rule of result.results ?? []) {
    const spec = parseObject(rule.match_spec_json);
    if (!matches(rule.match_kind, spec, parsed, headers)) continue;
    if (rule.match_kind === "header" && typeof spec.name === "string" && spec.drop === true) {
      delete headers[spec.name.toLowerCase()];
    }
    actions.push({
      kind: rule.action_kind,
      spec: parseObject(rule.action_spec_json),
      ruleId: rule.id
    });
  }
  return { parsed: { ...parsed, headers }, actions };
}

function matches(
  kind: RuleRow["match_kind"],
  spec: Record<string, unknown>,
  parsed: ParsedEmail,
  headers: Record<string, string>
): boolean {
  if (kind === "header") {
    const name = typeof spec.name === "string" ? spec.name.toLowerCase() : "";
    const value = headers[name];
    return value !== undefined && (spec.value === undefined || value === String(spec.value));
  }
  if (kind === "attachment_mime") {
    return parsed.attachments.some(
      (attachment) => attachment.contentType.toLowerCase() === String(spec.mime).toLowerCase()
    );
  }
  if (typeof spec.pattern !== "string") return false;
  try {
    return new RegExp(spec.pattern, typeof spec.flags === "string" ? spec.flags : "").test(
      parsed.subject
    );
  } catch {
    return false;
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
