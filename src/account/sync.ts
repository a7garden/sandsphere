import type {SystemSave} from '../sim/system';

export interface SyncCheckpoint {revision:string|null;syncedAt:number;}
export interface RemoteSave {revision:string;system:SystemSave;}
export class SaveConflict extends Error {
  constructor(){super('다른 기기에서 저장한 진행 상황이 있습니다. 사용할 저장본을 선택하세요.');}
}
/** Clock differences between devices never decide which branch wins. */
export function chooseSave(local:SystemSave|null,remote:RemoteSave|null,checkpoint:SyncCheckpoint|null){
  if(!local)return remote?'remote':'empty';
  if(!remote)return checkpoint?.revision?'conflict':'local';
  if(checkpoint?.revision===remote.revision)return local.savedAt!==checkpoint.syncedAt?'local':'remote';
  if(checkpoint&&local.savedAt===checkpoint.syncedAt)return 'remote';
  return 'conflict';
}
export function saveScope(uid:string|null,testing=false){
  const prefix=testing?'verification':uid?'account-'+encodeURIComponent(uid):'latest';
  return {slot:prefix,systemSlot:prefix+'-system',systemResumeKey:uid&&!testing?'sandsphere-'+prefix+'-system-resume':'sandsphere-system-resume'+(testing?'-test':''),
    discoveryKey:uid&&!testing?'sandsphere-discoveries-'+prefix:'sandsphere-discoveries'+(testing?'-test':''),checkpointKey:'sandsphere-sync-'+prefix};
}
