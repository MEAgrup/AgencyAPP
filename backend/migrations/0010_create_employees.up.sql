-- S0-06 HRIS employee sync: local mirror of the HRIS employee master.
-- CDPS never owns this data; every row is written only by the hris.Syncer
-- upsert path (docs/HRIS API CONTRACT.md §1).
CREATE TABLE employees (
    employee_id       VARCHAR(32)  NOT NULL,
    nama              VARCHAR(255) NOT NULL,
    email             VARCHAR(255) NOT NULL,
    divisi            VARCHAR(100) NOT NULL,
    jabatan           VARCHAR(100) NOT NULL,
    status_aktif      TINYINT(1)   NOT NULL,
    hris_updated_at   DATETIME(6)  NOT NULL,
    missing_from_sync TINYINT(1)   NOT NULL DEFAULT 0,
    created_at        DATETIME(6)  NOT NULL,
    updated_at        DATETIME(6)  NOT NULL,
    PRIMARY KEY (employee_id),
    UNIQUE KEY uq_employees_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
