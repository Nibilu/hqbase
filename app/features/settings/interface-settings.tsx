import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { updateOrganizationBranding } from "@/features/branding/api";
import { applyBrandingPalette } from "@/features/branding/apply-branding";
import { useBranding } from "@/features/branding/branding-provider";
import { brandingPresets } from "@/features/branding/presets";
import { SettingsSection } from "@/features/settings/settings-section";
import { useTheme } from "@/features/theme/theme-provider";

export function InterfaceSettings({
  organizationId
}: {
  organizationId?: string | undefined;
}): React.ReactElement {
  const { setTheme, theme } = useTheme();
  const { branding } = useBranding();
  const isDark = theme === "dark";

  return (
    <SettingsSection description="Appearance preferences for this browser" title="Interface">
      <div className="divide-y border-y text-sm">
        <div className="flex items-center justify-between gap-6 py-4">
          <div>
            <p className="font-medium">Dark mode</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Toggle the theme. Stored locally in this browser.
            </p>
          </div>
          <Switch
            aria-label="Dark mode"
            checked={isDark}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
          />
        </div>
      </div>
      <div className="mt-6 space-y-3">
        <div>
          <p className="font-medium">Workspace branding</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose a palette for this organization.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {brandingPresets.map((preset) => (
            <Button
              className="h-auto justify-start px-3 py-3 text-left"
              key={preset.id}
              variant="outline"
              onClick={() => {
                applyBrandingPalette(preset.palette);
                if (!organizationId) return;
                void updateOrganizationBranding(organizationId, {
                  palette: preset.palette,
                  copyOverrides: branding?.copyOverrides ?? {}
                }).then(() => window.location.reload());
              }}
            >
              <span>
                <span className="block font-medium">{preset.name}</span>
                <span className="block text-xs text-muted-foreground">{preset.description}</span>
              </span>
            </Button>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}
