# Monthly Earth SST, retaining only finite sea values in coastal interpolation.
# The upstream unweighted interpolator propagates land NaNs and substitutes
# 285 K; that arbitrary land placeholder must never become active ocean SST.
mutable struct MaskedSeasonalOcean{O} <: SpeedyWeather.AbstractPrescribedOcean
    climatology::O
    audit::Dict{String,Any}
end
MaskedSeasonalOcean(sg)=MaskedSeasonalOcean(SeasonalOceanClimatology(sg),Dict{String,Any}())

function masked_sst!(target,source,land_fraction;land_temperature=285.,valid_range=(180.,330.))
    RG=SpeedyWeather.RingGrids
    valid=copy(source);numerator=copy(source)
    valid.data.=isfinite.(source.data)
    numerator.data.=ifelse.(isfinite.(source.data),source.data,0)
    weights=copy(target)
    interp=RG.interpolator(target,source,NF=Float32)
    RG.interpolate!(target,numerator,interp);RG.interpolate!(weights,valid,interp)
    source_lon,source_lat=RG.get_londlatds(source.grid)
    target_lon,target_lat=RG.get_londlatds(target.grid)
    xyz(lon,lat)=(cosd(lat)*cosd(lon),cosd(lat)*sind(lon),sind(lat))
    coordinates=xyz.(source_lon,source_lat)
    repaired=0;fallback=0;max_distance=0.
    for m in axes(target.data,2)
        candidates=findall(isfinite,view(source.data,:,m))
        isempty(candidates)&&error("SST month $m contains no valid sea samples")
        for i in axes(target.data,1)
            if land_fraction[i]>=1
                target.data[i,m]=land_temperature
            elseif weights.data[i,m]>1e-7
                weights.data[i,m]<1-1e-6&&(repaired+=1)
                target.data[i,m]/=weights.data[i,m]
            else
                # Great-circle nearest valid sea datum; retain its observed
                # value and report distance rather than manufacture 285 K.
                v=xyz(target_lon[i],target_lat[i]);best=-Inf;index=0
                for j in candidates
                    c=coordinates[j];similarity=v[1]*c[1]+v[2]*c[2]+v[3]*c[3]
                    if similarity>best;best=similarity;index=j;end
                end
                target.data[i,m]=source.data[index,m];fallback+=1
                max_distance=max(max_distance,6371*acos(clamp(best,-1,1)))
            end
        end
    end
    active=target.data[findall(x->x<1,land_fraction),:]
    all(isfinite,active)||error("Nonfinite active SST")
    lo,hi=extrema(active);valid_range[1]<=lo<=hi<=valid_range[2]||error("Unphysical monthly boundary range: $lo $hi")
    Dict{String,Any}("partialCoastalInterpolations"=>repaired,"nearestSeaFallbacks"=>fallback,
        "maximumFallbackDistanceKm"=>max_distance,"activeSstRangeK"=>[lo,hi],
        "monthlyTimeInterpolation"=>"linear between calendar-month midpoints",
        "maskedLandPlaceholderK"=>land_temperature)
end
function SpeedyWeather.initialize!(o::MaskedSeasonalOcean,model::SpeedyWeather.PrimitiveEquation)
    c=o.climatology
    source=SpeedyWeather.get_asset(c.path;from_assets=c.from_assets,name=c.varname,
        ArrayType=c.FieldType,FileFormat=SpeedyWeather.NCDataset,version=c.version)
    merge!(o.audit,masked_sst!(c.monthly_temperature,source,model.land_sea_mask.land_fraction.data;land_temperature=c.land_temperature))
    nothing
end
SpeedyWeather.initialize!(vars::SpeedyWeather.Variables,o::MaskedSeasonalOcean,model)=SpeedyWeather.timestep!(vars,o,model)
month_midpoint(t)=Dates.firstdayofmonth(t)+Millisecond(43200000*Dates.daysinmonth(t))
function monthly_bracket(t)
    center=month_midpoint(t)
    left,right=t<center ? (month_midpoint(t-Month(1)),center) : (center,month_midpoint(t+Month(1)))
    month(left),month(right),Dates.value(t-left)/Dates.value(right-left)
end
function SpeedyWeather.timestep!(vars::SpeedyWeather.Variables,o::MaskedSeasonalOcean,model::SpeedyWeather.PrimitiveEquation)
    a,b,w=monthly_bracket(vars.prognostic.clock.time)
    monthly=o.climatology.monthly_temperature.data
    dst=vars.prognostic.ocean.sea_surface_temperature.data
    av=view(monthly,:,a);bv=view(monthly,:,b)
    @. dst=(1-w)*av+w*bv
    nothing
end

# AMIP-style observed monthly ice area replaces SST-threshold growth/melt.
# Use the Gaussian-grid ERA5-derived asset; its averaging period is not
# established by the file metadata, so retain that uncertainty in the audit.
mutable struct MonthlySeaIce{O} <: SpeedyWeather.AbstractPrescribedSeaIce
    climatology::O
    audit::Dict{String,Any}
end
MonthlySeaIce(sg)=MonthlySeaIce(SeasonalOceanClimatology(sg;file="sea_ice.nc",varname="sic",land_temperature=0),Dict{String,Any}())
function SpeedyWeather.initialize!(o::MonthlySeaIce,model::SpeedyWeather.PrimitiveEquation)
    c=o.climatology
    source=SpeedyWeather.get_asset(c.path;from_assets=true,name="sic",ArrayType=c.FieldType,FileFormat=SpeedyWeather.NCDataset,version=c.version)
    a=masked_sst!(c.monthly_temperature,source,model.land_sea_mask.land_fraction.data;land_temperature=0.,valid_range=(0.,1.))
    a["activeConcentrationRange"]=pop!(a,"activeSstRangeK")
    a["maskedLandPlaceholder"]=pop!(a,"maskedLandPlaceholderK")
    a["source"]="SpeedyWeatherAssets v1 ERA5-derived monthly sea_ice.nc sic, unit 1"
    a["climatologyPeriod"]="not established by asset metadata"
    merge!(o.audit,a);nothing
end
SpeedyWeather.initialize!(vars::SpeedyWeather.Variables,o::MonthlySeaIce,model)=SpeedyWeather.timestep!(vars,o,model)
function SpeedyWeather.timestep!(vars::SpeedyWeather.Variables,o::MonthlySeaIce,model::SpeedyWeather.PrimitiveEquation)
    a,b,w=monthly_bracket(vars.prognostic.clock.time)
    monthly=o.climatology.monthly_temperature.data
    dst=vars.prognostic.ocean.sea_ice_concentration.data
    av=view(monthly,:,a);bv=view(monthly,:,b)
    @. dst=(1-w)*av+w*bv
    nothing
end
