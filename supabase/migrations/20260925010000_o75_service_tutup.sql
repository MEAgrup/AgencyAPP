-- ============================================================================
-- O75 — Service akhirnya punya jalur untuk SELESAI.
--
-- Keputusan pemilik 2026-09-08 (menutup O75, `docs/DECISIONS.md`):
--
--   * SIAPA          : AM pemilik MENGAJUKAN → Head of Account MENYETUJUI.
--                      `require_lead = true` di sisi persetujuan.
--   * GERBANG WAJIB  : `contracts.tanggal_akhir` sudah LEWAT.
--   * TANGGAL SELESAI: tanggal transisi ke `Done` disimpan sebagai sumber
--                      `accrual.tanggalSelesai`.
--   * BACKFILL       : lewat `sm_transition` aktor `SISTEM`, BUKAN `UPDATE`
--                      mentah, dan HANYA sesudah bulan pengakuannya diketok.
--                      ⛔ Migrasi ini SENGAJA tidak membackfill apa pun — lihat
--                      §5.
--
-- ## Kenapa ini penting, bukan kerapian
--
-- Edge `[In Execution] → Done` sudah ada sejak `20260723055732_statemachine.sql`
-- :317 dengan NOL pemanggil di seluruh `packages/domain`. Konsekuensinya bukan
-- kosmetik:
--
--   1. Mesin accrual (`packages/core/src/accrual.ts`) mewajibkan
--      `tanggalSelesai` untuk `pengakuan = 'saat_selesai'` — menurut komentar
--      `20260922010000_dkom_pengakuan_katalog.sql` itu **38 layanan aktif** di
--      katalog. Tanpa jalur ke `Done` tidak ada satu pun sumber tanggal itu,
--      jadi pendapatan mereka mengembalikan skedul kosong beralasan
--      `[layanan belum selesai, pendapatannya diakui saat selesai]` — dan D-3
--      (kunci tutup buku) bilang bulan yang sudah ditutup tidak bisa diedit,
--      jadi rupiah yang telat diakui tidak punya bulan untuk pulang.
--   2. "Klien aktif" (`wrr_monday_job`, D-06) = ≥1 service NOT IN ('Done',
--      voided, '[On Hold]'). Karena nol service pernah `Done`, setiap klien yang
--      pernah membeli tetap dibuka rekap mingguan SELAMANYA.
--   3. Perpanjangan R-03 mencetak `SVC-` baru tanpa menutup yang lama, jadi
--      Client Portal menampilkan tiga generasi layanan sebagai "sedang jalan".
--
-- ## Bentuknya: DUA LANGKAH, meniru T-2b Hold apa adanya
--
-- Satu state baru `[Completion Requested]` (non-terminal) + tiga edge. Edge
-- LANGSUNG `[In Execution] → Done` DICABUT — persis cara T-2b mencabut
-- `[In Execution] → [On Hold]` saat hold jadi dua-langkah
-- (`20260814080000_t2b_hold_twostep.sql`). Menutup Service adalah keputusan yang
-- TIDAK bisa dibatalkan (`Done` terminal, `sm_terminal_states`), jadi satu klik
-- satu orang bukan bentuk yang benar untuknya.
--
-- Tidak ada tabel/prefix/mesin baru ⇒ gate tabel 146, entity_prefix 40,
-- sm_machines 31 **TETAP**. Yang naik hanya `notif_events` 73 → 76 (§4).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Mesin `service`: cabut jalur satu-langkah, pasang jalur dua-langkah
-- ---------------------------------------------------------------------------
--
-- `sm_states` tidak ada sebagai tabel di skema ini — sebuah state ADA karena ia
-- muncul di `sm_edges` (terminal-nya terdaftar terpisah di `sm_terminal_states`).
-- Jadi `[Completion Requested]` lahir dari tiga baris di bawah, tanpa baris
-- state tersendiri. Ini bukan penyimpangan: `[On Hold]` dan `[Hold Requested]`
-- lahir dengan cara yang sama.

DELETE FROM sm_edges
 WHERE machine = 'service' AND from_state = '[In Execution]' AND to_state = 'Done';

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    -- AM pemilik mengajukan. `require_lead = false` seperti seluruh edge
    -- "mengajukan" yang digerakkan non-lead (T-2b `[Hold Requested]`); gerbang
    -- SIAPA yang lebih ketat (AM pemilik / Account lead / Director) ada di
    -- `client.ts::requestServiceCompletion`, sama seperti `canRequestHold`.
    ('service', '[In Execution]',         '[Completion Requested]', false),
    -- Head of Account menyetujui. `require_lead = true` — ketokan pemilik.
    ('service', '[Completion Requested]', 'Done',                   true),
    -- Head of Account menolak: kembali jalan.
    ('service', '[Completion Requested]', '[In Execution]',         true);

