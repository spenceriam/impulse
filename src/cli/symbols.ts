/**
 * Terminal status symbols — nerd glyphs only when explicitly enabled.
 */

/** Nerd Fonts v3 — nf-md-eye (Material Design Icons); requires Nerd Font terminal. */
export const VISION_NERD_ICON = "\u{F06D0}";

export const VISION_STATUS_FALLBACK = "(vision)";

export function isNerdIconsEnabled(): boolean {
  const v = process.env.IMPULSE_NERD_ICONS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Suffix after vision model name: nerd eye or ASCII "(vision)". */
export function visionStatusSuffix(nerdIconsEnabled = isNerdIconsEnabled()): string {
  return nerdIconsEnabled ? ` ${VISION_NERD_ICON}` : ` ${VISION_STATUS_FALLBACK}`;
}
