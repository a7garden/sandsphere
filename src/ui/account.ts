import type {FirebaseServices} from '../account/firebase';
import {icon} from './icons';

export function accountMarkup(){return `<dialog id="account" aria-labelledby="account-title"><div class="dialog-header"><h2 id="account-title">계정과 저장</h2><button class="icon-button dialog-close" aria-label="계정 창 닫기">${icon('close')}</button></div><div class="dialog-body">
<p id="account-identity"></p><p id="account-status" role="status" aria-live="polite"></p>
<form id="account-form"><label for="account-email">이메일</label><input id="account-email" type="email" autocomplete="username" required><label for="account-password">비밀번호</label><input id="account-password" type="password" autocomplete="current-password" minlength="6" required><div class="account-actions"><button type="submit" class="account-primary">로그인</button><button type="submit" data-register>회원가입</button></div><button type="button" id="account-google">Google로 로그인</button><button type="button" id="account-reset">비밀번호 재설정</button></form>
<div id="account-signed-in" hidden><div class="account-actions"><button id="account-sync" class="account-primary">지금 저장</button><button id="account-logout">로그아웃</button></div><button id="account-import">이 브라우저의 비회원 게임 가져오기</button><p class="account-note">가져오기는 현재 계정에 저장된 게임이 없을 때 사용할 수 있습니다.</p></div>
<div id="account-conflict" hidden><h3>진행 상황 선택</h3><p>이 기기와 클라우드에 서로 다른 진행 상황이 있습니다. 선택 전의 로컬 저장본은 복구용으로 보관합니다.</p><div class="account-actions"><button id="account-use-cloud">클라우드 게임 이어하기</button><button id="account-use-local">이 기기 게임 저장하기</button></div></div>
</div></dialog>`;}
export interface AccountActions {beforeAuth:()=>Promise<void>;sync:()=>Promise<void>;importGuest:()=>Promise<void>;useCloud:()=>Promise<void>;useLocal:()=>Promise<void>;}
export class AccountPanel {
  private busy=false;
  private dialog=document.getElementById('account') as HTMLDialogElement;
  private opener:HTMLElement|null=null;
  constructor(private services:FirebaseServices|null,private actions:AccountActions){
    document.getElementById('account-open')!.addEventListener('click',event=>this.open(event.currentTarget as HTMLElement));
    this.dialog.addEventListener('close',()=>{(this.opener?.getClientRects().length?this.opener:document.getElementById('account-open'))?.focus();this.opener=null;});
    const auth=services?.auth;
    const placementAccount=document.getElementById('placement-account')!;
    placementAccount.textContent=auth?.currentUser?'클라우드 저장 관리':'로그인·회원가입';
    placementAccount.hidden=!auth;
    document.getElementById('placement-storage-copy')!.textContent=auth?.currentUser
      ?'로그인한 계정에 자동 저장됩니다.'
      :auth?'이 브라우저에 자동 저장됩니다. 로그인하면 다른 기기에서도 이어할 수 있어요.'
      :'이 브라우저에 자동 저장됩니다.';
    document.getElementById('account-identity')!.textContent=auth?.currentUser?.email??(auth?.currentUser?'로그인됨':'비회원 · 이 브라우저에 저장');
    (document.getElementById('account-form') as HTMLFormElement).hidden=!!auth?.currentUser||!auth;
    document.getElementById('account-signed-in')!.hidden=!auth?.currentUser;
    this.status(auth?auth.currentUser?'클라우드 저장 확인 중':'로그인하면 다른 기기에서도 게임을 이어할 수 있습니다.':'계정 저장 연결을 준비 중입니다. 게임은 이 브라우저에 보관됩니다.');
    document.getElementById('account-form')!.addEventListener('submit',event=>{
      event.preventDefault();const register=(event as SubmitEvent).submitter?.hasAttribute('data-register');
      void this.run(async()=>{if(!auth)return;await actions.beforeAuth();const email=this.input('account-email'),password=this.input('account-password');
        const api=await import('firebase/auth');if(register)await api.createUserWithEmailAndPassword(auth,email,password);else await api.signInWithEmailAndPassword(auth,email,password);});
    });
    document.getElementById('account-google')!.addEventListener('click',()=>void this.run(async()=>{if(!auth)return;await actions.beforeAuth();const api=await import('firebase/auth');await api.signInWithPopup(auth,new api.GoogleAuthProvider());}));
    document.getElementById('account-reset')!.addEventListener('click',()=>void this.run(async()=>{if(!auth)return;const email=document.getElementById('account-email') as HTMLInputElement;if(!email.reportValidity())return;const {sendPasswordResetEmail}=await import('firebase/auth');await sendPasswordResetEmail(auth,email.value);this.status('재설정 안내를 요청했습니다. 이메일을 확인하세요.');}));
    document.getElementById('account-logout')!.addEventListener('click',()=>void this.run(async()=>{if(!auth)return;await actions.beforeAuth();const {signOut}=await import('firebase/auth');await signOut(auth);}));
    for(const [id,action] of [['account-sync',actions.sync],['account-import',actions.importGuest],['account-use-cloud',actions.useCloud],['account-use-local',actions.useLocal]] as const)
      document.getElementById(id)!.addEventListener('click',()=>void this.run(action));
  }
  private input(id:string){return (document.getElementById(id) as HTMLInputElement).value;}
  open(opener?:HTMLElement){this.opener=opener??document.activeElement as HTMLElement;if(!this.dialog.open)this.dialog.showModal();}
  status(text:string){document.getElementById('account-status')!.textContent=text;}
  conflict(show:boolean){document.getElementById('account-conflict')!.hidden=!show;}
  private async run(action:()=>Promise<void>){
    if(this.busy)return;this.busy=true;this.dialog.querySelectorAll<HTMLButtonElement>('button:not(.dialog-close)').forEach(b=>b.disabled=true);
    try{await action();}catch(error){const code=(error as {code?:string}).code;const known:Record<string,string>={'auth/invalid-credential':'이메일과 비밀번호를 확인하세요.','auth/email-already-in-use':'이미 가입된 이메일입니다. 로그인해주세요.','auth/weak-password':'비밀번호는 6자 이상 입력하세요.','auth/popup-closed-by-user':'로그인을 취소했습니다.','auth/network-request-failed':'인터넷 연결을 확인하세요.','auth/too-many-requests':'요청이 많습니다. 잠시 후 다시 시도하세요.','permission-denied':'계정 저장 권한을 확인하지 못했습니다. 잠시 후 다시 시도하세요.','storage/unauthorized':'계정 저장 권한을 확인하지 못했습니다. 잠시 후 다시 시도하세요.'};this.status(code?(known[code]??'계정 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'):(error instanceof Error?error.message:'계정 작업을 완료하지 못했습니다.'));}
    finally{this.busy=false;this.dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}
  }
}
