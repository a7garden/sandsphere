"""Render scientific audit figures from test outputs (requires matplotlib)."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize, TwoSlopeNorm

root = Path(__file__).resolve().parents[1] / "artifacts/climate-reference"
audit = json.loads((root / "column-observations.json").read_text())
rows = audit["rows"]
fig, axes = plt.subplots(3, 3, figsize=(13, 9), constrained_layout=True)
longitude = [r["longitude"] for r in rows]
latitude = [r["latitude"] for r in rows]
for row, key, unit, limits, error_limit, palette in [
    (0, "temperature", "Surface temperature (deg C)", (-40, 40), .3, "coolwarm"),
    (1, "precipitation", "Precipitation (mm/day)", (0, 7), 5, "Blues"),
    (2, "cloud", "Cloud area fraction (%)", (0, 100), 100, "Blues"),
]:
    for col, field in enumerate(["observed", "model", "difference"]):
        values = [r[key][field] if field != "difference" else r[key]["model"]-r[key]["observed"] for r in rows]
        norm = Normalize(*limits) if col < 2 else TwoSlopeNorm(0, -error_limit, error_limit)
        points = axes[row, col].scatter(longitude, latitude, c=values, s=260, marker="s", norm=norm, cmap=palette if col < 2 else "coolwarm", edgecolors="#555", linewidth=.5)
        axes[row, col].set(xlim=(-180,180), ylim=(-90,90), xticks=[-180,-90,0,90,180], yticks=[-90,-45,0,45,90])
        axes[row, col].grid(alpha=.2)
        axes[row, col].set_title(["NASA 2001-2020 mean", "One-day wet column", "Model minus reference"][col] + "\n" + unit, fontsize=10)
        fig.colorbar(points, ax=axes[row,col], shrink=.8)
fig.suptitle("24 sampled locations: transient audit, NOT climatological validation\nTemperature starts from reference; Uniform subgrid cloud PDF; transient run does not establish climate skill", fontsize=12)
fig.savefig(root / "sampled-distributions.png", dpi=170)
plt.close(fig)

radiation = json.loads((root / "radiation-observations.json").read_text())
default = next(s for s in radiation["sensitivity"] if s["lapseKPerKm"]==6.5)
fig, axes = plt.subplots(1, 2, figsize=(10, 4.5), constrained_layout=True)
for ax, key, title, limits in [
    (axes[0], "longwave", "Clear-sky downward LW (W/m2)", (50,450)),
    (axes[1], "conditionalTemperature", "Conditional surface balance (deg C)", (-60,60)),
]:
    samples = default["samples"][key]
    ax.scatter([s["observed"] for s in samples], [s["model"] for s in samples], s=11, alpha=.5)
    ax.plot(limits, limits, color="#333", linewidth=1)
    ax.set(xlim=limits, ylim=limits, xlabel="NASA reference", ylabel="Model diagnostic", title=title)
    ax.grid(alpha=.2)
fig.suptitle("288 monthly samples; synthetic 6.5 K/km, constant-RH profiles\nSpectral coefficients are published defaults; no fit to these samples", fontsize=11)
fig.savefig(root / "radiation-comparison.png", dpi=170)
plt.close(fig)

if (root / "rce-100day.json").exists():
    result = json.loads((root / "rce-100day.json").read_text())
    samples = result["samples"]
    fig, axes = plt.subplots(1,3,figsize=(12,3.5),constrained_layout=True)
    days = [s["day"] for s in samples]
    for k in range(5):
        axes[0].plot(days, [s["temperature"][k] for s in samples], label=f"Layer {k+1}")
    axes[0].set(xlabel="Day", ylabel="deg C", title="Layer temperature"); axes[0].legend(fontsize=8)
    axes[1].plot(days,[s["dailyMaximumTemperatureChangeK"] for s in samples]);axes[1].axhline(.01,color="#999",ls="--")
    axes[1].set(xlabel="Day",ylabel="K/day",yscale="log",title="Maximum daily change")
    axes[2].plot(days,[s["precipitationMmDay"] for s in samples]); axes[2].set(xlabel="Day",ylabel="mm/day",title="Precipitation")
    fig.suptitle("100-day development column: RCEMIP forcing; protocol deviations prevent RCEMIP certification",fontsize=10)
    fig.savefig(root / "rce-100day.png",dpi=170)
    plt.close(fig)
print("Saved audit plots in", root)
