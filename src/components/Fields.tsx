/**
 * Campos de formulário no estilo Minecraft: texto, seleção, interruptor.
 */
import { useId } from "react";
import { UI } from "../theme/sound";

export function Field({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mc-field">
      {label && <span className="mc-field__label">{label}</span>}
      {children}
      {hint && <span className="mc-hint">{hint}</span>}
    </label>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  label,
  hint,
  maxLength,
  disabled,
  onEnter,
  autoFocus,
  type = "text",
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  maxLength?: number;
  disabled?: boolean;
  onEnter?: () => void;
  autoFocus?: boolean;
  type?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="mc-input"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        {...rest}
      />
    </Field>
  );
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
  hint,
  disabled,
  placeholder,
}: {
  value: T | "";
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label?: string;
  hint?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint}>
      <select
        id={id}
        className="mc-select"
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          UI.pop();
          const raw = e.target.value;
          const found = options.find((o) => String(o.value) === raw);
          if (found) onChange(found.value);
        }}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="mc-toggle-row">
      <button
        type="button"
        className="mc-toggle"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            UI.pop();
            onChange(!checked);
          }
        }}
      >
        <span className={`mc-toggle__box ${checked ? "mc-toggle__box--on" : ""}`}>
          {checked && <span className="mc-toggle__check" />}
        </span>
        <span>{label}</span>
      </button>
      {hint && <span className="mc-hint mc-toggle-row__hint">{hint}</span>}
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  label,
  hint,
  rows = 6,
  placeholder,
  spellCheck = false,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  hint?: string;
  rows?: number;
  placeholder?: string;
  spellCheck?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className="mc-textarea"
        value={value}
        rows={rows}
        placeholder={placeholder}
        spellCheck={spellCheck}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Barra de progresso no estilo da tela de carregamento do Java. */
export function ProgressBar({ value, label }: { value?: number | null; label?: string }) {
  const percent = value == null ? null : Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="mc-progress">
      <div className="mc-progress__track">
        {percent == null ? (
          <div className="mc-progress__indeterminate" />
        ) : (
          <div className="mc-progress__fill" style={{ width: `${percent}%` }} />
        )}
      </div>
      {label && <div className="mc-progress__label">{label}</div>}
    </div>
  );
}

/** Espaçador vertical. */
export function Gap({ size = 3 }: { size?: number }) {
  return <div style={{ height: `var(--sp-${size})` }} />;
}
