#!/bin/sh
# Runs inside the zpdev container: mirrors prepare-prefix + the Dockerfile's final stage.
# SKIP_PREFIX=true skips the prefix step when only C or link flags changed.
set -e
export WASM_DIR=/build/wasm TRIM=true BUILD_EXIFTOOL=false
export STACK_SIZE="${STACK_SIZE:-8388608}" INITIAL_MEMORY="${INITIAL_MEMORY:-16777216}"
export ASYNCIFY="${ASYNCIFY:-false}" WASM_OPT_FLAGS="${WASM_OPT_FLAGS:-}"
OUT="${OUT:-/work/out}"
if [ -f /opt/binaryen/bin/wasm-opt-real ]; then
  mv /opt/binaryen/bin/wasm-opt-real /opt/binaryen/bin/wasm-opt
fi
cp -R /src/stubs/. /build/repo/stubs/
cp -R /src/pipeline/. /build/repo/pipeline/
cp -R /src/tools/. /build/repo/tools/
chmod +x /build/repo/pipeline/*.sh
if [ "${SKIP_PREFIX:-}" != "true" ]; then
  /build/repo/pipeline/prepare-prefix.sh
fi
/build/repo/pipeline/build-wasm.sh
mkdir -p "$OUT"
cp /build/wasm/zeroperl.wasm /build/wasm/zeroperl_reactor.wasm "$OUT"/
ls -l "$OUT"
echo WASM_DONE
