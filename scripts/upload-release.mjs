import {readFile} from 'node:fs/promises';
const {GITEA_API_URL:base,GITEA_REPOSITORY:repo,GITEA_RELEASE_ID:id,GITEA_TOKEN:token}=process.env;
if(!base||!repo||!id||!token)throw new Error('Gitea release context is required.');
for(const name of ['sandsphere.tar.gz','SHA256SUMS']){
 const body=new FormData();body.set('attachment',new Blob([await readFile('release/'+name)]),name);
 const response=await fetch(`${base}/repos/${repo}/releases/${id}/assets?name=${encodeURIComponent(name)}`,{method:'POST',headers:{Authorization:'token '+token},body});
 if(!response.ok)throw new Error(`Gitea release attachment failed: ${response.status}`);
 console.log(`Attached ${name}`);
}
