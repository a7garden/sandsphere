# SPEEDY statistical cloud diagnosis, with SI conversion and dimensionless
# dry-static-energy gradient from the original Fortran implementation:
# https://users.ictp.it/~kucharsk/speedy_description/km_ver41_appendixA.pdf
# SpeedyWeather 0.23's diagnostic uses /1000 on m/s precipitation and a
# dimensional, reversed static-energy difference. Keep fixes local to this
# component; do not silently monkey-patch the installed reference solver.
mutable struct PhysicalDiagnosticClouds{C} <: SpeedyWeather.AbstractShortwaveClouds
    parameters::C
    stencils::Vector{Tuple{Int,Int,Float64}}
    stratocumulus_top::Int
end
PhysicalDiagnosticClouds(sg::SpectralGrid)=PhysicalDiagnosticClouds(DiagnosticClouds(sg),Tuple{Int,Int,Float64}[],0)
# Reference eight-layer full sigma values (geometry.f90). Preserve physical
# sampling pressure when vertical resolution changes, rather than using n-1.
const SPEEDY_CLOUD_SIGMA=(.095,.2,.34,.51,.685,.835,.95)
function sigma_stencil(levels,target)
    hi=clamp(searchsortedfirst(levels,target),2,length(levels));lo=hi-1
    weight=clamp((target-levels[lo])/(levels[hi]-levels[lo]),0.,1.)
    (lo,hi,Float64(weight))
end
sample_sigma(values,(lo,hi,w))=(1-w)*values[lo]+w*values[hi]
function SpeedyWeather.initialize!(c::PhysicalDiagnosticClouds,model::SpeedyWeather.AbstractModel)
    levels=model.geometry.σ_levels_full
    c.stencils=[sigma_stencil(levels,σ) for σ in SPEEDY_CLOUD_SIGMA]
    c.stratocumulus_top=argmin(abs.(levels.-.835))
    nothing
end
SpeedyWeather.variables(c::PhysicalDiagnosticClouds)=(SpeedyWeather.variables(c.parameters)...,
    SpeedyWeather.ParameterizationVariable(:total_cloud_cover,SpeedyWeather.Grid2D(),desc="Random-overlap total cloud area",units="1"))

function speedy_cloud_cover(rh_max,rain_rate_ms,stability,rh_surface,land_fraction)
    # Published SPEEDY defaults. No fit to our POWER evaluation points.
    large=min(1.,.2*sqrt(clamp(86400*1000*rain_rate_ms,0,10))+(clamp((rh_max-.3)/.7,0,1))^2)
    strat_ocean=clamp((stability-.25)/.15,0,1)*max(.6-1.2*large,0)
    strat_land=max(strat_ocean,.15)*clamp(rh_surface,0,1)
    strat=(1-land_fraction)*strat_ocean+land_fraction*strat_land
    return large,strat,1-(1-large)*(1-strat)
end
function SpeedyWeather.clouds!(ij,vars,c::PhysicalDiagnosticClouds,model)
    p=c.parameters
    temp=SpeedyWeather.get_prognostic_step(vars.grid.temperature,model.time_stepping,c)
    humid=SpeedyWeather.get_prognostic_step(vars.grid.humidity,model.time_stepping,c)
    phi=vars.dynamics.geopotential
    ps=vars.parameterizations.surface_pressure[ij]
    vc=model.geometry.vertical_coordinates;n=size(temp,2)
    rh_max=0.;top=n+1
    rh(k)=begin
        qs=SpeedyWeather.saturation_humidity(temp[ij,k],SpeedyWeather.pressure(k,ps,vc),model.atmosphere)
        qs>0 ? humid[ij,k]/qs : 0.
    end
    for i in 1:6
        lo,hi,w=c.stencils[i]
        relative=(1-w)*rh(lo)+w*rh(hi)
        q=(1-w)*humid[ij,lo]+w*humid[ij,hi]
        # An absolute 0.2 g/kg cutoff excluded even saturated cold clouds.
        # RH already normalizes by the temperature-dependent saturation.
        if q>0&&relative>rh_max
            rh_max=relative;top=w<.5 ? lo : hi
        end
    end
    top=min(top,round(Int,vars.parameterizations.cloud_top[ij]))
    upper,lower=c.stencils[6],c.stencils[7]
    T=view(temp,ij,:);Φ=view(phi,ij,:)
    dz_phi=sample_sigma(Φ,upper)-sample_sigma(Φ,lower)
    stability=dz_phi>0 ? 1+model.atmosphere.heat_capacity*(sample_sigma(T,upper)-sample_sigma(T,lower))/dz_phi : 0.
    lo,hi,w=lower;rh_surface=(1-w)*rh(lo)+w*rh(hi)
    large,strat,total=speedy_cloud_cover(rh_max,vars.parameterizations.rain_rate[ij]+vars.parameterizations.snow_rate[ij],stability,rh_surface,model.land_sea_mask.land_fraction[ij])
    vars.parameterizations.cloud_top[ij]=top
    vars.parameterizations.cloud_top_height[ij]=top<=n ? phi[ij,max(1,top)]/model.planet.gravity : 0
    vars.parameterizations.cloud_cover[ij]=large
    vars.parameterizations.total_cloud_cover[ij]=total
    return (cloud_cover=large,cloud_top=top,stratocumulus_cover=strat,stratocumulus_top=c.stratocumulus_top,cloud_albedo=p.cloud_albedo,stratocumulus_albedo=p.stratocumulus_albedo)
end
