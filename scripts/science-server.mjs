import {createServer} from 'vite';
const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:5189,strictPort:true,hmr:false,watch:{ignored:['**/*']}},logLevel:'error'});
await server.listen();
console.log('Immutable scientific benchmark server: http://127.0.0.1:5189');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
