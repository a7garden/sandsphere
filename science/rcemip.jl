using SpeedyWeather, JSON3, Dates, Statistics, Random
include("allsky_radiation.jl")
include("column.jl")

struct FixedZenith <: SpeedyWeather.AbstractZenith
    cosine::Float64
end
SpeedyWeather.initialize!(::FixedZenith,model::SpeedyWeather.AbstractModel)=nothing
SpeedyWeather.initialize!(::FixedZenith,::DateTime,model::SpeedyWeather.AbstractModel)=nothing
SpeedyWeather.cos_zenith!(out,z::FixedZenith,args...)=(out.=z.cosine;nothing)

mutable struct RCEAudit <: SpeedyWeather.AbstractCallback
    start::DateTime
    previous::DateTime
    next::DateTime
    water0::Float64
    evaporation::Float64
    rain::Float64
    daily_rain::Float64
    samples::Vector{Any}
end
RCEAudit()=RCEAudit(DateTime(2000),DateTime(2000),DateTime(2000),NaN,0.,0.,0.,Any[])
function SpeedyWeather.initialize!(a::RCEAudit,vars,model)
    now=vars.prognostic.clock.time
    isempty(a.samples)&&(a.start=now)
    a.previous=now;a.next=now+Day(1)
    ps=exp(vars.grid.pressure[1,2]);q=vars.grid.humidity[1,:,2]
    isnan(a.water0)&&(a.water0=sum(Float64(q[k])*SpeedyWeather.pressure_thickness(k,ps,model.geometry.vertical_coordinates)/model.planet.gravity for k in eachindex(q)))
    nothing
end
SpeedyWeather.finalize!(::RCEAudit,args...)=nothing
function SpeedyWeather.callback!(a::RCEAudit,vars,model)
    now=vars.prognostic.clock.time;dt=Dates.value(now-a.previous)/1000;a.previous=now
    P=vars.parameterizations
    # Integrate physical fluxes in SI over actual clock time, independent of
    # leapfrog's two-step prognostic update and accumulator initialization.
    rain=Float64(P.rain_rate[1]+P.snow_rate[1])*1000*dt
    a.rain+=rain;a.daily_rain+=rain;a.evaporation+=Float64(P.surface_humidity_flux[1])*dt
    now<a.next&&return;a.next+=Day(1)
    ps=P.surface_pressure[1];T=Float64.(vars.grid.temperature[1,:,2]);q=Float64.(vars.grid.humidity[1,:,2])
    all(isfinite,T)&&all(isfinite,q)||error("Nonfinite RCE column")
    water=sum(q[k]*SpeedyWeather.pressure_thickness(k,ps,model.geometry.vertical_coordinates)/model.planet.gravity for k in eachindex(q))
    day=round(Int,Dates.value(now-a.start)/86400000)
    solar=model.planet.solar_constant*cosd(42.05)
    sample=(day=day,temperatureK=T,humidity=q,columnWaterKgM2=water,precipitationMmDay=a.daily_rain,
        waterResidualKgM2=water-a.water0+a.rain-a.evaporation,
        olrWm2=Float64(P.outgoing_longwave[1]),toaNetWm2=Float64(solar-P.outgoing_shortwave[1]-P.outgoing_longwave[1]),
        cloudFraction=Float64(P.total_cloud_cover[1]),surfaceTemperatureK=Float64(vars.prognostic.ocean.sea_surface_temperature[1]))
    push!(a.samples,sample);a.daily_rain=0
    if day%100==0
        println("Spectral RCE day ",day," T range ",extrema(T)," rain ",sample.precipitationMmDay," water residual ",sample.waterResidualKgM2);flush(stdout)
    end
end

