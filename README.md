zeroperl is an experimental build of Perl5 in a sandboxed, self-contained WebAssembly module.

Read the full blog [here](https://andrews.substack.com/p/zeroperl-sandboxed-perl-with-webassembly)

This fork builds the `perl` command for [Piped](https://legendum.dojos.name/piped2). See [PIPED.md](PIPED.md) for how it is used and how it differs from upstream.

## Build

Requires Docker or Apple Container (macOS).

**Docker:**
```bash
docker build -t zeroperl .
mkdir -p output
docker run --rm -v $(pwd)/output:/output zeroperl cp -r /artifacts/. /output/
```

**Apple Container (macOS):**
```bash
container build -t zeroperl .
mkdir -p output
container run --rm -v $(pwd)/output:/output zeroperl cp -r /artifacts/. /output/
```

Output in `./output/`:
- `zeroperl.wasm` — the reactor, after wasm-opt's Asyncify pass (which setjmp needs)
- `zeroperl_reactor.wasm` — the linker's output before that pass; it cannot run as is
- `perl-wasi-prefix/` — Perl library prefix
- `exiftool.min.pl` — minified ExifTool (if enabled)

### Build args

**Docker:**
```bash
docker build --build-arg PERL_VERSION=5.42.0 --build-arg BUILD_EXIFTOOL=true -t zeroperl .
```

**Apple Container:**
```bash
container build --build-arg PERL_VERSION=5.42.0 --build-arg BUILD_EXIFTOOL=true -t zeroperl .
```

<details>
<summary>Available build arguments</summary>

| Arg | Default | |
|-----|---------|--|
| `PERL_VERSION` | `5.42.0` | Perl source version |
| `EXIFTOOL_VERSION` | `13.55` | ExifTool version |
| `BUILD_EXIFTOOL` | `false` | Include ExifTool (roughly doubles the wasm size) |
| `STACK_SIZE` | `8388608` | WASM stack (bytes) |
| `INITIAL_MEMORY` | `16777216` | WASM initial memory (bytes) |
| `ASYNCIFY` | `false` | Also let `fd_read` and host calls pause (Asyncify runs either way, for setjmp) |
| `TRIM` | `true` | Strip unused modules |

</details>

### Iterating on stubs/zeroperl.c

Build from `final` stage to reuse cached wasi-perl:

**Docker:**
```bash
docker build --target final -t zeroperl .
```

**Apple Container:**
```bash
container build --target final -t zeroperl .
```

## Testing

The easiest way to test a new build of `zeroperl.wasm` is to clone the TypeScript wrapper and run its test suite:

```bash
git clone https://github.com/6over3/zeroperl-ts
```

See the [zeroperl-ts README](https://github.com/6over3/zeroperl-ts) for details.
