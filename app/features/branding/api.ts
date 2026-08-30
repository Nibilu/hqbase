import { apiGet, apiPut } from "@/lib/api-client";
import type { BrandingPalette, OrganizationBranding } from "./types";

function brandingPath(organizationId: string): string {
  return `/api/organizations/${encodeURIComponent(organizationId)}/branding`;
}

export function getOrganizationBranding(organizationId: string): Promise<OrganizationBranding> {
  return apiGet<OrganizationBranding>(brandingPath(organizationId));
}

export function updateOrganizationBranding(
  organizationId: string,
  input: { palette: BrandingPalette; copyOverrides: Record<string, string> }
): Promise<OrganizationBranding> {
  return apiPut<OrganizationBranding>(brandingPath(organizationId), input);
}
