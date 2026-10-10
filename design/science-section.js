'use strict';
const data = JSON.parse(document.getElementById('preview-data').textContent);
const $ = id => document.getElementById(id);
const number = (x, digits = 2) => (Math.abs(x) < .5 * 10 ** -digits ? 0 : x).toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const massNumber = (x, digits = 2) => x > 0 && x < .5 * 10 ** -digits ? '<'+number(10 ** -digits,digits) : number(x,digits);
const names = { sand:'모래', clay:'점토', ceramic:'도자기', glass:'유리', water:'액체 물', ice:'얼음', salt:'소금', dissolved:'용해된 소금', vapor:'수증기', molten:'용융 규사', rock:'암석', nitrogen:'질소', methane:'메탄', carbonDioxide:'이산화탄소', cloud:'구름 물', cloudIce:'구름 얼음', soil:'토양', plant:'식물', herbivore:'초식 생물량', carnivore:'육식 생물량', iron:'운철' };
let pathIndex = 0, frameIndex = 0, selectedIndex = 0;
data.paths.forEach((p, i) => $('path').add(new Option(p.name, i)));
const line = (x1, y1, x2, y2, color, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" ${extra}/>`;
const rect = (x, y, w, h, color) => `<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${Math.max(0,h)}" fill="${color}"/>`;
const text = (x, y, content, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}">${content}</text>`;
const border = 'var(--color-border-strong)', ink = 'var(--color-text-secondary)';

function drawGlobe(path, cell) {
  const norm = v => { const length = Math.hypot(...v); return v.map(x => x / length); };
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const dot = (a,b) => a.reduce((s,x,k) => s+x*b[k],0);
  const center = norm(path.a.map((x,k) => x+path.b[k]));
  const east = norm(cross([0,1,0], center)), north = cross(center,east);
  const project = d => [100+70*dot(d,east), 84-70*dot(d,north)];
  const a = project(path.a), b = project(path.b), point = project(cell.direction);
  const points = path.points.map(project).map(v => v.join(',')).join(' ');
  $('globe').innerHTML = `<circle cx="100" cy="84" r="70" fill="var(--color-surface-under)" stroke="${border}"/><ellipse cx="100" cy="84" rx="70" ry="24" fill="none" stroke="${border}"/><ellipse cx="100" cy="84" rx="24" ry="70" fill="none" stroke="${border}"/><polyline points="${points}" fill="none" stroke="var(--color-text)" stroke-width="2"/><circle cx="${a[0]}" cy="${a[1]}" r="3" fill="var(--color-text)"/><circle cx="${b[0]}" cy="${b[1]}" r="3" fill="var(--color-text)"/>${text(a[0]-8,a[1]-8,'A','end')}${text(b[0]+8,b[1]-8,'B')}<circle cx="${point[0]}" cy="${point[1]}" r="5" fill="var(--plot-water)" stroke="var(--color-text)"/>${text(100,177,'로컬 좌표 · 선택 셀','middle')}`;
}

function render() {
  const path = data.paths[pathIndex], frame = data.frames[frameIndex];
  const rows = path.segments.map(s => ({ ...s, ...frame.cells[s.cellId] }));
  selectedIndex = Math.min(selectedIndex, rows.length - 1);
  const cell = rows[selectedIndex], f = cell.fields;
  $('cell').max = rows.length - 1; $('cell').value = selectedIndex;
  $('cell-position').value = number((cell.from+cell.to)/2,1)+'°';
  $('time').value = frameIndex;
  $('time-label').value = number(frame.time,0)+' 게임초';
  $('time').setAttribute('aria-valuetext', frame.time+' 게임초 기록');
  $('cell').setAttribute('aria-valuetext', '셀 '+cell.cellId+', A에서 '+number((cell.from+cell.to)/2,1)+'도');
  $('next').disabled = frameIndex === data.frames.length-1;
  $('reset').disabled = frameIndex === 0;
  $('path-info').textContent = number(path.degrees,1)+'° · 실제 '+rows.length+'셀 · 전체 '+data.gridCount.toLocaleString()+'셀 중 관측';
  $('selected-title').textContent = '셀 #'+cell.cellId;
  $('tick').textContent = 'tick '+frame.tick;
  const readout = [['고정 기반 높이',number(cell.baseHeight)],['고체 높이',number(cell.solidTop)],['물 수두',number(cell.waterHead)],['대표 온도',number(f.temperature,1)+' °C'],['액체 물',massNumber(f.water)+' kg'],['보유수 (물의 일부)',massNumber(cell.heldWater)+' kg'],['얼음',massNumber(f.ice)+' kg'],['수증기',massNumber(f.vapor)+' kg'],['구름 물 + 얼음',massNumber(f.cloud+f.cloudIce)+' kg']];
  $('readout').innerHTML = readout.map(([name,value]) => `<dt>${name}</dt><dd>${value}</dd>`).join('');
  const mass = Object.entries(names).map(([key,name]) => ({name,value:f[key]})).filter(m => m.value>1e-5).sort((a,b) => b.value-a.value);
  const total = mass.reduce((s,m) => s+m.value,0);
  $('composition').innerHTML = mass.map(m => `<div class="material"><div class="material-line"><span>${m.name}</span><span class="amount">${massNumber(m.value,3)}</span></div><div class="bar"><span style="width:${100*m.value/total}%"></span></div></div>`).join('');
  drawGlobe(path,cell);
  const svgWidth = Math.max(260,$('height').clientWidth);
  for (const [id,height] of [['height',240],['temperature',140],['cloud',112]]) $(id).setAttribute('viewBox',`0 0 ${svgWidth} ${height}`);
  const left = 54, right = svgWidth-20, width = right-left;
  const x = d => left + width*d/path.degrees;
  const selectedX = x((cell.from+cell.to)/2);
  const axes = (low,high,top,bottom,digits=1) => {
    const y = v => bottom-(v-low)/(high-low)*(bottom-top);
    let markup = '';
    for (let k=0;k<=4;k++) {
      const value = low+(high-low)*k/4, yy = y(value);
      markup += line(left,yy,right,yy,border)+text(left-8,yy+4,number(value,digits),'end');
    }
    for (let k=0;k<=4;k++) markup += text(x(path.degrees*k/4),bottom+22,number(path.degrees*k/4,1)+'°',k===0?'start':k===4?'end':'middle');
    return {y,markup};
  };
  const low = Math.floor(Math.min(...rows.map(r => r.baseHeight)))-1;
  const high = Math.ceil(Math.max(...rows.map(r => r.waterHead)))+1;
  const height = axes(low,high,12,206);
  let h = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="${border}" stroke-width="1"/></pattern></defs>`;
  for (const row of rows) {
    const xx = x(row.from), ww = x(row.to)-xx;
    h += rect(xx,height.y(row.baseHeight),ww,206-height.y(row.baseHeight),'url(#hatch)');
    h += rect(xx,height.y(row.solidTop),ww,height.y(row.baseHeight)-height.y(row.solidTop),'var(--plot-solid)');
    h += rect(xx,height.y(row.waterHead),ww,height.y(row.solidTop)-height.y(row.waterHead),'var(--plot-water)');
  }
  h += height.markup + line(selectedX,12,selectedX,206,'var(--color-text)','stroke-dasharray="4 3"');
  $('height').innerHTML = h;
  $('height').setAttribute('aria-label',path.name+' 단면; 선택 셀 '+cell.cellId+' 고체 높이 '+number(cell.solidTop)+' 물 수두 '+number(cell.waterHead));
  const ts = rows.map(r => r.fields.temperature), minT = Math.floor(Math.min(...ts)/5)*5-5, maxT = Math.ceil(Math.max(...ts)/5)*5+5;
  const temp = axes(minT,maxT,12,104);
  const tpoints = rows.flatMap(r => [[x(r.from),temp.y(r.fields.temperature)],[x(r.to),temp.y(r.fields.temperature)]]).map(p => p.join(',')).join(' ');
  $('temperature').innerHTML = temp.markup+`<polyline points="${tpoints}" fill="none" stroke="var(--plot-temperature)" stroke-width="2"/>`+line(selectedX,12,selectedX,104,'var(--color-text)','stroke-dasharray="4 3"');
  const maxCloud = Math.max(.02,...rows.map(r => r.fields.cloud+r.fields.cloudIce));
  const cloud = axes(0,maxCloud,8,78,3);
  $('cloud').innerHTML = rows.map(r => rect(x(r.from),cloud.y(r.fields.cloud+r.fields.cloudIce),x(r.to)-x(r.from),78-cloud.y(r.fields.cloud+r.fields.cloudIce),'var(--plot-cloud)')).join('')+cloud.markup+line(selectedX,8,selectedX,78,'var(--color-text)','stroke-dasharray="4 3"');
}
$('path').addEventListener('change',e => {pathIndex=Number(e.target.value);selectedIndex=0;render();});
$('time').addEventListener('input',e => {frameIndex=Number(e.target.value);render();});
$('cell').addEventListener('input',e => {selectedIndex=Number(e.target.value);render();});
$('next').addEventListener('click',() => {frameIndex=Math.min(data.frames.length-1,frameIndex+1);render();});
$('reset').addEventListener('click',() => {frameIndex=0;render();});
for (const id of ['height','temperature','cloud']) $(id).addEventListener('click',event => {
  const svg=$(id), point=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const path=data.paths[pathIndex], distance=Math.max(0,Math.min(path.degrees,(point.x-54)/(svg.viewBox.baseVal.width-74)*path.degrees));
  selectedIndex=path.segments.findIndex(s => distance<=s.to); render(); $('cell').focus({preventScroll:true});
});
$('provenance').textContent = '독립 예제: 해안 초기 상태, 대표 온도 16 × 로컬 y − 4°C. 환경 −8°C, 일조 0.45배, 중력 1배. 기존 CPU solver, dt=1/30게임초, 0~32초 기록. 생성 '+data.generatedAt+' · model.ts SHA-256 '+data.sourceSha256['src/sim/model.ts']+' · 기존 사용자 저장·재고에는 접근하지 않습니다.';
render();
window.addEventListener('resize',render);
