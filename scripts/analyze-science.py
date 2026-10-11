"""Independent observations/benchmark audit. Requires numpy and matplotlib.

No optimization or fit to observations. Do not replace a failed metric by a
different cloud quantity, initialized observed temperature or supplied SST.
"""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/science'
OUT.mkdir(parents=True, exist_ok=True)
MONTH_DAYS = np.array((31,28,31,30,31,30,31,31,30,31,30,31))
def read(name):
    return json.loads((OUT / name).read_text())
def matrix(x, ny, nz):
    a = np.asarray(x)
    return a.reshape((ny, nz), order='F') if a.ndim == 1 else a
def metric(obs, model, weight):
    obs, model, weight = map(np.asarray, (obs, model, weight))
    weight = weight / weight.sum()
    o, m = np.sum(weight * obs), np.sum(weight * model)
    cov = np.sum(weight * (obs-o) * (model-m))
    scale = np.sqrt(np.sum(weight*(obs-o)**2)*np.sum(weight*(model-m)**2))
    return dict(observedMean=float(o), modelMean=float(m), bias=float(m-o),
                rmse=float(np.sqrt(np.sum(weight*(model-obs)**2))),
                correlation=float(cov/scale) if scale > 0 else None)

report = {'schema': 1, 'thresholdAuthority': 'Declared project diagnostics, not official benchmark pass criteria'}
if (OUT / 'held-suarez-T42.json').exists():
    h = read('held-suarez-T42.json')
    lat, sigma = np.array(h['latitude']), np.array(h['sigma'])
    fields = [('temperature', 'Temperature (K)'), ('u', 'Zonal wind (m/s)'),
              ('eddyHeatFlux', 'Eddy heat flux (K m/s)'), ('eddyMomentumFlux', 'Eddy momentum flux (m²/s)')]
    fig, axes = plt.subplots(2, 2, figsize=(11, 7), constrained_layout=True)
    for ax, (key, label) in zip(axes.flat, fields):
        data = h['zonalMeans'][key] if key in ('temperature', 'u') else h[key]
        value = matrix(data, len(lat), len(sigma))
        levels = 20
        contour = ax.contourf(lat, sigma, value.T, levels, cmap='coolwarm')
        ax.invert_yaxis();ax.set(xlabel='Latitude (degrees)', ylabel='Sigma pressure', title=label)
        fig.colorbar(contour, ax=ax)
    fig.suptitle('Held–Suarez T42L20: actual 1,000-day mean after 200-day spin-up')
    fig.savefig(OUT / 'held-suarez.png', dpi=170);plt.close(fig)
    report['heldSuarez'] = {k: h[k] for k in ('configuration','samples','status','jets','maximumRelativePressureMassDrift','symmetryRmseMS','projectSanityChecks','paperQuantitativeValidation')}

