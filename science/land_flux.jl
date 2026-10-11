# SPEEDY's evaporation is positive-only max(alpha*qs-q,0). Allowing
# negative values of that expression manufactured dew on unsaturated dry
# land. Dew requires q>qs at the actual surface temperature instead.
struct PhysicalLandHumidityFlux{P} <: SpeedyWeather.AbstractSurfaceHumidityFlux
    parameters::P
end
PhysicalLandHumidityFlux(sg::SpeedyWeather.SpectralGrid)=PhysicalLandHumidityFlux(SpeedyWeather.SurfaceLandHumidityFlux(sg))
SpeedyWeather.variables(c::PhysicalLandHumidityFlux)=SpeedyWeather.variables(c.parameters)
SpeedyWeather.initialize!(::PhysicalLandHumidityFlux,::SpeedyWeather.PrimitiveWet)=nothing
land_humidity_gradient(qs,q,availability)=max(0,clamp(availability,0,1)*qs-q)+min(0,qs-q)
function SpeedyWeather.surface_humidity_flux!(ij,vars,c::PhysicalLandHumidityFlux,model)
    h=c.parameters
    soil=SpeedyWeather.get_prognostic_step(vars.prognostic.land.soil_temperature,SpeedyWeather.time_stepper(model.time_stepping,:land),h)
    snow=SpeedyWeather.get_prognostic_step(vars.prognostic.land.snow_depth,SpeedyWeather.time_stepper(model.time_stepping,:land),h)[ij]
    T=soil[ij,1];α=vars.parameterizations.land.soil_moisture_availability[ij]
    ps=vars.parameterizations.surface_pressure[ij]
    q=SpeedyWeather.get_prognostic_step(vars.grid.humidity,model.time_stepping,h)[ij,model.geometry.nlayers]
    qs=SpeedyWeather.saturation_humidity(T,ps,model.atmosphere)
    ρ=vars.parameterizations.surface_air_density[ij];V=vars.parameterizations.surface_wind_speed[ij]
    drag=h.use_boundary_layer_drag ? vars.parameterizations.boundary_layer_drag[ij] : h.drag
    flux=isfinite(T)&&isfinite(α) ? ρ*drag*V*land_humidity_gradient(qs,q,α)/(1+snow/h.snow_insulation_depth) : zero(T)
    vars.parameterizations.land.surface_humidity_flux[ij]=flux
    vars.parameterizations.surface_humidity_flux[ij]+=model.land_sea_mask.land_fraction[ij]*flux
    dq=SpeedyWeather.get_tendency_step(vars.tendencies.grid.humidity,model.time_stepping,h)
    dq[ij,model.geometry.nlayers]+=SpeedyWeather.surface_flux_to_tendency(model.land_sea_mask.land_fraction[ij]*flux,ps,model)
    nothing
end
