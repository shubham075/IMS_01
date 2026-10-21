-- 0007_transfer_note: an optional note on a branch transfer ("for the weekend sale"). Slice 2c.
ALTER TABLE stock_transfer ADD COLUMN note text CHECK (note IS NULL OR length(note) <= 200);
