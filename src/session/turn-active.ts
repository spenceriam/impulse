/** True while the agent loop is executing a user turn (skip mid-turn auto-compact). */

let turnActive = false;

export function setAgentTurnActive(active: boolean): void {
  turnActive = active;
}

export function isAgentTurnActive(): boolean {
  return turnActive;
}
