import * as React from "react";
import { getOrganizationBranding } from "./api";
import { applyBrandingPalette } from "./apply-branding";
import { defaultBrandingPalette } from "./presets";
import type { OrganizationBranding } from "./types";

type BrandingContextValue = {
  branding: OrganizationBranding | null;
  setOrganizationId: (organizationId: string | null) => void;
};

const BrandingContext = React.createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [organizationId, setOrganizationId] = React.useState<string | null>(null);
  const [branding, setBranding] = React.useState<OrganizationBranding | null>(null);

  React.useEffect(() => {
    let active = true;
    applyBrandingPalette(defaultBrandingPalette);
    setBranding(null);
    if (!organizationId) return () => undefined;

    void getOrganizationBranding(organizationId)
      .then((nextBranding) => {
        if (!active) return;
        setBranding(nextBranding);
        applyBrandingPalette(nextBranding.palette);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [organizationId]);

  const value = React.useMemo(() => ({ branding, setOrganizationId }), [branding]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const context = React.useContext(BrandingContext);
  return context ?? { branding: null, setOrganizationId: () => undefined };
}
