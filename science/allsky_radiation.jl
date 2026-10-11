import NumericalRadiation as NR
const RadiationCoupling=Base.get_extension(SpeedyWeather,:SpeedyWeatherNumericalRadiationExt)
include("clouds.jl")

"""Spectral ecCKD gas optics + Mie liquid/Baum ice optics with random overlap.
Condensate is diagnostic: cloud production inferred from precipitation with
a declared 900-s residence time. This is a sensitivity parameter, not a
fit to the POWER points, and is not a prognostic cloud-microphysics model."""
struct AllSkyRadiation{R,C,O} <: SpeedyWeather.AbstractRadiation
    gas::R
    clouds::C
    optics::O
    intervalSeconds::Int
    residenceSeconds::Int
end
function AllSkyRadiation(sg;co2=400e-6,ch4=1800e-9,n2o=320e-9,
                         ozone=NR.default_ozone_profile,intervalSeconds=10800,residenceSeconds=900,zeroCfc=false)
    names=zeroCfc ? (:composite,:h2o,:o3,:co2,:ch4,:n2o,:cfc11,:cfc12) : (:composite,:h2o,:o3,:co2,:ch4,:n2o)
    mole_fractions=zeroCfc ? (;co2,ch4,n2o,cfc11=0.,cfc12=0.) : (;co2,ch4,n2o)
    gas=NR.ClearSkyEcCKDRadiation(sg,"32x32";names,mole_fractions,ozone,surface_emissivity=1)
    liquid=NR.read_cloud_scattering_table(NR.ecrad_data_file("mie_droplet_scattering.nc"))
    ice=NR.read_cloud_scattering_table(NR.ecrad_data_file("baum-general-habit-mixture_ice_scattering.nc"))
    lw=NR.read_ecckd_spectral_mapping(NR.reference_ecckd_definition_path(:longwave_32))
    sw=NR.read_ecckd_spectral_mapping(NR.reference_ecckd_definition_path(:shortwave_32))
    ft=sg.NF
    optics=(ll=NR.SpectralCloudOptics(ft,liquid,lw;effective_radius=10e-6),
            ls=NR.SpectralCloudOptics(ft,liquid,sw;effective_radius=10e-6),
            il=NR.SpectralCloudOptics(ft,ice,lw;effective_radius=30e-6),
            is=NR.SpectralCloudOptics(ft,ice,sw;effective_radius=30e-6))
    AllSkyRadiation(gas,PhysicalDiagnosticClouds(sg),optics,intervalSeconds,residenceSeconds)
end
function SpeedyWeather.initialize!(r::AllSkyRadiation,model::SpeedyWeather.AbstractModel)
    SpeedyWeather.initialize!(r.gas,model);SpeedyWeather.initialize!(r.clouds,model)
end
SpeedyWeather.variables(r::AllSkyRadiation,model::SpeedyWeather.AbstractModel)=(
    SpeedyWeather.variables(r.gas,model)...,SpeedyWeather.variables(r.clouds)...)

# SpeedyWeather deliberately masks inactive surface states with NaN. Remove
# only zero-weight states before spectral emission (0*NaN is still NaN).
function active_surface(s)
    f=s.land_fraction
    ocean=f==1 ? s.land_surface_temperature : s.sea_surface_temperature
    land=f==0 ? s.sea_surface_temperature : s.land_surface_temperature
    ao=f==1 ? s.albedo_land : s.albedo_ocean
    al=f==0 ? s.albedo_ocean : s.albedo_land
    all(isfinite,(f,ocean,land,ao,al,s.cos_zenith))||error("Nonfinite active radiation boundary")
    merge(s,(sea_surface_temperature=ocean,land_surface_temperature=land,
             temperature=(1-f)*ocean+f*land,albedo_ocean=ao,albedo_land=al,albedo=(1-f)*ao+f*al))
end

