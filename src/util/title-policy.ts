/**
 * One source of truth for session title quality (#139).
 *
 * Both the automatic generator and the agent-facing `set_header` tool must
 * enforce the same hard cap, the same weak/generic rejection, and the same
 * per-project uniqueness rule. The `/resume` picker renders only the title, so
 * two identical titles make sessions indistinguishable.
 */

/** Hard character cap. Deliberately well under the former 60. */
export const TITLE_MAX_LENGTH = 40;

/** Target word range. Outside this band a title is rejected, not silently trimmed. */
export const TITLE_MIN_WORDS = 2;
export const TITLE_MAX_WORDS = 5;

/** How many user turns must exist before the first title is generated. */
export const TITLE_MIN_USER_TURNS = 2;

/** Reconsider an existing title only at multiples of this user-turn count. */
export const TITLE_RETITLE_INTERVAL = 10;

/** Bound on automatic replacements, so a long session cannot churn its title. */
export const TITLE_MAX_AUTO_RETITLES = 3;

/**
 * Labels that carry no information about the work. Short generic titles are as
 * useless as long ones — issue #139 calls this out explicitly.
 */
const GENERIC_TITLE_PATTERNS: RegExp[] = [
  /^(code|general|coding|dev(elopment)?)\s*(help|question|task|work|stuff|discussion|chat)?$/,
  /^(question|questions|discussion|chat|conversation|session|help|task|tasks|work|stuff|misc|miscellaneous|untitled|new session)$/,
  /^(please\s+)?(help|assist|explain)( me)?( with (this|that|it))?$/,
  /^(analysis|review|implementation|refactor|investigation|debugging|testing|setup|configuration)$/,
  /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no)$/,
  /^(test|testing|test session|smoke test|my session)$/,
];

/** Reject answer-echo, numeric-only, generic, and out-of-band session titles. */
export function isWeakHeaderTitle(title: string): boolean {
  const t = normalizeTitle(title);
  if (!t) return true;
  if (t.length < 3) return true;
  if (/^#?\s*[\d.,\s]+$/.test(t)) return true;
  if (/^\d+$/.test(t)) return true;

  const lower = t.toLowerCase();
  if (GENERIC_TITLE_PATTERNS.some((re) => re.test(lower))) return true;

  // Word band. A one-word label cannot identify a conversation; six-plus words
  // is a sentence, which is what the old 60-char cap invited.
  const words = splitTitleWords(t);
  if (words.length < TITLE_MIN_WORDS || words.length > TITLE_MAX_WORDS) return true;

  return false;
}

/** Collapse whitespace and strip list/heading/quote artifacts from a candidate. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/[\r\n\t]+/g, " ")
    .replace(/^[#>*\-\s]+/, "")
    .replace(/["'`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTitleWords(title: string): string[] {
  return title.split(/[\s/]+/).filter(Boolean);
}

/**
 * Hard cap enforcement for a title that is otherwise acceptable. Prefers
 * dropping whole words; falls back to a character cut for a single long token.
 */
export function clampTitle(title: string, max = TITLE_MAX_LENGTH): string {
  const t = normalizeTitle(title);
  if (t.length <= max) return t;

  const words = splitTitleWords(t);
  let out = "";
  for (const word of words) {
    const candidate = out ? `${out} ${word}` : word;
    if (candidate.length > max) break;
    out = candidate;
  }

  if (out) return out;
  return t.slice(0, max).trim();
}

/** Lowercased word set used for topic-shift comparison. */
export function titleWords(title: string): Set<string> {
  return new Set(
    splitTitleWords(normalizeTitle(title).toLowerCase()).filter((w) => w.length > 2)
  );
}

/**
 * Same-topic check used to decide whether an existing title still describes the
 * conversation. Deliberately deterministic and local — no extra LLM call.
 */
export function titlesOverlap(a: string, b: string, threshold = 0.4): boolean {
  const left = titleWords(a);
  const right = titleWords(b);
  if (left.size === 0 || right.size === 0) return false;

  let shared = 0;
  for (const word of left) {
    if (right.has(word)) shared++;
  }

  const union = new Set([...left, ...right]).size;
  return shared / union >= threshold;
}

/** Case-insensitive title key used for collision detection. */
export function titleKey(title: string): string {
  return normalizeTitle(title).toLowerCase();
}

/** Matches the numeric discriminator appended by {@link makeTitleUnique}. */
export const TITLE_DISCRIMINATOR_RE = /\s\((\d+)\)$/;

/**
 * True when two titles are the same label, ignoring a discriminator suffix.
 * Used so re-submitting a title that was stored as "X (2)" is still a no-op.
 */
export function sameTitleBase(a: string, b: string): boolean {
  const strip = (t: string) => titleKey(t).replace(TITLE_DISCRIMINATOR_RE, "");
  const left = strip(a);
  return left.length > 0 && left === strip(b);
}

/**
 * Deterministically disambiguate `candidate` against `taken`.
 *
 * Colliding titles get a numeric suffix (" (2)", " (3)", ...). The suffix is a
 * function of the taken set only, so the same collision always resolves the same
 * way, and the result always respects the hard cap.
 */
export function makeTitleUnique(candidate: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const t of taken) used.add(titleKey(t));

  const base = clampTitle(candidate);
  if (!base) return base;
  if (!used.has(titleKey(base))) return base;

  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const room = TITLE_MAX_LENGTH - suffix.length;
    const stem = base.length > room ? base.slice(0, room).trim() : base;
    const attempt = `${stem}${suffix}`;
    if (!used.has(titleKey(attempt))) return attempt;
  }

  return base;
}

export interface TitlePolicyResult {
  ok: boolean;
  title?: string;
  reason?: string;
}

/**
 * Apply the full policy to a candidate title destined for a specific session.
 *
 * @param candidate   Raw title text (model output or tool input).
 * @param takenTitles Titles of sibling sessions in the same project.
 */
export function applyTitlePolicy(
  candidate: string,
  takenTitles: Iterable<string> = []
): TitlePolicyResult {
  const normalized = normalizeTitle(candidate);
  if (!normalized) {
    return { ok: false, reason: "Title cannot be empty" };
  }

  if (normalized.length > TITLE_MAX_LENGTH) {
    return {
      ok: false,
      reason: `Title must be ${TITLE_MAX_LENGTH} characters or less`,
    };
  }

  if (isWeakHeaderTitle(normalized)) {
    return {
      ok: false,
      reason: `Title must be a specific ${TITLE_MIN_WORDS}-${TITLE_MAX_WORDS} word phrase (e.g. "Heartbeat reconnect loop"), not a generic label, answer, or number.`,
    };
  }

  return { ok: true, title: makeTitleUnique(normalized, takenTitles) };
}

/** Truncate model output to the hard cap before it ever reaches the policy gate. */
export function clampGeneratedTitle(title: string): string {
  return clampTitle(title);
}
