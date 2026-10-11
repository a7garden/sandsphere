using SpeedyWeather, Test
include("clouds.jl")
@testset "SPEEDY cloud dimensions and stability" begin
    large,strat,total=speedy_cloud_cover(.3,1/86400000,.2,.5,0)
    @test large≈.2 # exactly 1 mm/day; m/s -> mm/day is *86400000
    @test strat==0
    @test total≈.2
    stability=1-1004*6.5/9810 # 6.5 K/km, normalized by Δgeopotential
    large,strat,total=speedy_cloud_cover(.3,0.,stability,.8,0.)
    @test .25<stability<.4
    @test 0<strat<.6
    @test total≈strat
    _,land,_=speedy_cloud_cover(.3,0.,.2,.8,1.)
    @test land≈.15*.8
    @test PhysicalDiagnosticClouds(SpectralGrid(truncation=1,nlayers=8)) isa SpeedyWeather.AbstractShortwaveClouds
end

@testset "Cloud sampling pressure survives vertical refinement" begin
    for n in (8,20,32,64)
        levels=n==8 ? [.025,.095,.2,.34,.51,.685,.835,.95] : ((collect(0:n-1).^2+collect(1:n).^2)./(2n^2))
        # Analytic dry lapse profile linear in sigma: interpolation must
        # preserve the dimensionless static-energy gradient at all grids.
        phi=100000 .* (1 .- levels)
        temp=300 .- .0065/9.81 .* phi
        a,b=sigma_stencil(levels,.835),sigma_stencil(levels,.95)
        stability=1+1004*(sample_sigma(temp,a)-sample_sigma(temp,b))/(sample_sigma(phi,a)-sample_sigma(phi,b))
        @test stability≈1-1004*.0065/9.81 atol=1e-12
        @test sample_sigma(levels,a)≈.835 atol=1e-12
        @test sample_sigma(levels,b)≈.95 atol=1e-12
    end
end

@testset "Saturated cold layers remain eligible for cloud diagnosis" begin
    sg=SpectralGrid(NF=Float64,truncation=1,nlayers=8,Grid=FullGaussianGrid,dealiasing=1)
    c=PhysicalDiagnosticClouds(sg)
    model=PrimitiveWetModel(sg;radiation=Radiation(sg;shortwave=OneBandShortwave(sg;clouds=c)),feedback=Feedback(verbose=false))
    sim=initialize!(model)
    SpeedyWeather.initialize!(c,model)
    vars=sim.variables
    temp=SpeedyWeather.get_prognostic_step(vars.grid.temperature,model.time_stepping,c)
    humid=SpeedyWeather.get_prognostic_step(vars.grid.humidity,model.time_stepping,c)
    temp.=210
    vars.parameterizations.surface_pressure.=100000
    vars.parameterizations.rain_rate.=0;vars.parameterizations.snow_rate.=0
    vars.parameterizations.cloud_top.=9
    for k in 1:8
        humid[:,k].=.95*SpeedyWeather.saturation_humidity(210.,SpeedyWeather.pressure(k,100000.,model.geometry.vertical_coordinates),model.atmosphere)
        vars.dynamics.geopotential[:,k].=(1-model.geometry.σ_levels_full[k])*100000
    end
    @test maximum(humid)<.0002
    diagnostic=SpeedyWeather.clouds!(1,vars,c,model)
    @test diagnostic.cloud_cover≈((.95-.3)/.7)^2 atol=1e-10
    @test vars.parameterizations.total_cloud_cover[1]>.8
end
