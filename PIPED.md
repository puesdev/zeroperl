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
  calls `zeroperl_free_interpreter()` at the end, which runs global
  destruction (`DESTROY` methods) and flushes STDOUT and STDERR, even after
  `exit` or `die`.
- argv[0] can be anything. Piped passes `perl`, so `$^X` and `perl -h` say
  `perl`.
- zeroperl answers `/dev/null` itself (every `perl -e` opens it at start).
  Piped's shim should answer `fd_tell` on fds 0 to 2 with `ESPIPE` rather
  than `EBADF`.
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
- **mro** is linked into the wasm. Upstream compiled it but never linked it,
  so `use mro 'c3'` failed.
- **`B/Op_private.pm`** is kept (upstream deleted it), so B::Concise,
  B::Showlex and B::Terse load.
- **Pure-Perl CPAN modules** are added by `pipeline/add-cpan-modules.sh` at
  pinned releases: Text::CSV 2.06 (with Text::CSV_PP), YAML::Tiny 1.76,
  XML::Tiny 2.07, URI::Escape (from URI 5.37), Algorithm::Diff 1.201,
  Text::Diff 1.46 and CGI::Tiny 1.003.
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
  - `/dev/null` is answered from memory by `open` and `fopen`, in any mode:
    reads give end of file, writes are discarded, and `stat`, `fstat` and
    `close` work. `write` and `dup2` are wrapped too, so
    `open STDERR, '>', '/dev/null'` (or STDOUT, or STDIN) discards output,
    `warn` and `die` messages included. Upstream left `/dev/null` to the host.
  - `zeroperl_free_interpreter` runs global destruction under
    `asyncjmp_rt_start`, like every other entry point, so `DESTROY` methods
    run. Upstream called `perl_destruct` outside it, and they did not.
- **ExifTool is off by default** (`BUILD_EXIFTOOL=false`), since it roughly
  doubles the wasm. When enabled it uses version 13.55, downloads from CPAN
  with BackPAN and exiftool.org as fallbacks, and fails the build if the
  download fails. Upstream's 13.42 download had started returning 404, and a
  `|| true` hid the failure. The CI workflow defaults match.
- **Encode's CJK encodings are dropped**: Encode::JP, KR, CN and TW, with
  Encode::CJKConstants and Encode::MIME::Header::ISO_2022_JP, which only
  serve them (see "Not available").
- **`INITIAL_MEMORY` is 16 MiB** (upstream 32 MiB): the 8 MiB stack plus the
  data, with the heap growing from there.
- **`ASYNCIFY=false` is the default**, and its `wasm-opt` pass now has `-O3`
  like the other branch. This is the shipped build: Asyncify still runs,
  since setjmp and longjmp (every `die`) need it, but `fd_read` and host
  calls are not instrumented to pause, which piped's synchronous shim never
  does. It is as small and as fast as `ASYNCIFY=true` (139 bytes smaller; a
  300k-iteration regex loop took 81 ms against 82, median of 10), because
  Perl's indirect op calls get instrumented either way.
  `zeroperl_reactor.wasm` is the linker's output before that pass, so it
  cannot run. `zeroperl.wasm` is 10.9 MB with everything above.

## Testing a build

`test/` holds the checks each build passes. They run with Bun behind
piped2's own WASI shim, so they need a piped2 checkout beside this repo (or
`PIPED2=/path/to/piped2`):

- `bun test/piped-check.ts [wasm]` runs exit statuses, `die`, `eval`,
  `DESTROY`, `/dev/null`, file reads and more (default: `output/zeroperl.wasm`).
- `bun test/module-check.ts <wasm> <list>` requires every embedded module in
  a fresh instance; the list comes from the prefix the wasm was built from
  (`docker exec zpdev find /zeroperl/lib -name '*.pm' | sort`).

To rebuild without a full Docker build, use the dev container:
`docker build --target native-perl -t zp-native .`, then
`docker run -d --name zpdev -v "$PWD":/src:ro -v /tmp/zp:/work zp-native sleep infinity`.
`docker exec zpdev sh /src/test/dev-wasi.sh` configures and builds WASI perl
once (`dev-resume.sh` resumes its make), and
`docker exec zpdev sh /src/test/dev-wasm.sh` rebuilds the prefix and wasm into
`/tmp/zp/out` after each change.

