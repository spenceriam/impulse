import z from "zod";

export namespace BusEvent {
  export interface Definition<T extends z.ZodType> {
    name: string;
    schema: T;
  }

  export function define<T extends z.ZodType>(
    name: string,
    schema: T
  ): Definition<T> {
    return { name, schema };
  }

  export type BusEventPayload<T extends BusEvent.Definition<any>> =
    z.infer<T["schema"]>;
}

type Listener = (event: { type: string; properties: unknown }) => void;

class BusImpl {
  private listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish<T extends BusEvent.Definition<z.ZodType>>(
    event: T,
    properties: z.infer<T["schema"]>
  ): void {
    event.schema.parse(properties);

    for (const listener of this.listeners) {
      try {
        listener({ type: event.name, properties });
      } catch (error) {
        console.error(`Bus listener failed for "${event.name}":`, error);
      }
    }
  }

  /**
   * Simple event emission without schema validation
   * Useful for dynamic event names like PTY events
   */
  emit(type: string, properties: unknown = {}): void {
    for (const listener of this.listeners) {
      try {
        listener({ type, properties });
      } catch (error) {
        console.error(`Bus listener failed for "${type}":`, error);
      }
    }
  }
}

export const Bus = new BusImpl();
