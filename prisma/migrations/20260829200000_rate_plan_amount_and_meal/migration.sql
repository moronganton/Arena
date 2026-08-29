-- A derived plan can follow its parent by a flat amount as well as a percent.
--
-- Breakfast is the case that needs it: it costs EUR 12 a night, not 10%, and
-- encoding a fixed cost as a proportional one is right at EUR 120 and wrong at
-- EUR 200 the moment a season rule moves the base. Booking.com's own "Price
-- difference" control offers a currency and a percent side by side, so a plan
-- mirrored from there can carry either.
--
-- Both nullable and both null on the parent, so every existing row stays valid
-- and keeps meaning exactly what it meant: a percent, or nothing.
ALTER TABLE "RatePlan" ADD COLUMN "derivedAmount" DOUBLE PRECISION;

-- What Channex calls meal_type, and Booking.com shows as "Meals" on the rate
-- plan. A breakfast plan whose meal type says none would advertise wrong on any
-- channel that reads it from Channex.
ALTER TABLE "RatePlan" ADD COLUMN "mealType" TEXT;
