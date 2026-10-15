import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('dist');
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(root+ '/'.replace('/',process.platform==='win32'?'\\':'/')))throw Error();const data=await readFile(path);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(path)]||'application/octet-stream')});res.end(data);}catch{res.writeHead(404);res.end('Not found');}}).listen(43148,'127.0.0.1',()=>console.log('Redact This http://127.0.0.1:43148'));
