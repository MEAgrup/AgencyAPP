-- Reverse of 0014. Pure column drops (0006/0001 hold the base schema).
ALTER TABLE qualified_form_services
    DROP COLUMN quantity,
    DROP COLUMN input_amount,
    DROP COLUMN unit,
    DROP COLUMN min_qty,
    DROP COLUMN pricing_mode,
    DROP COLUMN apply_ppn,
    DROP COLUMN subtotal;

ALTER TABLE master_service_versions
    DROP COLUMN category,
    DROP COLUMN unit,
    DROP COLUMN min_qty,
    DROP COLUMN pricing_mode,
    DROP COLUMN apply_ppn,
    DROP COLUMN frequency,
    DROP COLUMN price_note,
    DROP COLUMN description;
