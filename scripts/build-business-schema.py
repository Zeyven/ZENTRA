"""One-time structural port, excluding legacy identity, secrets and data. Generated SQL is reviewed and versioned."""
from pathlib import Path
import re,json
root=Path(__file__).resolve().parents[1]
source=Path('E:/Shipin/ZuyuPOS-server/src/db/schema.sql').read_text(encoding='utf8')
source=re.sub(r'--[^\n]*','',source)
excluded={'stores','users','user_mfa','mfa_recovery_codes','auth_rate_limits','invite_codes','role_permissions','audit_events','realtime_events','idempotency_records'}
tables={}
def split_columns(text):
 parts=[];start=0;depth=0;quoted=False;i=0
 while i<len(text):
  char=text[i]
  if char=="'":
   if quoted and i+1<len(text) and text[i+1]=="'":i+=2;continue
   quoted=not quoted
  if not quoted:
   if char=='(':depth+=1
   elif char==')':depth-=1
   elif char==',' and depth==0:parts.append(text[start:i].strip());start=i+1
  i+=1
 parts.append(text[start:].strip());return parts
for match in re.finditer(r'CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);',source):
 table,body=match.groups()
 if table in excluded:continue
 parts=split_columns(body);new=[];columns=[]
 for part in parts:
  if re.match(r'(UNIQUE|PRIMARY KEY)\s*\(',part):
   part=re.sub(r'^(UNIQUE|PRIMARY KEY)\s*\(',r'\1(merchant_id,',part)
  else:
   column=part.split()[0];columns.append(column)
   if column=='id':part='id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY'
   else:
    part=re.sub(r'\bINTEGER\b','bigint' if column.endswith('_id') or column.endswith('_by') else 'integer',part)
    if 'REAL' in part:
     precision='numeric(18,6)' if column.endswith('_rate') or (table=='members' and column=='discount') or (table=='member_levels' and column=='discount') else 'numeric(18,3)' if column in {'qty','quantity','ordered_qty','received_qty','returned_qty'} else 'numeric(18,2)'
     part=part.replace('REAL',precision)
    if column.endswith('_at') or column in {'reserve_time','preferred_start','preferred_end'}:
     part=re.sub(r'\bTEXT\b','timestamptz',part)
    part=part.replace("(datetime('now','localtime'))",'CURRENT_TIMESTAMP')
  new.append(part)
 new.insert(1,'merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id)')
 if 'store_id' in columns:
  new=[re.sub(r'^store_id bigint(?! NOT NULL)', 'store_id bigint NOT NULL',p) for p in new]
 if 'id' in columns:new.append('UNIQUE(merchant_id,id)')
 if 'id' in columns and 'store_id' in columns:new.append('UNIQUE(merchant_id,store_id,id)')
 if table=='purchase_order_items':new.insert(2,'store_id bigint NOT NULL');columns.append('store_id');new.append('UNIQUE(merchant_id,store_id,id)')
 if table=='inventory_transfer_items':new.extend(['from_store_id bigint NOT NULL','to_store_id bigint NOT NULL','target_item_id bigint NOT NULL']);columns.extend(['from_store_id','to_store_id','target_item_id'])
 tables[table]={'parts':new,'columns':columns}

# Explicit local-database columns added by the old migration, carried over structurally only.
extras={'wristbands':['room_id bigint','card_uid text'], 'reservations':["source text NOT NULL DEFAULT 'front_desk'",'deposit numeric(18,2) NOT NULL DEFAULT 0','cancelled_at timestamptz']}
for table,parts in extras.items():
 for part in parts:
  col=part.split()[0]
  if col not in tables[table]['columns']:tables[table]['parts'].append(part);tables[table]['columns'].append(col)

sql=['-- Reviewed structural baseline; no rows or old identity/credentials are imported.',
 'ALTER POLICY activation_owner ON merchant_users TO saas_migrator USING(true) WITH CHECK(true);',
 'ALTER POLICY activation_metadata ON merchants TO saas_migrator USING(true) WITH CHECK(true);']
