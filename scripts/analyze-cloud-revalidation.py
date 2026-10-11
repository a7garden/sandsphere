"""Compare preserved controls with completed cloud-bias integrations.
Run after science:analyze. Does not change or fit any acceptance threshold.
"""
import json, hashlib
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(__file__).resolve().parents[1]
out=root/'artifacts/science'
read=lambda path:json.loads((root/path).read_text())
before=read('artifacts/science/control/before-cloud-dew/summary.json')['earth-climate-spectral']
after=read('artifacts/science/summary.json')['earth-climate-spectral']
native=read('artifacts/science/earth-climate-spectral.json')
assert native['configuration']['days']==1095 and native['samples']==2920
assert before['configuration']['truncation']==after['configuration']['truncation']==21
assert before['configuration']['nlayers']==after['configuration']['nlayers']==32
browser=[];node=[];controls=[]
def rce(path):
    data=read(path);rows=data['samples'];assert len(rows)==1000
    result={k:data[k] for k in ('status','configuration','elapsedSeconds','stationarity','energyResidual','protocolDeviations')}
    result['final200DayMeans']={key:float(np.mean([r[key] for r in rows[-200:]])) for key in ('precipitationMmDay','olrWm2','toaNetWm2','airRadiativeHeatingWm2','cloudWaterPathKgM2')}
    if 'finalLayers' in data:result['finalLayers']=data['finalLayers']
    if 'dryMassDrift' in data:result['dryMassDrift']=data['dryMassDrift']
    if 'browser' in data:result['browser']=data['browser']
    return result
for sst in (295,300,305):
    browser.append(rce(f'artifacts/science/browser/rce-{sst}K.json'))
    assert browser[-1]['browser']['sourceUnchangedDuringRun']
    assert 'Lin ice aggregation' in browser[-1]['configuration']['microphysics']
    assert 'dry-air-mass compensated' in browser[-1]['configuration']['convection']
    assert browser[-1]['dryMassDrift']['maximumRelative']<1e-7
    node.append(rce(f'artifacts/climate-reference/rce-1000day-{sst}K.json'))
    assert 'Lin ice aggregation' in node[-1]['configuration']['microphysics']
    assert 'dry-air-mass compensated' in node[-1]['configuration']['convection']
    assert node[-1]['dryMassDrift']['maximumRelative']<1e-7
    controls.append(rce(f'artifacts/science/control/browser-kessler/rce-1000day-{sst}K.json'))
report=dict(schema=1,thresholdAuthority='Unchanged project gates, not official RCEMIP or observational certification',earthBefore=before,earthAfter=after,
    nativeRun=read('artifacts/science/earth-run-manifest.json'),browserRce=browser,nodeRce=node,browserKesslerWithoutAccretionControl=controls,wetMassConvectionControlBrowser=[rce(f'artifacts/science/control/wet-mass-convection/browser/rce-{sst}K.json') for sst in (295,300,305)],
    browserTransientObservations=read('artifacts/climate-reference/column-observations.json'),browserRadiationObservations=read('artifacts/climate-reference/radiation-observations.json'),
    limitations=['Earth before/after uses the same grid, forcing and seed, but changes two physics defects jointly; it does not isolate each effect.',
      'NASA POWER comparisons cover 24 points/288 monthly values, not a validated global-area climate map.',
      'Actual Chromium production-core RCE is separate from SpeedyWeather Earth and Held-Suarez validation.',
      'Browser one-day observation comparison has no climate spin-up; observed initialization is not predictive skill.',
      'Native condensate optics are precipitation-derived; browser cloud ice aggregates into diagnostic snow but rain/snow/aerosol distributions are not prognostic.'])