-- ⚠️ SENGAJA TIDAK ADA edge `[Completion Requested] → [Cancelled — Service
-- Voided]`. Alasannya konsistensi, bukan kelupaan: `[Hold Requested]` dan
-- `[On Hold]` juga tidak punya edge void (`20260814030000`/`20260814080000`),
-- jadi menambahkannya hanya untuk state ini akan membuat mesin `service`
-- menjawab pertanyaan "boleh void dari state menunggu?" dengan dua jawaban
-- berbeda. Konsekuensinya jujur: sebuah Service yang sedang menunggu ACC tutup
-- harus DITOLAK dulu (satu klik Head) sebelum bisa di-void.

-- ---------------------------------------------------------------------------
-- 2. Gerbang WAJIB di DB: kontrak harus sudah berakhir
-- ---------------------------------------------------------------------------
--
-- Aturan rumah: penegakan ada di DB, bukan cuma di TS. Gerbang ini ditulis
-- sebagai trigger dan BUKAN sebagai `require_lead`/edge, karena mesin transisi
-- tidak bisa melihat kolom baris lain (alasan yang sama dengan
-- "Direct-breakdown guard" di `STATE_MACHINES.md` §6 dan dengan
-- `guard_floor_disetujui` O57).
--
-- Tersedia karena A-4 (K-2, `sales.ts:1683`): sejak A-4 setiap closing mencetak
-- baris `contracts` dengan `tanggal_akhir` eksplisit, dan setiap `SVC-` yang
-- lahir dari closing itu menggantung padanya (`services.contract_id`).
--
-- ⚠️ SERVICE TANPA KONTRAK (`contract_id IS NULL`) TETAP BOLEH DITUTUP, dan itu
-- keputusan yang perlu dilihat, bukan celah:
--   * `contract_id` null berarti SEMUA baris closing-nya sekali-jadi — tidak ada
--     jendela periodik yang dicetak (`sales.resolveClosingWindow` mengembalikan
--     null). Jadi "kontraknya sudah berakhir" bukan syarat yang BELUM terpenuhi,
--     ia syarat yang TIDAK ADA.
--   * Justru layanan sekali-jadi itulah yang `pengakuan = 'saat_selesai'`.
--     Memblokirnya sampai ada kontrak = membiarkan O75 tetap terbuka tepat pada
--     38 layanan yang paling membutuhkannya.
--   * Yang menjaganya tetap dua-langkah: persetujuan Head of Account tetap
--     wajib. Yang hilang hanya gerbang TANGGAL, karena tidak ada tanggal.
-- Dicatat sebagai asumsi eksplisit di `docs/DECISIONS.md` (O75), supaya kalau
-- pemilik memutuskan sebaliknya yang berubah cuma satu `IF` di sini.

CREATE OR REPLACE FUNCTION guard_service_tutup_butuh_kontrak_berakhir()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_akhir date;
BEGIN
  IF NEW.status = '[Completion Requested]' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.contract_id IS NOT NULL THEN
      SELECT c.tanggal_akhir INTO v_akhir
        FROM contracts c
       WHERE c.id = NEW.contract_id AND c.client_id = NEW.client_id;
      -- `>=` bukan `>`: kontrak yang berakhir HARI INI belum lewat. Hari
      -- terakhir adalah hari kerja, bukan hari tutup.
      IF v_akhir IS NOT NULL AND v_akhir >= wib_date(now()) THEN
        RAISE EXCEPTION '[service belum boleh ditutup sebelum kontraknya berakhir]';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION guard_service_tutup_butuh_kontrak_berakhir() IS
  'O75 (ketokan pemilik 2026-09-08): pengajuan tutup Service ditolak selama '
  '`contracts.tanggal_akhir` belum lewat. Service tanpa kontrak lolos gerbang '
  'tanggal (tidak ada jendela periodik untuk ditunggu) — persetujuan Head of '
  'Account tetap wajib.';

CREATE TRIGGER trg_service_tutup_butuh_kontrak_berakhir
    BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION guard_service_tutup_butuh_kontrak_berakhir();

