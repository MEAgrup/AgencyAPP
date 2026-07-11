-- W1-03 · Win resolution: winning salesperson on the Lead record (M1 §6 rule 5:
-- "System sets the Lead record's winning attempt + winning salesperson").
-- winning_attempt (PRSP-) already exists (migration 0030); this adds the
-- denormalized winning salesperson so the Client Record handoff (M0 §6 rule 7,
-- W1-10 "inherits ... the winning salesperson") reads it straight off the lead.
-- Set ONLY by module1_leads.ResolveWin inside the win-resolution transaction,
-- never by user input (house convention #4).
ALTER TABLE leads
  ADD COLUMN winning_salesperson_employee_id VARCHAR(64) NULL AFTER winning_attempt;
