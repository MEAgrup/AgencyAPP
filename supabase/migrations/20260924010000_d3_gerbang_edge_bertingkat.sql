-- ===========================================================================
-- D-3 (1/3) — gerbang peran BERTINGKAT di sm_edges
-- ===========================================================================
--
-- MASALAHNYA. Kunci tutup buku D-3 punya dua wewenang yang SENGAJA berbeda
-- (ketokan pemilik 2026-09-08):
--
--     menutup bulan   : Finance level lead  ATAU  Director
--     membuka kembali : Director SAJA
--
-- Mesin transisi yang ada tidak bisa menyatakan satu pun dari keduanya. Ia
-- hanya punya `sm_edges.require_lead`, dan gerbangnya berbunyi
-- `p_role_director OR p_role_lead` — lolos untuk lead DIVISI MANA PUN.
-- Dipakai apa adanya:
--
--   * edge "menutup" akan mengizinkan lead Creative menutup buku keuangan;
--   * edge "membuka kembali" akan mengizinkan lead mana pun membatalkan
--     tutupan Director — dan asimetri yang membuat kunci ini berarti hilang.
--
-- Menutupnya di TypeScript saja tidak cukup, dan alasannya tertulis di kepala
-- `20260723055732_statemachine.sql`: gerbang role dievaluasi DI DALAM fungsi
-- SQL justru "supaya panggilan langsung via service-role tetap tidak bisa
-- melewati gate". Untuk kendali keuangan paling sensitif di sistem ini,
-- berhenti di TS adalah tempat berhenti yang salah.
--
-- CATATAN PENYIMPANGAN. Komentar di `packages/core/src/statemachine.ts`
-- menyatakan "division-specific checks ... live in the module layer — not the
-- engine". Migrasi ini menyimpang dari kalimat itu, dengan sengaja, dan
-- penyimpangannya dicatat di docs/DECISIONS.md 2026-09-08. Yang ditambahkan
-- bukan aturan Finance: yang ditambahkan adalah KEMAMPUAN edge menyatakan
-- gerbangnya sendiri sebagai DATA — bentuk yang sama dengan `require_lead`
-- yang sudah ada, sehingga mesin baru tetap tidak butuh redeploy kode.
--
-- YANG BERUBAH UNTUK 31 MESIN LAMA: NOL. `require_director` lahir `false` dan
-- `require_division` lahir NULL, dan pada nilai itu ekspresi gerbangnya
-- tereduksi kata-per-kata menjadi gerbang lama.
-- ===========================================================================

-- --- 1. Dua kolom gerbang baru ---------------------------------------------

ALTER TABLE sm_edges
    ADD COLUMN require_director boolean NOT NULL DEFAULT false,
    ADD COLUMN require_division text    NULL;

-- Divisi hanya MENYEMPITKAN cabang lead. Tanpa `require_lead`, sebuah divisi
-- yang diisi tidak akan pernah dibaca — gerbang yang diam-diam tidak berlaku
-- persis kelas bug yang aturan rumah #4 larang ("ketiadaan yang diam tidak
-- bisa dibedakan dari kerusakan"). Jadi kombinasi itu ditolak, bukan diabaikan.
ALTER TABLE sm_edges ADD CONSTRAINT ck_sm_edges_divisi_butuh_lead
    CHECK (require_division IS NULL OR require_lead);

-- `require_director` menang mutlak atas `require_lead`; kalau keduanya menyala,
-- `require_lead` tidak menambah apa pun dan pembacanya akan salah menduga
-- "lead juga boleh". Ditolak karena satu edge tidak boleh membawa dua gerbang
-- yang salah satunya mati.
ALTER TABLE sm_edges ADD CONSTRAINT ck_sm_edges_director_eksklusif
    CHECK (NOT (require_director AND require_lead));

COMMENT ON COLUMN sm_edges.require_director IS
  'Edge ini HANYA untuk Director. Lead level mana pun ditolak. Eksklusif '
  'terhadap require_lead (ck_sm_edges_director_eksklusif).';
