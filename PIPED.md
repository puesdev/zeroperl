# zeroperl in Piped

This fork of [6over3/zeroperl](https://github.com/6over3/zeroperl) builds the
`perl` command for [Piped](https://legendum.dojos.name/piped2) (piped2,
MIT-licensed). Piped already runs Python 3 and JavaScript as WebAssembly; this
adds Perl, aimed at what Perl does best: text processing.

## How Piped uses it

- Each `perl` run instantiates the wasm in a Worker behind Piped's own
  synchronous WASI shim (`src/wasm/wasi.ts` in piped2). User files come from
  Piped's file system through WASI.
- The worker calls `_initialize`, passes argv (allocated with `malloc`) to
  `zeroperl_init_with_args`, and takes the exit status as its return value
  `& 255` (a compile-phase `exit 0`, as from `-v`, returns 256). It always
  calls `zeroperl_free_interpreter()` at the end, which flushes STDOUT and
  STDERR even after `exit` or `die`.
- Piped's shim must serve `/dev/null` (every `perl -e` opens it at start) and
  should answer `fd_tell` on fds 0 to 2 with `ESPIPE` rather than `EBADF`.
- Errno values are WASI's, so `$!` and `die`'s exit status differ from Linux:
  a missing file is 44, not 2.
- Perl's own library is embedded in the wasm, so nothing else ships with it.
  Pure-Perl modules a script needs can be loaded from the user's files at
  runtime.
- Network access goes through Piped's `/dev/fetch` device (JSON request in,
  JSON response out, text bodies). The plan is an `HTTP::Tiny` in Piped's perl
  worker library that speaks this protocol, so it costs nothing in the wasm.

### Size matters

The wasm's data is copied into linear memory when it starts, so every
megabyte of wasm is a megabyte of memory for every run. Anything that bloats
the build stays out; that is why ExifTool is off and why large data files such
as `unicore/Name.pl` (for `\N{NAME}` and `charnames`) are not added back.

## Changes from upstream

- **Storable** is built in as a static XS extension. Upstream excluded it, and
  `Encode.pm` needs it, so `use Encode` failed with `Can't locate Storable.pm`.
- **B** and **POSIX** are built in as static XS extensions.
- **WASI shims for POSIX** in `stubs/`, which wasi-libc lacks:
  - `fenv.h`: the rounding-mode constants. WebAssembly only rounds to nearest,
    so `fesetround` rejects the others.
  - `signal.h`: signal sets, `sigprocmask` and `sigaction` emulated over
    `signal()`. WASI never delivers signals asynchronously, so masks have no
    effect.
  - `sys/wait.h`: the `W*` macros, so `$?` can be decoded. There are no child
    processes.
  - `pipeline/hints-wasi.sh` marks `sigaction` and `sigprocmask` as missing.
  - `stubs.c`: `pipe`, `mknod`, `pause` and `ttyname`, which fail.
- **`stubs/pwd.h` and `stubs/grp.h`** define their functions `static inline`,
  so more than one source file (now `POSIX.xs` too) can include them.
- **`stubs/zeroperl.c` fixes**:
  - `zeroperl_init_with_args` and `zeroperl_reset` return Perl's exit status
    when the compile phase ends the program (syntax error 255,
    `BEGIN { exit 3 }` 3, `-v` 256). Upstream always returned 1.
  - `zeroperl_flush` works after `exit` or `die`. Upstream refused, so
    unflushed output was lost.
  - The embedded library's file descriptors start at 4096, clear of the
    host's. Upstream used 3 to 31, where hosts put their own, so a user's
    `open` could read a library file, and 28 open files plus a `require`
    killed the run.
  - `isatty` and wasi-libc's `__wasilibc_tell` (what `lseek(fd, 0, SEEK_CUR)`
    becomes) are wrapped too. Unwrapped, they reached the host with library
    descriptors and left `EBADF` in `$!`, so `use strict; die` exited 8, not
    255.
- **ExifTool is off by default** (`BUILD_EXIFTOOL=false`), since it roughly
  doubles the wasm. When enabled it uses version 13.55, downloads from CPAN
  with BackPAN and exiftool.org as fallbacks, and fails the build if the
  download fails. Upstream's 13.42 download had started returning 404, and a
  `|| true` hid the failure. The CI workflow defaults match.

### In progress

- Lower `INITIAL_MEMORY` (32 MiB upstream) now that ExifTool is gone.
- Measure `zeroperl.wasm` (asyncify) against `zeroperl_reactor.wasm`
  (without). B, POSIX and these fixes add about 0.3 MB to `zeroperl.wasm`
  (13.2 MB with Storable, B and POSIX).

## Not available

WASI has no sockets, processes (`fork`, `system`, backticks, pipes to
commands), threads or asynchronous signals. Upstream also trims modules such
as `Test::*`, `Pod::*` and `HTTP::Tiny` from the embedded library (see
`tools/delete.txt`).
