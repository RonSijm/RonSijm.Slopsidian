import { reportError } from "./dom";

type Callback = (...args: unknown[]) => unknown;

export interface EventRef {
  emitter: Events;
  e: Events;
  name: string;
  callback: Callback;
  context?: unknown;
}

export class Events {
  private readonly listeners = new Set<EventRef>();

  on(name: string, callback: Callback, context?: unknown): EventRef {
    const reference = { emitter: this, e: this, name, callback, context };
    this.listeners.add(reference);
    return reference;
  }

  off(name: string, callback: Callback): void {
    for (const reference of this.listeners) {
      if (reference.name === name && reference.callback === callback) {
        this.listeners.delete(reference);
      }
    }
  }

  offref(reference: EventRef): void {
    this.listeners.delete(reference);
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const reference of [...this.listeners]) {
      if (reference.name === name) {
        try {
          Promise.resolve(reference.callback.apply(reference.context, args)).catch(reportError);
        } catch (error) {
          reportError(error);
        }
      }
    }
  }
}
