#!/bin/sh
# Runs inside zpdev: refresh stubs from the repo and resume the WASI perl make.
set -e
cp -R /src/stubs/. /build/repo/stubs/
export PATH="/build/repo/wasi-bin:$PATH"
cd /build/wasm
wasimake make -j"$(nproc)" utilities PERL="/build/native/miniperl"
wasimake make -j"$(nproc)" RUN_PERL="/build/native/miniperl -Ilib -I."
wasimake make install
echo WASI_PERL_DONE