function SpeedyWeather.parameterization!(ij,vars,r::AllSkyRadiation,model)
    E=RadiationCoupling;W=vars.parameterizations.ecckd;P=vars.parameterizations
    dTdt=SpeedyWeather.get_tendency_step(vars.tendencies.grid.temperature,model.time_stepping,r)
    ps=P.surface_pressure[ij]
    flux=NR.RadiativeFluxes(longwave_up=E.column(W.longwave_up,ij),longwave_down=E.column(W.longwave_down,ij),
        shortwave_up=E.column(W.shortwave_up,ij),shortwave_down=E.column(W.shortwave_down,ij))
    interval=max(1,round(Int,r.intervalSeconds/model.time_stepping.Δt))
    if vars.prognostic.clock.time_step_counter%interval==0
        T=SpeedyWeather.get_prognostic_step(vars.grid.temperature,model.time_stepping,r)
        q=SpeedyWeather.get_prognostic_step(vars.grid.humidity,model.time_stepping,r)
        surface=active_surface(E.ecckd_surface_state(ij,vars,r.gas,model))
        atm=E.ecckd_column_atmosphere!(ij,W,r.gas,view(T,ij,:),view(q,ij,:),ps,surface,vars,model)
        lw,sw=E.ecckd_column_optics(ij,W,r.gas)
        NR.optical_properties!(lw,sw,r.gas.gas_optics,atm)
        all(isfinite,lw.optical_depth)&&all(isfinite,lw.source)&&all(isfinite,sw.optical_depth)||error("Nonfinite gas optics: T=$(collect(view(T,ij,:))) q=$(collect(view(q,ij,:)))")
        # Sets ocean/land spectral emission, then replace clear flux by all-sky.
        E.ecckd_longwave!(ij,vars,flux,lw,atm,r.gas,surface)
        all(isfinite,flux.longwave_up)&&all(isfinite,flux.longwave_down)||error("Nonfinite clear longwave")
        cl=SpeedyWeather.clouds!(ij,vars,r.clouds,model)
        n=size(T,2);ft=eltype(T);fraction=zeros(ft,n);path=zeros(ft,n)
        ktop=clamp(cl.cloud_top,1,n)
        if cl.cloud_top<=n
            fraction[ktop]=cl.cloud_cover
            path[ktop]=ft(1000*max(0,P.rain_rate[ij]+P.snow_rate[ij])*r.residenceSeconds)
        end
        # Nonprecipitating boundary-layer cloud path from the cloud-area
        # diagnosis, with the same explicit in-cloud 0.01 kg/m² thin-cloud
        # floor. Record this closure; do not call it observed condensate.
        ksc=cl.stratocumulus_top
        # Random union if both components occupy the same resolved layer;
        # sum their grid-mean water paths, then pool within its cloudy area.
        fraction[ksc]=1-(1-fraction[ksc])*(1-ft(cl.stratocumulus_cover))
        path[ksc]+=ft(cl.stratocumulus_cover*.01)
        ltau=copy(lw.optical_depth);stau=copy(sw.optical_depth)
        scattering=copy(sw.rayleigh_optical_depth);asymmetry=copy(sw.scattering_asymmetry)
        for k in 1:n
            fraction[k]<=0&&continue
            inpath=path[k]/fraction[k];frozen=clamp(-T[ij,k]/40+273.15/40,0,1)
            for ig in axes(ltau,1)
                L=r.optics.ll;I=r.optics.il
                ltau[ig,k]+=inpath*((1-frozen)*L.mass_extinction_coefficient[ig,1]*(1-L.single_scattering_albedo[ig,1])+frozen*I.mass_extinction_coefficient[ig,1]*(1-I.single_scattering_albedo[ig,1]))
                L=r.optics.ls;I=r.optics.is
                sliq=inpath*(1-frozen)*L.mass_extinction_coefficient[ig,1]*L.single_scattering_albedo[ig,1]
                sice=inpath*frozen*I.mass_extinction_coefficient[ig,1]*I.single_scattering_albedo[ig,1]
                stau[ig,k]+=inpath*((1-frozen)*L.mass_extinction_coefficient[ig,1]*(1-L.single_scattering_albedo[ig,1])+frozen*I.mass_extinction_coefficient[ig,1]*(1-I.single_scattering_albedo[ig,1]))
                asymmetry[ig,k]=(scattering[ig,k]*asymmetry[ig,k]+sliq*L.asymmetry_factor[ig,1]+sice*I.asymmetry_factor[ig,1])/max(eps(ft),scattering[ig,k]+sliq+sice)
                scattering[ig,k]+=sliq+sice
            end
        end
        cloudy_lw=NR.LongwaveOptics(ltau,lw.source;source_top=lw.source_top,source_bottom=lw.source_bottom,weights=lw.weights)
        cloudy_sw=NR.ShortwaveOptics(stau;rayleigh_optical_depth=scattering,scattering_asymmetry=asymmetry,weights=sw.weights)
        clear_lw=NR.LongwaveOptics(copy(lw.optical_depth),lw.source;source_top=lw.source_top,source_bottom=lw.source_bottom,weights=lw.weights)
        lw_overlap=NR.LongwaveCloudOverlapOptics(clear_lw,cloudy_lw,fraction)
        NR.radiative_fluxes!(flux,NR.CloudOverlapLongwave(overlap=:adding),lw_overlap,atm,
            NR.LongwaveBoundaryConditions(surface_longwave_up=E.column(W.surface_emission,ij)))
        all(isfinite,flux.longwave_up)&&all(isfinite,flux.longwave_down)||error("Nonfinite cloudy longwave: fraction=$fraction path=$path tau=$(extrema(ltau))")
        # Solar geometry follows the radiation interval (3 h by default).
        E.ecckd_shortwave!(ij,vars,flux,sw,atm,r.gas,surface,model)
        if surface.cos_zenith>0
            clear_sw=NR.ShortwaveOptics(copy(sw.optical_depth);rayleigh_optical_depth=copy(sw.rayleigh_optical_depth),scattering_asymmetry=copy(sw.scattering_asymmetry),weights=sw.weights)
            sw_overlap=NR.ShortwaveCloudOverlapOptics(clear_sw,cloudy_sw,fraction)
            NR.radiative_fluxes!(flux,NR.CloudOverlapShortwave(overlap=:adding),sw_overlap,atm,
                NR.ShortwaveBoundaryConditions(toa_shortwave_down=ft(model.planet.solar_constant*surface.cos_zenith),surface_albedo=ft(surface.albedo)))
        end
        P.outgoing_longwave[ij]=flux.longwave_up[1];P.surface_longwave_down[ij]=flux.longwave_down[n+1]
        P.outgoing_shortwave[ij]=flux.shortwave_up[1];P.surface_shortwave_down[ij]=flux.shortwave_down[n+1];P.surface_shortwave_up[ij]=flux.shortwave_up[n+1]
        P.ocean.surface_shortwave_down[ij]=P.land.surface_shortwave_down[ij]=flux.shortwave_down[n+1]
        P.ocean.surface_shortwave_up[ij]=surface.albedo_ocean*flux.shortwave_down[n+1]
        P.land.surface_shortwave_up[ij]=surface.albedo_land*flux.shortwave_down[n+1]
        all(isfinite,flux.longwave_up)&&all(isfinite,flux.longwave_down)&&
            all(isfinite,flux.shortwave_up)&&all(isfinite,flux.shortwave_down)||error("Nonfinite all-sky flux in column $ij")
    end
    E.ecckd_heating!(ij,dTdt,flux,ps,model)
    nothing
end
