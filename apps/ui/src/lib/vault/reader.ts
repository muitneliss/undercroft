/**
 * The reader's path through the vault, and the one entry point that advances the film.
 *
 * Six steps from an invitation to a question. The pointer carries the reader along the path,
 * or the reader walks by itself when nobody points, and each step it crosses DOES something to
 * the data -- connecting a source sends from it, a run sends from all of them, asking lifts the
 * report. That is the point of drawing the two together: the user flow is shown as the cause of
 * the data flow, not as a second list beside it.
 */

import { emit, flow, runNow, shape } from "@/lib/vault/flow.ts";
import { SOURCE_COUNT, type StepId, stepAt, type Vault, WALK_START } from "@/lib/vault/model.ts";

const READER_FOLLOW = 6;
const WALK_SPEED = 0.07;
const WALK_END = 1.08;
const ASK_LIFT = 0.08;

/** A step the reader crosses acts on the data. */
export function trigger(vault: Vault, step: StepId): void {
  vault.flares[step] = vault.time;
  switch (step) {
    case "invite":
      vault.reader.signedIn = true;
      break;
    case "connect": {
      const source = Math.floor(vault.random() * SOURCE_COUNT);
      vault.sourceFlares[source] = vault.time;
      emit(vault, source);
      emit(vault, source);
      break;
    }
    case "choose":
      vault.gateAt = vault.time;
      break;
    case "run":
      runNow(vault);
      break;
    case "model":
      shape(vault, Math.max(0, vault.lanes.indexOf(Math.max(...vault.lanes))));
      break;
    default:
      vault.bars.forEach((height, bar) => {
        vault.bars[bar] = Math.min(1, height + ASK_LIFT);
      });
      break;
  }
}

function moveReader(vault: Vault, dt: number, pointer: number | null): void {
  const { reader } = vault;
  if (pointer === null) {
    reader.u += WALK_SPEED * dt;
    if (reader.u > WALK_END) {
      // A new visitor: the walk starts again from before the invitation.
      reader.u = WALK_START;
      reader.signedIn = false;
    }
  } else {
    reader.u += (pointer - reader.u) * (1 - Math.exp(-dt * READER_FOLLOW));
  }
  const step = stepAt(reader.u);
  if (step !== reader.step) {
    reader.step = step;
    if (step !== null) {
      trigger(vault, step);
    }
  }
}

/**
 * One frame. `pointer` is where the visitor points along the path, 0..1, or null to let the
 * reader walk by itself.
 */
export function advance(vault: Vault, dt: number, pointer: number | null): void {
  vault.time += dt;
  moveReader(vault, dt, pointer);
  flow(vault, dt);
}
