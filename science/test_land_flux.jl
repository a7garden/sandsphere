using SpeedyWeather, Test
include("land_flux.jl")
@testset "Dry land cannot condense undersaturated air" begin
    @test land_humidity_gradient(.03,.003,0.)==0
    @test land_humidity_gradient(.03,.003,.05)==0
    @test land_humidity_gradient(.03,.003,1.)≈.027
    @test land_humidity_gradient(.03,.04,0.)≈-.01
    @test land_humidity_gradient(.03,.04,1.)≈-.01
    for α in (0.,.05,.5,1.)
        @test land_humidity_gradient(.03,.03,α)==0
    end
end
