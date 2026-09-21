import test from 'node:test';
import assert from 'node:assert/strict';
import {schemaCheckSql} from '../scripts/release-schema-check.mjs';
test('release schema gate enumerates gaps instead of trusting migration count',()=>{
 const sql=schemaCheckSql(['035-hardware-binding-room-uniqueness.sql','033-point-clock-business-type.sql']);
 assert.match(sql,/033-point-clock-business-type\.sql/);
 assert.match(sql,/035-hardware-binding-room-uniqueness\.sql/);
 assert.match(sql,/BEGIN READ ONLY/);
 assert.match(sql,/RAISE EXCEPTION 'Missing migrations/);
 assert.match(sql,/indisunique AND i.indisvalid/);
 assert.throws(()=>schemaCheckSql([]));
 assert.throws(()=>schemaCheckSql(["033-evil');DROP TABLE stores;--.sql"]));
});
