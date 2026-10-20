export interface Debouncer<T extends unknown[], V> {
  (...args: T): Debouncer<T, V>;
  cancel(): Debouncer<T, V>;
  run(): V | undefined;
}

export function debounce<T extends unknown[], V>(callback: (...args: T) => V, timeout = 0, resetTimer = false): Debouncer<T, V> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { args: T; receiver: unknown } | undefined;
  const debounced: Debouncer<T, V> = function (this: unknown, ...args: T) {
    pending = { args, receiver: this };
    if (timer !== undefined) {
      if (!resetTimer) { return debounced; }
      clearTimeout(timer);
    }
    timer = setTimeout(() => { debounced.run(); }, timeout);
    return debounced;
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
    return debounced;
  };
  debounced.run = () => {
    const call = pending;
    debounced.cancel();
    if (call) { return callback.apply(call.receiver, call.args); }
  };
  return debounced;
}

interface PromiseTimerOptions {
  signal?: AbortSignal;
  ref?: boolean;
}

function timerAbortError(signal: AbortSignal): Error {
  return Object.assign(new Error("The operation was aborted.", { cause: signal.reason }), { name: "AbortError", code: "ABORT_ERR" });
}

async function promiseTimeout<T = void>(delay = 1, value?: T, options: PromiseTimerOptions = {}): Promise<T | undefined> {
  const { signal, ref } = options;
  if (ref !== undefined && ref !== true) { throw new TypeError("Browser promise timers do not support Node process-liveness options (ref: false)."); }
  if (signal !== undefined && !(signal instanceof AbortSignal)) { throw new TypeError("A promise timer signal must be an AbortSignal."); }
  if (signal?.aborted) { throw timerAbortError(signal); }
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal) { reject(timerAbortError(signal)); }
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(value);
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export const browserPromiseTimers = Object.freeze({ setTimeout: promiseTimeout });
