/**
 * Read/write phase guard.
 *
 * Layout thrash is the one performance mistake this engine cannot absorb: a
 * read interleaved into a write phase forces a second layout of the whole
 * edition. That is invisible in the output and catastrophic in the profile, so
 * in development the phases are declared explicitly and violations are logged
 * with a stack. In production this compiles down to nothing worth noticing.
 */

type Phase = 'idle' | 'write' | 'read';

let phase: Phase = 'idle';
let owner = '';

const enabled = import.meta.env.DEV;

function violation(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[rw-batch] ${message}\n${new Error().stack ?? ''}`);
}

export function beginWrite(who: string): void {
  if (!enabled) return;
  if (phase === 'read') {
    violation(`write during read phase owned by "${owner}" (now "${who}")`);
  }
  phase = 'write';
  owner = who;
}

export function beginRead(who: string): void {
  if (!enabled) return;
  phase = 'read';
  owner = who;
}

export function endPhase(): void {
  if (!enabled) return;
  phase = 'idle';
  owner = '';
}

/** Call from anywhere that is about to force layout outside a declared phase. */
export function assertNotWriting(who: string): void {
  if (!enabled) return;
  if (phase === 'write') {
    violation(`layout read from "${who}" during write phase owned by "${owner}"`);
  }
}
