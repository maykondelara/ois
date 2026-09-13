-- Same Australian licence number history is permitted only for one driver in a company.
-- The preceding unique constraint was stronger, so this must be true before it is replaced.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM driver_licences
    GROUP BY company_id, licence_number_lookup_hash
    HAVING count(DISTINCT driver_id) > 1
  ) THEN
    RAISE EXCEPTION
      'driver_licences contains a licence number hash assigned to more than one driver in one company';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE driver_licences
  DROP CONSTRAINT driver_licences_company_id_licence_number_lookup_hash_key;

-- Prisma 6.19 cannot model PostgreSQL exclusion constraints; this migration is authoritative.
ALTER TABLE driver_licences
  ADD CONSTRAINT driver_licences_company_hash_different_driver_excl
  EXCLUDE USING gist (
    company_id WITH =,
    licence_number_lookup_hash WITH =,
    driver_id WITH <>
  );

CREATE INDEX driver_licences_company_lookup_hash_idx
  ON driver_licences(company_id, licence_number_lookup_hash);
