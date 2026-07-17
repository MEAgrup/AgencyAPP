-- Reverse of 0023. Drops the Complaint entity created by the up migration.
-- Nothing in 0002/0010/0020/0021/0022 was relaxed, so there is nothing to
-- restore beyond removing the new table.
DROP TABLE complaints;