The released wasm comes from a clean `docker build --no-cache` of the tagged
source. No two builds match byte for byte, because Configure records when it
ran (`cf_time`) in the embedded `Config_heavy.pl`. Re-running the dev
container's prefix step also re-tidies library files that are already tidied,
which changes their spacing.

## Modules

Every module embedded in the wasm was loaded with `require` in a fresh
instance behind piped2's WASI shim: 278 load and 24 do not. Those marked * are
the CPAN additions above.

### Modules that load

Algorithm::Diff\*, Algorithm::DiffOld\*, Archive::Tar,
Archive::Tar::Constant, Archive::Tar::File, Attribute::Handlers, AutoLoader,
AutoSplit, B, B::Concise, B::Op_private, B::Showlex, B::Terse, B::Xref,
Benchmark, CGI::Tiny\*, CGI::Tiny::Multipart\*, CGI::Tiny::_Debug\*, Carp,
Carp::Heavy, Class::Struct, Compress::Raw::Bzip2, Compress::Raw::Zlib,
Compress::Zlib, Config, Config::Extensions, Config::Perl::V, Cwd, DBM_Filter,
DBM_Filter::compress, DBM_Filter::encode, DBM_Filter::int32,
DBM_Filter::null, DBM_Filter::utf8, Data::Dumper, Devel::SelfStubber, Digest,
Digest::MD5, Digest::SHA, Digest::base, Digest::file, DirHandle, Dumpvalue,
DynaLoader, Encode, Encode::Alias, Encode::Byte, Encode::Config,
Encode::EBCDIC, Encode::Encoder, Encode::Encoding, Encode::GSM0338,
Encode::Guess, Encode::MIME::Header, Encode::MIME::Name, Encode::Symbol,
Encode::Unicode, Encode::Unicode::UTF7, English,
Env, Errno, Exporter, Exporter::Heavy, Fatal, Fcntl, File::Basename,
File::Compare, File::Copy, File::Find, File::Glob, File::GlobMapper,
File::Path, File::Spec, File::Spec::AmigaOS, File::Spec::Cygwin,
File::Spec::Epoc, File::Spec::Functions, File::Spec::Mac, File::Spec::OS2,
File::Spec::Unix, File::Spec::Win32, File::Temp, File::stat, FileCache,
FileHandle, Filter::Simple, Filter::Util::Call, FindBin, Getopt::Long,
Getopt::Long::Parser, Getopt::Std, Hash::Util, Hash::Util::FieldHash,
I18N::Collate, I18N::LangTags, I18N::LangTags::Detect, I18N::Langinfo, IO,
IO::Compress, IO::Compress::Adapter::Bzip2, IO::Compress::Adapter::Deflate,
IO::Compress::Adapter::Identity, IO::Compress::Base,
IO::Compress::Base::Common, IO::Compress::Bzip2, IO::Compress::Deflate,
IO::Compress::Gzip, IO::Compress::Gzip::Constants, IO::Compress::RawDeflate,
IO::Compress::Zip, IO::Compress::Zip::Constants,
IO::Compress::Zlib::Constants, IO::Compress::Zlib::Extra, IO::Dir, IO::File,
IO::Handle, IO::Pipe, IO::Poll, IO::Seekable, IO::Select,
IO::Uncompress::Adapter::Bunzip2, IO::Uncompress::Adapter::Identity,
IO::Uncompress::Adapter::Inflate, IO::Uncompress::AnyInflate,
IO::Uncompress::AnyUncompress, IO::Uncompress::Base,
IO::Uncompress::Bunzip2, IO::Uncompress::Gunzip, IO::Uncompress::Inflate,
IO::Uncompress::RawInflate, IO::Uncompress::Unzip, IO::Zlib, JSON::PP,
JSON::PP::Boolean, List::Util, List::Util::XS, Locale::Maketext,
Locale::Maketext::Guts, Locale::Maketext::GutsLoader,
Locale::Maketext::Simple, MIME::Base64, MIME::QuotedPrint, Math::BigFloat,
Math::BigFloat::Trace, Math::BigInt, Math::BigInt::Calc,
Math::BigInt::FastCalc, Math::BigInt::Lib, Math::BigInt::Trace,
Math::BigRat, Math::BigRat::Trace, Math::Complex, Math::Trig, Memoize,
Memoize::Expire, Memoize::Storable, Module::CoreList,
Module::CoreList::Utils, Module::Load, Module::Load::Conditional,
Module::Loaded, Module::Metadata, NEXT, O, Opcode, POSIX, Params::Check,
Parse::CPAN::Meta, Perl::OSType, PerlIO, PerlIO::encoding, PerlIO::mmap,
PerlIO::scalar, PerlIO::via, PerlIO::via::QuotedPrint, Safe,
Scalar::List::Utils, Scalar::Util, Search::Dict, SelectSaver, SelfLoader,
Storable, Sub::Util, Symbol, Sys::Hostname, Term::ANSIColor, Term::Cap,
Term::Complete, Term::ReadLine, Term::Table::CellStack,
Term::Table::HashBase, Term::Table::Spacer, Text::Abbrev, Text::Balanced,
Text::CSV\*, Text::CSV_PP\*, Text::Diff\*, Text::Diff::Config\*,
Text::Diff::Table\*, Text::ParseWords, Text::Tabs, Text::Wrap, Tie::Array,
Tie::File, Tie::Handle, Tie::Hash, Tie::Hash::NamedCapture, Tie::Memoize,
Tie::RefHash, Tie::Scalar, Tie::StdHandle, Tie::SubstrHash, Time::HiRes,
Time::Local, Time::Piece, Time::Seconds, Time::gmtime, Time::localtime,
Time::tm, UNIVERSAL, URI::Escape\*, Unicode::Collate,
Unicode::Collate::Locale, Unicode::Normalize, XML::Tiny\*, XSLoader,
YAML::Tiny\*.

