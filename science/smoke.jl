using SpeedyWeather, Dates, Test
include("allsky_radiation.jl")
include("column.jl")

function smoke_sim()
    sg=SpectralGrid(truncation=1,nlayers=20,Grid=FullGaussianGrid)
    m=PrimitiveWetModel(sg;radiation=AllSkyRadiation(sg),dynamics=false,horizontal_diffusion=ColumnNoHorizontalDiffusion(),
        orography=NoOrography(sg),land_sea_mask=AquaPlanetMask(sg),ocean=AquaPlanet(sg),
        sea_ice=nothing,time_stepping=Leapfrog(sg;Δt_at_T32=Second(10)),feedback=Feedback(verbose=false))
    s=initialize!(m);initialize!(s;period=Day(1),output=false)
    @test all(isfinite,s.variables.grid.temperature)
    return s
end

s=smoke_sim()
initial=copy(s.variables.grid.temperature)
initial_time=s.variables.prognostic.clock.time
for step in 1:s.variables.prognostic.clock.n_steps
    SpeedyWeather.time_step!(s)
    if !all(isfinite,s.variables.grid.temperature)
        p=s.variables.parameterizations
        error("Nonfinite temperature at step $step; fluxes $(extrema(p.sensible_heat_flux)) $(extrema(p.surface_humidity_flux)); tendency $(extrema(s.variables.tendencies.grid.temperature))")
    end
end
@test all(isfinite,s.variables.parameterizations.outgoing_longwave)
@test maximum(abs.(s.variables.grid.temperature-initial))>.01
@test s.variables.prognostic.clock.time-initial_time==Day(1)
@testset "Radiative column energy budget in SI" begin
    v=s.variables;E=RadiationCoupling;W=v.parameterizations.ecckd
    flux=NR.RadiativeFluxes(longwave_up=E.column(W.longwave_up,1),longwave_down=E.column(W.longwave_down,1),
        shortwave_up=E.column(W.shortwave_up,1),shortwave_down=E.column(W.shortwave_down,1))
    n=s.model.spectral_grid.nlayers;ps=v.parameterizations.surface_pressure[1]
    heating=zeros(eltype(v.grid.temperature),s.model.spectral_grid.npoints,n)
    E.ecckd_heating!(1,heating,flux,ps,s.model)
    absorbed=sum(heating[1,k]*s.model.atmosphere.heat_capacity*
        SpeedyWeather.pressure_thickness(k,ps,s.model.geometry.vertical_coordinates)/s.model.planet.gravity for k in 1:n)
    net(k)=flux.longwave_down[k]-flux.longwave_up[k]+flux.shortwave_down[k]-flux.shortwave_up[k]
    @test absorbed≈net(1)-net(n+1) atol=.0002 rtol=1e-6
end
println("Finite all-sky smoke OLR: ",extrema(s.variables.parameterizations.outgoing_longwave))
