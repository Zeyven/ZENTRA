set -eu
# Existing report fixtures used fictitious trigger names before workflows were implemented.
# Touch only those named fixtures, only in the isolated SaaS test database.
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -X -p 5433 -d za_spa_saas_test -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN IF current_database()<>'za_spa_saas_test' THEN RAISE EXCEPTION 'Wrong test database'; END IF; END $$;
UPDATE marketing_workflows SET trigger_type=CASE trigger_type WHEN 'test-0' THEN 'birthday' ELSE 'dormant' END,coupon_value=10,enabled=0
WHERE trigger_type IN('test-0','test-1') AND name IN('回访活动0','回访活动1');
SQL
