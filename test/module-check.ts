// Requires every embedded module in a fresh zeroperl instance behind piped's
// WASI shim. Usage: bun test/module-check.ts zeroperl.wasm embedded-pm.txt
// where embedded-pm.txt lists the prefix the wasm was built from:
//   docker exec zpdev find /zeroperl/lib -name '*.pm' | sort > embedded-pm.txt
// Needs a piped checkout beside this repo, or PIPED=/path/to/piped.
const piped = process.env.PIPED ?? `${import.meta.dir}/../../piped`;
const { Exit, wasi } = await import(`${piped}/src/wasm/wasi.ts`);

const [wasmPath, listPath] = process.argv.slice(2);
const module = new WebAssembly.Module(await Bun.file(wasmPath).arrayBuffer());
const encoder = new TextEncoder();
const files: Record<string, string> = {};
const folders = new Set(["/", "/dev", "/data"]);

function run(perlArgs: string[]) {
  const out: Record<number, string> = { 1: "", 2: "" };
  const link = {
    ask(call: { kind: string; path?: string }) {
      const path = call.path!;
      if (folders.has(path)) return JSON.stringify({ type: "folder", size: 0, modified: 0 });
      if (path in files) return JSON.stringify({ type: "file", size: files[path].length, modified: 0 });
      return "null";
    },
    askBytes: (call: { path: string }) => encoder.encode(files[call.path] ?? ""),
    ending: () => false,
    stop: (info: { message: string }) => new Error(info.message),
    room: () => {},
    write: (fd: number, text: string) => { out[fd] += text; },
  };
  const start = {
    args: [], env: { HOME: "/data" }, cwd: "/data", stdin: "",
    limits: { memory: 256 * 1024 * 1024, ms: 30_000 }, deadline: Date.now() + 30_000,
  };
  let memory!: WebAssembly.Memory;
  const shim = wasi(start as never, link as never, { root: "/__perl", files: {} }, () => memory);
  const instance = new WebAssembly.Instance(module, { ...shim.imports(module), env: { call_host_function: () => 0 } });
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
    x.zeroperl_free_interpreter();
  } catch (error) {
    if (error instanceof Exit) code = error.code;
    else return { code: -1, out: out[1], err: `${out[2]}trap: ${error}` };
  }
  shim.flush();
  return { code, out: out[1], err: out[2] };
}

const names = (await Bun.file(listPath).text()).trim().split("\n").map((path) =>
  path.replace(/^\/zeroperl\/lib\/5\.42\.0\/(wasm32-wasi\/)?/, "").replace(/\.pm$/, "").replaceAll("/", "::"));

let ok = 0;
for (const name of names) {
  const r = run(["-e", `require ${name}; print "ok"`]);
  if (r.code === 0 && r.out === "ok") {
    ok++;
    console.log(`ok ${name}`);
  } else {
    console.log(`FAIL ${name}: ${r.err.split("\n")[0].slice(0, 160)}`);
  }
}
console.log(`${ok} of ${names.length} load`);
