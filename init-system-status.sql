-- Initialize system_status table with default 'auto' mode
-- Run this SQL script if the table is empty

INSERT INTO system_status (mode, record_date, record_time, chiller_status, fsm_state, created_at)
VALUES ('auto', CURRENT_DATE, CURRENT_TIME, 'OFF', 'S0', NOW())
ON CONFLICT DO NOTHING;

-- Or if you want to ensure there's always exactly one record:
-- DELETE FROM system_status;
-- INSERT INTO system_status (mode, record_date, created_at)
-- VALUES ('auto', CURRENT_DATE, NOW());

