-- CDPS M16 — Akun A, LT-27: emitter tahapan + tick harian `stage_overdue_tick`.
--
-- Katalog v12 (5 event milik Akun A: dispatched/diterima_divisi/dikembalikan/
-- butuh_aksi_am/lewat_target) SUDAH terdaftar di Tahap F
-- (`20260829001000_m16_fondasi.sql`) — migrasi ini HANYA menambah emitter untuk
-- SATU event yang butuh job terjadwal (`m16.tahap.lewat_target`); keempat
-- lainnya diemit langsung dari domain (`account.insertBrief`, `stage.reviewBrief`,
-- `stage.advanceStage` — lihat berkas TS, bukan migrasi). Nol tabel/mesin/prefix
-- baru di sini ⇒ SEMUA gate F-5 TETAP (tabel 127, sm_machines 28, notif_events 65).
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENSI TANPA KOLOM/TABEL BARU (HANDOFF_M16_AKUN_A.md §1.6)
-- ---------------------------------------------------------------------------
-- Pola `penugasan_reminder_tick` (20260814120000) memakai KOLOM penanda +
-- trigger beku. Di sini itu tidak pas: `production_stage` sebuah Brief BERGANTI
-- (bukan sekali terisi seperti due_date), jadi kolom penanda butuh trigger yang
-- me-reset-nya setiap kali tahap berganti — kerja ekstra untuk sesuatu yang
-- tabel `notifications` sudah punya SECARA GRATIS: sebelum mengemit,
-- `stage_overdue_tick` mengecek apakah SUDAH ada notifikasi
-- `m16.tahap.lewat_target` untuk Brief ini yang timestamp-nya >= saat Brief
-- MASUK ke tahap SAAT INI. Begitu tahap berganti, `masuk_pada` ikut berganti
-- (lebih baru dari notifikasi lama), jadi jendela pencarian otomatis "reset" —
-- nol kolom, nol trigger, nol tabel ledger baru.
--
-- ---------------------------------------------------------------------------
-- KENAPA `gate_pihak='AM'` TIDAK DIKECUALIKAN DARI TICK INI
-- ---------------------------------------------------------------------------
-- HANDOFF_M16_AKUN_A.md §1.3: `gate_pihak='AM'` adalah gerbang PERAN (siapa
-- boleh menjalankan transisi), bukan pengecualian lead time — beda dengan
-- `'KLIEN'` yang Rule 9 secara eksplisit keluarkan dari LEAD TIME DIVISI.
-- `stage_overdue_tick` mendeteksi keterlambatan APA PUN gate-nya (termasuk
-- 'KLIEN' — team tetap perlu tahu Approval Sampel sudah lewat target, walau
-- durasinya tidak dihitung ke Speed Score) karena ini notifikasi DIAGNOSTIK
-- ("tahap ini lambat"), bukan komponen skor.
create or replace function stage_overdue_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := wib_date(p_now);
  v_count integer := 0;
  r record;
  v_masuk_pada timestamptz;
  v_target integer;
begin
  for r in
    select b.id as brief_id, b.production_stage, b.stage_pipeline_code, b.assigned_division,
           b.assigned_pic, b.created_at, sp.machine_name,
           private.brief_owner_am(b.id) as owner_am
      from briefs b
      join stage_pipeline sp on sp.code = b.stage_pipeline_code
     where b.stage_pipeline_code is not null
       and b.production_stage is not null
  loop
    -- Target: override per Brief (brief_stage_sla) menang atas default pipeline
    -- (stage_definition) — Rule 7. Tanpa target di KEDUANYA ⇒ tidak pernah
    -- overdue (Rule 8, N/A tidak pernah di-default diam-diam).
    select coalesce(bs.target_hari_kerja, sd.target_hari_kerja)
      into v_target
      from stage_definition sd
      left join brief_stage_sla bs on bs.brief_id = r.brief_id and bs.stage_code = r.production_stage
     where sd.pipeline_code = r.stage_pipeline_code and sd.stage_code = r.production_stage;
    if v_target is null then
      continue;
    end if;

    -- Masuk tahap SAAT INI: transisi TERAKHIR ke state ini di audit_log
    -- entity_type='brief_stage' (namespace WAJIB — PRD §5.2), atau created_at
    -- kalau ini stage pertama pipeline (belum pernah bertransisi, pola yang
    -- sama dengan `leadtime.ts` boundariesFor idx===0).
    select max(a.created_at) into v_masuk_pada
      from audit_log a
     where a.entity_type = 'brief_stage' and a.entity_id = r.brief_id
       and a.action like '%->' || r.production_stage;
    if v_masuk_pada is null then
      v_masuk_pada := r.created_at;
    end if;

    if working_days_between(wib_date(v_masuk_pada), v_today) <= v_target then
      continue;
    end if;

    if exists (
      select 1 from notifications
       where event_type = 'm16.tahap.lewat_target' and entity_id = r.brief_id
         and created_at >= v_masuk_pada
    ) then
      continue;
    end if;

    perform notify_emit('m16.tahap.lewat_target', 'brief_stage', r.brief_id, 'SISTEM',
                        '', r.assigned_division, array[r.assigned_pic, r.owner_am], false);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('lewat_target', v_count);
end;
$$;

comment on function stage_overdue_tick(timestamptz) is
  'M16 LT-27 — job harian: tahap yang melewati target_hari_kerja (override brief_stage_sla > default stage_definition) mengemit m16.tahap.lewat_target ke PIC + lead divisi + AM pemilik. Idempoten lewat notifications.created_at >= masuk_pada (nol kolom/tabel penanda baru). Aktor SISTEM.';

revoke execute on function stage_overdue_tick(timestamptz) from public;

-- pg_cron dibungkus IF EXISTS (absen di Postgres polos CI/lokal) — pola
-- `penugasan_reminder_tick`/`interview_daily_tick`. 08:00 WIB = 01:00 UTC:
-- setelah tick Penugasan (00:00 UTC), sebelum jam kerja mulai.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('m16_stage_overdue_tick', '0 1 * * *',
                          $job$ SELECT public.stage_overdue_tick(now()); $job$);
  END IF;
END;
$cron$;