-- ---------------------------------------------------------------------------
-- 3. TANGGAL SELESAI — dibaca dari log, tidak disimpan dua kali
-- ---------------------------------------------------------------------------
--
-- Ketokan bilang "simpan tanggal transisi ke Done sebagai sumber
-- `accrual.tanggalSelesai`". Ia SUDAH tersimpan: `sm_transition` menulis baris
-- `audit_log` ber-`action = 'transition:<from>-><to>'` (statemachine.sql:134),
-- dan `audit_log` menolak UPDATE/DELETE (aturan rumah #3). Menambah kolom
-- `services.selesai_pada` berarti menyimpan fakta yang sama dua kali di tempat
-- yang bisa berbeda — persis yang aturan rumah #4 larang ("selalu bisa dihitung
-- ulang dari log").
--
-- Jadi yang dibangun adalah PINTU BACANYA, dan ia `private.*` SECURITY DEFINER
-- karena `audit_log_select` tidak memberi AM/Finance hak baca baris audit
-- Service milik divisi lain: sebuah subquery langsung akan diam-diam
-- mengembalikan NULL di bawah RLS (perangkap O52 versi "angka salah, bukan
-- galat"), dan NULL di situ tidak bisa dibedakan dari "belum selesai".
-- Pola + alasan sama dengan `private.brief_jumlah_anak` (A-req-3).
--
-- Mengembalikan `date` dalam WIB, bukan `timestamptz`: yang dibutuhkan mesin
-- accrual adalah `YYYY-MM-DD` (`AccrualInput.tanggalSelesai`), dan bulan
-- pengakuan sebuah rupiah tidak boleh bergeser karena zona waktu pembacanya.

CREATE OR REPLACE FUNCTION private.service_tanggal_selesai(p_service_id text)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  -- Baris TERAKHIR yang mendarat di `Done`. `Done` terminal, jadi normalnya ada
  -- nol atau satu — `order by` + `limit 1` supaya sebuah backfill yang pernah
  -- salah jalan tidak membuat fungsi ini melempar "more than one row".
  SELECT wib_date(a.created_at)
    FROM public.audit_log a
   WHERE a.entity_type = 'service'
     AND a.entity_id = p_service_id
     AND a.action LIKE 'transition:%->Done'
   ORDER BY a.created_at DESC, a.id DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION private.service_tanggal_selesai(text) IS
  'O75: tanggal (WIB) sebuah Service mencapai `Done`, dibaca dari audit_log '
  'transisinya — sumber `accrual.AccrualInput.tanggalSelesai` untuk layanan '
  'ber-`pengakuan = saat_selesai`. NULL = belum pernah selesai.';

-- ---------------------------------------------------------------------------
-- 4. Katalog notifikasi v16 — tiga event
-- ---------------------------------------------------------------------------
--
-- Bentuknya menyalin v8 (T-2c Hold) baris per baris, termasuk resolver-nya:
-- pengajuan → lead divisi Account (`leadsOfDivision`), keputusan → AM pemilik
-- (`explicit`). Deskripsi di sini WAJIB identik dengan yang di
-- `packages/core/src/notification.ts` — `notif_catalog.reals.test.ts`
-- membandingkan TS ≡ DB.
--
-- Invariant O55 menghitung SUM(event_count) = COUNT(notif_events); JANGAN
-- hardcode 76 di mana pun kecuali gate `db-rebuild.sh` + `ci.yml`, yang
-- dinaikkan di commit yang SAMA dengan migrasi ini (memisahkannya membuat CI
-- merah menurut konstruksinya sendiri — PR #170).

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (16,
     'O75 tutup Service dua-langkah — 3 event (service_completion_requested → Head of Account; service_completed / service_completion_rejected → AM pemilik)',
     3,
     'docs/DECISIONS.md 2026-09-08 (O75 — siapa yang menutup Service + gerbangnya)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('service_completion_requested', 'AM mengajukan Service selesai — ke Head of Account',            'leadsOfDivision', 16),
    ('service_completed',            'Service dinyatakan selesai oleh Head of Account — ke AM pemilik','explicit',        16),
    ('service_completion_rejected',  'Pengajuan Service selesai ditolak — ke AM pemilik',              'explicit',        16);

-- ---------------------------------------------------------------------------
-- 5. ⛔ BACKFILL SENGAJA TIDAK DIJALANKAN DI SINI
-- ---------------------------------------------------------------------------
--
-- Ketokan pemilik: backfill "hanya sesudah keputusan bulan pengakuannya".
-- Itu syarat yang belum terpenuhi, jadi migrasi ini tidak menyentuh satu baris
-- data pun — kalau ia menutup Service lama hari ini, tanggal `Done`-nya menjadi
-- HARI MIGRASI DIJALANKAN, dan mesin accrual akan mengakui pendapatan lama itu
-- di bulan yang kebetulan sedang berjalan. Itu keputusan keuangan yang diambil
-- oleh efek samping sebuah deploy.
--
-- Yang perlu diketok lebih dulu: sebuah Service yang kontraknya berakhir Maret
-- lalu dan pekerjaannya tuntas, pendapatannya diakui di bulan MANA — bulan
-- kontrak berakhir, atau bulan ia dinyatakan selesai?
--
-- Kandidat barisnya (jalankan untuk melihat besarnya, ini murni SELECT):
--
--   select s.id, s.name, c.id as contract_id, c.tanggal_akhir
--     from services s
--     join contracts c on c.id = s.contract_id and c.client_id = s.client_id
--    where s.status = '[In Execution]'
--      and c.tanggal_akhir < wib_date(now())
--    order by c.tanggal_akhir;
--
-- Saat diketok nanti, backfill-nya WAJIB lewat `sm_transition` dengan aktor
-- `SISTEM` (preseden `20260922100400_a3_backfill_service_strategy_approved.sql`
-- + `PLAN_JOB_ACTOR_ID`), dua langkah berurutan per baris
-- ([In Execution] → [Completion Requested] → Done), supaya baris auditnya
-- menceritakan jalur yang sama dengan yang ditempuh manusia. `UPDATE services
-- SET status = ...` melewati mesin, melewati audit, dan melewati trigger §2
-- sekaligus.
