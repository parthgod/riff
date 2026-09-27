-- pg_trgm backs the library-search trigram index; it is a trusted extension, so the
-- database owner can create it without superuser rights.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
