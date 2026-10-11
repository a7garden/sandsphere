using SpeedyWeather, Test, Dates
include("column.jl")

@testset "Physical seconds in a single column" begin
    sg=SpectralGrid(NF=Float64,truncation=1,nlayers=8,Grid=FullGaussianGrid,dealiasing=1)
    model=PrimitiveWetModel(sg;dynamics=false,horizontal_diffusion=ColumnNoHorizontalDiffusion(),
        ocean=AquaPlanet(sg),sea_ice=nothing,land_sea_mask=AquaPlanetMask(sg),orography=NoOrography(sg),
        time_stepping=Leapfrog(sg;Δt_at_T32=Second(10)),feedback=Feedback(verbose=false))
    sim=initialize!(model);initialize!(sim;steps=1,output=false)
    v=sim.variables;old=copy(SpeedyWeather.get_step(v.grid.temperature,1))
    SpeedyWeather.reset_tendencies!(v,model.time_stepping)
    tendency=SpeedyWeather.get_tendency_step(v.tendencies.grid.temperature,model.time_stepping,SpeedyWeather.DummyParameterization())
    tendency.=.001 # independent exact solution: dT/dt = 0.001 K/s
    SpeedyWeather.parameterization_tendencies_only!(v,model)
    SpeedyWeather.horizontal_diffusion!(v,model)
    SpeedyWeather.update_prognostic!(v,model)
    SpeedyWeather.transform!(v,model)
    change=SpeedyWeather.get_step(v.grid.temperature,2).-old
    @test maximum(abs.(change.-(.001*model.time_stepping.Δt/2)))<1e-8
    @test all(isfinite,v.grid.humidity)
end
