using SpeedyWeather, JSON3, Dates, Statistics
include("surface.jl")
sg=SpectralGrid(truncation=21,nlayers=32)
model=PrimitiveWetModel(sg;ocean=MaskedSeasonalOcean(sg),sea_ice=MonthlySeaIce(sg))
for component in (model.geometry,model.land_sea_mask,model.ocean,model.sea_ice)
    SpeedyWeather.initialize!(component,model)
end
T=model.ocean.climatology.monthly_temperature.data
C=model.sea_ice.climatology.monthly_temperature.data
L=model.land_sea_mask.land_fraction.data
open_sea=[T[i,m] for m in 1:12,i in axes(T,1) if L[i]<.5&&C[i,m]<.01]
cold=[(point=i,month=m,temperatureK=T[i,m],iceFraction=C[i,m],landFraction=L[i]) for m in 1:12,i in axes(T,1) if L[i]<.5&&C[i,m]<.01&&T[i,m]<269.15]
result=(schema=1,configuration=(truncation=21,nlayers=32,npoints=sg.npoints),
    sst=model.ocean.audit,seaIce=model.sea_ice.audit,
    nearlyIceFreeSeaRangeK=extrema(open_sea),coldNearlyIceFreeSeaSamples=cold,
    interpretation="Under-ice cold asset temperatures are prescribed surface values, not a separate liquid-water or predicted ice-skin state")
open("artifacts/science/surface-boundary-check.json","w") do io;JSON3.write(io,result);end
println(JSON3.write(result))
