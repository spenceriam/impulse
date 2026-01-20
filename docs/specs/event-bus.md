# Event Bus Specification

> Internal event system for decoupled communication between components

Generated: 01-19-2026

---

## Overview

The event bus enables loose coupling between system components. Tools publish events, and UI contexts subscribe to receive updates. This pattern is essential for real-time UI updates without tight coupling.

---

## Architecture

```
┌─────────────┐     publish      ┌───────────┐     subscribe     ┌─────────────┐
│    Tools    │ ───────────────> │    Bus    │ <──────────────── │  UI Context │
│  (todo.ts)  │                  │  (bus.ts) │                   │  (sync.tsx) │
└─────────────┘                  └───────────┘                   └─────────────┘
       │                               │                               │
       │  Todo.update()                │  Bus.publish()                │  setStore()
       │  Storage.write()              │  Event dispatch               │  Re-render
       └───────────────────────────────┴───────────────────────────────┘
```

---

## Directory Structure

```
src/
├── bus/
│   ├── index.ts          # Re-exports
│   ├── bus.ts            # Bus singleton with publish/subscribe
│   └── events.ts         # Event definitions using BusEvent.define()
```

---

## Core Types

### BusEvent Definition

```typescript
// src/bus/bus.ts
import z from "zod"

export namespace BusEvent {
  export interface Definition<T extends z.ZodType> {
    name: string
    schema: T
  }

  export function define<T extends z.ZodType>(
    name: string,
    schema: T
  ): Definition<T> {
    return { name, schema }
  }
}

export type BusEventPayload<T extends BusEvent.Definition<any>> = 
  z.infer<T["schema"]>
```

### Bus Singleton

```typescript
// src/bus/bus.ts
type Listener = (event: { type: string; properties: unknown }) => void

class BusImpl {
  private listeners: Set<Listener> = new Set()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish<T extends BusEvent.Definition<any>>(
    event: T,
    properties: z.infer<T["schema"]>
  ): void {
    // Validate payload
    event.schema.parse(properties)
    
    // Dispatch to all listeners
    for (const listener of this.listeners) {
      listener({ type: event.name, properties })
    }
  }
}

export const Bus = new BusImpl()
```

---

## Event Definitions

### Todo Events

```typescript
// src/bus/events.ts
import { BusEvent } from "./bus"
import z from "zod"
import { TodoSchema } from "../session/todo"

export const TodoEvents = {
  Updated: BusEvent.define(
    "todo.updated",
    z.object({
      sessionID: z.string(),
      todos: z.array(TodoSchema),
    })
  ),
}
```

### Session Events

```typescript
export const SessionEvents = {
  Updated: BusEvent.define(
    "session.updated",
    z.object({
      info: SessionInfoSchema,
    })
  ),

  Deleted: BusEvent.define(
    "session.deleted",
    z.object({
      info: z.object({ id: z.string() }),
    })
  ),

  Status: BusEvent.define(
    "session.status",
    z.object({
      sessionID: z.string(),
      status: z.enum(["idle", "working", "compacting"]),
    })
  ),

  Diff: BusEvent.define(
    "session.diff",
    z.object({
      sessionID: z.string(),
      diff: z.array(FileDiffSchema),
    })
  ),
}
```

### Message Events

```typescript
export const MessageEvents = {
  Updated: BusEvent.define(
    "message.updated",
    z.object({
      info: MessageInfoSchema,
    })
  ),

  Removed: BusEvent.define(
    "message.removed",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    })
  ),

  PartUpdated: BusEvent.define(
    "message.part.updated",
    z.object({
      part: MessagePartSchema,
    })
  ),
}
```

### MCP Events

```typescript
export const McpEvents = {
  StatusChanged: BusEvent.define(
    "mcp.status",
    z.object({
      server: z.string(),
      status: z.enum(["connected", "failed", "disabled"]),
      error: z.string().optional(),
    })
  ),
}
```

---

## Usage Patterns

### Publishing from Tools

```typescript
// src/session/todo.ts
import { Bus } from "../bus"
import { TodoEvents } from "../bus/events"
import { Storage } from "../storage"

export namespace Todo {
  export async function update(input: { 
    sessionID: string
    todos: Todo[] 
  }) {
    // 1. Persist to storage
    await Storage.write(["todo", input.sessionID], input.todos)
    
    // 2. Publish event for UI update
    Bus.publish(TodoEvents.Updated, input)
  }
}
```

### Subscribing in UI Context

```typescript
// src/ui/context/sync.tsx
import { Bus } from "../../bus"
import { onMount, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"

export function SyncProvider(props: { children: any }) {
  const [store, setStore] = createStore({
    todo: {} as Record<string, Todo[]>,
    // ... other state
  })

  onMount(() => {
    const unsubscribe = Bus.subscribe((event) => {
      switch (event.type) {
        case "todo.updated":
          setStore(
            "todo",
            event.properties.sessionID,
            reconcile(event.properties.todos)
          )
          break
        
        case "session.updated":
          // Handle session update
          break
        
        // ... other events
      }
    })

    onCleanup(unsubscribe)
  })

  return (
    <SyncContext.Provider value={{ data: store, set: setStore }}>
      {props.children}
    </SyncContext.Provider>
  )
}
```

---

## Design Decisions

### Why a Simple Pub/Sub?

1. **Decoupling** - Tools don't know about UI components
2. **Testability** - Easy to mock for unit tests
3. **Simplicity** - No complex event routing or middleware
4. **Performance** - Synchronous dispatch, no async overhead

### Why Zod Validation?

1. **Type Safety** - Compile-time type checking
2. **Runtime Validation** - Catch malformed events early
3. **Documentation** - Schema serves as event documentation

### Why Not EventEmitter?

1. **Type Safety** - Native EventEmitter has weak typing
2. **Validation** - No built-in payload validation
3. **Consistency** - Match Zod patterns used elsewhere

---

## Testing

```typescript
// Example test
import { Bus, BusEvent } from "./bus"
import z from "zod"

describe("Bus", () => {
  it("publishes events to subscribers", () => {
    const TestEvent = BusEvent.define("test", z.object({ value: z.number() }))
    const received: unknown[] = []
    
    Bus.subscribe((e) => received.push(e))
    Bus.publish(TestEvent, { value: 42 })
    
    expect(received).toEqual([{ type: "test", properties: { value: 42 } }])
  })

  it("validates event payload", () => {
    const TestEvent = BusEvent.define("test", z.object({ value: z.number() }))
    
    expect(() => {
      Bus.publish(TestEvent, { value: "not a number" } as any)
    }).toThrow()
  })
})
```

---

## Integration Checklist

- [ ] Create `src/bus/bus.ts` with BusEvent and Bus
- [ ] Create `src/bus/events.ts` with all event definitions
- [ ] Create `src/bus/index.ts` with re-exports
- [ ] Update `src/session/todo.ts` to publish events
- [ ] Update `src/ui/context/sync.tsx` to subscribe to events
- [ ] Add bus to Storage operations for session/message events
