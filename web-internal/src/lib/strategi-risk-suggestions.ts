/**
 * A-13 — H-1 risk register: suggested starting rows, keyed off what is already
 * on the Strategi (the contracted channels, D1) rather than invented per-AM.
 *
 * ⟳ 2026-08-26 (DECISIONS): owner QA on STRG-202608-0001 — an AM new to a
 * store may not yet know which risks are worth naming. This is a picklist of
 * candidates, never an auto-fill: `getRiskSuggestions` only returns rows, the
 * AM must explicitly add one (`SectionH.tsx`) before it becomes a real H-1
 * row they can edit and PIC-assign, same as any manually typed row — nothing
 * here writes to `strategi_risk` on its own. This is content, not business
 * logic, so it lives entirely client-side (no domain package change, no
 * migration, no API route).
 *
 * **Generic list mirrors H-2's trigger vocabulary on purpose.** The six
 * substantive `TRIGGER_REVISI_LABELS` codes (H-2) are already the risks the
 * PRD itself considers worth naming for a revision — reusing that wording
 * keeps H-1/H-2 pointing at the same underlying risks instead of inventing a
 * second, unrelated vocabulary.
 *
 * **Channel list is deliberately short.** Only channels with something
 * genuinely distinct to say get an entry; a channel absent here (or
 * `'Lainnya'`) still gets the generic six.
 */

export interface RiskSuggestion {
  risiko: string;
  dampak: 'rendah' | 'sedang' | 'tinggi';
  kemungkinan: 'rendah' | 'sedang' | 'tinggi';
  mitigasi: string;
}

/** Mirrors the six substantive H-2 trigger codes (`lainnya` excluded — not a risk statement). */
export const GENERIC_RISK_SUGGESTIONS: RiskSuggestion[] = [
  {
    risiko: 'Pencapaian di bawah target 2 bulan berturut-turut',
    dampak: 'tinggi',
    kemungkinan: 'sedang',
    mitigasi: 'Review pencapaian vs target mingguan, evaluasi ulang strategi kalau 2 bulan berturut di bawah target.',
  },
  {
    risiko: 'Klien mengubah lini produk di tengah jalan',
    dampak: 'sedang',
    kemungkinan: 'rendah',
    mitigasi: 'Selaraskan ulang baseline dan target begitu ada info perubahan lini produk dari klien.',
  },
  {
    risiko: 'Stok kosong pada SKU utama',
    dampak: 'tinggi',
    kemungkinan: 'sedang',
    mitigasi: 'Koordinasi rutin dengan klien soal jadwal restock, siapkan SKU alternatif.',
  },
  {
    risiko: 'Budget iklan dipotong klien',
    dampak: 'sedang',
    kemungkinan: 'sedang',
    mitigasi: 'Siapkan skenario alokasi budget minimum dan channel prioritas kalau budget dipotong.',
  },
  {
    risiko: 'Perubahan kebijakan platform (algoritma, komisi, atau aturan lain)',
    dampak: 'sedang',
    kemungkinan: 'rendah',
    mitigasi: 'Pantau pengumuman resmi platform, siapkan rencana adaptasi cepat.',
  },
  {
    risiko: 'Ganti PIC klien di tengah engagement',
    dampak: 'sedang',
    kemungkinan: 'rendah',
    mitigasi: 'Dokumentasikan konteks strategi dengan rapi untuk handover cepat ke PIC baru.',
  },
];

export const CHANNEL_RISK_SUGGESTIONS: Record<string, RiskSuggestion[]> = {
  Shopee: [
    {
      risiko: 'Kompetitor kategori sama menurunkan harga agresif',
      dampak: 'sedang',
      kemungkinan: 'sedang',
      mitigasi: 'Pantau harga kompetitor mingguan, siapkan bundling/promo alternatif selain perang harga.',
    },
    {
      risiko: 'Poin penalti toko naik mendekati ambang suspend',
      dampak: 'tinggi',
      kemungkinan: 'rendah',
      mitigasi: 'Monitor skor toko harian, prioritaskan perbaikan SLA pengiriman dan respons chat.',
    },
  ],
  'TikTok Shop': [
    {
      risiko: 'Live/afiliasi/KOL utama berhenti aktif',
      dampak: 'tinggi',
      kemungkinan: 'sedang',
      mitigasi: 'Siapkan cadangan kreator/afiliasi, jangan bergantung pada satu KOL.',
    },
    {
      risiko: 'Perubahan algoritma For You Page menurunkan reach organik',
      dampak: 'sedang',
      kemungkinan: 'sedang',
      mitigasi: 'Diversifikasi format konten, jangan hanya mengandalkan satu tipe video.',
    },
  ],
  Tokopedia: [
    {
      risiko: 'Persaingan gimmick harga ketat di kategori yang sama',
      dampak: 'sedang',
      kemungkinan: 'sedang',
      mitigasi: 'Fokus diferensiasi non-harga: bundling, garansi, kecepatan kirim.',
    },
    {
      risiko: 'Perubahan skema Power Merchant/gratis ongkir memengaruhi margin',
      dampak: 'sedang',
      kemungkinan: 'rendah',
      mitigasi: 'Hitung ulang margin begitu skema berubah, sesuaikan floor price.',
    },
  ],
  Lazada: [
    {
      risiko: 'Trafik organik Lazada relatif kecil dibanding channel lain',
      dampak: 'sedang',
      kemungkinan: 'tinggi',
      mitigasi: 'Alokasikan ads secukupnya, jangan menaruh target GMV terlalu tinggi tanpa dukungan budget.',
    },
    {
      risiko: 'Ketergantungan tinggi pada kampanye flash sale platform',
      dampak: 'sedang',
      kemungkinan: 'sedang',
      mitigasi: 'Bangun demand di luar flash sale supaya GMV tidak jatuh drastis di luar periode kampanye.',
    },
  ],
  Website: [
    {
      risiko: 'Trafik sepenuhnya bergantung pada ads berbayar, tanpa organik',
      dampak: 'tinggi',
      kemungkinan: 'sedang',
      mitigasi: 'Bangun kanal organik (SEO/sosial) supaya CAC tidak terus naik.',
    },
    {
      risiko: 'Isu teknis (downtime, checkout error) tidak terdeteksi cepat',
      dampak: 'tinggi',
      kemungkinan: 'rendah',
      mitigasi: 'Pasang monitoring uptime dan cek funnel checkout mingguan.',
    },
  ],
};

const normalize = (s: string) => s.trim().toLowerCase();

/**
 * Generic six + one set per contracted channel that has an entry above,
 * minus anything whose `risiko` text (trim/case-insensitive) is already in
 * the AM's current H-1 draft — re-suggesting a row already added is noise.
 */
export function getRiskSuggestions(
  channels: string[],
  existingRisks: { risiko: string }[],
): RiskSuggestion[] {
  const already = new Set(existingRisks.map((r) => normalize(r.risiko)));
  const seen = new Set<string>();
  const out: RiskSuggestion[] = [];
  const consider = (s: RiskSuggestion) => {
    const key = normalize(s.risiko);
    if (already.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  GENERIC_RISK_SUGGESTIONS.forEach(consider);
  for (const channel of channels) {
    (CHANNEL_RISK_SUGGESTIONS[channel] ?? []).forEach(consider);
  }
  return out;
}
