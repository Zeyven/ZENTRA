ALTER TABLE support_grants DROP CONSTRAINT support_grants_scope_check;
ALTER TABLE support_grants ADD CONSTRAINT support_grants_scope_check CHECK(scope IN ('read','configuration','maintenance'));
