import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'../artifacts/science/runtime/browser/node_modules/playwright-core/index.mjs');
const dir=process.env.MOBILE_ARTIFACTS??new URL('../artifacts/mobile/after',import.meta.url).pathname;mkdirSync(dir,{recursive:true});
const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:3,locale:'ko-KR'});
const p=await context.newPage(),errors=[],results=[];
p.on('pageerror',e=>errors.push(e.message));
const check=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS',name);};
const stats=()=>p.evaluate(()=>window.sandsphere.stats());
const cdp=await context.newCDPSession(p);
const touch=async(type,points=[])=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2,force:1}))});};
const drag=async(points)=>{await touch('touchStart',points[0]);for(const step of points.slice(1)){await touch('touchMove',step);await p.waitForTimeout(30);}await touch('touchEnd');await p.waitForTimeout(150);};
const menu=async(id)=>{await p.locator('#workbench-menu-toggle').tap();await p.locator(id).tap();};
try {
 await p.goto(`${process.env.MOBILE_URL??'http://127.0.0.1:5173'}/?test=1&cpu=1`);await p.waitForFunction(()=>!!window.sandsphere);
 await check('mobile guest onboarding and planet creation',async()=>{await p.locator('#entry-guest').tap();await p.locator('[data-game-mode=campaign]').tap();await p.locator('#first-experiment-create').tap();await p.waitForFunction(()=>window.sandsphere.stats().planets.length===1);await p.locator('#pause').tap();await p.locator('#first-steps-close').tap();assert.equal((await stats()).paused,true);});
 for(const locale of ['ko','en']){
  await menu('#settings-open');await p.locator('#settings-language').selectOption(locale);await p.locator('#app-settings .dialog-close').tap();
  for(const [width,height] of [[320,568],[390,844],[430,932],[667,375],[844,390],[768,1024]]){
   await p.setViewportSize({width,height});await p.waitForTimeout(200);
   await check(`${locale} layout ${width}x${height}`,async()=>{
    const layout=await p.evaluate(()=>{const elements=[...document.querySelectorAll('.view-transport-dock button,#workbench-menu-toggle,#game-mode-open,#header-planet-select,#planet-rename,.workspace-toggle')].filter(e=>e.getClientRects().length);return {overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,small:elements.filter(e=>{const r=e.getBoundingClientRect();return r.width<43.9||r.height<43.9}).map(e=>e.id),occluded:elements.filter(e=>{if(e.disabled)return false;const r=e.getBoundingClientRect(),dock=e.closest('.camera-bar');if(dock&&(r.x<dock.getBoundingClientRect().x||r.right>dock.getBoundingClientRect().right))return false;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !hit||!e.contains(hit);}).map(e=>e.id)};});
    assert.equal(layout.overflow,false);assert.equal(await p.locator('#planet').evaluate(e=>e.width*e.height<=2_000_001),true);assert.deepEqual(layout.small,[]);assert.deepEqual(layout.occluded,[]);
    await p.locator('#workspace-materials').tap();assert.equal(await p.locator('.app').getAttribute('data-mobile-panel'),'materials');await p.locator('#settings-toggle').tap();await p.locator('#workspace-observation').tap();await p.locator('#inspector-toggle').tap();await p.screenshot({path:`${dir}/${locale}-${width}x${height}.png`});
   });
  }
 }
 await p.setViewportSize({width:390,height:844});
 await check('narrow camera strip scrolls and map picker works',async()=>{await p.setViewportSize({width:320,height:568});await p.locator('#planet-rename').tap();await p.locator('#planet-name').fill('Mobile planet');await p.locator('#planet-name-apply').tap();assert.equal(await p.locator('#header-planet-select option:checked').textContent(),'Mobile planet');await p.locator('#mobile-view-toggle').tap();await p.locator('#home').tap();await p.locator('[data-camera-view=globe]').tap();await p.locator('#climate-map-toggle').tap();await p.locator('[data-climate-option=temperature]').tap();await p.locator('#climate-legend-toggle').tap();assert.equal(await p.locator('.view').getAttribute('data-climate-layer'),'temperature');await p.locator('#climate-legend-toggle').tap();await p.locator('#climate-map-toggle').tap();await p.locator('[data-climate-option=none]').tap();await p.setViewportSize({width:390,height:844});});
 await check('safe area offsets and drawer scroll',async()=>{
  await p.evaluate(()=>{const a=document.querySelector('.app');a.style.setProperty('--safe-top','47px');a.style.setProperty('--safe-bottom','34px');a.style.setProperty('--mobile-left','24px');a.style.setProperty('--mobile-right','24px');});
  await p.waitForTimeout(100);assert.equal(await p.locator('#workbench-menu-toggle').evaluate(e=>e.getBoundingClientRect().y),59);
  await p.locator('#workspace-materials').tap();await p.locator('[data-tool=meteor]').scrollIntoViewIfNeeded();await p.screenshot({path:`${dir}/safe-area-drawer.png`});await p.locator('#settings-toggle').tap();await p.evaluate(()=>document.querySelector('.app').removeAttribute('style'));await p.setViewportSize({width:430,height:932});await p.setViewportSize({width:390,height:844});
 });
 await check('single-finger grab rotates exactly once',async()=>{
  const before=await stats();await drag([[[1,195,350]],[[1,215,350]],[[1,235,350]]]);const after=await stats();assert.ok(Math.abs(after.camera[0]-before.camera[0]+40/220)<.01);assert.equal(after.supplied,before.supplied);
 });
 await check('pin tap and delete',async()=>{await p.locator('#observation-pin').tap();await p.touchscreen.tap(195,400);assert.equal((await stats()).observation.pinned,true);await p.locator('#observation-clear').tap();assert.equal((await stats()).observation.pinned,false);await p.locator('button[data-tool=observe]').tap();});
 await check('paused material tap edits without camera movement',async()=>{await p.locator('#workspace-materials').tap();await p.locator('[data-material=sand]').tap();const before=await stats();await p.touchscreen.tap(195,400);await p.waitForTimeout(100);const after=await stats();assert.ok(after.supplied>before.supplied);assert.deepEqual(after.camera,before.camera);});
 await check('two-finger rotate and pinch do not paint or resume with one finger',async()=>{
  const before=await stats();await touch('touchStart',[[1,170,350]]);await touch('touchStart',[[1,170,350],[2,220,350]]);await touch('touchMove',[[1,170,365],[2,250,365]]);await p.waitForTimeout(150);await touch('touchEnd',[[2,250,365]]);await touch('touchMove',[[1,190,380]]);await p.waitForTimeout(180);await touch('touchEnd');const after=await stats();assert.equal(after.supplied,before.supplied);assert.ok(after.camera[2]<before.camera[2]);assert.ok(Math.abs(after.camera[0]-before.camera[0]+15/220)<.01);
 });
 await check('paused drag paints successive points',async()=>{const before=await stats();await touch('touchStart',[[1,195,400]]);await p.waitForTimeout(150);await touch('touchMove',[[1,210,400]]);await p.waitForTimeout(50);await touch('touchMove',[[1,230,400]]);await touch('touchEnd');assert.ok((await stats()).supplied>before.supplied);});
 await check('running short tap still pours',async()=>{await p.locator('#pause').tap();const before=await stats();await p.touchscreen.tap(195,400);assert.ok((await stats()).supplied>before.supplied);await p.locator('#pause').tap();});
 await check('three-to-two-finger transition does not jump',async()=>{const before=await stats();await touch('touchStart',[[1,170,350],[2,210,350],[3,250,350]]);await touch('touchEnd',[[1,170,350]]);await touch('touchMove',[[2,215,350],[3,255,350]]);await touch('touchEnd');const after=await stats();assert.equal(after.supplied,before.supplied);assert.ok(Math.abs(after.camera[0]-before.camera[0]+5/220)<.01);});
 await check('running two-finger gesture adds no material',async()=>{await p.locator('#pause').tap();const before=await stats();await drag([[[1,170,350],[2,220,350]],[[1,180,350],[2,240,350]],[[1,190,350],[2,250,350]]]);assert.equal((await stats()).supplied,before.supplied);await p.locator('#pause').tap();});
 await check('touch cancellation clears editing and allows next gesture',async()=>{const before=await stats();await touch('touchStart',[[1,195,400]]);await touch('touchCancel');await p.waitForTimeout(200);assert.equal((await stats()).supplied,before.supplied);await p.touchscreen.tap(195,400);assert.ok((await stats()).supplied>before.supplied);});
 await check('window blur cancels touch editing',async()=>{const before=await stats();await touch('touchStart',[[1,195,400]]);await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await touch('touchEnd');assert.equal((await stats()).supplied,before.supplied);await p.touchscreen.tap(195,400);assert.ok((await stats()).supplied>before.supplied);});
 await check('section, camera, and workspace controls stay reachable on mobile sizes',async()=>{
  for(const [width,height] of [[320,568],[390,844],[667,375]]){
   await p.setViewportSize({width,height});
   if(await p.locator('#mobile-view-toggle').getAttribute('aria-expanded')==='true')await p.locator('#mobile-view-toggle').tap();
   await p.locator('#mobile-view-toggle').tap();await p.locator('[data-camera-view=section]').tap();
   assert.equal(await p.locator('#section-selection-controls').isVisible(),true);
   const layout=await p.evaluate(()=>{
    const box=(selector)=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const overlaps=(a,b)=>Math.max(a.left,b.left)<Math.min(a.right,b.right)&&Math.max(a.top,b.top)<Math.min(a.bottom,b.bottom);
    const ownsCenter=(selector)=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(hit===e||e.contains(hit));};
    const camera=box('#camera-controls'),materials=box('#workspace-materials'),observation=box('#workspace-observation'),section=box('#section-selection-controls');
    return {camera,materials,observation,section,overlapCameraMaterials:overlaps(camera,materials),overlapCameraObservation:overlaps(camera,observation),overlapCameraSection:overlaps(camera,section),materialsHit:ownsCenter('#workspace-materials'),observationHit:ownsCenter('#workspace-observation'),sectionOpenHit:ownsCenter('#section-selection-open')};
   });
   assert.equal(layout.overlapCameraMaterials,false,`${width}x${height}: camera bar overlaps tools toggle`);
   assert.equal(layout.overlapCameraObservation,false,`${width}x${height}: camera bar overlaps observation toggle`);
   assert.equal(layout.overlapCameraSection,false,`${width}x${height}: camera bar overlaps section panel`);
   assert.equal(layout.materialsHit,true,`${width}x${height}: tools toggle center is blocked`);
   assert.equal(layout.observationHit,true,`${width}x${height}: observation toggle center is blocked`);
   assert.equal(layout.sectionOpenHit,true,`${width}x${height}: section action center is blocked`);
   await p.locator('#home').tap();await p.locator('#zoom-in').tap();await p.locator('#section-selection-open').tap();
   assert.equal((await stats()).effects.section.enabled,true,`${width}x${height}: section action did not open the view`);
   if(await p.locator('#mobile-view-toggle').getAttribute('aria-expanded')!=='true')await p.locator('#mobile-view-toggle').tap();
   await p.locator('[data-camera-view=globe]').tap();
   await p.locator('#workspace-materials').tap();assert.equal(await p.locator('#workspace-materials').getAttribute('aria-expanded'),'true');
   await p.locator('#workspace-materials').tap();await p.locator('#workspace-observation').tap();assert.equal(await p.locator('#workspace-observation').getAttribute('aria-expanded'),'true');
   await p.locator('#workspace-observation').tap();
  }
 });
 await check('section navigation by touch does not edit material',async()=>{await p.setViewportSize({width:390,height:844});await p.locator('#mobile-view-toggle').tap();await p.locator('[data-camera-view=section]').tap();await p.locator('#section-selection-open').tap();await p.waitForTimeout(500);const before=await stats();await drag([[[1,175,350],[2,220,350]],[[1,185,355],[2,240,355]]]);const after=await stats();assert.equal(after.supplied,before.supplied);assert.equal(after.effects.section.enabled,true);if(await p.locator('#mobile-view-toggle').getAttribute('aria-expanded')!=='true')await p.locator('#mobile-view-toggle').tap();await p.locator('[data-camera-view=globe]').tap();});
 await check('inventory and settings scroll without painting',async()=>{await p.locator('#workspace-materials').tap();await p.locator('#inventory-open').tap();await p.locator('#catalog-search').fill('water');await p.locator('#catalog-close').tap();await p.locator('#settings-toggle').tap();await p.locator('#mobile-view-toggle').tap();await p.locator('#planet-settings-toggle').tap();await p.locator('#axis-number').fill('25');await p.locator('#axis-number').press('Enter');await p.locator('#planet-settings-close').tap();await menu('#settings-open');await p.locator('#settings-language').selectOption('ko');await p.locator('#app-settings .dialog-close').tap();});
 await check('dashboard tabs and nested scroll on portrait and landscape',async()=>{
  for(const [width,height] of [[320,568],[667,375]]){await p.setViewportSize({width,height});await menu('#dashboard-open');for(const tab of ['overview','matter','thermal','water','atmosphere','ecology','budget']){await p.locator(`[data-dashboard-page=${tab}]`).tap();assert.ok(await p.locator('#dashboard-content').textContent());}const beforeScroll=await stats();await p.locator('#dashboard-content').evaluate(e=>{e.scrollTop=e.scrollHeight;});assert.equal((await stats()).supplied,beforeScroll.supplied);await p.screenshot({path:`${dir}/dashboard-${width}x${height}.png`});await p.locator('#planet-dashboard .dialog-close').tap();}
 });
 await check('desktop left and right drag preserve grab; material left click edits',async()=>{
  await p.setViewportSize({width:1440,height:900});await p.locator('button[data-tool=observe]').click();let before=await stats();await p.mouse.move(720,420);await p.mouse.down();await p.mouse.move(760,430,{steps:5});await p.mouse.up();await p.waitForTimeout(250);assert.notDeepEqual((await stats()).camera,before.camera);await p.locator('[data-material=sand]').click();before=await stats();await p.mouse.click(720,450);assert.ok((await stats()).supplied>before.supplied);before=await stats();await p.mouse.move(720,420);await p.mouse.down({button:'right'});await p.mouse.move(760,430,{steps:5});await p.mouse.up({button:'right'});await p.waitForTimeout(250);assert.notDeepEqual((await stats()).camera,before.camera);await p.screenshot({path:`${dir}/desktop.png`});
 });
 await check('test-slot reload keeps planet and settings',async()=>{const before=await stats();await p.reload();await p.waitForFunction(()=>!!window.sandsphere);assert.equal((await stats()).planets.length,1);assert.equal((await stats()).activeId,before.activeId);});
 assert.deepEqual(errors,[]);
} catch(error){results.push({passed:false,error:String(error)});throw error;} finally {writeFileSync(`${dir}/browser-results.json`,JSON.stringify({results,errors,renderer:'Chrome headless WebGL/CPU',realIPhoneTested:false},null,2));await b.close();}
