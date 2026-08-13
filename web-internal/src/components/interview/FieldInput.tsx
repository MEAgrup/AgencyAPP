'use client';

/**
 * One Blok B answer control, rendered from a `FieldSpec`.
 *
 * The field's `tipe` decides the input; a scored numeric field additionally
 * carries its I3 `sumber_angka` (klien_hitung / diturunkan / estimasi_am) and,
 * when it is an AM estimate, a written basis — the DB rejects a baseless estimate
 * (`ck_answer_estimasi_basis`), so the basis box is shown the moment "Estimasi AM"
 * is picked and marked required.
 */

import { formatIDR } from '@/lib/money';
import {
  SUMBER_ANGKA_MARGIN_OPTIONS,
  SUMBER_ANGKA_OPTIONS,
  type FieldSpec,
  type FieldValue,
} from '@/lib/interview-fields';
import { SUMBER_ANGKA } from '@/lib/interview-scoring';

export default function FieldInput({
  spec,
  value,
  onChange,
  disabled,
}: {
  spec: FieldSpec;
  value: FieldValue;
  onChange: (next: FieldValue) => void;
  disabled: boolean;
}) {
  const set = (patch: Partial<FieldValue>) => onChange({ ...value, ...patch });
  const isEstimasi = value.sumber === SUMBER_ANGKA.EstimasiAm;
  const isDerived = value.sumber === SUMBER_ANGKA.DariMarginKotor;
  const sumberOptions = spec.sumber === 'margin' ? SUMBER_ANGKA_MARGIN_OPTIONS : SUMBER_ANGKA_OPTIONS;

  return (
    <div className="field" style={{ gap: 4 }}>
      <label htmlFor={`fld-${spec.fieldKey}`}>
        {spec.fieldKey} · {spec.label}
        {spec.scored && <span title="Field skor — tidak boleh kosong saat diajukan"> ★</span>}
        {spec.drives && (
          <span className="muted" style={{ fontWeight: 400 }}>
            {' '}
            → {spec.drives}
          </span>
        )}
      </label>

      {spec.tipe === 'enum' ? (
        <select
          id={`fld-${spec.fieldKey}`}
          value={value.raw}
          disabled={disabled}
          onChange={(e) => set({ raw: e.target.value })}
        >
          <option value="">— pilih —</option>
          {spec.enumOptions?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : spec.tipe === 'teks' ? (
        <textarea
          id={`fld-${spec.fieldKey}`}
          rows={2}
          value={value.raw}
          disabled={disabled}
          onChange={(e) => set({ raw: e.target.value })}
        />
      ) : (
        <input
          id={`fld-${spec.fieldKey}`}
          type="number"
          inputMode="decimal"
          placeholder={spec.tipe === 'money' ? 'Rupiah' : spec.tipe === 'persen' ? '%' : ''}
          value={isDerived && spec.fieldKey === 'B2-7' ? '' : value.raw}
          disabled={disabled || (isDerived && spec.fieldKey === 'B2-7')}
          onChange={(e) => set({ raw: e.target.value })}
        />
      )}

      {spec.tipe === 'money' && value.raw.trim() !== '' && (
        <span className="muted" style={{ fontSize: 11 }}>
          {formatIDR(Number(value.raw))}
        </span>
      )}
      {spec.hint && (
        <span className="muted" style={{ fontSize: 11 }}>
          {spec.hint}
        </span>
      )}

      {spec.sumber && (
        <div className="row" style={{ gap: 6, marginTop: 2 }}>
          <select
            aria-label={`Sumber angka ${spec.fieldKey}`}
            value={value.sumber ?? ''}
            disabled={disabled}
            onChange={(e) => set({ sumber: e.target.value as FieldValue['sumber'] })}
            style={{ fontSize: 12, padding: '4px 8px' }}
          >
            <option value="">Sumber angka…</option>
            {sumberOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {spec.sumber && isEstimasi && (
        <textarea
          aria-label={`Dasar estimasi ${spec.fieldKey}`}
          rows={2}
          placeholder="Dasar estimasi (wajib untuk estimasi AM)"
          value={value.dasar ?? ''}
          disabled={disabled}
          onChange={(e) => set({ dasar: e.target.value })}
          style={{
            fontSize: 12,
            borderColor: (value.dasar ?? '').trim() === '' ? 'var(--color-danger)' : undefined,
          }}
        />
      )}
    </div>
  );
}
