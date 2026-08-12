const commitChains = new Map<string, Promise<unknown>>();
const activeLeases = new Set<symbol>();

export interface SessionCommitLease {
  readonly sessionID: string;
  readonly nonce: symbol;
}

/**
 * Serialize the final promotion window for every file owned by one session.
 * Staging happens outside this lock; validation, rename, and directory fsync
 * happen inside it.
 */
export async function withSessionCommitLock<T>(
  sessionID: string,
  operation: (lease: SessionCommitLease) => Promise<T>
): Promise<T> {
  const previous = commitChains.get(sessionID) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const lease: SessionCommitLease = { sessionID, nonce: Symbol(sessionID) };
    activeLeases.add(lease.nonce);
    try {
      return await operation(lease);
    } finally {
      activeLeases.delete(lease.nonce);
    }
  });
  commitChains.set(sessionID, run);
  try {
    return await run;
  } finally {
    if (commitChains.get(sessionID) === run) commitChains.delete(sessionID);
  }
}

/** Execute under a lease already held by the caller without reacquiring it. */
export async function withSessionCommitLease<T>(
  lease: SessionCommitLease,
  sessionID: string,
  operation: () => Promise<T>
): Promise<T> {
  if (lease.sessionID !== sessionID || !activeLeases.has(lease.nonce)) {
    throw new Error(`Invalid session commit lease for ${sessionID}`);
  }
  return operation();
}
