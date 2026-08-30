import type { BrandingPreset } from "./types";

export const brandingPresets: BrandingPreset[] = [
  {
    id: "hqbase",
    name: "HQBase",
    description: "Neutral, high-contrast workspace colours.",
    palette: {
      "--primary": "0 0% 9%",
      "--primary-foreground": "0 0% 98%",
      "--accent": "0 0% 93%",
      "--accent-foreground": "0 0% 9%"
    }
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Calm blue controls for customer-facing inboxes.",
    palette: {
      "--primary": "205 84% 38%",
      "--primary-foreground": "0 0% 100%",
      "--accent": "204 75% 92%",
      "--accent-foreground": "205 84% 24%",
      "--ring": "205 84% 38%"
    }
  }
];

export const defaultBrandingPalette = brandingPresets[0]?.palette ?? {};
