// Runs zeroperl.wasm behind piped's own synchronous WASI shim, the way piped's
// perl worker will: _initialize, zeroperl_init_with_args(...) & 255, then
// zeroperl_free_interpreter (or zeroperl_flush, to test that path).
// Usage: bun test/piped-check.ts [path/to/zeroperl.wasm]
// Needs a piped checkout beside this repo, or PIPED=/path/to/piped.
// TRACE=1 logs failing WASI calls; ONLY=text runs the cases whose name has it.
const piped = process.env.PIPED ?? `${import.meta.dir}/../../piped`;
const { Exit, wasi } = await import(`${piped}/src/wasm/wasi.ts`);

const wasmPath = process.argv[2] ?? `${import.meta.dir}/../output/zeroperl.wasm`;
const module = new WebAssembly.Module(await Bun.file(wasmPath).arrayBuffer());
const encoder = new TextEncoder();

// No /dev/null here: zeroperl answers it from memory.
const files: Record<string, string> = {
  "/data/b.txt": "B-CONTENT\nsecond b line\n",
  "/data/u.txt": "caf\u00e9 \u263a\n",
};
const folders = new Set(["/", "/dev", "/data"]);

type Result = { code: number; out: string; err: string };

function run(perlArgs: string[], opts: { stdin?: string; flushOnly?: boolean } = {}): Result {
  const out: Record<number, string> = { 1: "", 2: "" };
  const link = {
    ask(call: { kind: string; path?: string }) {
      if (call.kind === "stat") {
        const path = call.path!;
        if (folders.has(path)) return JSON.stringify({ type: "folder", size: 0, modified: 0 });
        if (path in files) return JSON.stringify({ type: "file", size: encoder.encode(files[path]).length, modified: 0 });
        return "null";
      }
      throw new Error(`unexpected ask ${call.kind}`);
    },
    askBytes(call: { path: string }) {
      if (call.path in files) return encoder.encode(files[call.path]);
      throw new Error("no such file");
    },
    ending: () => false,
    stop: (info: { message: string }) => new Error(info.message),
    room: () => {},
    write: (fd: number, text: string) => { out[fd] += text; },
  };
  const start = {
    args: [], env: { HOME: "/data" }, cwd: "/data", stdin: opts.stdin ?? "",
    limits: { memory: 256 * 1024 * 1024, ms: 30_000 }, deadline: Date.now() + 30_000,
  };
  let memory!: WebAssembly.Memory;
  const shim = wasi(start as never, link as never, { root: "/__perl", files: {} }, () => memory);
  const wasiImports = shim.imports(module);
  if (process.env.TRACE) {
    const table = wasiImports.wasi_snapshot_preview1 as Record<string, (...args: number[]) => number>;
    for (const [name, call] of Object.entries(table)) {
      table[name] = (...args: number[]) => {
        const result = call(...args);
        if (result !== 0 && name !== "proc_exit") console.log(`  ${name}(${args.join(", ")}) = ${result}`);
        return result;
      };
    }
  }
  const imports: WebAssembly.Imports = { ...wasiImports, env: { call_host_function: () => 0 } };
  const instance = new WebAssembly.Instance(module, imports);
  const x = instance.exports as Record<string, any>;
  memory = x.memory;
  x._initialize();

  const argv = ["perl", ...perlArgs];
  const ptrs = argv.map((word) => {
    const bytes = encoder.encode(`${word}\0`);
    const at = x.malloc(bytes.length);
    new Uint8Array(memory.buffer).set(bytes, at);
    return at;
  });
  const argvAt = x.malloc(4 * (ptrs.length + 1));
  const view = new DataView(memory.buffer);
  ptrs.forEach((p, i) => view.setUint32(argvAt + 4 * i, p, true));
  view.setUint32(argvAt + 4 * ptrs.length, 0, true);

  let code: number;
  try {
    code = x.zeroperl_init_with_args(argv.length, argvAt) & 255;
    if (opts.flushOnly) x.zeroperl_flush();
    else x.zeroperl_free_interpreter();
  } catch (error) {
    if (error instanceof Exit) code = error.code;
    else throw error;
  }
  shim.flush();
  return { code, out: out[1], err: out[2] };
}