files=['artifacts/science/earth-climate-spectral.json','artifacts/science/earth-climate-spectral-comparison.json','artifacts/science/earth-run-manifest.json']
files += [f'artifacts/science/browser/rce-{sst}K.json' for sst in (295,300,305)]
files += [f'artifacts/climate-reference/rce-1000day-{sst}K.json' for sst in (295,300,305)]
report['artifactSha256']={path:hashlib.sha256((root/path).read_bytes()).hexdigest() for path in files}
report['browserControlledGeography']=read('artifacts/science/browser/cloud-geography.json')
reference=read('tests/fixtures/rcemip-ensemble-summary.json')
means=browser[1]['final200DayMeans']
report['browser300EnsembleContext']={key:dict(model=means[key],ensembleMean=ref['mean'],ensembleStandardDeviation=ref['standardDeviation'],standardizedDifference=(means[key]-ref['mean'])/ref['standardDeviation']) for key,ref in reference['statistics'].items() if key in means}
report['browser300EnsembleContextLimitations']=reference['limitations']
# Interannual stationarity diagnostic at the SAME observation grid centers.
# This is not a global-area average, nor an official equilibrium pass gate.
rows=read('artifacts/science/earth-climate-spectral-comparison.json')['rows']
interannual={}
for name,selected in [('all24Points',rows),('landPoints',[r for r in rows if r['landFraction']>.5])]:
    w=np.array([np.cos(np.deg2rad(r['latitude'])) for r in selected]);w=w/w.sum()
    metrics={}
    for key in ('skin_temperature','rain_mm_day','cloud_fraction'):
        annual=np.array([[np.average([native['monthly'][year*12+m][key][r['gridIndex']] for m in range(12)],weights=native['monthSamples'][year*12:(year+1)*12]) for r in selected] for year in range(2)])
        if key=='cloud_fraction':annual*=100
        delta=annual[1]-annual[0]
        metrics[key]=dict(year2002Mean=float(np.sum(w*annual[0])),year2003Mean=float(np.sum(w*annual[1])),meanDifference=float(np.sum(w*delta)),pointRmsDifference=float(np.sqrt(np.sum(w*delta**2))))
    interannual[name]=dict(pointCount=len(selected),metrics=metrics)
report['earthInterannualDiagnostics']=dict(groups=interannual,meaning='Two annual means at sampled grid centers; interannual variability and spin-up cannot be separated by this short experiment; no new pass threshold')

(root/'science/results-cloud-bias-2026-10-11.json').write_text(json.dumps(report,indent=2)+'\n')
labels=['Tropics','Midlatitudes','Polar'];groups=['tropics','midlatitudes','polar']
fig,axes=plt.subplots(1,2,figsize=(11,4),constrained_layout=True)
for ax,key,unit in zip(axes,['rain_mm_day','cloud_fraction'],['Precipitation bias (mm/day)','Cloud-area bias (percentage points)']):
    x=np.arange(3)
    for shift,run,label in [(-.18,before,'Before'),(.18,after,'Dew + cold-cloud corrections')]:
        values=[run['residualGroups'][g]['metrics'][key]['bias'] for g in groups]
        bars=ax.bar(x+shift,values,.36,label=label)
        ax.bar_label(bars,fmt='%.2f',padding=3,fontsize=8)
    ax.axhline(0,color='black',lw=.8);ax.set(xticks=x,xticklabels=labels,ylabel=unit)
axes[0].legend(fontsize=8)
fig.suptitle('Same T21L32, 1,095 days: 24 POWER points; 730-day means, unchanged observation gates')
fig.savefig(out/'cloud-bias-before-after.png',dpi=180);plt.close(fig)
fig,axes=plt.subplots(2,3,figsize=(12,7),constrained_layout=True)
for col,sst in enumerate((295,300,305)):
    data=read(f'artifacts/science/browser/rce-{sst}K.json');rows=data['samples'];days=[r['day'] for r in rows]
    heights=[.5,1.5,3,5.5,8.5,12,16,20,25,31,38]
    image=axes[0,col].contourf(days,heights,np.array([r['temperature'] for r in rows]).T,24,cmap='coolwarm')
    axes[0,col].set(title=f"{sst} K: mean-window difference {data['stationarity']['maximum100DayMeanTemperatureDifferenceK']:.3f} K",xlabel='Day',ylabel='Height (km)');fig.colorbar(image,ax=axes[0,col],label='°C')
    axes[1,col].plot(days,[r['cloudWaterPathKgM2'] for r in rows]);axes[1,col].set(xlabel='Day',ylabel='Cloud condensate path (kg/m²)')
fig.suptitle('Actual Chromium production-core RCE: 1,000 days each; reduced column, not RCEMIP compliance')
fig.savefig(out/'browser-rce-final.png',dpi=180);plt.close(fig)
print(json.dumps(dict(earth=after['gates'],browser=[dict(sst=r['configuration']['sstK'],stationarity=r['stationarity']) for r in browser]),indent=2))
