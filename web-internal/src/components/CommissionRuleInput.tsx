'use client';

/**
 * A friendlier editor for `commission_rule` custom-term negotiation lines —
 * replaces a free-text field that sales staff kept mistyping (e.g. typing a
 * bare "0") with a mode toggle (Persentase | Flat) + one number input.
 *
 * Composes/parses EXACTLY the two shapes `sales.parseCommissionRule`
 * recognizes server-side (`packages/domain/src/sales.ts`) — this component
 * changes nothing about how commission is computed, only how the string
 * that names it gets typed. Anything else (e.g. a basis other than the
 * service's own standard price — omzet growth, ad spend, GMV) is NOT one of
 * those two shapes and is out of scope here; see `docs/DECISIONS.md` O25b.
 */
import { useState } from 'react';

const RE_PCT = /^(\d+)(?:\.(\d+))?% of standard price$/;
const RE_FLAT = /^flat Rp (\d+|\d{1,3}(?:\.\d{3})+)$/;

type Mode = 'percent' | 'flat';

export function parse(value: string): { mode: Mode; number: string } {
  const pct = RE_PCT.exec(value.trim());
  if (pct) {
    return { mode: 'percent', number: pct[2] ? `${pct[1]}.${pct[2]}` : pct[1] };
  }
  const flat = RE_FLAT.exec(value.trim());
  if (flat) {
    return { mode: 'flat', number: flat[1].replace(/\./g, '') };
  }
  return { mode: 'percent', number: '' };
}

export function compose(mode: Mode, number: string): string {
  const n = number.trim();
  if (n === '') return '';
  return mode === 'percent' ? `${n}% of standard price` : `flat Rp ${Math.trunc(Number(n)) || 0}`;
}

export default function CommissionRuleInput({
  value, onChange, disabled, idPrefix,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  // Local mode/number state so switching modes doesn't lose what was typed
  // before a valid number is entered (parse() only recognizes complete strings).
  const initial = parse(value);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [number, setNumber] = useState(initial.number);

  function set(nextMode: Mode, nextNumber: string) {
    setMode(nextMode);
    setNumber(nextNumber);
    onChange(compose(nextMode, nextNumber));
  }

  return (
    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
      <select
        aria-label="Jenis komisi"
        value={mode}
        disabled={disabled}
        onChange={(e) => set(e.target.value as Mode, number)}
        style={{ width: 100 }}
      >
        <option value="percent">Persen</option>
        <option value="flat">Flat (Rp)</option>
      </select>
      <input
        aria-label={mode === 'percent' ? 'Persen komisi' : 'Nominal komisi (Rp)'}
        type="number"
        min="0"
        step={mode === 'percent' ? '0.01' : '1'}
        placeholder={mode === 'percent' ? 'kosong = rule standar' : 'Rp'}
        id={`${idPrefix}-commission-number`}
        value={number}
        disabled={disabled}
        onChange={(e) => set(mode, e.target.value)}
        style={{ width: 110 }}
      />
      {mode === 'percent' && <span className="muted" style={{ fontSize: 12 }}>% dari harga standar</span>}
    </div>
  );
}
