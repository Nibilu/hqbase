export type BrandingPalette = Record<string, string>;

export type OrganizationBranding = {
  organizationId: string;
  logoR2Key: string | null;
  logoUrl?: string | null;
  palette: BrandingPalette;
  copyOverrides: Record<string, string>;
  updatedAt: string;
};

export type BrandingPreset = {
  id: string;
  name: string;
  description: string;
  palette: BrandingPalette;
};
