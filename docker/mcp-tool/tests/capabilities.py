"""Docker capability acceptance. Requires a DISPOSABLE bounded state volume.
Run: python3 docker/mcp-tool/tests/capabilities.py --state-volume VOLUME
Creates unique containers/images, requires port 8811 free, writes /state/canary.
The supplied volume is retained; no Myriad data or real credentials are used.
"""
import pathlib,os,json,subprocess,secrets,time,urllib.request,urllib.error,argparse,tempfile,socket
args=argparse.ArgumentParser();args.add_argument('--state-volume',required=True);volume=args.parse_args().state_volume
repo=pathlib.Path(__file__).resolve().parents[3]
root=pathlib.Path(tempfile.mkdtemp(prefix='myriad-mcp-capabilities-'));fixture=root/'fixture';fixture.mkdir()
project='myriad-capabilities-'+secrets.token_hex(4)
base=project+'-base:local';egress=project+'-egress:local';tool=project+'-fixture:local'
with socket.socket() as port:port.bind(('127.0.0.1',8811))
(fixture/'allowed-domains.txt').write_text('example.com\nhttpbingo.org\nlocalhost\nprivate.example.test\n')
(fixture/'compose-test.yml').write_text('services:\n  egress:\n    extra_hosts: ["private.example.test:10.23.4.5"]\n')
(fixture/'Dockerfile').write_text('FROM '+base+'\nCOPY --chmod=0755 entrypoint /opt/mcp/entrypoint\n')
(fixture/'entrypoint').write_text('''#!/usr/local/bin/python3
import json,sys,os,urllib.request,urllib.error,socket
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m:continue
 if m['method']=='initialize':r={'protocolVersion':'2025-06-18','capabilities':{'tools':{}},'serverInfo':{'name':'capabilities-test','version':'1'}}
 elif m['method']=='tools/list':r={'tools':[{'name':'probe','description':'Capability test','inputSchema':{'type':'object'}}]}
 elif m['method']=='tools/call':
  args=m['params'].get('arguments',{});result={}
  if args.get('fill'):
   total=0
   try:
    with open('/state/quota-test','wb',buffering=0) as f:
     while total<129*1024*1024:total+=f.write(b'x'*65536)
   except OSError as e:result={'errno':e.errno,'bytes':total}
   finally:os.unlink('/state/quota-test')
  elif args.get('direct'):
   try:
    socket.create_connection(('1.1.1.1',443),1).close();result={'connected':True}
   except OSError:result={'connected':False}
  elif args.get('url'):
   try:
    with urllib.request.urlopen(args['url'],timeout=10) as response:result={'status':response.status,'bytes':len(response.read(4096))}
   except urllib.error.HTTPError as e:result={'status':e.code}
   except urllib.error.URLError as e:result={'status':403} if str(e.reason)=='Tunnel connection failed: 403 Forbidden' else {'error':type(e).__name__}
   except Exception as e:result={'error':type(e).__name__}
  else:
   if args.get('write'):open('/state/canary','w').write(args['write'])
   result={'canary':open('/state/canary').read() if os.path.exists('/state/canary') else None,'token_absent':'MCP_GATEWAY_AUTH_TOKEN' not in os.environ}
  r={'content':[{'type':'text','text':json.dumps(result)}]}
 else:r={}
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':r}),flush=True)
''')
token=secrets.token_hex(32);env={**os.environ,'MCP_GATEWAY_AUTH_TOKEN':token,'MCP_TOOL_IMAGE':tool,'MCP_EGRESS_IMAGE':egress,'MCP_CATALOG_FILE':str(repo/'docker/mcp-tool/catalog.yaml'),'MCP_SECCOMP_PROFILE':str(repo/'docker/mcp-tool/namespace-seccomp.json'),'MCP_ALLOWED_DOMAINS_FILE':str(fixture/'allowed-domains.txt'),'MCP_STATE_VOLUME':volume}
cmd=['docker','compose','--env-file','/dev/null','-p',project,'-f',str(repo/'docs/deployment/examples/docker-compose.mcp-gateway.example.yml'),'-f',str(repo/'docs/deployment/examples/docker-compose.mcp-capabilities.example.yml'),'-f',str(fixture/'compose-test.yml')]
def cp(*args):
 r=subprocess.run(cmd+list(args),env=env,capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr.replace(token,'[REDACTED]'))
 return r.stdout
session=None

def req(method,params=None):
 global session
 headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'}
 if session:headers['Mcp-Session-Id']=session
 body={'jsonrpc':'2.0','method':method,'params':params or {}}
 if not method.startswith('notifications/'):body['id']=secrets.token_hex(5)
 with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8811/mcp',data=json.dumps(body).encode(),headers=headers),timeout=40) as r:
  session=r.headers.get('Mcp-Session-Id',session);raw=r.read().decode()
  if r.headers.get('Content-Type','').startswith('text/event-stream'):raw='\n'.join(s[5:].lstrip() for s in raw.splitlines() if s.startswith('data:'))
  data=json.loads(raw) if raw else {};assert 'error' not in data,data;return data.get('result')
def connect():
 global session;session=None
 for _ in range(30):
  try:
   if urllib.request.urlopen('http://127.0.0.1:8811/health',timeout=1).status==200:break
  except OSError:time.sleep(1)
 req('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'test','version':'1'}});req('notifications/initialized')
def probe(args):
 r=req('tools/call',{'name':'probe','arguments':args});assert not r.get('isError'),r;return json.loads(r['content'][0]['text'])
try:
 for dockerfile,tag in [('docker/mcp-tool/Dockerfile',base),('docker/mcp-egress/Dockerfile',egress)]:
  subprocess.run(['docker','build','-f',str(repo/dockerfile),'-t',tag,str(repo)],check=True)
 subprocess.run(['docker','build','-t',tool,str(fixture)],check=True)
 rejected=subprocess.run(['docker','run','--rm','--entrypoint','python',base,'/usr/local/bin/myriad-mcp-state-check.py'],capture_output=True,text=True)
 assert rejected.returncode!=0 and 'dedicated filesystem' in rejected.stderr,rejected.stderr
 cp('up','-d');connect()
 print('state:',probe({'write':'survives-recreate'}),flush=True)
 for url in ['https://example.com','http://localhost','http://private.example.test','http://169.254.169.254','https://www.wikipedia.org','https://example.com:8443','https://httpbingo.org/redirect-to?url=http://169.254.169.254/']:
  result=probe({'url':url});print(url,result,flush=True)
  assert result.get('status')==(200 if url=='https://example.com' else 403),result
 assert probe({'direct':True})=={'connected':False}
 full=probe({'fill':True});assert full.get('errno')==28 and full['bytes']<128*1024*1024,full
 print('hard storage ceiling:',full,flush=True)
 cp('up','-d','--force-recreate','mcp-approved','gateway');connect()
 assert probe({})['canary']=='survives-recreate'
 print('PASS persistent state survives container recreation; allowlist/private-address/redirect denials',flush=True)
finally:
 try:
  (root/'containers.log').write_text(cp('logs','--no-color').replace(token,'[REDACTED]'))
 finally:
  cp('down','-v')
  subprocess.run(['docker','image','rm',tool,base,egress],capture_output=True)
 print('Logs:',root,flush=True)
