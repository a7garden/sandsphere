"""Plot recorded physics steps; requires matplotlib only for this audit export.

Run after the opt-in soak tests:
  python scripts/audit-climate-plot.py
"""
import json
from pathlib import Path
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parents[1] / 'artifacts/climate-soak'
fig, axes = plt.subplots(2, 3, figsize=(13, 7.5), constrained_layout=True)
cases = [('final/coast-1.json', 'Rotating coast', '#247ba0'),
         ('final/tidal-1.json', 'Tidally locked', '#d57632'),
         ('final/cold-1.json', 'Cold coast (control)', '#717783')]
for filename, label, color in cases:
    samples = json.loads((root / filename).read_text())['samples']
    time = [s['time'] for s in samples]
    axes[0, 0].plot(time, [s['meanT'] for s in samples], label=label, color=color)
    axes[0, 0].fill_between(time, [s['minT'] for s in samples],
                           [s['maxT'] for s in samples], color=color, alpha=.1)
    axes[0, 1].plot(time, [s['windRms'] * 1000 for s in samples], color=color)
    axes[0, 2].plot(time, [s['currentRms'] * 1000 for s in samples], color=color)
    axes[1, 0].plot(time, [s['stocks']['cloud'] + s['stocks']['cloudIce']
                           for s in samples], color=color)
    rates = [(b['rain'] + b['snow'] - a['rain'] - a['snow']) /
             (b['time'] - a['time']) for a, b in zip(samples, samples[1:])]
    axes[1, 1].plot(time[1:], rates, color=color)
    axes[1, 2].plot(time, [s['stocks']['plant'] for s in samples], color=color)
titles = [('Temperature: mean and cell range', 'deg C'),
          ('Airflow RMS', 'millirad / game second'),
          ('Surface current RMS', 'millirad / game second'),
          ('Cloud water + ice stock', 'kg'),
          ('Rain + snow: 60-second intervals', 'kg / game second'),
          ('Living vegetation stock', 'kg')]
for ax, (title, unit) in zip(axes.flat, titles):
    ax.set_title(title, fontsize=11, loc='left')
    ax.set_xlabel('Game seconds')
    ax.set_ylabel(unit)
    ax.grid(alpha=.2)
    ax.set_xlim(0, 7200)
axes[0, 0].legend(fontsize=8, frameon=False)
fig.suptitle('Sandsphere: 42-cell long-run climate / ecology audit', fontsize=15)
fig.savefig(root / 'long-run.png', dpi=170)
fig.savefig(root / 'long-run.pdf')
print(root / 'long-run.png')
