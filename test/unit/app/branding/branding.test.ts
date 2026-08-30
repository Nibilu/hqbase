// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { applyBrandingPalette, brandingCopy } from "@/features/branding/apply-branding";
import { brandingPresets } from "@/features/branding/presets";

describe("organization branding", () => {
  it("ships two valid palette presets", () => {
    expect(brandingPresets).toHaveLength(2);
    expect(brandingPresets.map((preset) => preset.id)).toEqual(["hqbase", "ocean"]);
  });

  it("applies safe CSS variables and resets omitted defaults", () => {
    document.documentElement.style.setProperty("--ring", "red");
    applyBrandingPalette({ "--primary": "205 84% 38%", "--bad;property": "red" });

    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("205 84% 38%");
    expect(document.documentElement.style.getPropertyValue("--bad;property")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--ring")).toBe("");
  });

  it("uses an organization copy override when one exists", () => {
    expect(
      brandingCopy({ copyOverrides: { "app.title": "Acme Inbox" } }, "app.title", "HQBase")
    ).toBe("Acme Inbox");
    expect(brandingCopy(null, "app.title", "HQBase")).toBe("HQBase");
  });
});
