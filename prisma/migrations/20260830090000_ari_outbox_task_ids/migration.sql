-- The Channex task ids returned by the call that settled an outbox row.
--
-- A task id is the only handle on what Channex actually received - it is what
-- PMS certification is graded on, and what answers "did this price really
-- reach the channel" once the push is long finished. The drain returned them
-- to its caller and dropped them.
--
-- Nullable, so every existing row stays valid and simply has no record of the
-- call that settled it.
ALTER TABLE "AriOutbox" ADD COLUMN "taskIds" TEXT;
