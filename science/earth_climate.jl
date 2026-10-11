using SpeedyWeather, JSON3, Dates, Statistics, Random
const SPECTRAL="--spectral" in ARGS
include("surface.jl")
include("land_flux.jl")
if SPECTRAL;include("allsky_radiation.jl");else;include("clouds.jl");end

mutable struct EarthAudit <: SpeedyWeather.AbstractCallback
    start::DateTime
    next::DateTime
    samples::Int
    sums::Dict{Symbol,Vector{Float64}}
    monthly::Vector{Dict{Symbol,Vector{Float64}}}
    counts::Vector{Int}
    interval_rain::Vector{Float64}
    previous::DateTime
end
function EarthAudit(sg)
    sums=Dict(k=>zeros(sg.npoints) for k in (:skin_temperature,:surface_air_temperature,:cloud_fraction,:rain_mm_day))
    EarthAudit(DateTime(2000),DateTime(2000),0,sums,[deepcopy(sums) for _ in 1:24],zeros(Int,24),zeros(sg.npoints),DateTime(2000))
end
SpeedyWeather.initialize!(a::EarthAudit,vars,model)=begin
    a.start=vars.prognostic.clock.time;a.previous=a.start;a.next=a.start+Hour(6);nothing
end
SpeedyWeather.finalize!(::EarthAudit,args...)=nothing
function SpeedyWeather.callback!(a::EarthAudit,vars,model)
    now=vars.prognostic.clock.time
    dt=Dates.value(now-a.previous)/1000;a.previous=now
    p=vars.parameterizations
    # Physical m/s flux integrated over elapsed clock time, independent of
    # leapfrog's two-step prognostic tendency update and accumulator semantics.
    a.interval_rain.+=Float64.(p.rain_rate[:]+p.snow_rate[:]).*(1000*dt)
    now<a.next&&return;a.next+=Hour(6)
    day=Dates.value(now-a.start)/86400000
    daily=a.interval_rain*4;a.interval_rain.=0
    if day>365
        a.samples+=1
        midpoint=now-Hour(3)
        m=(year(midpoint)-2002)*12+month(midpoint)
        1<=m<=24||error("Invalid climate month $m")
        a.counts[m]+=1
        land=Float64.(model.land_sea_mask.land_fraction[:])
        ocean=Float64.(vars.prognostic.ocean.sea_surface_temperature[:])
        soil=Float64.(Array(vars.prognostic.land.soil_temperature)[:,1])
        # Masked values cannot enter 0*NaN arithmetic.
        skin=[l>=1 ? t : l<=0 ? s : (1-l)*s+l*t for (l,s,t) in zip(land,ocean,soil)]
        values=(skin_temperature=skin.-273.15,surface_air_temperature=Float64.(p.surface_air_temperature[:]).-273.15,
                cloud_fraction=Float64.(p.total_cloud_cover[:]),rain_mm_day=daily)
        for k in keys(a.sums)
            all(isfinite,values[k])||error("Nonfinite $k at day $day")
            a.sums[k].+=values[k];a.monthly[m][k].+=values[k]
        end
    end
    if abs(day/100-round(day/100))<1e-6
        println("Earth climate day ",round(Int,day)," cloud mean ",mean(p.total_cloud_cover));flush(stdout)
    end
end

function run_earth()
    Random.seed!(42)
    sg=SpectralGrid(truncation=SPECTRAL ? 21 : 31,nlayers=SPECTRAL ? 32 : 20)
    # AMIP-style prescribed monthly SST, independent prognostic soil moisture,
    # temperature and snow, prescribed vegetation climatology, actual Earth land and topography.
    radiation=SPECTRAL ? AllSkyRadiation(sg) : Radiation(sg;shortwave=OneBandShortwave(sg;clouds=PhysicalDiagnosticClouds(sg)))
    geometry=SPECTRAL ? Geometry(sg;vertical_coordinates=SigmaCoordinates(collect(range(0,1,length=33)).^2)) : Geometry(sg)
    model=PrimitiveWetModel(sg;ocean=MaskedSeasonalOcean(sg),sea_ice=MonthlySeaIce(sg),radiation,geometry,
        surface_humidity_flux=SurfaceHumidityFlux(sg;land=PhysicalLandHumidityFlux(sg)),
        time_stepping=Leapfrog(sg;Δt_at_T32=Minute(15)),feedback=Feedback(verbose=false,debug=true))
    audit=EarthAudit(sg);add!(model,:audit=>audit)
    sim=initialize!(model;time=DateTime(2001));println("SST boundary audit: ",model.ocean.audit);println("Sea ice boundary audit: ",model.sea_ice.audit);flush(stdout);started=time()
    run!(sim,period=Day(1095),output=false)
    model.feedback.nans_detected&&error("Earth climate NaNs")
    audit.samples==2920||error("Incomplete Earth mean: $(audit.samples)")
    means=Dict(k=>v/audit.samples for (k,v) in audit.sums)
    monthly=[Dict(k=>v/max(1,audit.counts[i]) for (k,v) in d) for (i,d) in enumerate(audit.monthly)]
    result=(schema=1,solver="SpeedyWeather.jl $(pkgversion(SpeedyWeather))",status="completed-observation-comparison-pending",
        configuration=(truncation=sg.truncation,nlayers=sg.nlayers,precipitationNormalization="physical m/s rain+snow rate integrated over elapsed clock seconds",days=1095,spinupDays=365,averageDays=730,sampleHours=6,timestepSeconds=model.time_stepping.Δt,
            surface="Earth orography and land fraction, monthly prescribed SST, prognostic soil/snow, prescribed monthly sea ice and vegetation climatology",
            radiation=SPECTRAL ? "ecCKD gas/Mie liquid/Baum ice, random overlap, diagnostic condensate, 3 h radiation" : "SPEEDY shortwave/ozone and Frierson longwave; not spectroscopic Earth radiation",
            cloud="SPEEDY SI/stability corrections; reference sigma-pressure cloud sampling; random union"),
        surfaceBoundaryAudit=(sst=model.ocean.audit,seaIce=model.sea_ice.audit),elapsedSeconds=time()-started,samples=audit.samples,longitude=Float64.(model.geometry.londs),latitude=Float64.(model.geometry.latds),
        landFraction=Float64.(model.land_sea_mask.land_fraction[:]),orographyM=Float64.(model.orography.orography[:]),
        means,monthly,monthSamples=audit.counts,
        limitations=["Surface air temperature is dry-adiabatically extrapolated, not a Monin–Obukhov 2-m diagnostic",
            "Ocean skin temperature is prescribed; it is not an independent SST prediction",
            "Different climatology periods for SST boundary and POWER 2001–2020 observations",
            "Two years of averaging and 24 reference points do not establish a globally validated climate model"])
    mkpath("artifacts/science");open(SPECTRAL ? "artifacts/science/earth-climate-spectral.json" : "artifacts/science/earth-climate.json","w") do io;JSON3.write(io,result);end
    println("Earth climate completed in ",result.elapsedSeconds," seconds");flush(stdout)
end
run_earth()
