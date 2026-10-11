using SpeedyWeather, Dates, Test
isdefined(Main,:MaskedSeasonalOcean)||include("surface.jl")
@testset "Prescribed monthly ice reaches surface state" begin
    sg=SpectralGrid(truncation=3,nlayers=8)
    ice=MonthlySeaIce(sg)
    model=PrimitiveWetModel(sg;sea_ice=ice,ocean=MaskedSeasonalOcean(sg))
    sim=initialize!(model;time=DateTime(2001,1,16,12))
    actual=sim.variables.prognostic.ocean.sea_ice_concentration.data
    @test all(x->0<=x<=1,actual)
    @test maximum(actual)>.5
    @test actual≈ice.climatology.monthly_temperature.data[:,1]
    january=copy(actual)
    SpeedyWeather.set!(sim.variables.prognostic.clock;time=DateTime(2001,7,16,12),start=DateTime(2001))
    SpeedyWeather.timestep!(sim.variables,ice,model)
    @test actual≈ice.climatology.monthly_temperature.data[:,7]
    @test maximum(abs.(actual-january))>.01
end
