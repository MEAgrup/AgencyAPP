# Dev environment

- Go 1.24+, MySQL 8.x (MariaDB works for local dev/test).
- Local DB bootstrap:
  ```sql
  CREATE DATABASE cdps_dev; CREATE DATABASE cdps_test;
  CREATE USER 'cdps'@'localhost' IDENTIFIED BY 'cdps';
  GRANT ALL ON cdps_dev.* TO 'cdps'@'localhost';
  GRANT ALL PRIVILEGES ON `cdps\_test%`.* TO 'cdps'@'localhost';
  GRANT CREATE, DROP ON *.* TO 'cdps'@'localhost'; -- tests create isolated DBs
  ```
- `make migrate-up` applies migrations to `cdps_dev`.
- `make test` runs all backend tests. Tests that need MySQL read
  `CDPS_TEST_MYSQL_DSN` (default `cdps:cdps@tcp(127.0.0.1:3306)/cdps_test?parseTime=true&multiStatements=true`)
  and **create an isolated database per test run** (`cdps_test_<pkg>_<rand>`),
  migrate it up, and drop it — so packages can test concurrently. If the DSN
  is unreachable the DB-bound tests skip with a notice.
- Migration file numbering is range-allocated per area to avoid collisions:
  - `0001–0009` core (id sequences, audit log)
  - `0010–0019` HRIS sync & auth (employees, sessions)
  - `0020–0029` authz, Master Service List, notifications
  - `0030+` module waves