for earth_name in ('earth-climate.json', 'earth-climate-spectral.json'):
    if not (OUT / earth_name).exists(): continue
    earth = read(earth_name)
    reference = json.loads((ROOT / 'tests/fixtures/nasa-power-climatology.json').read_text())
    lat, lon = np.asarray(earth['latitude']), np.asarray(earth['longitude'])
    monthly = earth['monthly']
    counts = np.array(earth['monthSamples'])
    rows = []
    for p in reference['points']:
        # Nearest grid-center comparison with actual geodesic distance recorded.
        dot = np.sin(np.deg2rad(lat))*np.sin(np.deg2rad(p['latitude'])) + np.cos(np.deg2rad(lat))*np.cos(np.deg2rad(p['latitude']))*np.cos(np.deg2rad(lon-p['longitude']))
        index = int(np.argmax(dot))
        distance = 6371*np.arccos(np.clip(dot[index], -1, 1))
        model = {k: [] for k in ('skin_temperature','rain_mm_day','cloud_fraction')}
        for month in range(12):
            for k in model:
                model[k].append(sum(monthly[y*12+month][k][index]*counts[y*12+month] for y in range(2)) / sum(counts[y*12+month] for y in range(2)))
        observed = {k: p['values'][key] for k,key in [('skin_temperature','TS'),('rain_mm_day','PRECTOTCORR'),('cloud_fraction','CLOUD_AMT')]}
        model['cloud_fraction'] = [100*x for x in model['cloud_fraction']]
        rows.append(dict(latitude=p['latitude'],longitude=p['longitude'],gridIndex=index,distanceKm=float(distance),landFraction=earth['landFraction'][index],model=model,observed=observed))
    metrics = {}
    for k in rows[0]['model']:
        # Month-duration and cos(latitude) weights, NOT a true global area mean.
        weights = [np.cos(np.deg2rad(r['latitude']))*d for r in rows for d in MONTH_DAYS]
        metrics[k] = metric([v for r in rows for v in r['observed'][k]], [v for r in rows for v in r['model'][k]], weights)
    land = [r for r in rows if r['landFraction']>.5]
    if land:
        metrics['land_skin_temperature'] = metric([v for r in land for v in r['observed']['skin_temperature']], [v for r in land for v in r['model']['skin_temperature']], [np.cos(np.deg2rad(r['latitude']))*d for r in land for d in MONTH_DAYS])
    # Residual diagnostics use the same variables and weights as the gates.
    # Small subsets diagnose where errors occur; they add no new pass gates.
    groups = dict(land=land, ocean=[r for r in rows if r['landFraction']<=.5],
                  tropics=[r for r in rows if abs(r['latitude'])<30],
                  midlatitudes=[r for r in rows if 30<=abs(r['latitude'])<60],
                  polar=[r for r in rows if abs(r['latitude'])>=60])
    residuals = {name: dict(pointCount=len(subset), metrics={k:metric(
        [v for r in subset for v in r['observed'][k]],
        [v for r in subset for v in r['model'][k]],
        [np.cos(np.deg2rad(r['latitude']))*d for r in subset for d in MONTH_DAYS])
        for k in rows[0]['model']}) for name,subset in groups.items() if subset}
    # Predeclared diagnostic gates. Correlation matters: matching a scalar
    # mean does not validate a precipitation or cloud spatial distribution.
    gates = dict(precipitation=metrics['rain_mm_day']['rmse']<1 and (metrics['rain_mm_day']['correlation'] or 0)>.5,
                 clouds=metrics['cloud_fraction']['rmse']<15 and (metrics['cloud_fraction']['correlation'] or 0)>.5,
                 landTemperature='land_skin_temperature' in metrics and metrics['land_skin_temperature']['rmse']<5)
    audit = dict(status='passed-project-observation-gates' if all(gates.values()) else 'failed-project-observation-gates',configuration=earth['configuration'],surfaceBoundaryAudit=earth.get('surfaceBoundaryAudit'),gates=gates,metrics=metrics,residualGroups=residuals,rows=rows,
                 limitations=earth['limitations']+['Nearest coarse grid centers; distance and land fraction reported','24 points and two forecast years versus 2001–2020 MERRA-2/CERES climatology; no claim of a validated global mean','Skin temperature compared with TS, not an extrapolated surface-air diagnostic with T2M'])
    stem = earth_name.removesuffix('.json')
    (OUT / f'{stem}-comparison.json').write_text(json.dumps(audit,indent=2))
    report[stem] = {k: audit[k] for k in ('status','configuration','surfaceBoundaryAudit','gates','metrics','residualGroups','limitations')}
    fig, axes = plt.subplots(3,3,figsize=(13,9),constrained_layout=True)
    for axes_row,k,label,limits in zip(axes,('skin_temperature','rain_mm_day','cloud_fraction'),('Skin temperature (°C)','Precipitation (mm/day)','Cloud area (%)'),((-60,40),(0,7),(0,100))):
        for ax,col in zip(axes_row,('observed','model','difference')):
            vals=[np.average(r['observed'][k] if col=='observed' else r['model'][k],weights=MONTH_DAYS) if col!='difference' else np.average(np.subtract(r['model'][k],r['observed'][k]),weights=MONTH_DAYS) for r in rows]
            scale=limits[1]-limits[0]
            im=ax.scatter([r['longitude'] for r in rows],[r['latitude'] for r in rows],c=vals,s=250,marker='s',cmap='coolwarm' if col=='difference' or k=='skin_temperature' else 'Blues',vmin=-scale/2 if col=='difference' else limits[0],vmax=scale/2 if col=='difference' else limits[1])
            ax.set(xlim=(-180,180),ylim=(-90,90),title=f'{col}: {label}',xlabel='Longitude',ylabel='Latitude');fig.colorbar(im,ax=ax)
    fig.suptitle(f'{stem}: two-year mean versus 24 POWER reference points; supplied SST excluded from independent prediction claims')
    fig.savefig(OUT / f'{stem}-comparison.png',dpi=170);plt.close(fig)

rces=[]
for sst in (295,300,305):
    name=f'rcemip-{sst}-K.json'
    if (OUT/name).exists():
        r=read(name);rces.append(r)
        report[f'rcemip{sst}']={k:r[k] for k in ('configuration','stationarity','final200DayMeans','waterResidualKgM2','protocolDeviations')}
        if sst==300:
            ref=json.loads((ROOT/'tests/fixtures/rcemip-ensemble-summary.json').read_text())
            means=dict(r['final200DayMeans'])
            means['columnWaterKgM2']=float(np.mean([s['columnWaterKgM2'] for s in r['samples'][-200:]]))
            comparison={key:dict(model=means[key],ensembleMean=v['mean'],ensembleStandardDeviation=v['standardDeviation'],standardizedDifference=(means[key]-v['mean'])/v['standardDeviation']) for key,v in ref['statistics'].items()}
            report['rcemip300']['ensembleComparison']=dict(source=ref['source'],table=ref['table'],metrics=comparison,limitations=ref['limitations'])
if rces:
    fig,axes=plt.subplots(2,3,figsize=(12,7),constrained_layout=True)
    for col,r in enumerate(rces):
        s=r['samples'];days=[x['day'] for x in s];height=np.array(r['heightM'])/1000
        contour=axes[0,col].contourf(days,height,np.array([x['temperatureK'] for x in s]).T,20,cmap='coolwarm')
        axes[0,col].set(title=f"{r['configuration']['sstK']} K SST",xlabel='Day',ylabel='Initial-height coordinates (km)');fig.colorbar(contour,ax=axes[0,col])
        axes[1,col].plot(days,[x['precipitationMmDay'] for x in s]);axes[1,col].set(xlabel='Day',ylabel='mm/day')
    fig.suptitle('Spectral single-column RCE: actual integrations, with stationarity and protocol deviations recorded')
    fig.savefig(OUT/'rcemip.png',dpi=170);plt.close(fig)

for sst in (295,300,305):
    p=ROOT/f'artifacts/climate-reference/rce-1000day-{sst}K.json'
    if p.exists():
        r=json.loads(p.read_text());report[f'appRce{sst}']={k:r[k] for k in ('configuration','stationarity','energyResidual','protocolDeviations')}
(OUT/'summary.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v.get('status',v.get('stationarity',{})) for k,v in report.items() if isinstance(v,dict)},indent=2))
