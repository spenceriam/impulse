/** Format a /steer note injected before the model's next action in the same turn. */
export function formatSteeringNote(text: string): string {
  return `[User steering — this overrides prior instructions and system notes in this turn] ${text} — adjust your next action accordingly and briefly acknowledge the change.`;
}
