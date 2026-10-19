import type { SimEvent } from "./types";

export class EventLog {
  private nextId = 1;
  private events: SimEvent[] = [];
  private subscribers = new Set<(event: SimEvent) => void>();

  constructor(private readonly capacity = 20000) {}

  emit(partial: Omit<SimEvent, "id">): SimEvent {
    const event: SimEvent = { id: this.nextId, ...partial };
    this.nextId += 1;
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
    for (const subscriber of this.subscribers) subscriber(event);
    return event;
  }

  get all(): readonly SimEvent[] {
    return this.events;
  }

  get lastId(): number {
    return this.nextId - 1;
  }

  get count(): number {
    return this.events.length;
  }

  since(id: number): SimEvent[] {
    return this.events.filter((event) => event.id > id);
  }

  byCategory(category: SimEvent["category"]): SimEvent[] {
    return this.events.filter((event) => event.category === category);
  }

  subscribe(fn: (event: SimEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  clear(): void {
    this.events = [];
  }
}