COMMENT ON COLUMN sm_edges.require_division IS
  'Menyempitkan cabang LEAD dari require_lead ke satu divisi (mis. ''Finance''). '
  'NULL = lead divisi mana pun, perilaku asli. Director selalu lolos, karena '
  'Director tidak punya divisi (Phase 0 §4: peran berlapis di atas satu akun).';

-- --- 2. sm_transition: parameter divisi aktor ------------------------------
--
-- Parameter ke-11 TANPA DEFAULT, dan versi 10-parameter DIBUANG. Sengaja:
-- sebuah default akan membuat pemanggil lama tetap kompilasi sambil diam-diam
-- mengirim "divisi tidak diketahui", dan edge ber-divisi akan menolak mereka
-- dengan pesan yang menyesatkan. Menghapus overload lama memaksa setiap
-- pemanggil menyebut divisi aktornya — kegagalannya keras dan di tempat yang
-- benar. (Overload berdampingan juga akan membuat panggilan 10-argumen
-- ambigu: "function is not unique".)

DROP FUNCTION IF EXISTS sm_transition(text, text, text, text, text, text, text, text, boolean, boolean);

CREATE OR REPLACE FUNCTION sm_transition(
    p_machine           text,
    p_entity_type       text,
    p_table             text,
    p_id_col            text,
    p_status_col        text,
    p_entity_id         text,
    p_to                text,
    p_actor_employee_id text,
    p_role_director     boolean,
    p_role_lead         boolean,
    p_role_division     text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_machine          sm_machines%ROWTYPE;
    v_from             text;
    v_require_lead     boolean;
    v_require_director boolean;
    v_require_division text;
    v_id_type          text;
BEGIN
    -- Actor wajib (mirror audit.ErrNoActor) — jaring pengaman kedua di sisi SQL.
    IF p_actor_employee_id IS NULL OR p_actor_employee_id = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'no_actor',
                                  'message', 'audit: every write requires an actor');
    END IF;

    SELECT * INTO v_machine FROM sm_machines WHERE name = p_machine;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'unknown_machine',
                                  'message', format('statemachine: unknown machine %L', p_machine));
    END IF;
    IF v_machine.auto_computed THEN
        RETURN jsonb_build_object('ok', false, 'code', 'auto_computed',
                                  'message', format('statemachine: %L status is auto-computed; manual transitions are not allowed', p_machine));
    END IF;

    -- Tipe kolom id, dibaca dari katalog (20260908020000). `format_type`
    -- menghasilkan nama tipe kanonik dari sistem (bukan masukan pemanggil),
    -- jadi aman diinterpolasi.
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_id_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = p_table
       AND a.attname = p_id_col AND a.attnum > 0 AND NOT a.attisdropped;
    v_id_type := coalesce(v_id_type, 'text');

    -- Kunci baris entity & baca status otoritatif (SELECT ... FOR UPDATE dinamis).
    -- Catatan: EXECUTE TIDAK meng-set variabel FOUND di PL/pgSQL, jadi deteksi
    -- "tidak ada baris" memakai v_from IS NULL — valid karena kolom status entity
    -- selalu NOT NULL (skema port), sehingga NULL ⇔ baris tidak ditemukan.
    EXECUTE format('SELECT %I FROM %I WHERE %I = $1::%s FOR UPDATE',
                   p_status_col, p_table, p_id_col, v_id_type)
        INTO v_from USING p_entity_id;
    IF v_from IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_found',
                                  'message', format('statemachine: entity %s not found', p_entity_id));
    END IF;

    -- Cek edge (from -> to). Tidak terdaftar = blocked dengan pesan machine.
    SELECT e.require_lead, e.require_director, e.require_division
      INTO v_require_lead, v_require_director, v_require_division
      FROM sm_edges e
     WHERE e.machine = p_machine AND e.from_state = v_from AND e.to_state = p_to;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'message', v_machine.block_message);
    END IF;

    -- Gerbang role, dua tingkat.
    --
    --   require_director : Director SAJA. Lead mana pun ditolak.
    --   require_lead     : Director ATAU lead — dipersempit ke satu divisi
    --                      kalau require_division diisi.
    --
    -- Pada (false, NULL) — nilai 31 mesin lama — cabang pertama mati dan
    -- cabang kedua berbunyi `NOT (director OR lead)`, sama persis dengan
    -- gerbang sebelum migrasi ini. OD tidak pernah menulis.
    IF v_require_director AND NOT p_role_director THEN
        RETURN jsonb_build_object('ok', false, 'code', 'role_denied',
                                  'message', '[anda tidak memiliki akses untuk melakukan transisi ini]');
    END IF;
    IF v_require_lead AND NOT (
           p_role_director
        OR (p_role_lead AND (v_require_division IS NULL
                             OR p_role_division IS NOT DISTINCT FROM v_require_division))
       ) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'role_denied',
                                  'message', '[anda tidak memiliki akses untuk melakukan transisi ini]');
    END IF;

    -- Terapkan perubahan status (SATU-SATUNYA tempat kolom status ditulis).
    EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2::%s', p_table, p_status_col, p_id_col, v_id_type)
        USING p_to, p_entity_id;

    -- Baris audit immutable (before -> after), dalam transaksi yang sama.
    INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
    VALUES (p_entity_type, p_entity_id, p_actor_employee_id,
            'transition:' || v_from || '->' || p_to,
            jsonb_build_object('status', v_from),
            jsonb_build_object('status', p_to),
            p_actor_employee_id);

    RETURN jsonb_build_object('ok', true, 'from', v_from, 'to', p_to);
