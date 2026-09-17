-- 043_company_address.sql
-- A structured postal address on `companies`.
--
-- WHY. Until now a company's whereabouts lived in ONE free-text column,
-- `location` — filled on 1,565 of the 1,567 companies in the live database,
-- almost always as "City, ST". That is enough to say where a client is and is
-- what the lead screens read. It is NOT enough to put on a contract, an
-- invoice or an envelope, which is what the owner asked for when the BD
-- New Job form started collecting client details (Session 26).
--
-- WHY THE OLD COLUMN STAYS. `location` is read in several places and holds the
-- only address 1,565 rows have. Dropping it, or trying to split it into these
-- columns by guessing where the street ends, would turn good data into
-- confidently wrong data. So this is purely ADDITIVE: every existing row keeps
-- exactly what it has and reads back with six nulls, and the app treats
-- `location` as the short display form and these columns as the postal one.
-- A row may legitimately have one, the other, or both.
--
-- ORDERING MATTERS: apply this BEFORE deploying the code that writes these
-- columns. An insert naming a column that does not exist fails the whole
-- insert, which here would mean nobody can create a job order.

alter table public.companies
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city          text,
  add column if not exists state         text,
  add column if not exists postal_code   text,
  add column if not exists country       text;

comment on column public.companies.address_line1 is
  'Street address, line 1. Postal address, added 043. The short display form stays in `location`.';
comment on column public.companies.address_line2 is
  'Street address, line 2 — suite, floor, unit. Optional.';
comment on column public.companies.city is
  'Postal city. May differ from the city in `location`, which is the short display form.';
comment on column public.companies.state is
  'State / province / region, as the client writes it.';
comment on column public.companies.postal_code is
  'Zip / postal code. Text, never a number — leading zeros are real (00501) and non-US codes contain letters and spaces.';
comment on column public.companies.country is
  'Country. Free text rather than an enum: this is typed by a BD, and refusing an unrecognised country would block a real job order.';
