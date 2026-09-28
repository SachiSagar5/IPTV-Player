/**
 * PIN hashing for the parental gate.
 *
 * Read the limitations before treating this as a security boundary. It is not
 * one. A four-digit PIN has 10,000 possible values, so the iterations below
 * exist to make a casual read of LocalStorage useless rather than to make
 * brute force infeasible — anyone who can run JavaScript in the page can simply
 * try all 10,000 in a second, and can read the playlist itself without ever
 * touching this gate.
 *
 * What the gate *does* do is what it is for: keep the Parent section closed to
 * casual use on a shared family device, and keep the PIN out of plain sight in
 * storage and out of the app bundle. If this needs to resist a determined user,
 * it has to be enforced by the streaming provider, not by a web client.
 */
const SALT = 'iptv-player:parental:v1';

/** Iterations: enough to make a raw read uninteresting, cheap enough for 10k attempts. */
const ITERATIONS = 2048;

/** FNV-1a, 32-bit. Small, dependency-free and synchronous. */
function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 16777619, expressed so the multiply stays in 32-bit space.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Derives the stored form of a PIN. Deterministic, so it doubles as the check. */
export function hashPin(pin: string): string {
  let hash = fnv1a(SALT);
  for (let i = 0; i < ITERATIONS; i++) hash = fnv1a(`${pin}:${i}:${hash}`);
  return hash.toString(16).padStart(8, '0');
}

/** True when `pin` produced `stored`. Compares by value, not identity. */
export function verifyPin(pin: string, stored: string): boolean {
  if (!stored) return false;
  return hashPin(pin) === stored;
}

/** The PIN a fresh install starts with. Changeable in Settings. */
export const DEFAULT_PIN = '8345';

export const MIN_PIN_LENGTH = 4;

/** Rejects PINs that would be trivially guessed on a shared device. */
export function validatePin(pin: string): string | null {
  if (pin.length < MIN_PIN_LENGTH) return `Use at least ${MIN_PIN_LENGTH} characters.`;
  if (!/^\d+$/.test(pin)) return 'Use digits only.';
  // 1234 / 0000 / 1111 are the first things anyone tries.
  if (/^(\d)\1+$/.test(pin)) return 'Avoid repeating the same digit.';
  if (isSequential(pin)) return 'Avoid a run of sequential digits.';
  return null;
}

function isSequential(pin: string): boolean {
  let ascending = true;
  let descending = true;
  for (let i = 1; i < pin.length; i++) {
    const delta = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}