for table,data in tables.items():sql.append('CREATE TABLE '+table+'(\n '+',\n '.join(data['parts'])+'\n);')
relationships={
 'room_id':'rooms','technician_id':'technicians','category_id':'categories','item_id':'items','service_item_id':'items','product_item_id':'items',
 'member_id':'members','order_id':'orders','order_item_id':'order_items','reservation_id':'reservations','offered_reservation_id':'reservations',
 'used_order_id':'orders','applied_order_id':'orders','supplier_id':'suppliers','purchase_order_id':'purchase_orders','transfer_id':'inventory_transfers',
 'workflow_id':'marketing_workflows','coupon_id':'coupons','channel_order_id':'channel_orders','payment_order_id':'booking_payment_orders'}
user_columns={'user_id','cashier_id','operator_id','staff_id','created_by','requested_by','reviewed_by','sent_by','acknowledged_by'}
for table,data in tables.items():
 cols=data['columns']
 for col in cols:
  if col in {'store_id','from_store_id','to_store_id'}:sql.append(f'ALTER TABLE {table} ADD FOREIGN KEY(merchant_id,{col}) REFERENCES stores(merchant_id,id);')
  elif col in user_columns:sql.append(f'ALTER TABLE {table} ADD FOREIGN KEY(merchant_id,{col}) REFERENCES merchant_users(merchant_id,id);')
  elif col in relationships:
   parent=relationships[col]
   if parent=='members':scope=''
   elif table=='inventory_transfer_items' and col=='item_id':scope='from_store_id,'
   elif 'store_id' in cols and 'store_id' in tables[parent]['columns']:scope='store_id,'
   else:scope=''
   parent_scope='store_id,' if scope else ''
   sql.append(f'ALTER TABLE {table} ADD FOREIGN KEY(merchant_id,{scope}{col}) REFERENCES {parent}(merchant_id,{parent_scope}id);')
 if table=='inventory_transfer_items':sql.append('ALTER TABLE inventory_transfer_items ADD FOREIGN KEY(merchant_id,to_store_id,target_item_id) REFERENCES items(merchant_id,store_id,id);')
 sql.extend([f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;',f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY;',f'CREATE POLICY tenant_rows ON {table} TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());',f'GRANT SELECT,INSERT,UPDATE ON {table} TO saas_runtime;'])
 if 'store_id' in cols:sql.append(f'CREATE INDEX {table}_tenant_store ON {table}(merchant_id,store_id);')
for match in re.finditer(r'CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+)\s+ON (\w+)\s*\(([^;]*?)\)([^;]*);',source):
 unique,name,table,columns,where=match.groups()
 if table not in tables:continue
 sql.append(f'CREATE {unique or ""}INDEX {name} ON {table}(merchant_id,{columns}){where};')
sql.extend([
 'ALTER TABLE staff_store_grants ADD FOREIGN KEY(merchant_id,store_id,technician_id) REFERENCES technicians(merchant_id,store_id,id);',
 'GRANT DELETE ON technician_skills,service_consumables,settings TO saas_runtime;',
 'REVOKE UPDATE ON operation_logs,member_transactions,points_log,inventory_movements,clock_events,booking_payment_events FROM saas_runtime;',
 'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO saas_runtime;',
 'CREATE UNIQUE INDEX one_live_order_per_room ON orders(merchant_id,store_id,room_id) WHERE status IN (\'open\',\'suspended\');',
 'CREATE UNIQUE INDEX one_live_shift_per_cashier ON shifts(merchant_id,store_id,cashier_id) WHERE status=\'open\';',
 'CREATE UNIQUE INDEX wristbands_card_identity ON wristbands(merchant_id,store_id,card_uid) WHERE card_uid IS NOT NULL;'
])
target=root/'apps/server/src/db/003-business.sql'
assert not target.exists(),'Inspect the versioned migration instead of overwriting it'
target.write_text('\n'.join(sql)+'\n',encoding='utf8')
(root/'docs/business-schema-map.json').write_text(json.dumps({t:d['columns'] for t,d in tables.items()},ensure_ascii=False,indent=2),encoding='utf8')
print('Generated',len(tables),'tenant-scoped business tables; no business records copied')
