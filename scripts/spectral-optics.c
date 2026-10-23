/* Experimental ecCKD interpolation kernel. Production JS stays authoritative.
 * f64 only; strict FP; no contraction, reassociation, reduction, or fast math.
 * SIMD lanes are independent adjacent spectral bands. Gas j=0..7 accumulation
 * has the same order in each lane as src/sim/spectralRadiation.ts.
 */
#ifdef USE_SIMD
#include <wasm_simd128.h>
typedef v128_t Value;
#define LANES 2
#define LOAD(p) wasm_v128_load(p)
#define STORE(p, x) wasm_v128_store(p, x)
#define SPLAT(x) wasm_f64x2_splat(x)
#define ADD(x, y) wasm_f64x2_add(x, y)
#define SUB(x, y) wasm_f64x2_sub(x, y)
#define MUL(x, y) wasm_f64x2_mul(x, y)
#define NONNEGATIVE(x) wasm_f64x2_max(wasm_f64x2_splat(0), x)
#else
typedef double Value;
#define LANES 1
#define LOAD(p) (*(p))
#define STORE(p, x) (*(p) = (x))
#define SPLAT(x) (x)
#define ADD(x, y) ((x) + (y))
#define SUB(x, y) ((x) - (y))
#define MUL(x, y) ((x) * (y))
/* Valid physical inputs produce finite results. Preserve NaN for diagnostics
 * and return positive zero for either zero, matching JS Math.max(0, value). */
#define NONNEGATIVE(x) ((x) != (x) ? (x) : ((x) > 0 ? (x) : 0.0))
#endif

static inline Value interpolate(const double *a, int i, int dp, int dt,
                                Value wp, Value wt) {
  Value x = ADD(LOAD(a+i), MUL(wp, SUB(LOAD(a+i+dp), LOAD(a+i))));
  Value y = ADD(LOAD(a+i+dt), MUL(wp, SUB(LOAD(a+i+dp+dt), LOAD(a+i+dt))));
  return ADD(x, MUL(wt, SUB(y, x)));
}

static inline Value water(const double *a, int g, int p, int t, int h,
                          Value wp, Value wt, Value wh, int np, int nt) {
  int i = g + 32 * (p + np * (t + nt * h));
  Value x = interpolate(a, i, 32, 32*np, wp, wt);
  Value y = interpolate(a, i + 32*np*nt, 32, 32*np, wp, wt);
  return ADD(x, MUL(wh, SUB(y, x)));
}

/* input stride: p,wp,t,wt,h,wh,waterMoles,totalMoles,amounts[8].
 * output stride: longwave[32],shortwave[32],rayleigh[32].
 * All tables and buffers are caller-owned linear-memory Float64 views. */
__attribute__((visibility("default")))
void optics(const double *lw, const double *sw, const double *water_lw,
            const double *water_sw, const double *rayleigh,
            const double *input, double *output, int count, int np, int nt) {
  for (int row=0; row<count; row++) {
    const double *c=input+row*16;
    double *out=output+row*96;
    int p=(int)c[0], t=(int)c[2], h=(int)c[4];
    Value wp=SPLAT(c[1]), wt=SPLAT(c[3]), wh=SPLAT(c[5]);
    for (int g=0; g<32; g+=LANES) {
      Value l=MUL(water(water_lw,g,p,t,h,wp,wt,wh,np,nt),SPLAT(c[6]));
      Value s=MUL(water(water_sw,g,p,t,h,wp,wt,wh,np,nt),SPLAT(c[6]));
      for (int j=0; j<8; j++) {
        int i=g+32*(j+8*(p+np*t));
        l=ADD(l,MUL(interpolate(lw,i,32*8,32*8*np,wp,wt),SPLAT(c[8+j])));
        s=ADD(s,MUL(interpolate(sw,i,32*8,32*8*np,wp,wt),SPLAT(c[8+j])));
      }
      STORE(out+g,NONNEGATIVE(l));
      STORE(out+32+g,NONNEGATIVE(s));
      STORE(out+64+g,MUL(LOAD(rayleigh+g),SPLAT(c[7])));
    }
  }
}
