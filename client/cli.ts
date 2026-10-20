import type { App } from "./app";

export interface CliFlag { value?: string; description: string; required?: boolean }
export type CliFlags = Record<string, CliFlag>;
export type CliData = Record<string, string>;
export type CliHandler = (parameters: CliData) => string | Promise<string>;
interface Registration { description: string; flags: CliFlags | null; handler: CliHandler }

export class Cli {
  private readonly handlers = new Map<string, Registration>();

  constructor(private readonly app: App) {}

  registerHandler(command: string, description: string, flags: CliFlags | null, handler: CliHandler): void {
    if (typeof command !== "string" || !command.trim() || typeof description !== "string" || typeof handler !== "function") {
      throw new Error("CLI handlers require a command, description and callback.");
    }
    if (this.handlers.has(command)) { throw new Error(`Duplicate CLI command: ${command}`); }
    if (flags !== null && (typeof flags !== "object" || Array.isArray(flags) || Object.values(flags).some(flag => !flag || typeof flag.description !== "string" || flag.value !== undefined && typeof flag.value !== "string" || flag.required !== undefined && typeof flag.required !== "boolean"))) {
      throw new Error("CLI flags require descriptions and optional string placeholders/boolean requirements.");
    }
    this.handlers.set(command, { description, flags: flags === null ? null : Object.fromEntries(Object.entries(flags).map(([name, flag]) => [name, { ...flag }])), handler });
  }

  unregisterHandler(command: string, handler: CliHandler): void {
    if (this.handlers.get(command)?.handler === handler) { this.handlers.delete(command); }
  }

  listHandlers(): { command: string; description: string; flags: CliFlags | null }[] {
    return [...this.handlers].map(([command, entry]) => ({
      command, description: entry.description,
      flags: entry.flags === null ? null : Object.fromEntries(Object.entries(entry.flags).map(([name, flag]) => [name, { ...flag }])),
    }));
  }

  async dispatch(command: string, parameters: CliData = {}): Promise<string> {
    if (this.app.changingVault) { throw new Error("Wait for the vault change to finish before running CLI commands."); }
    const entry = this.handlers.get(command);
    if (!entry) { throw new Error(`CLI command is unavailable: ${command}`); }
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || Object.values(parameters).some(value => typeof value !== "string")) {
      throw new Error("CLI parameters must be a record of string values.");
    }
    if (entry.flags) {
      for (const [name, flag] of Object.entries(entry.flags)) {
        if (flag.required && !parameters[name]) { throw new Error(`CLI parameter is required: ${name}`); }
      }
      for (const [name, value] of Object.entries(parameters)) {
        if (!Object.hasOwn(entry.flags, name)) { throw new Error(`Unknown CLI parameter: ${name}`); }
        const flag = entry.flags[name];
        if (flag.value === undefined && value !== "true" && value !== "false") {
          throw new Error(`CLI boolean parameter must be true or false: ${name}`);
        }
      }
    }
    const result = await entry.handler({ ...parameters });
    if (typeof result !== "string") { throw new Error(`CLI command did not return text: ${command}`); }
    return result;
  }
}
