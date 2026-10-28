import { useEffect, useState } from 'react';
import { parseAngle, parseLength, toDisplay, type Units } from '../util/units';

interface LengthProps {
  label: string;
  mm: number;
  units: Units;
  onCommit: (mm: number) => void;
  disabled?: boolean;
  testId?: string;
}

/**
 * A length input. Shows the value in display units; accepts typed units on commit, so
 * "2.25in" becomes 57.15 mm. Commits on Enter or blur; Escape reverts.
 */
export function LengthField({ label, mm, units, onCommit, disabled, testId }: LengthProps) {
  const shown = String(toDisplay(mm, units));
  const [text, setText] = useState(shown);
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(shown);
    setError(false);
  }, [shown]);

  const commit = () => {
    if (text === shown) return;
    const v = parseLength(text, units);
    if (v === null) {
      setError(true);
      return;
    }
    setError(false);
    onCommit(v);
  };

  return (
    <label className={`field${error ? ' has-error' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          value={text}
          disabled={disabled}
          data-testid={testId}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).select();
            } else if (e.key === 'Escape') {
              // Revert the field only; do not let Escape also clear the selection.
              e.stopPropagation();
              setText(shown);
              setError(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          title={units === 'metric' ? `${(mm / 25.4).toFixed(3)} in` : `${mm.toFixed(2)} mm`}
        />
        <span className="unit">{units === 'metric' ? 'mm' : 'in'}</span>
      </span>
      {error && <span className="field-error">Not a length. Try 57, 57mm or 2.25in.</span>}
    </label>
  );
}

interface NumberProps {
  label: string;
  value: number;
  unit: string;
  onCommit: (v: number) => void;
  parse?: (s: string) => number | null;
  disabled?: boolean;
  testId?: string;
}

export function NumberField({ label, value, unit, onCommit, parse, disabled, testId }: NumberProps) {
  const shown = String(Math.round(value * 1000) / 1000);
  const [text, setText] = useState(shown);
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(shown);
    setError(false);
  }, [shown]);
  const commit = () => {
    if (text === shown) return;
    const v = (parse ?? parseAngle)(text);
    if (v === null || !Number.isFinite(v)) return setError(true);
    setError(false);
    onCommit(v);
  };
  return (
    <label className={`field${error ? ' has-error' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          value={text}
          disabled={disabled}
          data-testid={testId}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              e.stopPropagation();
              setText(shown);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="unit">{unit}</span>
      </span>
    </label>
  );
}

export function TextField({ label, value, onCommit, testId }: { label: string; value: string; onCommit: (v: string) => void; testId?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          value={text}
          data-testid={testId}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== value && onCommit(text)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text !== value) onCommit(text);
            if (e.key === 'Escape') {
              // Revert the field only; do not let Escape also clear the selection.
              e.stopPropagation();
              setText(value);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </span>
    </label>
  );
}

/** A length that may be unset. An empty field commits null. */
export function OptionalLengthField({ label, mm, units, onCommit, testId, placeholder = 'not set' }: { label: string; mm: number | null; units: Units; onCommit: (mm: number | null) => void; testId?: string; placeholder?: string }) {
  const shown = mm === null ? '' : String(toDisplay(mm, units));
  const [text, setText] = useState(shown);
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(shown);
    setError(false);
  }, [shown]);
  const commit = () => {
    if (text === shown) return;
    if (text.trim() === '') return onCommit(null);
    const v = parseLength(text, units);
    if (v === null || v < 0) return setError(true);
    setError(false);
    onCommit(v);
  };
  return (
    <label className={`field${error ? ' has-error' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          value={text}
          placeholder={placeholder}
          data-testid={testId}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              e.stopPropagation();
              setText(shown);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="unit">{units === 'metric' ? 'mm' : 'in'}</span>
      </span>
    </label>
  );
}
