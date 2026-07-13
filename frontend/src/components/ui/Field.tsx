import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type AriaAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

type FieldContextValue = {
  controlId: string;
  descriptionId?: string;
  invalid: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, required = false, className, children }: FieldProps) {
  const generatedId = useId();
  const controlId = `field-${generatedId}`;
  const descriptionId = hint || error ? `${controlId}-description` : undefined;

  return (
    <FieldContext.Provider value={{ controlId, descriptionId, invalid: Boolean(error) }}>
      <div className={cn("grid min-w-0 gap-1.5", className)}>
        <label htmlFor={controlId} className="text-sm font-medium leading-5 text-ink-strong">
          {label}
          {required ? <span className="ml-1 text-danger" aria-hidden="true">*</span> : null}
        </label>
        {children}
        {error ? (
          <p id={descriptionId} role="alert" className="text-xs leading-4 text-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={descriptionId} className="text-xs leading-4 text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

function controlAccessibility<T extends { id?: string; "aria-describedby"?: string; "aria-invalid"?: AriaAttributes["aria-invalid"] }>(
  props: T,
  context: FieldContextValue | null,
) {
  if (!context) return props;
  const describedBy = [props["aria-describedby"], context.descriptionId].filter(Boolean).join(" ") || undefined;
  return {
    ...props,
    id: props.id || context.controlId,
    "aria-describedby": describedBy,
    "aria-invalid": context.invalid ? "true" as const : props["aria-invalid"],
  };
}

const controlClass = cn(
  "w-full rounded-md border border-border bg-surface-1 text-ink-strong shadow-xs",
  "placeholder:text-ink-disabled transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard",
  "hover:border-ink-disabled focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20",
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled disabled:shadow-none",
  "aria-[invalid=true]:border-danger/65 aria-[invalid=true]:focus:ring-danger/20",
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  const context = useContext(FieldContext);
  const accessibleProps = controlAccessibility(props, context);
  return <input ref={ref} className={cn(controlClass, "h-9 px-3 text-sm", className)} {...accessibleProps} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  const context = useContext(FieldContext);
  const accessibleProps = controlAccessibility(props, context);
  return <textarea ref={ref} className={cn(controlClass, "min-h-24 resize-y px-3 py-2 text-sm leading-5", className)} {...accessibleProps} />;
});

export type NumberInputProps = Omit<InputProps, "type">;

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(props, ref) {
  return <Input ref={ref} type="number" inputMode="decimal" {...props} />;
});
