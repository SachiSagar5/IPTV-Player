/**
 * PIN prompt for the Parent section.
 *
 * Rendered as a real modal rather than a field on the page so that the gated
 * content is never in the DOM while it is locked — otherwise the page title and
 * a screen reader would describe what is behind the lock.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Form';
import { checkPin } from '@/store/adultGate';

export interface PinDialogProps {
  open: boolean;
  onUnlocked: () => void;
  onCancel: () => void;
}

export const PinDialog = memo(function PinDialog({
  open,
  onUnlocked,
  onCancel,
}: PinDialogProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear between openings so a previous attempt never lingers on screen.
  useEffect(() => {
    if (open) {
      setPin('');
      setError(null);
    }
  }, [open]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (checkPin(pin)) {
      setPin('');
      setError(null);
      onUnlocked();
      return;
    }
    // Deliberately vague: confirming "wrong PIN" is all the feedback needed, and
    // saying more would help someone narrow the PIN down.
    setError('That PIN is not right. Try again.');
    setPin('');
    inputRef.current?.focus();
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Parental controls"
      description="Enter the PIN to view adult content. The section locks again when the app is closed."
      size="sm"
    >
      <form onSubmit={submit}>
        <Input
          ref={inputRef}
          label="PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          error={error}
          onChange={(event) => {
            setPin(event.target.value);
            if (error) setError(null);
          }}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button type="submit" disabled={pin.length === 0}>
            Unlock
          </Button>
        </div>
      </form>
    </Modal>
  );
});
