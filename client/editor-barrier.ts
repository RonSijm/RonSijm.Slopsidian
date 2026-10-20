import { Compartment, EditorState, Prec, type Extension, type StateEffect } from "@codemirror/state";

/** History commands bypass transaction filters; a temporary readOnly facet blocks them without discarding history. */
export class MutationLock {
  private readonly compartment = new Compartment();
  private readonly readOnly = Prec.highest(EditorState.readOnly.of(true));
  private held = false;

  get locked(): boolean { return this.held; }

  extension(): Extension { return this.compartment.of(this.held ? this.readOnly : []); }

  set(locked: boolean): StateEffect<unknown> {
    this.held = locked;
    return this.compartment.reconfigure(locked ? this.readOnly : []);
  }
}
