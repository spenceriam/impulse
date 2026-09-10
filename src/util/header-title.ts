/**
 * Title quality rules now live in ./title-policy.ts (#139) so the automatic
 * generator, `set_header`, and title enrichment share one gate.
 *
 * This re-export is kept so existing importers and tests keep working.
 */
export { isWeakHeaderTitle } from "./title-policy.js";

