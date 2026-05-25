import { getCachedModelInfos } from "./model-setup.js";
import type { SelectableListRow } from "./components/selectable-list-overlay.js";
import type { ReasoningLevel } from "../util/config.js";

export const MANUAL_MODEL_ROW_ID = "__manual_model__";

/** Build overlay rows for provider setup model selection. */
export function buildModelSetupRows(
  providerKey: string,
  modelIds: string[],
  opts?: { allowManual?: boolean }
): SelectableListRow[] {
  const cached = getCachedModelInfos(providerKey);
  const labelById = new Map(
    (cached ?? []).map((info) => [info.id, info.pickerLine])
  );

  const rows: SelectableListRow[] = modelIds.map((id) => ({
    id,
    label: labelById.get(id) ?? id,
  }));

  if (opts?.allowManual) {
    rows.push({
      id: MANUAL_MODEL_ROW_ID,
      label: "Type custom model ID…",
    });
  }

  return rows;
}

/** Build overlay rows for reasoning level selection during setup. */
export function buildReasoningSetupRows(
  levels: ReasoningLevel[],
  labelFor: (level: ReasoningLevel) => string
): SelectableListRow[] {
  return levels.map((level) => ({
    id: level,
    label: labelFor(level),
  }));
}
