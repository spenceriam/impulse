/** Shared terminal presentation density. Semantics never change with density. */
export const PRESENTATION_DENSITIES = ["compact", "comfy"] as const;

export type PresentationDensity = (typeof PRESENTATION_DENSITIES)[number];

export interface DensitySpacing {
  transcriptGap: 0 | 1;
  blockGap: 0 | 1;
  overlayGap: 0 | 1;
}

export function normalizePresentationDensity(value: unknown): PresentationDensity {
  return value === "comfy" ? "comfy" : "compact";
}

export function densitySpacing(density: PresentationDensity): DensitySpacing {
  const gap = density === "comfy" ? 1 : 0;
  return {
    transcriptGap: gap,
    blockGap: gap,
    overlayGap: gap,
  };
}

function isEmptyOverlayChrome(line: string): boolean {
  const plain = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  return plain.trim().length === 0 || /^[│┃|]\s*[│┃|]$/.test(plain);
}

/** Remove spacer-only overlay rows in compact mode without changing content. */
export function applyOverlayDensity(
  lines: readonly string[],
  density: PresentationDensity
): string[] {
  if (density === "comfy") return [...lines];
  return lines.filter((line) => !isEmptyOverlayChrome(line));
}
