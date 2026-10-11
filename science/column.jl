# A single-column experiment has no horizontal dynamical mixing. In addition,
# the reference hyperdiffusion normalization divides by T(T-1), singular at
# T1. Disable it explicitly rather than allowing 0*Inf to poison all fields.
struct ColumnNoHorizontalDiffusion <: SpeedyWeather.AbstractHorizontalDiffusion end
SpeedyWeather.initialize!(::ColumnNoHorizontalDiffusion,::SpeedyWeather.AbstractModel)=nothing
function SpeedyWeather.horizontal_diffusion!(vars::SpeedyWeather.Variables,::ColumnNoHorizontalDiffusion,model::SpeedyWeather.PrimitiveEquation)
    model.dynamics&&error("ColumnNoHorizontalDiffusion is restricted to physics-only columns")
    # SpeedyWeather 0.23 physics-only path omits the radius scaling normally
    # applied by dynamics_tendencies!. update_prognostic! divides by radius;
    # undo that numerical normalization so physical K/s advances real seconds.
    SpeedyWeather.scale_tendencies!(vars,model)
    nothing
end
