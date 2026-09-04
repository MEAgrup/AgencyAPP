-- L3 (Revisi Sales/Creative/Performa) — job harian `leads_unrespon_tick`.
--
-- Dua kaki, satu fungsi (pola stage_overdue_tick, 20260830030000):
--   1. `New Lead`/`Contacted` -> `[Unrespon]` setelah 3 hari KALENDER tanpa
--      perubahan status (require_lead=true — edge L1).
--   2. `[Unrespon]` -> `Not Qualified` setelah 14 hari KALENDER lagi tanpa
--      perubahan status, plus baris `[Tidak ada respon]` di
--      `prospect_attempt_nq_reasons` (M1-OA-8, `created_by='SISTEM'`).
--
-- **Jangkar jam = keputusan pemilik: dari perubahan status TERAKHIR**, bukan
-- tanggal daftar — turunan murni `audit_log` (aturan rumah #4), tanpa kolom
-- `unrespon_at` baru. Untuk baris `[Unrespon]`, "transisi terakhir" otomatis
-- menunjuk baris audit `...->[Unrespon]` yang paling baru, jadi jam RESET
-- sendiri setiap kali sales menghidupkan lagi lalu lead itu menua kedua
-- kalinya — nol logika reset eksplisit dibutuhkan.
--
-- **Hari KALENDER, bukan hari kerja** (`working_days_between` ADA di
-- `packages/core`, sengaja tidak dipakai di sini): sales wajib merespon di
-- hari libur (aturan MEA), `hari_libur` masih kosong sehingga artinya akan
-- berubah diam-diam begitu diisi, dan preseden terdekat
-- (`finance.scanReminders`) juga kalender. `wib_date()` (20260722052710) —
-- subtraksi dua `date` WIB memberi selisih hari kalender langsung.
--
-- **Idempoten tanpa kolom penanda.** Kandidat dipilih dari STATUS
-- (`New Lead`/`Contacted` untuk kaki 1, `[Unrespon]` untuk kaki 2); begitu
-- `sm_transition` memindahkan status, baris itu tidak lagi cocok kriteria
-- SELECT kaki manapun. Run kedua di hari yang sama menemukan nol kandidat —
-- {unrespon:0, auto_not_qualified:0}. `sm_transition` sendiri mengunci baris
-- (`FOR UPDATE`) dan membaca ulang status DI DALAM lock, jadi aman dari race
-- dengan sales yang menghidupkan lead di saat bersamaan.
--
-- **Jebakan `require_lead` (dicatat supaya tidak terulang):** preseden
-- `wrr_monday_job` (20260813080000:111) memanggil `sm_transition(...,
-- 'SISTEM', false, false)` untuk edge `require_lead=false`. Kaki 1 di sini
-- memakai edge `require_lead=TRUE` (L1) — copy-paste pola wrr apa adanya akan
-- menghasilkan `role_denied` DIAM-DIAM di setiap baris (fungsi mengembalikan
-- `{ok:false}`, bukan exception, jadi tanpa guard eksplisit tick akan
-- "sukses" tanpa memindahkan siapa pun). Karena itu setiap panggilan
-- `sm_transition` di bawah diperiksa `(res->>'ok')::boolean` dan
-- `RAISE EXCEPTION` kalau gagal — kegagalan sebagian tidak pernah senyap.
--
-- **Aktor `'SISTEM'`** (bukan `'SYSTEM'` yang dipakai TS `leads.SYSTEM_ACTOR`)
-- — mengikuti preseden `wrr_monday_job`/`stage_overdue_tick`: job SQL murni di
-- repo ini konsisten memakai ejaan Indonesia. Inkonsistensi lama (TS vs SQL)
-- dicatat di backlog, TIDAK diperbaiki di sini — di luar scope tiket ini.
create or replace function leads_unrespon_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := wib_date(p_now);
  v_unrespon_count integer := 0;
  v_nq_count integer := 0;
  v_last_transition timestamptz;
  res jsonb;
  r record;
begin
  -- Kaki 1: New Lead / Contacted -> [Unrespon], 3 hari kalender diam.
  for r in
    select pa.id, pa.owner_employee_id, pa.created_at
      from prospect_attempts pa
     where pa.status in ('New Lead', 'Contacted')
  loop
    select max(a.created_at) into v_last_transition
      from audit_log a
     where a.entity_type = 'prospect_attempt' and a.entity_id = r.id
       and a.action like 'transition:%';
    if v_last_transition is null then
      v_last_transition := r.created_at;
    end if;

    if v_today - wib_date(v_last_transition) < 3 then
      continue;
    end if;

    res := sm_transition('prospect_attempt', 'prospect_attempt', 'prospect_attempts',
                         'id', 'status', r.id, '[Unrespon]', 'SISTEM', true, false);
    if not (res ->> 'ok')::boolean then
      raise exception 'leads_unrespon_tick: % -> [Unrespon] gagal: %', r.id, res;
    end if;

    perform notify_emit('m1.attempt.unrespon', 'prospect_attempt', r.id, 'SISTEM',
                        '/attempts/' || r.id, '', array[r.owner_employee_id], false);
    v_unrespon_count := v_unrespon_count + 1;
  end loop;

  -- Kaki 2: [Unrespon] -> Not Qualified, 14 hari kalender LAGI diam.
  for r in
    select pa.id, pa.owner_employee_id, pa.created_at
      from prospect_attempts pa
     where pa.status = '[Unrespon]'
  loop
    select max(a.created_at) into v_last_transition
      from audit_log a
     where a.entity_type = 'prospect_attempt' and a.entity_id = r.id
       and a.action like 'transition:%';
    if v_last_transition is null then
      v_last_transition := r.created_at;
    end if;

    if v_today - wib_date(v_last_transition) < 14 then
      continue;
    end if;

    -- Baris alasan SEBELUM transisi — urutan yang sama dengan
    -- sales.setNotQualified (packages/domain/src/sales.ts). Taksonomi
    -- tertutup M1-OA-8: '[Tidak ada respon]' sudah ada, nol perluasan.
    insert into prospect_attempt_nq_reasons (attempt_id, reason, created_by)
    values (r.id, '[Tidak ada respon]', 'SISTEM')
    on conflict (attempt_id, reason) do nothing;

    res := sm_transition('prospect_attempt', 'prospect_attempt', 'prospect_attempts',
                         'id', 'status', r.id, 'Not Qualified', 'SISTEM', false, false);
    if not (res ->> 'ok')::boolean then
      raise exception 'leads_unrespon_tick: % -> Not Qualified gagal: %', r.id, res;
    end if;

    perform notify_emit('m1.attempt.auto_not_qualified', 'prospect_attempt', r.id, 'SISTEM',
                        '/attempts/' || r.id, '', array[r.owner_employee_id], false);
    v_nq_count := v_nq_count + 1;
  end loop;

  return jsonb_build_object('unrespon', v_unrespon_count, 'auto_not_qualified', v_nq_count);
end;
$$;

comment on function leads_unrespon_tick(timestamptz) is
  'Revisi Sales/Creative/Performa L3 — job harian: New Lead/Contacted -> [Unrespon] setelah 3 hari kalender diam (jangkar audit_log transition terakhir); [Unrespon] -> Not Qualified otomatis setelah 14 hari kalender LAGI diam, dengan baris NQ [Tidak ada respon]. Idempoten lewat kriteria status (nol kolom penanda). Aktor SISTEM.';

revoke execute on function leads_unrespon_tick(timestamptz) from public;

-- pg_cron dibungkus IF EXISTS (absen di Postgres polos CI/lokal) — pola
-- stage_overdue_tick/penugasan_reminder_tick. '30 22 * * *' UTC = 05:30 WIB
-- (WIB = UTC+7, tanpa DST) — sebelum jam kerja mulai (08:00 WIB), sesudah
-- tengah malam WIB supaya "hari kalender" yang dihitung wib_date(now())
-- konsisten dengan hari yang baru saja lewat tengah malam.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('m1_leads_unrespon_tick', '30 22 * * *',
                          $job$ SELECT public.leads_unrespon_tick(now()); $job$);
  END IF;
END;
$cron$;
