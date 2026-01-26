/**
 * File events for formatter integration
 */

import { BusEvent } from "../bus/bus";
import z from "zod";

export const FileEvents = {
  /**
   * Emitted when a file is written or edited
   * Formatters subscribe to this to auto-format files
   */
  Edited: BusEvent.define(
    "file.edited",
    z.object({
      file: z.string().describe("Absolute path to the edited file"),
      isNew: z.boolean().optional().describe("True if this is a newly created file"),
    })
  ),
};
