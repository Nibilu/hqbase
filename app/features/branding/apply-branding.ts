import { brandingPresets, defaultBrandingPalette } from "./presets";
import type { BrandingPalette } from "./types";

const cssVariablePattern = /^--[a-z0-9-]+$/u;
const cssValuePattern = /^[a-z0-9.%(), #+-]+$/iu;

export function applyBrandingPalette(palette: BrandingPalette): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of new Set(brandingPresets.flatMap((preset) => Object.keys(preset.palette)))) {
    root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(defaultBrandingPalette)) {
    root.style.setProperty(name, value);
  }
  for (const [name, value] of Object.entries(palette)) {
    if (cssVariablePattern.test(name) && cssValuePattern.test(value)) {
      root.style.setProperty(name, value);
    }
  }
}

export function brandingCopy(
  branding: { copyOverrides: Record<string, string> } | null,
  key: string,
  fallback: string
): string {
  return branding?.copyOverrides[key] ?? fallback;
}
