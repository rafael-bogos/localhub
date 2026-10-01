import asyncio, json, urllib.request, os, base64
import websockets
D=os.environ['D']
async def main():
    tabs=json.load(urllib.request.urlopen('http://127.0.0.1:9333/json'))
    page=[t for t in tabs if t['type']=='page'][0]
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=64*1024*1024) as ws:
        n=0
        async def call(m,**p):
            nonlocal n; n+=1; i=n
            await ws.send(json.dumps({'id':i,'method':m,'params':p}))
            while True:
                r=json.loads(await ws.recv())
                if r.get('id')==i: return r.get('result')
        async def ev(x):
            r=await call('Runtime.evaluate',expression=x,awaitPromise=True,returnByValue=True); return r['result'].get('value')
        await call('Page.enable'); await call('Runtime.enable')
        await call('Page.addScriptToEvaluateOnNewDocument',source=open(D+'/h/mock.js').read())
        await call('Emulation.setDeviceMetricsOverride',width=1400,height=760,deviceScaleFactor=1,mobile=False)
        await call('Page.navigate',url='http://127.0.0.1:8765/no-such-page'); await asyncio.sleep(.5)
        await ev("localStorage.clear()")
        await call('Page.navigate',url='http://127.0.0.1:8765/'); await asyncio.sleep(1.2)
        await ev("[...document.querySelectorAll('.tab-btn')].find(b=>b.textContent==='Containers').click()"); await asyncio.sleep(2.5)
        await ev("[...document.querySelectorAll('.container-row')][0].querySelector('.action-key').click()"); await asyncio.sleep(.5)
        tab=os.environ.get('TAB','Containers')
        if tab!='Containers':
            await ev("[...document.querySelectorAll('.tab-btn')].find(b=>b.textContent===%s).click()" % json.dumps(tab)); await asyncio.sleep(1.0)
        print('viewport  panelW  layout  hscroll  overflowPx  clipped')
        for w in list(range(820, 1900, 60)):
            await call('Emulation.setDeviceMetricsOverride',width=w,height=760,deviceScaleFactor=1,mobile=False)
            await asyncio.sleep(0.35)
            r=json.loads(await ev("""JSON.stringify((()=>{
              const p=document.querySelector('.instrument-panel'); const pr=p.getBoundingClientRect();
              const row=document.querySelector('.container-row, .port-row, .image-row');
              const cl=[]; p.querySelectorAll('td,button').forEach(e=>{const r=e.getBoundingClientRect(); if(r.width>0 && r.right>pr.right+1) cl.push(Math.round(r.right-pr.right));});
              return {panelW:Math.round(pr.width), layout:getComputedStyle(row).display, hscroll:p.scrollWidth>p.clientWidth+1, over:p.scrollWidth-p.clientWidth, clipped:cl.length};})())"""))
            flag='  <<< QUEBRA' if r['hscroll'] or r['clipped'] else ''
            print(f"{w:8d} {r['panelW']:7d}  {r['layout']:8s} {str(r['hscroll']):6s} {r['over']:8d}  {r['clipped']}{flag}")
asyncio.run(main())