END;
$$;

COMMENT ON FUNCTION sm_transition(text, text, text, text, text, text, text, text, boolean, boolean, text) IS
  'Engine transisi status: row lock + validasi edge + gerbang role BERTINGKAT + '
  'baris audit dalam SATU transaksi. Satu-satunya penulis kolom status. Sadar '
  'tipe kolom id (20260908020000). Gerbang bertingkat (20260924010000): '
  'require_director = Director saja; require_lead + require_division = Director '
  'atau lead divisi itu.';

-- --- 3. Mengembalikan hak akses & SECURITY DEFINER yang hilang -------------
--
-- `DROP FUNCTION` membuang ACL fungsi bersama fungsinya. Tanpa blok ini,
-- `sm_transition` yang baru lahir dengan EXECUTE untuk PUBLIC — artinya `anon`
-- dan `authenticated` bisa memanggil mesin transisi langsung. Itu regresi
-- keamanan yang nyata, dan `rls_checks` di `scripts/db-rebuild.sh` TIDAK
-- menangkapnya (ia memeriksa tabel, bukan ACL fungsi). Ditemukan dengan
-- membandingkan `proacl` terhadap dua saudaranya, bukan dengan membaca kode.
REVOKE EXECUTE ON FUNCTION public.sm_transition(
    text, text, text, text, text, text, text, text, boolean, boolean, text)
    FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_transition(
    text, text, text, text, text, text, text, text, boolean, boolean, text)
    TO service_role;

-- TEMUAN TERPISAH, LEBIH TUA DARI MIGRASI INI, dan sengaja diperbaiki di sini
-- karena di sinilah fungsinya sedang ditulis ulang.
--
-- `20260723064438_rls_baseline.sql` §3 menjadikan ident_next / sm_transition /
-- notify_emit bertiga SECURITY DEFINER. Sejak `20260908020000` menulis ulang
-- `sm_transition` dengan CREATE OR REPLACE tanpa menyebut SECURITY DEFINER,
-- atribut itu DIAM-DIAM kembali ke SECURITY INVOKER — CREATE OR REPLACE
-- mengembalikan atribut opsional yang tidak disebut ke nilai bakunya, dan
-- perilaku itu diverifikasi langsung, bukan diingat dari dokumentasi.
-- Buktinya masih terlihat di katalog: kedua saudaranya `prosecdef = true`,
-- `sm_transition` sendirian `false`.
--
-- Tidak ada yang rusak karenanya (CDPS memanggilnya lewat service_role, yang
-- melewati RLS apa pun), jadi ini pemulihan niat yang tertulis — bukan
-- perbaikan kerusakan yang sedang terjadi. Disebut apa adanya supaya tidak
-- dibaca sebagai temuan Gelombang D.
ALTER FUNCTION public.sm_transition(
    text, text, text, text, text, text, text, text, boolean, boolean, text)
    SECURITY DEFINER SET search_path = public, pg_temp;

