// @vitest-environment happy-dom
import {it,expect} from 'vitest';
import {setTextIfChanged} from '../src/ui/domUpdates';
import {setupLocalization,translatePhrase} from '../src/ui/i18n';
it('preserves localized text-node identity and generates no duplicate mutation',async()=>{
 localStorage.setItem('sandsphere-language','en');document.body.innerHTML='<main id="app"><select id="settings-language"><option value="ko">한국어</option><option value="en">English</option></select><output>고체</output></main>';
 const dispose=setupLocalization(),node=document.querySelector('output')!,text=node.firstChild;
 const observer=new MutationObserver(()=>{});observer.observe(node,{childList:true,characterData:true,subtree:true});
 expect(node.textContent).toBe('Solid');
 for(let i=0;i<20;i++)expect(setTextIfChanged(node,translatePhrase('고체'))).toBe(false);
 expect(observer.takeRecords()).toHaveLength(0);expect(node.firstChild).toBe(text);
 expect(setTextIfChanged(node,translatePhrase('액체'))).toBe(true);expect(node.textContent).toBe('Liquid');
 expect(observer.takeRecords().length).toBeGreaterThan(0);observer.disconnect();dispose?.();document.body.replaceChildren();localStorage.clear();
});
