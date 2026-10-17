#ifndef ZEROPERL_FENV_H
#define ZEROPERL_FENV_H

#include_next <fenv.h>

// WebAssembly only rounds to nearest; wasi-libc defines FE_TONEAREST alone.
// POSIX.xs needs the other modes to exist, and fesetround rejects them.
#ifndef FE_DOWNWARD
#define FE_DOWNWARD 0x400
#endif
#ifndef FE_UPWARD
#define FE_UPWARD 0x800
#endif
#ifndef FE_TOWARDZERO
#define FE_TOWARDZERO 0xc00
#endif

#endif // ZEROPERL_FENV_H
