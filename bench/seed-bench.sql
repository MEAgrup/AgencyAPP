-- Synthetic load for perf benchmarking ONLY (local throwaway DB).
-- 25 clients x (2 services, 3 briefs/service, 3 assets/brief) + bookings +
-- complaints + campaigns + metric entries + audit transition rows.
begin;

insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                     sales_pic_id, commission_payment_pic_id, created_by, assigned_am_id, created_at)
select 'CLI-202607-' || lpad(g::text, 4, '0'), 'PIC ' || g, 'Toko ' || g, 'Jakarta',
       'https://x/' || g, 'Fashion', 100000000, 200000000, 'EMP-0001', 'EMP-0001', 'EMP-0001',
       'EMP-0002', timestamptz '2026-01-01'
from generate_series(1, 25) g;

insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                      commission_rule, status, created_by)
select 'SVC-202607-' || lpad((c.n * 10 + s)::text, 4, '0'),
       'CLI-202607-' || lpad(c.n::text, 4, '0'), 'MSV-202608-0001', 1, 'Layanan ' || s,
       10000000, 'percentage', 'In Execution', 'EMP-0001'
from generate_series(1, 25) c(n), generate_series(1, 2) s;

insert into briefs (id, service_id, title, status, created_by, assigned_division, assigned_pic,
                    sla_target_hours, created_at)
select 'BRF-202607-' || lpad((s.n * 10 + b)::text, 5, '0'),
       'SVC-202607-' || lpad(s.n::text, 4, '0'), 'Brief ' || b, '[Approved]', 'EMP-0001',
       case when b = 1 then 'Ads' else 'Creative' end,
       case when b = 1 then 'EMP-0004' else 'EMP-0003' end,
       48, timestamptz '2026-07-02'
from generate_series(11, 260) s(n), generate_series(1, 3) b
where s.n % 10 between 1 and 2;

insert into assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, sla_target_hours,
                    attributed_gmv, created_by, created_at)
select 'AST-202607-' || lpad((b.rn * 10 + a)::text, 6, '0'), b.id, 'Video', a, 'EMP-0003',
       '[Approved]', 48, 5000000, 'EMP-0001', timestamptz '2026-07-02'
from (select id, row_number() over (order by id) rn from briefs) b, generate_series(1, 3) a;

insert into creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate,
                              status, sla_target_hours, assigned_coordinator, created_by, created_at)
select 'BKG-202607-' || lpad(b.rn::text, 5, '0'), b.id, 'Creator ' || b.rn, 'TikTok', 'Internal',
       1000000, '[QC Passed]', 48, 'EMP-0005', 'EMP-0001', timestamptz '2026-07-02'
from (select id, row_number() over (order by id) rn from briefs) b
where b.rn % 3 = 0;

insert into complaints (id, client_id, source, description, severity, status, assigned_to,
                        created_by, created_at)
select 'CMP-202607-' || lpad((c.n * 10 + k)::text, 5, '0'),
       'CLI-202607-' || lpad(c.n::text, 4, '0'), 'Client', 'Keluhan ' || k, 'Low', '[Resolved]',
       'EMP-0002', 'EMP-0001', timestamptz '2026-07-03'
from generate_series(1, 25) c(n), generate_series(1, 4) k;

-- Audit transition rows: one [Approved] per asset/brief/booking, one [Resolved] per complaint.
insert into audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json,
                       created_by, created_at)
select 'asset', id, 'EMP-0003', 'transition:[In Progress]->[Approved]', '{}'::jsonb, '{}'::jsonb,
       'EMP-0003', timestamptz '2026-07-04'
from assets;

insert into audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json,
                       created_by, created_at)
select 'asset', id, 'EMP-0003', 'transition:[Approved]->[Revision Requested]', '{}'::jsonb,
       '{}'::jsonb, 'EMP-0003', timestamptz '2026-07-05'
from assets where right(id, 1) in ('0', '3', '6');

insert into audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json,
                       created_by, created_at)
select 'brief', id, 'EMP-0004', 'transition:[In Progress]->[Approved]', '{}'::jsonb, '{}'::jsonb,
       'EMP-0004', timestamptz '2026-07-04'
from briefs;

insert into audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json,
                       created_by, created_at)
select 'creator_booking', id, 'EMP-0005', 'transition:[In QC]->[QC Passed]', '{}'::jsonb,
       '{}'::jsonb, 'EMP-0005', timestamptz '2026-07-04'
from creator_bookings;

insert into audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json,
                       created_by, created_at)
select 'complaint', id, 'EMP-0002', 'transition:[In Progress]->[Resolved]', '{}'::jsonb,
       '{}'::jsonb, 'EMP-0002', timestamptz '2026-07-06'
from complaints;

insert into ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, status, created_by)
select 'CMP-ADS-' || lpad(b.rn::text, 5, '0'), b.id, sv.client_id, 'Meta', 'Sales', 50000000,
       date '2026-07-01', date '2026-07-31', 'ROAS 3.0', 'Active', 'EMP-0004'
from (select id, service_id, row_number() over (order by id) rn from briefs where assigned_division = 'Ads') b
join services sv on sv.id = b.service_id;

insert into metric_entries (id, campaign_id, period_start, period_end, spend, gmv, entry_method, entered_by, created_by)
select 'MTR-202607-' || lpad(row_number() over (order by c.id, d)::text, 5, '0'), c.id,
       date '2026-07-01' + d, date '2026-07-01' + d, 1000000, 4000000, 'manual', 'EMP-0004', 'EMP-0004'
from ad_campaigns c, generate_series(0, 6) d;

commit;
