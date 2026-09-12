"""Real Docker acceptance test. Run from any directory with Python 3.9+.

Creates only uniquely named test resources; requires localhost:8811 to be free.
Uses fake credentials and an offline bounded adversarial fixture, never Myriad data.
"""
import json,os,pathlib,secrets,subprocess,time,urllib.request,urllib.error,threading
import tempfile, socket
repo=pathlib.Path(__file__).resolve().parents[3]
root=pathlib.Path(tempfile.mkdtemp(prefix='myriad-mcp-test-'))
token=secrets.token_hex(32)
project='myriad-mcp-test-'+secrets.token_hex(4)
base=project+'-base:local'; fixture=project+'-fixture:local'
# Fail before creating resources if the example listener is already in use.
with socket.socket() as port:port.bind(('127.0.0.1',8811))
env={**os.environ,'MCP_GATEWAY_AUTH_TOKEN':token,'MCP_TOOL_IMAGE':fixture,
     'MCP_CATALOG_FILE':str(repo/'docker/mcp-tool/catalog.yaml'),
     'MCP_SECCOMP_PROFILE':str(repo/'docker/mcp-tool/namespace-seccomp.json')}
compose=['docker','compose','--env-file','/dev/null','-p',project,'-f',str(repo/'docs/deployment/examples/docker-compose.mcp-gateway.example.yml')]
def cp(*args,check=True):return subprocess.run(compose+list(args),env=env,text=True,capture_output=True,check=check)
def top():return cp('top','mcp-approved').stdout
def clean_guests():
    for _ in range(50):
        if '/opt/mcp/entrypoint' not in top():return
        time.sleep(.1)
    raise AssertionError('Guest survived: '+top())
def req(method,params=None,session=None,request_id=None):
    headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'}
    if session:headers['Mcp-Session-Id']=session
    msg={'jsonrpc':'2.0','method':method,'params':params or {}}
    if not method.startswith('notifications/'):msg['id']=request_id or secrets.token_hex(6)
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8811/mcp',data=json.dumps(msg).encode(),headers=headers),timeout=45) as response:
        raw=response.read().decode()
        if response.headers.get('Content-Type','').startswith('text/event-stream'):raw='\n'.join(s[5:].lstrip() for s in raw.splitlines() if s.startswith('data:'))
        parsed=json.loads(raw) if raw else {}
        assert 'error' not in parsed,parsed
        return parsed.get('result'),response.headers.get('Mcp-Session-Id',session)
def connect():
    _,session=req('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'native-sandbox-test','version':'1'}})
    req('notifications/initialized',session=session)
    return session
def delete(session):
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8811/mcp',method='DELETE',headers={'Authorization':'Bearer '+token,'Mcp-Session-Id':session,'MCP-Protocol-Version':'2025-06-18'}),timeout=40) as response:assert response.status==204
results={}
try:
    subprocess.run(['docker','build','-f',str(repo/'docker/mcp-tool/Dockerfile'),'-t',base,str(repo)],check=True)
    subprocess.run(['docker','build','--build-arg','BASE_IMAGE='+base,'-t',fixture,str(repo/'docker/mcp-tool/tests')],check=True)
    cp('up','-d')
    for _ in range(30):
        try:
            if urllib.request.urlopen('http://127.0.0.1:8811/health',timeout=1).status==200:break
        except OSError:pass
        time.sleep(1)
    else:raise AssertionError('Gateway not ready')
    try:
        urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8811/mcp',data=b'{}',headers={'Content-Type':'application/json'}),timeout=2)
        raise AssertionError('Unauthenticated request accepted')
    except urllib.error.HTTPError as error:assert error.code==401,error
    inspected=json.loads(subprocess.check_output(['docker','inspect',cp('ps','-q','mcp-approved').stdout.strip()]))[0]
    config=inspected['HostConfig']
    assert config['Memory']==config['MemorySwap']==268435456 and config['PidsLimit']==64,config
    assert config['ReadonlyRootfs'] and config['CapDrop']==['ALL'],config
    assert not inspected['Mounts'],inspected['Mounts']
    results['container_limits_verified']=True
    session=connect()
    tools,_=req('tools/list',session=session);print('tools:',tools,flush=True)
    assert len(tools['tools'])==7
    result,_=req('tools/call',{'name':'probe','arguments':{}},session)
    assert not result.get('isError'),result
    payload=json.loads(result['content'][0]['text']);assert payload['uid']==65534 and not payload['gateway_token_present'],payload
    for name in ['boundaries','pids','disk','boundaries']:
        print('Checking',name,flush=True)
        result,_=req('tools/call',{'name':name,'arguments':{}},session)
        assert not result.get('isError'),result
        data=json.loads(result['content'][0]['text']);results[name]=data
        if name=='boundaries':assert data['setns']==1 and data['unshare']==1 and data['proc_absent'] and data['filter_absent'] and data['root_write']==30 and data['network']==101 and data['clean_work'],data
        if name=='pids':assert data['fork_errno']==11 and 0<data['children']<64,data
        if name=='disk':assert data['disk_errno']==28 and data['written_mib']==32,data
        clean_guests()
    oom_before=cp('exec','-T','mcp-approved','cat','/sys/fs/cgroup/memory.events').stdout
    try:
        result,_=req('tools/call',{'name':'memory','arguments':{}},session)
        assert result.get('isError'),result
    except AssertionError as error:
        assert 'EOF' in str(error),error
    oom_after=cp('exec','-T','mcp-approved','cat','/sys/fs/cgroup/memory.events').stdout
    assert dict(line.split() for line in oom_after.splitlines())['oom_kill'] > dict(line.split() for line in oom_before.splitlines())['oom_kill'],oom_after
    clean_guests();results['memory_exhaustion_bounded']=True
    result,_=req('tools/call',{'name':'probe','arguments':{}},session)
    assert not result.get('isError'),result
    req('tools/call',{'name':'resist','arguments':{}},session)
    clean_guests();results['resistant_tree_reaped']=True
    delete(session);clean_guests()
    for mode in ['cancel','delete','kill']:
        session=connect();done=threading.Event();call_id=secrets.token_hex(6)
        def call():
            try:req('tools/call',{'name':'hang','arguments':{}},session,call_id)
            except Exception:pass
            finally:done.set()
        thread=threading.Thread(target=call);thread.start()
        for _ in range(50):
            if '/opt/mcp/entrypoint' in top():break
            time.sleep(.1)
        else:raise AssertionError('No active guest before fault')
        started=time.monotonic()
        if mode=='cancel':
            req('notifications/cancelled',{'requestId':call_id},session);delete(session)
        elif mode=='delete':delete(session)
        else:cp('kill','-s','SIGKILL','gateway')
        clean_guests();results[mode+'_active_guest_reaped_seconds']=round(time.monotonic()-started,2)
        assert done.wait(47),'Call did not finish';thread.join()
    print(json.dumps(results,indent=2),flush=True)
finally:
    (root/'static-gateway.log').write_text(cp('logs','--no-color',check=False).stdout.replace(token,'[REDACTED]'))
    cp('down','-v','--remove-orphans',check=False)
    (root/'static-gateway-result.json').write_text(json.dumps(results,indent=2)+'\n')
    subprocess.run(['docker','image','rm',fixture,base],capture_output=True)
    print('Redacted logs and results:',root,flush=True)