-- --- 4. Pemanggil SQL: dua job yang memanggil sm_transition dari dalam DB ---
--
-- `wrr_monday_job` dan `leads_unrespon_tick` memanggil `sm_transition` di dalam
-- badan PL/pgSQL-nya, jadi keduanya ikut patah saat tanda tangannya berubah —
-- dan patahnya baru terlihat SAAT DIJALANKAN, bukan saat migrasi ini di-apply,
-- karena PL/pgSQL me-resolve nama fungsi pada waktu eksekusi. Itulah yang
-- membuat 23 tes merah dan bukan nol.
--
-- Definisi di bawah diambil UTUH dari katalog (`pg_get_functiondef`) lalu
-- diubah SATU token: argumen divisi ditambahkan di setiap panggilan. Diambil
-- dari katalog, bukan disalin dari migrasi lama, supaya yang ditulis ulang
-- benar-benar versi TERAKHIR — `wrr_monday_job` sudah pernah didefinisikan
-- ulang di `20260814030000`, dan menyalin dari `20260813080000` akan
-- MEMUNDURKANNYA tanpa ada yang sadar.
--
-- Divisi yang dikirim '' (string kosong), bukan nama divisi karangan: kedua job
-- berjalan sebagai 'SISTEM', yang tidak punya divisi. Semua edge yang mereka
-- lewati `require_division IS NULL`, jadi '' tidak pernah dibaca — dan kalau
-- suatu hari ada edge ber-divisi di jalur ini, job-nya HARUS ditolak sampai
-- ada yang memutuskan divisi apa yang diwakili SISTEM.
CREATE OR REPLACE FUNCTION public.wrr_monday_job(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today    date    := wib_date(p_now);
  v_dow      integer := extract(isodow FROM wib_date(p_now))::int;  -- 1=Sen..7=Min
  v_monday   date;
  v_sunday   date;
  v_iso_year integer;
  v_iso_week integer;
  v_opened   integer := 0;
  v_forced   integer := 0;
  v_am       text;
  v_div      text;
  r          record;
  res        jsonb;
BEGIN
  v_monday   := v_today - (v_dow - 1);          -- Senin minggu ISO berjalan (WIB)
  v_sunday   := v_monday + 6;                    -- Minggu
  v_iso_year := extract(isoyear FROM v_monday)::int;
  v_iso_week := extract(week    FROM v_monday)::int;

  -- -----------------------------------------------------------------------
  -- FORCE-CLOSE lebih dulu (rekap minggu LALU masih Terbuka lewat grace 2 hk).
  -- -----------------------------------------------------------------------
  FOR r IN
    SELECT w.id, w.client_id
      FROM weekly_result_recap w
     WHERE w.status = 'Terbuka'
       AND w.minggu_akhir < v_monday
       AND working_days_between(w.minggu_akhir, v_today) > 2
  LOOP
    res := sm_transition('weekly_result_recap','weekly_result_recap','weekly_result_recap',
                         'id','status', r.id, 'Ditutup Otomatis', 'SISTEM', false, false, '');
    IF NOT (res ->> 'ok')::boolean THEN
      RAISE WARNING 'wrr_monday_job: force-close % gagal: %', r.id, res;
      CONTINUE;
    END IF;
    -- Tanda non-performa AM permanen + jejak penutupan (RM-5/RM-F).
    UPDATE weekly_result_recap
       SET pernah_ditutup_otomatis = true, ditutup_pada = p_now, ditutup_oleh = 'SISTEM'
     WHERE id = r.id;

    -- Job (c): saat tutup, divisi yang berutang catatan wajib (RM-8) tapi belum
    -- mengisi → catatan_divisi_belum_diisi (lead divisi + AM). "Berutang" =
    -- punya baris produksi (menyentuh klien) tanpa baris catatan divisi.
    SELECT assigned_am_id INTO v_am FROM clients WHERE id = r.client_id;
    FOR v_div IN
      SELECT d.divisi FROM wrr_divisi d
       WHERE d.recap_id = r.id
         AND NOT EXISTS (SELECT 1 FROM wrr_catatan_divisi cd
                          WHERE cd.recap_id = r.id AND cd.divisi = d.divisi)
    LOOP
      PERFORM notify_emit('catatan_divisi_belum_diisi', 'weekly_result_recap', r.id, 'SISTEM',
                          '/account/rekap/' || r.id, v_div,
                          CASE WHEN v_am IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_am] END, false);
    END LOOP;
    v_forced := v_forced + 1;
  END LOOP;

  -- -----------------------------------------------------------------------
  -- BUKA rekap minggu berjalan per klien aktif (idempoten: NOT EXISTS).
  -- plan_id = periode Plan 'Aktif' yang mencakup minggu ini (else NULL).
  -- RM-2: klien yang SEMUA service-nya '[On Hold]' (atau terminal) tak dibuka.
  -- -----------------------------------------------------------------------
  INSERT INTO weekly_result_recap
    (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, created_by)
  SELECT ident_next('WRR', p_now), c.id,
         (SELECT p.id FROM plan p
           WHERE p.client_id = c.id AND p.status = 'Aktif'
             AND p.tanggal_mulai <= v_sunday AND p.tanggal_akhir >= v_monday
           ORDER BY p.tanggal_mulai DESC LIMIT 1),
         v_iso_year, v_iso_week, v_monday, v_sunday, 'SISTEM'
    FROM clients c
   WHERE EXISTS (SELECT 1 FROM services s
                  WHERE s.client_id = c.id
                    AND s.status NOT IN ('Done', '[Cancelled — Service Voided]', '[On Hold]'))
     AND NOT EXISTS (SELECT 1 FROM weekly_result_recap w
                      WHERE w.client_id = c.id
                        AND w.iso_year = v_iso_year AND w.iso_week = v_iso_week);

  -- Transisi Terjadwal→Terbuka + agregasi awal + notif buka, per rekap baru.
  FOR r IN
    SELECT w.id, w.client_id FROM weekly_result_recap w
     WHERE w.iso_year = v_iso_year AND w.iso_week = v_iso_week AND w.status = 'Terjadwal'
  LOOP
    res := sm_transition('weekly_result_recap','weekly_result_recap','weekly_result_recap',
                         'id','status', r.id, 'Terbuka', 'SISTEM', false, false, '');
    IF NOT (res ->> 'ok')::boolean THEN
      RAISE WARNING 'wrr_monday_job: buka % gagal: %', r.id, res;
      CONTINUE;
    END IF;
    PERFORM wrr_aggregate(r.id);
    SELECT assigned_am_id INTO v_am FROM clients WHERE id = r.client_id;
    PERFORM notify_emit('rekap_mingguan_terbuka', 'weekly_result_recap', r.id, 'SISTEM',
                        '/account/rekap/' || r.id, 'Account',
                        CASE WHEN v_am IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_am] END, false);
    v_opened := v_opened + 1;
  END LOOP;

  RETURN jsonb_build_object('iso_year', v_iso_year, 'iso_week', v_iso_week,
                            'dibuka', v_opened, 'ditutup_otomatis', v_forced);
END;
$function$;

CREATE OR REPLACE FUNCTION public.leads_unrespon_tick(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                         'id', 'status', r.id, '[Unrespon]', 'SISTEM', true, false, '');
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
                         'id', 'status', r.id, 'Not Qualified', 'SISTEM', false, false, '');
    if not (res ->> 'ok')::boolean then
      raise exception 'leads_unrespon_tick: % -> Not Qualified gagal: %', r.id, res;
    end if;

    perform notify_emit('m1.attempt.auto_not_qualified', 'prospect_attempt', r.id, 'SISTEM',
                        '/attempts/' || r.id, '', array[r.owner_employee_id], false);
    v_nq_count := v_nq_count + 1;
  end loop;

  return jsonb_build_object('unrespon', v_unrespon_count, 'auto_not_qualified', v_nq_count);
end;
$function$;
