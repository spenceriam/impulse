# Storage Specification

> File-based persistence layer for sessions, messages, todos, and configuration

Generated: 01-19-2026

---

## Overview

The Storage module provides a simple key-value abstraction over the filesystem. All data is stored as JSON files in the user's config directory.

---

## Directory Structure

```
~/.config/glm-cli/
├── config.json              # User configuration
├── logs/                    # Log files
│   └── glm-cli.log
└── storage/                 # Persisted data
    ├── migration            # Migration version number
    ├── session/
    │   └── {projectID}/
    │       └── {sessionID}.json
    ├── message/
    │   └── {sessionID}/
    │       └── {messageID}.json
    ├── part/
    │   └── {messageID}/
    │       └── {partID}.json
    ├── todo/
    │   └── {sessionID}.json
    └── session_diff/
        └── {sessionID}.json
```

---

## Source Structure

```
src/
├── storage/
│   ├── index.ts          # Re-exports
│   └── storage.ts        # Storage namespace with read/write/list/remove
```

---

## Core API

### Storage Namespace

```typescript
// src/storage/storage.ts
import z from "zod"
import path from "path"
import fs from "fs/promises"

export namespace Storage {
  // Error for missing resources
  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({ message: z.string() })
  )

  /**
   * Read a JSON file from storage
   * @param key - Path segments, e.g., ["todo", sessionID]
   * @returns Parsed JSON content or throws NotFoundError
   */
  export async function read<T>(key: string[]): Promise<T>

  /**
   * Write a JSON file to storage
   * @param key - Path segments
   * @param content - Data to serialize as JSON
   */
  export async function write<T>(key: string[], content: T): Promise<void>

  /**
   * Update a JSON file in place
   * @param key - Path segments
   * @param fn - Mutation function applied to current content
   * @returns Updated content
   */
  export async function update<T>(
    key: string[], 
    fn: (draft: T) => void
  ): Promise<T>

  /**
   * Remove a JSON file from storage
   * @param key - Path segments
   */
  export async function remove(key: string[]): Promise<void>

  /**
   * List all keys under a prefix
   * @param prefix - Path segments to search under
   * @returns Array of full key paths
   */
  export async function list(prefix: string[]): Promise<string[][]>
}
```

---

## Implementation Details

### Key to Path Mapping

```typescript
function keyToPath(key: string[]): string {
  const storageDir = path.join(Global.Path.data, "storage")
  return path.join(storageDir, ...key) + ".json"
}

// Examples:
// ["todo", "session123"] -> ~/.config/glm-cli/storage/todo/session123.json
// ["session", "proj1", "sess1"] -> ~/.config/glm-cli/storage/session/proj1/sess1.json
```

### File Locking

Use read/write locks to prevent corruption from concurrent access:

```typescript
import { Lock } from "../util/lock"

export async function read<T>(key: string[]): Promise<T> {
  const target = keyToPath(key)
  using _ = await Lock.read(target)  // Shared lock
  const content = await Bun.file(target).json()
  return content as T
}

export async function write<T>(key: string[], content: T): Promise<void> {
  const target = keyToPath(key)
  using _ = await Lock.write(target)  // Exclusive lock
  await Bun.write(target, JSON.stringify(content, null, 2))
}
```

### Error Handling

```typescript
async function withErrorHandling<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body()
  } catch (e) {
    if (e instanceof Error) {
      const errnoException = e as NodeJS.ErrnoException
      if (errnoException.code === "ENOENT") {
        throw new NotFoundError({ 
          message: `Resource not found: ${errnoException.path}` 
        })
      }
    }
    throw e
  }
}
```

### Directory Creation

Parent directories are created automatically on write:

```typescript
export async function write<T>(key: string[], content: T): Promise<void> {
  const target = keyToPath(key)
  const dir = path.dirname(target)
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(target, JSON.stringify(content, null, 2))
}
```

---

## Usage Examples

### Todo Operations

