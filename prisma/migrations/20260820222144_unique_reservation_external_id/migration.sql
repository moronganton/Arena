-- A re-import must never be able to create a second reservation for a stay
-- that already exists. Postgres permits any number of NULLs in a unique
-- index, so direct bookings carrying no OTA reference are unaffected.
--
-- Verified before writing this: 166 of 171 reservations carry an externalId
-- and none of them collide, so the index builds without conflict.
CREATE UNIQUE INDEX "Reservation_externalId_key" ON "Reservation"("externalId");
