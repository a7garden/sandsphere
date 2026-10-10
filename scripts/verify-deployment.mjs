import {readFile} from 'node:fs/promises';
const expected=JSON.parse(await readFile('dist/release.json','utf8'));
for(let attempt=0;attempt<6;attempt++){
 try{
  const response=await fetch('https://sandsphere.app/release.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const actual=await response.json();if(actual.tag!==expected.tag||actual.commit!==expected.commit)throw new Error('The domain is still serving a different release.');
  const home=await fetch('https://sandsphere.app/',{signal:AbortSignal.timeout(10000)});if(!home.ok)throw new Error('The game page failed its health check.');
  console.log(`Verified ${expected.tag} at https://sandsphere.app`);process.exit(0);
 }catch(error){if(attempt===5)throw error;await new Promise(resolve=>setTimeout(resolve,5000));}
}
