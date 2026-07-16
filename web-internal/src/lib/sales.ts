// Typed wrapper over lib/api.ts for the Module 0 quote-preview endpoint
// (MSL v2 calculator). Shapes mirror backend/internal/module0_sales/commission.go
// (LineQuote / Quote) and qualified.go (ServiceSelection) exactly — read from
// the Go code, never invented. All money fields are pre-formatted IDR strings
// from the server (money.Money.Format()); the frontend never recomputes them
// (CLAUDE.md #4).

import { api } from '@/lib/api';

export interface ServiceSelection {
  master_service_id: string;
  quantity?: number;
  amount?: string;
}

export interface LineQuote {
  service_id: string;
  name: string;
  quantity: number;
  unit: string;
  standard_price_idr: string;
  komisi_idr: string;
  subtotal_idr: string;
}

export interface Quote {
  lines: LineQuote[];
  estimasi_nilai_idr: string;
  total_komisi_idr: string;
}

export function previewQuote(services: ServiceSelection[]): Promise<Quote> {
  return api.post<Quote>('/sales/quote-preview', { services });
}
