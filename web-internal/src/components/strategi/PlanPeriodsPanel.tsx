'use client';

/**
 * The Strategi → Plan bridge (Module 6B). On Strategi approval
 * `generatePlanPeriods` mints one PLAN- period per contract month; this panel
 * lists them and links into each period page (`/account/plan/{id}`), where the
 * AM breaks the target into work rows (kuota) and inherits Briefs.
 *
 * Read-only and advisory: it never blocks the Strategi form. Empty (or a load
 * failure) simply means no periods yet — the skeleton is generated at approval,
 * not before, so a Draft Strategi legitimately shows nothing here.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { listPlansForContract, type Plan } from '@/lib/plan';

export default function PlanPeriodsPanel({ contractId }: { contractId: string }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listPlansForContract(contractId)
      .then((p) => alive && setPlans(p))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [contractId]);

  if (error) return null; // advisory — never surface a Plan error on the Strategi form
  if (plans === null) return null;

  return (
    <div className="card">
      <div className="cardHeader">Periode Plan (M6B)</div>
      {plans.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Belum ada periode Plan — kerangka periode dibuat otomatis saat Strategi disetujui.
        </p>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          {plans.map((p) => (
            <Link
              key={p.id}
              href={`/account/plan/${p.id}`}
              className="row"
              style={{ alignItems: 'center', gap: 8, padding: '4px 0', textDecoration: 'none' }}
            >
              <strong style={{ fontSize: 13 }}>Periode {p.periode_no}</strong>
              <StatusBadge status={p.status} />
              <span className="muted" style={{ fontSize: 12 }}>
                {p.tanggal_mulai} → {p.tanggal_akhir}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