### Pragmas that load

attributes, autodie, autodie::Scope::Guard, autodie::Scope::GuardStack,
autodie::Util, autodie::exception, autodie::exception::system,
autodie::hints, autodie::skip, autouse, base, bigfloat, bigint, bignum,
bigrat, blib, builtin, bytes, constant, deprecate, encoding,
encoding::warnings, experimental, feature, fields, filetest, integer, less,
lib, locale, meta_notation, mro, ops, overload, overload::numbers,
overloading, parent, perlfaq, re, sigtrap, source::encoding, stable, strict,
subs, utf8, vars, version, version::regex, vmsish, warnings,
warnings::register.

`if`, `open` and `sort` are embedded too, but were not checked: their names
are Perl keywords, so `require if` does not parse.

### Embedded but do not load

- No sockets: IO::Socket, IO::Socket::INET, IO::Socket::UNIX.
- No threads: Thread, Thread::Queue, Thread::Semaphore.
- No DBM: AnyDBM_File, Memoize::AnyDBM_File, Memoize::NDBM_File,
  Memoize::SDBM_File.
- Cannot duplicate STDOUT: Term::Table, Term::Table::Cell,
  Term::Table::LineBreak, Term::Table::Util.
- Need what upstream trims: charnames and _charnames (`unicore/Name.pm`, so
  no `\N{NAME}`), diagnostics (`perldiag.pod`), ok (Test::More), File::Fetch
  (IPC::Cmd), I18N::LangTags::List (its data is POD, which the trim strips).
- VMS only: File::Spec::VMS.

## Not available

WASI has no sockets, processes (`fork`, `system`, backticks, pipes to
commands), threads or asynchronous signals. Duplicating a handle with `'>&'`
or `'<&'` (as in saving and restoring STDERR) needs `dup`, which this build
lacks.

Encode's legacy CJK conversions are left out: Encode::JP, KR, CN and TW
(Shift_JIS, EUC-JP, ISO-2022-JP, EUC-KR, GB2312, GBK and Big5), 2.66 MB of
tables. Chinese, Japanese and Korean text in UTF-8 needs none of them.

Upstream also trims modules such
as `Test::*`, `Pod::*` and `HTTP::Tiny` from the embedded library (see
`tools/delete.txt`).
