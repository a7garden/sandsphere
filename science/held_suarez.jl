using SpeedyWeather, JSON3, Dates, Statistics, Random

# A separate, pinned primitive-equation reference solver. This experiment
# does not certify Sandsphere's finite-volume graph dynamics.
mutable struct HeldSuarezAudit <: SpeedyWeather.AbstractCallback
    start::DateTime
    next::DateTime
    samples::Int
    sums::Dict{Symbol,Matrix{Float64}}
    blocks::Vector{Dict{Symbol,Matrix{Float64}}}
    block_counts::Vector{Int}
    mass0::Float64
    max_mass_drift::Float64
end
function HeldSuarezAudit(sg)
    fields=(:temperature,:u,:v,:uv,:vT,:u2,:v2,:T2)
    sums=Dict(k=>zeros(sg.nlat,sg.nlayers) for k in fields)
    blocks=[deepcopy(sums) for _ in 1:10]
    HeldSuarezAudit(DateTime(2000),DateTime(2000),0,sums,blocks,zeros(Int,10),0.,0.)
end
SpeedyWeather.initialize!(a::HeldSuarezAudit,vars,model)=begin
    a.start=vars.prognostic.clock.time; a.next=a.start+Hour(6)
    nothing
end
SpeedyWeather.finalize!(::HeldSuarezAudit,args...)=nothing
function SpeedyWeather.callback!(a::HeldSuarezAudit,vars,model)
    now=vars.prognostic.clock.time
    now<a.next && return
    a.next+=Hour(6)
    day=Dates.value(now-a.start)/86400000
    rings=SpeedyWeather.RingGrids.eachring(model.spectral_grid.grid)
    weights=SpeedyWeather.RingGrids.get_quadrature_weights(model.spectral_grid.grid)
    # Prognostic grid pressure is ln(Pa). Gaussian quadrature, not equal-point weights.
    mass=sum(weights[j]*mean(exp.(vars.grid.pressure[r,2])) for (j,r) in enumerate(rings))/2
    a.mass0==0 && (a.mass0=mass)
    a.max_mass_drift=max(a.max_mass_drift,abs(mass/a.mass0-1))
    if day>200
        a.samples+=1
        block=clamp(ceil(Int,(day-200)/100),1,10);a.block_counts[block]+=1
        for (j,r) in enumerate(rings), k in 1:model.spectral_grid.nlayers
            T=Float64.(vars.grid.temperature[r,k,2]);u=Float64.(vars.grid.u[r,k,2]);v=Float64.(vars.grid.v[r,k,2])
            values=(temperature=mean(T),u=mean(u),v=mean(v),uv=mean(u.*v),vT=mean(v.*T),u2=mean(u.^2),v2=mean(v.^2),T2=mean(T.^2))
            for name in keys(a.sums)
                a.sums[name][j,k]+=values[name];a.blocks[block][name][j,k]+=values[name]
            end
        end
    end
    if abs(day/100-round(day/100))<1e-6
        println("Held–Suarez day ",round(Int,day)," mass drift ",a.max_mass_drift);flush(stdout)
    end
end

function run_benchmark(truncation=42)
    Random.seed!(42)
    sg=SpectralGrid(truncation=truncation,nlayers=20)
    audit=HeldSuarezAudit(sg)
    model=PrimitiveDryModel(sg;
        forcing=HeldSuarez(sg),drag=LinearDrag(sg),dynamics_only=true,
        orography=NoOrography(sg),land_sea_mask=AquaPlanetMask(sg),
        ocean=AquaPlanet(sg),sea_ice=nothing,
        time_stepping=Leapfrog(sg;Δt_at_T32=Minute(20)),
        feedback=Feedback(verbose=false,debug=true))
    add!(model,:audit=>audit)
    sim=initialize!(model);started=time()
    run!(sim,period=Day(1200),output=false)
    model.feedback.nans_detected && error("Held–Suarez encountered NaNs")
    audit.samples==4000 || error("Incomplete averaging window: $(audit.samples)")
    means=Dict(k=>v/audit.samples for (k,v) in audit.sums)
    eddy_momentum=means[:uv]-means[:u].*means[:v]
    eddy_heat=means[:vT]-means[:v].*means[:temperature]
    eddy_kinetic=.5*(means[:u2]-means[:u].^2+means[:v2]-means[:v].^2)
    lat=Float64.(model.geometry.latd);sigma=Float64.(model.geometry.σ_levels_full)
    jets=[begin
        js=findall(x->side*x>0&&abs(x)<75,lat)
        val,idx=findmax(means[:u][js,:]);j,k=Tuple(idx)
        (hemisphere=side==1 ? "north" : "south",speedMS=val,latitude=lat[js[j]],sigma=sigma[k])
    end for side in (1,-1)]
    symmetry=sqrt(mean((means[:u]-reverse(means[:u],dims=1)).^2))
    # Project sanity checks only; the original paper provides plots, not a
    # machine-readable pointwise tolerance or a universal pass/fail threshold.
    checks=(massConservation=audit.max_mass_drift<.01,
            subtropicalWesterlyJets=all(j->15<abs(j.latitude)<60&&15<j.speedMS<70,jets),
            activeEddies=maximum(eddy_kinetic)>20,
            approximateHemisphericSymmetry=symmetry<5)
    result=(schema=1,solver="SpeedyWeather.jl $(pkgversion(SpeedyWeather))",
        benchmark="Held–Suarez 1994",configuration=(truncation=truncation,nlayers=20,days=1200,spinupDays=200,averageDays=1000,sampleHours=6,timestepSeconds=model.time_stepping.Δt,seed=42,flatSurface=true),
        elapsedSeconds=time()-started,samples=audit.samples,latitude=lat,sigma=sigma,
        maximumRelativePressureMassDrift=audit.max_mass_drift,jets=jets,
        symmetryRmseMS=symmetry,projectSanityChecks=checks,
        status=all(values(checks)) ? "completed-project-sanity-checks-pass" : "completed-project-sanity-checks-fail",
        paperQuantitativeValidation="not-certified; compare zonal/eddy plots with Held & Suarez Fig. 1–3",
        zonalMeans=means,eddyMomentumFlux=eddy_momentum,eddyHeatFlux=eddy_heat,eddyKineticEnergy=eddy_kinetic,
        blocks=[Dict(k=>v/max(1,audit.block_counts[b]) for (k,v) in audit.blocks[b]) for b in 1:10],blockSamples=audit.block_counts)
    mkpath("artifacts/science")
    open("artifacts/science/held-suarez-T$truncation.json","w") do io;JSON3.write(io,result);end
    println(JSON3.write((status=result.status,jets=jets,checks=checks,symmetry=symmetry,elapsedSeconds=result.elapsedSeconds)));flush(stdout)
end
run_benchmark(isempty(ARGS) ? 42 : parse(Int,ARGS[1]))
