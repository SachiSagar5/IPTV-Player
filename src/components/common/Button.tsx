/**
 * Button / IconButton primitives.
 *
 * Both are real `<button>` elements with an explicit `type`, so they behave
 * correctly inside forms and are reachable by keyboard and by a TV remote's
 * OK button without any extra wiring.
 */
import { forwardRef, memo } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';
import { Icon } from './Icon';
import type { IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap ' +
  'transition-[background-color,color,border-color,transform,opacity] duration-150 ' +
  'disabled:opacity-45 disabled:pointer-events-none select-none';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-jade-500 text-ink-1000 hover:bg-jade-400 active:bg-jade-600 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]',
  secondary:
    'bg-ink-700 text-mist-50 hover:bg-ink-600 active:bg-ink-750 border border-ink-600',
  ghost: 'bg-transparent text-mist-200 hover:bg-ink-800 hover:text-mist-50',
  subtle: 'bg-ink-800/80 text-mist-200 hover:bg-ink-700 hover:text-mist-50 border border-ink-700',
  danger: 'bg-live-500/15 text-live-400 hover:bg-live-500/25 border border-live-500/35',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-sm',
  xl: 'h-14 px-8 text-base',
};

const ICON_SIZES: Record<Size, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-14 w-14',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = memo(
  forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
      variant = 'primary',
      size = 'md',
      icon,
      iconRight,
      loading = false,
      fullWidth = false,
      className = '',
      children,
      disabled,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    const iconSize = size === 'sm' ? 14 : size === 'xl' ? 22 : 18;
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${
          fullWidth ? 'w-full' : ''
        } ${className}`}
        {...rest}
      >
        {loading ? (
          <Spinner size={iconSize} />
        ) : icon ? (
          <Icon name={icon} size={iconSize} />
        ) : null}
        {children ? <span className="truncate">{children}</span> : null}
        {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
      </button>
    );
  }),
);

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required: an icon-only control has no text content. */
  label: string;
  variant?: Variant;
  size?: Size;
  active?: boolean;
  filled?: boolean;
}

export const IconButton = memo(
  forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    {
      icon,
      label,
      variant = 'ghost',
      size = 'md',
      active = false,
      filled = false,
      className = '',
      ...rest
    },
    ref,
  ) {
    const iconSize = size === 'sm' ? 16 : size === 'xl' ? 26 : 20;
    return (
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={active || undefined}
        className={`${BASE} ${ICON_SIZES[size]} ${
          active ? 'bg-ink-700 text-mist-50' : VARIANTS[variant]
        } ${className}`}
        {...rest}
      >
        <Icon name={icon} size={iconSize} filled={filled || active} />
      </button>
    );
  }),
);

export interface ButtonLinkProps extends LinkProps {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  fullWidth?: boolean;
  children?: ReactNode;
}

/** Same visual language as `Button`, but renders an anchor for real navigation. */
export const ButtonLink = memo(function ButtonLink({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  fullWidth = false,
  className = '',
  children,
  ...rest
}: ButtonLinkProps) {
  const iconSize = size === 'sm' ? 14 : size === 'xl' ? 22 : 18;
  return (
    <Link
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children ? <span className="truncate">{children}</span> : null}
      {iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
    </Link>
  );
});

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`animate-spin-slow ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="2.5"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
