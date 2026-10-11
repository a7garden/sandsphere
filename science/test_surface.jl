using SpeedyWeather, Dates, Test
include("surface.jl")
@testset "Masked coastal SST and calendar phase" begin
    input=SpectralGrid(truncation=7,Grid=FullGaussianGrid).GridVariable3D
    source=zeros(input,SpectralGrid(truncation=7,Grid=FullGaussianGrid).grid,12)
    target_grid=SpectralGrid(truncation=3,Grid=FullGaussianGrid)
    target=zeros(target_grid.GridVariable3D,target_grid.grid,12)
    source.data.=280;source.data[1:5:end,:].=NaN
    audit=masked_sst!(target,source,zeros(target_grid.npoints))
    @test all(x->isapprox(x,280;atol=.0001),target.data)
    @test audit["partialCoastalInterpolations"]>0
    source.data.=NaN;source.data[1,:].=271.35
    audit=masked_sst!(target,source,zeros(target_grid.npoints))
    @test audit["nearestSeaFallbacks"]>0
    @test all(x->isapprox(x,271.35;atol=.0001),target.data)
    @test monthly_bracket(DateTime(2001,1,16,12))==(1,2,0.)
    a,b,w=monthly_bracket(DateTime(2001,1,1))
    @test (a,b)==(12,1)
    @test 0<w<1
end
