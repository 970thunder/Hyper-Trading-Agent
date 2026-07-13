import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border-primary bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 hover:shadow-sm",
  secondary: "border-border bg-surface-1 text-ink-strong shadow-xs hover:border-ink-disabled hover:bg-surface-2 hover:shadow-sm",
  outline: "border-border bg-transparent text-ink hover:border-primary/45 hover:bg-primary/5 hover:text-ink-strong",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink-strong",
  destructive: "border-destructive bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 hover:shadow-sm",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3 text-sm",
  lg: "h-11 gap-2 px-4 text-sm",
  icon: "h-9 w-9 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    loadingLabel,
    leftIcon,
    rightIcon,
    disabled,
    className,
    children,
    type = "button",
    "aria-label": ariaLabel,
    ...props
  },
  ref,
) {
  const busyName = loading ? loadingLabel || ariaLabel : ariaLabel;

  return (
    <button
      ref={ref}
      type={type}
      data-variant={variant}
      data-size={size}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={busyName}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border font-medium",
        "transition-[color,background-color,border-color,box-shadow,transform] duration-fast ease-standard",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "active:translate-y-px disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      <span className={cn("inline-flex min-w-0 items-center justify-center gap-[inherit]", loading && "opacity-0")}>
        {leftIcon ? <span className="shrink-0" aria-hidden="true">{leftIcon}</span> : null}
        {children}
        {rightIcon ? <span className="shrink-0" aria-hidden="true">{rightIcon}</span> : null}
      </span>
      {loading ? (
        <span data-button-spinner className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
      ) : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "aria-label" | "children" | "size"> {
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, title, children, variant = "ghost", ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      size="icon"
      variant={variant}
      aria-label={label}
      title={title || label}
      data-icon-button="true"
      {...props}
    >
      {children}
    </Button>
  );
});
