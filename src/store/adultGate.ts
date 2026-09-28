/**
 * Unlock state for the Parent section.
 *
 * Deliberately **not persisted**. Persisting "unlocked" would make the gate
 * worthless: a reload — or a page left open overnight — would re-open the
 * section without anyone entering a PIN. Holding it in memory means the section
 * re-locks whenever the app is closed or reloaded, which is the behaviour a
 * parent expects on a shared device.
 *
 * A plain module-level `Store` rather than a field on `appStore`, so that none of
 * appStore's persistence layers can ever write it to LocalStorage or IndexedDB.
 */
import { Store, useStoreSelector } from '@/store/store';
import { DEFAULT_PIN, hashPin, verifyPin } from '@/utils/pin';
import { loadAdultPinHash } from '@/services/storage/prefs';

export interface AdultGateState {
  /** True once a correct PIN has been entered this session. */
  unlocked: boolean;
}

export const adultGateStore = new Store<AdultGateState>({ unlocked: false });

/** The hash to check against: whatever the parent set, else the default PIN. */
export function currentPinHash(): string {
  return loadAdultPinHash() || hashPin(DEFAULT_PIN);
}

/** True when `pin` opens the section. */
export function checkPin(pin: string): boolean {
  return verifyPin(pin, currentPinHash());
}

export function unlockAdult(): void {
  adultGateStore.setState({ unlocked: true });
}

export function lockAdult(): void {
  adultGateStore.setState({ unlocked: false });
}

export function useAdultUnlocked(): boolean {
  return useStoreSelector(adultGateStore, (s) => s.unlocked);
}