function run_rce(sst;days=1000,maxDays=2000)
    Random.seed!(42)
    # All columns are homogeneous with dynamics disabled. A linear Gaussian
    # grid exactly represents this constant horizontal field; quadratic
    # dealiasing would only duplicate the same column four times as often.
    sg=SpectralGrid(NF=Float64,truncation=1,nlayers=64,Grid=FullGaussianGrid,dealiasing=1)
    geometry=Geometry(sg;vertical_coordinates=SigmaCoordinates(collect(range(0,1,length=65)).^2))
    ozone=p->3.6478e-6*(p/100)^.83209*exp(-p/(100*11.3515))
    radiation=AllSkyRadiation(sg;co2=348e-6,ch4=1650e-9,n2o=306e-9,ozone,intervalSeconds=3600,zeroCfc=true)
    albedo=GlobalConstantAlbedo(sg;albedo=.07)
    model=PrimitiveWetModel(sg;geometry,radiation,dynamics=false,horizontal_diffusion=ColumnNoHorizontalDiffusion(),
        planet=Earth(sg;solar_constant=551.58),solar_zenith=FixedZenith(cosd(42.05)),
        ocean=AquaPlanet(sg;temperature_equator=sst,temperature_poles=sst),sea_ice=nothing,
        land_sea_mask=AquaPlanetMask(sg),orography=NoOrography(sg),
        albedo=OceanLandAlbedo(sg;ocean=albedo,land=albedo),
        boundary_layer=BoundaryLayer(sg;surface_condition=SurfaceCondition(sg;gust_speed=5)),
        time_stepping=Leapfrog(sg;Δt_at_T32=Second(10)),feedback=Feedback(verbose=false,debug=true))
    audit=RCEAudit();add!(model,:audit=>audit)
    sim=initialize!(model)
    q0=sst==295 ? .012 : sst==300 ? .01865 : .024
    tv0=sst*(1+.608*q0);tvt=tv0-.0067*15000;ps=101480.;rd=287.04;g=9.81
    pt=ps*(tvt/tv0)^(g/(rd*.0067))
    height=σ->σ*ps>=pt ? tv0/.0067*(1-(σ)^(rd*.0067/g)) : 15000-rd*tvt/g*log(σ*ps/pt)
    humid=σ->height(σ)<15000 ? q0*exp(-height(σ)/4000-(height(σ)/7500)^2) : 1e-14
    temp=σ->(tv0-.0067*min(15000,height(σ)))/(1+.608*humid(σ))
    for step in 1:2
        set!(sim;step,temperature=(lon,lat,σ)->temp(σ),humidity=(lon,lat,σ)->humid(σ),pressure=log(ps),u=0,v=0)
    end
    started=time();run!(sim,period=Day(days),output=false)
    model.feedback.nans_detected&&error("RCE NaNs")
    length(audit.samples)==days||error("Incomplete RCE")
    means=lohi->[mean(s.temperatureK[k] for s in audit.samples[lohi]) for k in 1:64]
    drift=maximum(abs.(means(days-199:days-100)-means(days-99:days)))
    checkpoints=[(day=days,maximum100DayMeanTemperatureDifferenceK=drift)]
    while drift>=.2 && days<maxDays
        chunk=min(500,maxDays-days)
        run!(sim,period=Day(chunk),output=false);days+=chunk
        model.feedback.nans_detected&&error("RCE continuation NaNs")
        length(audit.samples)==days||error("Incomplete RCE continuation")
        drift=maximum(abs.(means(days-199:days-100)-means(days-99:days)))
        push!(checkpoints,(day=days,maximum100DayMeanTemperatureDifferenceK=drift))
    end
    last=audit.samples[days-199:days]
    result=(schema=1,solver="SpeedyWeather.jl $(pkgversion(SpeedyWeather)) / NumericalRadiation $(pkgversion(NR))",
        status="completed-RCEMIP-SCM-protocol-audit",configuration=(sstK=sst,days=days,nlayers=64,redundantHomogeneousGridPoints=sg.npoints,topCenterHeightM=height(model.geometry.σ_levels_full[1]),
            radiationSeconds=3600,solarConstantWm2=551.58,zenithDegrees=42.05,albedo=.07,surfaceFluxWindMS=5,
            co2Ppm=348,ch4Ppb=1650,n2oPpb=306,cfc11Ppt=0,cfc12Ppt=0,ozone="Wing analytic pressure profile",initialSounding="Wing analytic tropical sounding",
            surfacePressurePa=ps,timestepSeconds=model.time_stepping.Δt,
            cloudClosure="pressure-sampled diagnostic SPEEDY cover, 900 s precipitation-linked condensate, 0.01 kg/m² in-cloud stratocumulus path floor"),
        elapsedSeconds=time()-started,sigma=Float64.(model.geometry.σ_levels_full),heightM=height.(Float64.(model.geometry.σ_levels_full)),
        stationarity=(maximum100DayMeanTemperatureDifferenceK=drift,projectToleranceK=.2,passed=drift<.2,checkpoints=checkpoints),
        final200DayMeans=(precipitationMmDay=mean(s.precipitationMmDay for s in last),olrWm2=mean(s.olrWm2 for s in last),cloudFraction=mean(s.cloudFraction for s in last)),
        waterResidualKgM2=audit.samples[end].waterResidualKgM2,
        protocolDeviations=["Diagnostic condensate rather than prognostic cloud liquid/ice","Single realization of each SST, no parameterization uncertainty ensemble",
            "Ensemble summary comparison at 300 K only; no full profile/temperature/cloud-amount intercomparison","Single vertical resolution; convergence not demonstrated","500-day continuation chunks reinitialize leapfrog; not bitwise identical to one uninterrupted integration"],samples=audit.samples)
    mkpath("artifacts/science");open("artifacts/science/rcemip-$sst-K.json","w") do io;JSON3.write(io,result);end
    println("Spectral RCE ",sst," K completed: ",result.stationarity," means ",result.final200DayMeans);flush(stdout)
end
for sst in (295,300,305);run_rce(sst);end
