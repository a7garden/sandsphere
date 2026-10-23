import {icon} from './icons';

export function accountMarkup(){return `<dialog id="account" aria-labelledby="account-title"><div class="dialog-header"><h2 id="account-title">계정과 저장</h2><button class="icon-button dialog-close" aria-label="계정 창 닫기">${icon('close')}</button></div><div class="dialog-body">
<p id="account-identity"></p><p id="account-status" role="status" aria-live="polite"></p>
<form id="account-form"><label for="account-email">이메일</label><input id="account-email" type="email" autocomplete="username" required><label for="account-password">비밀번호</label><input id="account-password" type="password" autocomplete="current-password" minlength="6" required><div class="account-actions"><button type="submit" class="account-primary">로그인</button><button type="submit" data-register>회원가입</button></div><button type="button" id="account-google">Google로 로그인</button><button type="button" id="account-reset">비밀번호 재설정</button></form>
<div id="account-signed-in" hidden><div class="account-actions"><button id="account-sync" class="account-primary">지금 저장</button><button id="account-logout">로그아웃</button></div><button id="account-import">이 브라우저의 비회원 게임 가져오기</button><p class="account-note">가져오기는 현재 계정에 저장된 게임이 없을 때 사용할 수 있습니다.</p></div>
<div id="account-conflict" hidden><h3>진행 상황 선택</h3><p>이 기기와 클라우드에 서로 다른 진행 상황이 있습니다. 선택 전의 로컬 저장본은 복구용으로 보관합니다.</p><div class="account-actions"><button id="account-use-cloud">클라우드 게임 이어하기</button><button id="account-use-local">이 기기 게임 저장하기</button></div></div>
</div></dialog>`;}