```typescript
import { Storage } from "../storage"

// Write todos for a session
await Storage.write(["todo", sessionID], [
  { id: "1", content: "Task 1", status: "pending", priority: "high" },
  { id: "2", content: "Task 2", status: "in_progress", priority: "medium" },
])

// Read todos for a session
const todos = await Storage.read<Todo[]>(["todo", sessionID])
  .catch(() => [])  // Return empty array if not found

// Update todos in place
await Storage.update<Todo[]>(["todo", sessionID], (todos) => {
  const todo = todos.find(t => t.id === "1")
  if (todo) todo.status = "completed"
})
```

### Session Operations

```typescript
// Save session info
await Storage.write(["session", projectID, sessionID], {
  id: sessionID,
  title: "Feature implementation",
  time: { created: Date.now(), updated: Date.now() },
})

// List all sessions for a project
const sessionKeys = await Storage.list(["session", projectID])
// Returns: [["session", "proj1", "sess1"], ["session", "proj1", "sess2"], ...]

// Load all sessions
const sessions = await Promise.all(
  sessionKeys.map(key => Storage.read<Session>(key))
)
```

### Message Operations

```typescript
// Save a message
await Storage.write(["message", sessionID, messageID], {
  id: messageID,
  sessionID,
  role: "assistant",
  content: "Here's my response...",
  time: { created: Date.now(), completed: Date.now() },
})

// List messages for a session
const messageKeys = await Storage.list(["message", sessionID])
```

---

## Migration System

Storage supports migrations for schema changes:

```typescript
type Migration = (dir: string) => Promise<void>

const MIGRATIONS: Migration[] = [
  // Migration 0->1: Restructure session storage
  async (dir) => {
    // Move files, transform data, etc.
  },
  // Migration 1->2: Add new fields
  async (dir) => {
    // Add default values to existing records
  },
]

// Run pending migrations on startup
async function runMigrations() {
  const dir = path.join(Global.Path.data, "storage")
  const currentVersion = await readMigrationVersion()
  
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    await MIGRATIONS[i](dir)
    await writeMigrationVersion(i + 1)
  }
}
```

---

## Global Paths

```typescript
// src/global.ts
export namespace Global {
  export namespace Path {
    // Base config directory
    export const config = path.join(os.homedir(), ".config", "glm-cli")
    
    // Data directory (same as config for simplicity)
    export const data = config
    
    // Logs directory
    export const logs = path.join(config, "logs")
  }
}
```

---

## Design Decisions

### Why JSON Files?

1. **Simplicity** - No database setup required
2. **Portability** - Easy to backup, sync, or inspect
3. **Debugging** - Human-readable format
4. **Performance** - Fast enough for typical usage patterns

### Why Key Arrays?

1. **Hierarchical** - Natural mapping to nested directories
2. **Type Safe** - Avoids path injection issues
3. **Portable** - Works across platforms

### Why File Locking?

1. **Concurrency** - Multiple processes may access storage
2. **Integrity** - Prevent partial writes from corruption
3. **Simplicity** - OS-level locking is reliable

---

## Testing

```typescript
import { Storage } from "./storage"

describe("Storage", () => {
  beforeEach(async () => {
    // Use temp directory for tests
    Global.Path.data = await fs.mkdtemp("/tmp/glm-test-")
  })

  it("reads and writes JSON", async () => {
    const data = { foo: "bar", count: 42 }
    await Storage.write(["test", "data"], data)
    
    const result = await Storage.read(["test", "data"])
    expect(result).toEqual(data)
  })

  it("throws NotFoundError for missing files", async () => {
    await expect(Storage.read(["nonexistent"]))
      .rejects.toThrow(Storage.NotFoundError)
  })

  it("lists keys under prefix", async () => {
    await Storage.write(["prefix", "a"], {})
    await Storage.write(["prefix", "b"], {})
    await Storage.write(["other", "c"], {})
    
    const keys = await Storage.list(["prefix"])
    expect(keys).toEqual([["prefix", "a"], ["prefix", "b"]])
  })
})
```

---

## Integration Checklist

- [ ] Create `src/storage/storage.ts` with Storage namespace
- [ ] Create `src/storage/index.ts` with re-exports
- [ ] Create `src/global.ts` with Path configuration
- [ ] Create `src/util/lock.ts` for file locking
- [ ] Implement migration system for future schema changes
- [ ] Add storage initialization to app startup
