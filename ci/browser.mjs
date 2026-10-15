import { spawn } from 'node:child_process';
const serverScript = "scripts/serve.mjs";
let server;
try {
  if (serverScript) {
    server = spawn(process.execPath, [serverScript], {stdio:['ignore','pipe','inherit'],windowsHide:true});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Server startup timed out')),10000);
      server.stdout.once('data',()=>{clearTimeout(timer);resolve();});
      server.once('error',reject);
      server.once('exit',code=>reject(new Error('Server exited '+code)));
    });
  }
  const child=spawn(process.execPath,["tests/browser.mjs"],{stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0) throw new Error('Browser checks failed: '+code);
} finally { server?.kill(); }