type Case = { name: string; args: string[]; code: number; out?: string | RegExp; err?: string | RegExp; flushOnly?: boolean; was?: string };
const destroy = 'package X; sub DESTROY { print "bye\\n" } package main; my $x = bless {}, "X";';
const cases: Case[] = [
  { name: "print 1", args: ["-e", "print 1"], code: 0, out: "1" },
  { name: "die after use strict", args: ["-e", 'use strict; die "x\\n"'], code: 255, err: /^x$/m, was: "exit 8 (EBADF in $!)" },
  { name: "eval catches die", args: ["-e", 'eval { die "inner\\n" }; print "caught $@"'], code: 0, out: "caught inner\n", err: "" },
  { name: "BEGIN { exit 3 }", args: ["-e", "BEGIN { exit 3 }"], code: 3, was: "exit 1" },
  { name: "syntax error", args: ["-e", "1 +;"], code: 255, err: /syntax error/, was: "exit 1" },
  { name: "-v", args: ["-v"], code: 0, out: /This is perl 5/, was: "exit 1" },
  // $! is WASI's ENOENT, 44 (2 natively)
  { name: "use No::Such", args: ["-e", "use No::Such;"], code: 44, err: /Can't locate No\/Such\.pm/, was: "exit 1" },
  { name: "flush after exit", args: ["-e", 'print "kept"; exit 3'], code: 3, out: "kept", flushOnly: true, was: "output lost" },
  { name: "flush after die", args: ["-e", 'print "kept"; die "d\\n"'], code: 255, out: "kept", flushOnly: true, was: "output lost" },
  { name: "open after library loads", args: ["-e", 'use Carp; use Data::Dumper; use Encode; open my $f, "<", "/data/b.txt" or die "open: $!"; print scalar <$f>'], code: 0, out: "B-CONTENT\n", was: "read package Carp" },
  { name: "40 open files + require", args: ["-e", 'my @h; for (1..40) { open my $h, "<", "/data/b.txt" or die "open $_: $!"; push @h, $h } require Data::Dumper; print scalar(@h), " ", scalar readline($h[39])'], code: 0, out: "40 B-CONTENT\n", was: "proc_exit(10)" },
  { name: "binmode :encoding(UTF-8)", args: ["-e", 'binmode STDOUT, ":encoding(UTF-8)"; print "\\x{263a}\\n"'], code: 0, out: "\u263a\n", was: "Bad file descriptor" },
  { name: "open <:encoding(UTF-8)", args: ["-e", 'open my $f, "<:encoding(UTF-8)", "/data/u.txt" or die "open: $!"; my $l = <$f>; print length($l)'], code: 0, out: "7", was: "Bad file descriptor" },
  { name: "Encode", args: ["-e", 'use Encode; print encode("UTF-8", "\\x{263a}") eq "\\xe2\\x98\\xba" ? "ok" : "no"'], code: 0, out: "ok", was: "Can't locate Storable.pm" },
  { name: "Storable dclone", args: ["-e", 'use Storable qw(dclone); print dclone({a => [1, 2]})->{a}[1]'], code: 0, out: "2", was: "missing" },
  { name: "POSIX", args: ["-e", 'use POSIX qw(floor ceil strftime); print floor(2.7), ceil(2.1), " ", strftime("%Y", gmtime(0)), " ", POSIX::WEXITSTATUS(3 << 8)'], code: 0, out: "23 1970 3", was: "missing" },
  { name: "POSIX mkfifo fails", args: ["-e", 'use POSIX; print POSIX::mkfifo("/data/f", 0600) ? "made" : "failed"'], code: 0, out: "failed" },
  { name: "B", args: ["-e", 'use B; sub foo {} print B::svref_2object(\\&foo)->GV->NAME'], code: 0, out: "foo", was: "missing" },
  { name: "-ne over a file", args: ["-ne", "print if /second/", "/data/b.txt"], code: 0, out: "second b line\n" },
  { name: "JSON::PP", args: ["-MJSON::PP", "-e", 'print JSON::PP->new->canonical->encode({b => [1], a => "x"})'], code: 0, out: '{"a":"x","b":[1]}' },
  { name: "script on stdin", args: [], code: 0, out: "stdin ok", stdin: 'print "stdin ok"' } as Case & { stdin: string },
  { name: "/dev/null read, stat, close", args: ["-e", 'open my $f, "<", "/dev/null" or die "open: $!"; my @l = <$f>; print scalar(@l), (-c "/dev/null" ? " c" : " -"), (-c $f ? " c" : " -"); close $f or die "close: $!"; print " closed"'], code: 0, out: "0 c c closed", err: "", was: "host EROFS/ENOENT" },
  { name: "/dev/null every mode", args: ["-e", 'for my $m ("<", ">", ">>", "+<", "+>") { open my $f, $m, "/dev/null" or die "$m: $!"; print $f "gone" x 1000 if $m ne "<"; close $f or die "close $m: $!" } print "ok"'], code: 0, out: "ok", err: "", was: "EROFS" },
  // open leaves ENOTTY in $! (isatty), so die exits with it: 25 natively, 59 in WASI
  { name: "STDERR to /dev/null", args: ["-e", 'open STDERR, ">", "/dev/null" or die "open: $!"; print STDERR "gone"; warn "warned\\n"; print "out"; die "died\\n"'], code: 59, out: "out", err: "", was: "EROFS" },
  { name: "STDOUT to /dev/null, exit 3", args: ["-e", 'open STDOUT, ">", "/dev/null" or die "open: $!"; print "gone"; exit 3'], code: 3, out: "", err: "" },
  { name: "STDOUT to /dev/null, success", args: ["-e", 'open STDOUT, ">", "/dev/null" or die "open: $!"; print "gone"'], code: 0, out: "", err: "" },
  { name: "STDIN from /dev/null", args: ["-e", 'open STDIN, "<", "/dev/null" or die "open: $!"; my @l = <STDIN>; print scalar @l'], code: 0, out: "0", err: "", stdin: "x\ny\n" } as Case & { stdin: string },
  { name: "$^X is perl", args: ["-e", "print $^X"], code: 0, out: "perl" },
  { name: "-h says perl", args: ["-h"], code: 0, out: /Usage: perl /, err: "" },
  { name: "DESTROY at global destruction", args: ["-e", destroy], code: 0, out: "bye\n", err: "", was: "nothing printed" },
  { name: "DESTROY after exit 3", args: ["-e", `${destroy} exit 3`], code: 3, out: "bye\n", err: "" },
  { name: "DESTROY after die", args: ["-e", `${destroy} die "d\\n"`], code: 255, out: "bye\n", err: /^d$/m },
  { name: "regex loop 300k", args: ["-e", 'my $n = 0; for my $i (1 .. 300000) { $n++ if "abc$i" =~ /c(\\d+)5$/ } print $n'], code: 0, out: "29999", err: "" },
  { name: "CJK in UTF-8", args: ["-e", 'use Encode; print encode_utf8("\\x{65e5}\\x{672c}")'], code: 0, out: "\u65e5\u672c", err: "" },
  { name: "shiftjis gone", args: ["-e", 'use Encode; eval { Encode::decode("shiftjis", "x") }; print $@ =~ /Unknown encoding .shiftjis./ ? "gone" : "here: $@"'], code: 0, out: "gone", err: "" },
];

let failed = 0;
const only = process.env.ONLY;
for (const c of cases.filter((c) => !only || c.name.includes(only))) {
  const started = performance.now();
  let r: Result;
  try {
    r = run(c.args, { flushOnly: c.flushOnly, stdin: (c as { stdin?: string }).stdin });
  } catch (error) {
    failed++;
    console.log(`FAIL ${c.name}: threw ${error}`);
    continue;
  }
  const ms = (performance.now() - started).toFixed(1);
  const problems: string[] = [];
  if (r.code !== c.code) problems.push(`code ${r.code} != ${c.code}`);
  if (c.out !== undefined && !(typeof c.out === "string" ? r.out === c.out : c.out.test(r.out))) problems.push(`out ${JSON.stringify(r.out.slice(0, 200))}`);
  if (c.err !== undefined && !(typeof c.err === "string" ? r.err === c.err : c.err.test(r.err))) problems.push(`err ${JSON.stringify(r.err.slice(0, 200))}`);
  if (problems.length) {
    failed++;
    console.log(`FAIL ${c.name} (${ms} ms): ${problems.join("; ")}${r.err && c.err === undefined ? ` stderr ${JSON.stringify(r.err.slice(0, 200))}` : ""}`);
  } else {
    console.log(`ok   ${c.name} (${ms} ms)${c.was ? ` [was: ${c.was}]` : ""}`);
  }
}
console.log(failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} passed`);
process.exit(failed ? 1 : 0);
