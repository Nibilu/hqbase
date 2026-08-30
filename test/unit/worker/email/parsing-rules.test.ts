import { describe, expect, it } from "vitest";

import type { ParsedEmail } from "../../../../worker/email/parse-email";
import { applyParsingRules } from "../../../../worker/email/parsing-rules";

const email: ParsedEmail = {
  headers: { "x-internal-score": "9" },
  fromAddress: "sender@example.com",
  fromName: null,
  to: [],
  cc: [],
  bcc: [],
  subject: "Invoice 123",
  date: null,
  messageId: null,
  inReplyTo: null,
  references: [],
  textBody: "body",
  htmlBody: null,
  snippet: "body",
  attachments: []
};

function database(rows: unknown[]) {
  return {
    prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) })
  } as unknown as D1Database;
}

describe("organization parsing rules", () => {
  it("drops matching headers and returns the action", async () => {
    const result = await applyParsingRules(
      database([
        {
          id: "rule-header",
          match_kind: "header",
          match_spec_json: JSON.stringify({ name: "X-Internal-Score", drop: true }),
          action_kind: "tag",
          action_spec_json: JSON.stringify({ tag: "review" })
        }
      ]),
      "org_default",
      email
    );

    expect(result.parsed.headers).toEqual({});
    expect(result.actions).toEqual([
      { kind: "tag", spec: { tag: "review" }, ruleId: "rule-header" }
    ]);
  });

  it("returns matching reject and webhook actions without side effects", async () => {
    const result = await applyParsingRules(
      database([
        {
          id: "rule-webhook",
          match_kind: "subject_regex",
          match_spec_json: '{"pattern":"invoice","flags":"i"}',
          action_kind: "webhook",
          action_spec_json: '{"event":"invoice.received"}'
        },
        {
          id: "rule-reject",
          match_kind: "subject_regex",
          match_spec_json: '{"pattern":"invoice","flags":"i"}',
          action_kind: "reject",
          action_spec_json: "{}"
        }
      ]),
      "org_default",
      email
    );

    expect(result.actions.map((action) => action.kind)).toEqual(["webhook", "reject"]);
  });
});
