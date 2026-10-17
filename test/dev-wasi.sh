#!/bin/sh
# Runs inside the zpdev container: mirrors the Dockerfile's wasi-perl stage.
set -e
export WASM_DIR=/build/wasm TRIM=true BUILD_EXIFTOOL=false
mkdir -p /build/repo
cp -R /src/wasi-bin /src/pipeline /src/patches /src/stubs /src/tools /build/repo/
chmod +x /build/repo/wasi-bin/* /build/repo/pipeline/*.sh
mkdir -p /build/repo/gen
mv /opt/binaryen/bin/wasm-opt /opt/binaryen/bin/wasm-opt-real
cp /build/repo/tools/wasm-opt /opt/binaryen/bin/wasm-opt
chmod +x /opt/binaryen/bin/wasm-opt
/build/repo/pipeline/build-wasi-perl.sh
mv /opt/binaryen/bin/wasm-opt-real /opt/binaryen/bin/wasm-opt
echo WASI_PERL_DONE
