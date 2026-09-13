"""Disposable Docker/PostgreSQL acceptance for the worker SQL policy.
Run: python3 scripts/extra/test-worker-database.py
Uses random fake credentials; requires Docker, no Myriad deployment or data.
"""
import os,secrets,subprocess,time,pathlib,json,re
import tempfile
root=pathlib.Path(tempfile.mkdtemp(prefix='myriad-db-budget-'));repo=pathlib.Path(__file__).resolve().parents[2]
container='myriad-db-budget-'+secrets.token_hex(4)
passwords={r:secrets.token_hex(24) for r in ['myriad','myriad_persona','myriad_federation']}
def run(args,**kw):return subprocess.run(args,text=True,capture_output=True,**kw)
try:
 if run(['docker','inspect',container]).returncode!=0:
  assert run(['docker','network','create',container]).returncode==0
  r=run(['docker','run','-d','--name',container,'--network',container,'--network-alias','postgres','--memory','768m','--cpus','1','-e','POSTGRES_DB=myriad','-e','POSTGRES_USER=myriad','-e','POSTGRES_PASSWORD','postgres:18-alpine'],env={**os.environ,'POSTGRES_PASSWORD':passwords['myriad']});assert r.returncode==0,r.stderr
 
 def cmd(role='myriad'):
  return ['docker','exec','-i','-e','PGPASSWORD',container,'psql','-h','127.0.0.1','-U',role,'-d','myriad','-At','-v','ON_ERROR_STOP=1']
 def sql(query,role='myriad',check=True):
  r=run(cmd(role),input=query,env={**os.environ,'PGPASSWORD':passwords[role]})
  if check:assert r.returncode==0,r.stderr
  return r
 for _ in range(60):
  if run(['docker','exec',container,'pg_isready','-h','127.0.0.1','-U','myriad']).returncode==0:break
  time.sleep(1)
 else:raise AssertionError('Postgres not ready')
 sql('CREATE TABLE IF NOT EXISTS budget_probe(id int PRIMARY KEY, value text); INSERT INTO budget_probe VALUES(1,\'ok\') ON CONFLICT DO NOTHING;')
 source=(repo/'backend/src/db/worker_policy.rs').read_text();template=re.search(r'let sql = format!\(\s*r#"(.*?)"#',source,re.S)[1]
 for role,limit,ms in [('myriad_persona',8,30000),('myriad_federation',4,10000)]:
  sql(template.format(role=role,connections=limit,password=passwords[role],statement=ms,transaction=ms+5000))
  print(role,sql("SELECT current_user,current_setting('temp_file_limit'),current_setting('transaction_timeout');",role).stdout.strip(),flush=True)
  for query in ['CREATE TABLE forbidden(x int);','CREATE TEMP TABLE forbidden(x int);','SET temp_file_limit=-1;','SET ROLE myriad;']:
   assert sql(query,role,False).returncode!=0,query
  assert sql('SELECT value FROM budget_probe',role).stdout.strip()=='ok'
  # Occupy every allowed backend simultaneously; one extra connection is rejected.
  sessions=[]
  for _ in range(limit):
   p=subprocess.Popen(cmd(role),env={**os.environ,'PGPASSWORD':passwords[role]},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   p.stdin.write('SELECT pg_sleep(8);\n');p.stdin.flush();sessions.append(p)
  for _ in range(30):
   if int(sql("SELECT count(*) FROM pg_stat_activity WHERE usename='"+role+"'").stdout.strip())==limit:break
   time.sleep(.1)
  extra=sql('SELECT 1',role,False);assert extra.returncode!=0 and 'too many connections for role' in extra.stderr,extra.stderr
  assert sql('SELECT value FROM budget_probe').stdout.strip()=='ok'
  for p in sessions:p.stdin.close();p.wait(timeout=15)
  print(role,'connection quota and privilege denials passed',flush=True)
 t=time.monotonic();r=sql('SELECT pg_sleep(12)','myriad_federation',False);assert 'statement timeout' in r.stderr,r.stderr;statement=round(time.monotonic()-t,2)
 t=time.monotonic();r=sql('BEGIN;'+('SELECT pg_sleep(1);'*20),'myriad_federation',False);assert 'transaction timeout' in r.stderr,r.stderr;transaction=round(time.monotonic()-t,2)
 r=sql("SET work_mem='64kB'; SELECT count(*) FROM (SELECT repeat('x',1024)||i AS v FROM generate_series(1,100000) i ORDER BY v) q;",'myriad_persona',False);assert 'temp_file_limit' in r.stderr,r.stderr
 print('PASS statement/transaction timeouts and hard temporary file quota',statement,transaction,flush=True)
 # A worker's row lock is bounded; unrelated web reads continue immediately.
 p=subprocess.Popen(cmd('myriad_federation'),env={**os.environ,'PGPASSWORD':passwords['myriad_federation']},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 p.stdin.write("BEGIN; UPDATE budget_probe SET value='locked' WHERE id=1; SELECT pg_sleep(8); ROLLBACK;\n");p.stdin.flush()
 for _ in range(50):
  if sql("SELECT count(*) FROM pg_stat_activity WHERE usename='myriad_federation' AND wait_event='PgSleep'").stdout.strip()=='1':break
  time.sleep(.1)
 else:raise AssertionError('Worker did not acquire probe lock')
 t=time.monotonic();r=sql("SET lock_timeout='1s'; UPDATE budget_probe SET value='web' WHERE id=1",check=False)
 assert 'lock timeout' in r.stderr and time.monotonic()-t<3,r.stderr
 assert sql('SELECT value FROM budget_probe').stdout.strip()=='ok'
 p.stdin.close();p.wait(timeout=12)
 # Execute the actual startup inspection against each login; catch SQL/type errors.
 verify=re.search(r'query_one_raw\(Statement::from_string\(\s*DbBackend::Postgres,\s*r#"(.*?)"#',source,re.S)[1]
 for role in ['myriad_persona','myriad_federation']:
  fields=sql(verify,role).stdout.strip().split('|')
  assert fields[0]=='f' and fields[-2:]==['f','f'],fields
 assert sql(verify).stdout.startswith('t|')
 print('PASS production inspection, web lock deadline and unrelated read during worker lock',flush=True)
 (root/'db-budget-results.json').write_text(json.dumps({'connection_caps':[8,4],'admin_connection_survived_saturation':True,'ddl_temp_and_privilege_escape_denied':True,'statement_timeout_seconds':statement,'transaction_timeout_seconds':transaction,'temp_file_limit_enforced':True,'startup_inspection_sql_passed':True,'web_lock_timeout_and_unrelated_read_passed':True},indent=2)+'\n')
 
finally:
 run(['docker','rm','-fv',container])
 run(['docker','network','rm',container])
 print('Results:',root,flush=True)
