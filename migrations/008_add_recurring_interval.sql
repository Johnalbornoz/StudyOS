-- Structured recurrence for assessment schedule rules. occurrence_pattern
-- stays a free-text label ("Cada viernes") for display; interval_days is
-- the actual number the system rolls forward on (7 = weekly). NULL means
-- the rule is a one-off label with no auto-generated future occurrences.
ALTER TABLE assessment_schedule_rules ADD COLUMN IF NOT EXISTS interval_days INTEGER;
