import {runRceExperiment} from './helpers/rceExperiment';
self.onmessage=()=>{
 try{
  for(const sst of [295,300,305] as const){
   const result=runRceExperiment(sst,(day,drift)=>self.postMessage({type:'progress',sst,day,drift}));
   self.postMessage({type:'result',sst,result});
  }
  self.postMessage({type:'completed'});
 }catch(error){self.postMessage({type:'failed',error:String(error),stack:error instanceof Error?error.stack:undefined});}
};
