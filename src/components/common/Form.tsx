/**
 * Form primitives: text input, switch, segmented control, filter chip row.
 */
import { forwardRef, memo, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

/* ---------------- Input ---------------- */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
  /** Trailing slot, e.g. a paste or clear button. */
  trailing?: ReactNode;
  containerClassName?: string;
}

export const Input = memo(
  forwardRef<HTMLInputElement, InputProps>(function Input(
    { label, hint, error, icon, trailing, className = '', containerClassName = '', id, ...rest },
    ref,
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

    return (
      <div className={containerClassName}>
        {label ? (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-xs font-semibold tracking-wide text-mist-400"
          >
            {label}
          </label>
        ) : null}
        <div className="relative">
          {icon ? (
            <Icon
              name={icon}
              size={18}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mist-500"
            />
          ) : null}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={`h-11 w-full rounded-md border bg-ink-850 text-sm text-mist-50 transition-colors placeholder:text-mist-600 hover:border-ink-600 focus:border-jade-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-jade-400 ${
              icon ? 'pl-10' : 'pl-3.5'
            } ${trailing ? 'pr-10' : 'pr-3.5'} ${
              error ? 'border-live-500/60' : 'border-ink-700'
            } ${className}`}
            {...rest}
          />
          {trailing ? (
            <div className="absolute top-1/2 right-2 -translate-y-1/2">{trailing}</div>
          ) : null}
        </div>
        {error ? (
          <p id={`${inputId}-error`} className="mt-1.5 text-xs text-live-400">
            {error}
          </p>
        ) : hint ? (
          <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-mist-500">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }),
);

/* ---------------- Switch ---------------- */

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'size'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
}

export const Switch = memo(function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
}: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-mist-50">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-mist-500">{description}</p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 ${
          checked ? 'border-jade-500 bg-jade-500' : 'border-ink-600 bg-ink-750'
        } disabled:opacity-45`}
      >
        <span
          className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform duration-150 ${
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
          }`}
          style={{ height: '1.125rem', width: '1.125rem' }}
        />
      </button>
    </div>
  );
});

/* ---------------- Segmented control ---------------- */

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  icon?: IconName;
  count?: number;
}

export interface SegmentedProps<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className = '',
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1 ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm'
            } ${
              selected
                ? 'bg-ink-700 text-mist-50 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]'
                : 'text-mist-400 hover:bg-ink-800 hover:text-mist-200'
            }`}
          >
            {option.icon ? <Icon name={option.icon} size={size === 'sm' ? 13 : 15} /> : null}
            {option.label}
            {option.count != null ? (
              <span className="text-[10px] tabular-nums text-mist-500">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Filter chip ---------------- */

export interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
  icon?: IconName;
}

export const FilterChip = memo(function FilterChip({
  label,
  active,
  onClick,
  count,
  icon,
}: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
        active
          ? 'border-jade-500 bg-jade-500 text-ink-1000'
          : 'border-ink-600 bg-ink-850 text-mist-200 hover:border-ink-500 hover:bg-ink-800'
      }`}
    >
      {active ? <Icon name="check" size={13} /> : icon ? <Icon name={icon} size={13} /> : null}
      <span className="max-w-[16ch] truncate">{label}</span>
      {count != null ? (
        <span className={`tabular-nums ${active ? 'text-ink-1000/70' : 'text-mist-500'}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
});

/* ---------------- Scrollable chip row ---------------- */

export function ChipRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`row-scroll -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:-mx-8 md:px-8 ${className}`}
    >
      {children}
    </div>
  );
}
