#!/usr/bin/env -S deno run --allow-all
// Re-vendors the Foxglove ROS 2 modules source/ros.js loads (the CDR codec, the standard message definitions and the
// .msg parser) into source/vendor/ros/, bundled for the browser from npm at exact versions (dependencies too), so pages
// load them from their own vendored copy, with no CDN:
//
//     deno run -A tools/vendor_ros.js
//
// To move a version, change it in PACKAGES and run it again.
const PACKAGES = {
    "@foxglove/rosmsg2-serialization": "3.1.2",
    "@foxglove/rosmsg-msgs-common": "3.3.0",
    "@foxglove/rosmsg": "5.0.5",
    // their dependencies, pinned so the bundle doesn't move with their semver ranges
    "@foxglove/cdr": "3.5.1",
    "@foxglove/rostime": "1.1.3",
    "@foxglove/message-definition": "0.5.0",
}
const npm = (name) => `npm:${name}@${PACKAGES[name]}`
const pins = ["@foxglove/cdr", "@foxglove/rostime", "@foxglove/message-definition"].map((name) =>
    `import "${npm(name)}"`
)
    .join("\n")
// the CommonJS packages' exports, named (an `export *` of CommonJS bundles to nothing)
const ENTRIES = {
    serialization: `${pins}\nexport { MessageReader, MessageWriter } from "${
        npm("@foxglove/rosmsg2-serialization")
    }"\n`,
    definitions: `${pins}\nexport * from "${npm("@foxglove/rosmsg-msgs-common")}"\n`,
    parser: `${pins}\nimport * as rosmsg from "${
        npm("@foxglove/rosmsg")
    }"\nexport const { parse, stringify } = rosmsg\nexport default { parse, stringify }\n`,
}

const repo = new URL("../", import.meta.url)
const out = new URL("source/vendor/ros/", repo)
const work = await Deno.makeTempDir({ prefix: "vendor_ros_" })
await Deno.writeTextFile(`${work}/deno.json`, "{}")
for (const [name, code] of Object.entries(ENTRIES)) {
    await Deno.writeTextFile(`${work}/${name}.js`, code)
}
const bundle = await new Deno.Command(Deno.execPath(), {
    args: [
        "bundle",
        "--platform",
        "browser",
        "--code-splitting",
        "--minify",
        "--outdir",
        "out",
        ...Object.keys(ENTRIES).map((name) => `${name}.js`),
    ],
    cwd: work,
}).output()
if (!bundle.success) {
    console.error(new TextDecoder().decode(bundle.stderr))
    Deno.exit(1)
}

// every npm package in the bundle (from deno's lockfile), each one's license text
const lock = JSON.parse(await Deno.readTextFile(`${work}/deno.lock`))
const info = JSON.parse(
    new TextDecoder().decode((await new Deno.Command(Deno.execPath(), { args: ["info", "--json"] }).output()).stdout),
)
const licenses = []
for (const key of Object.keys(lock.npm ?? {}).sort()) {
    const at = key.lastIndexOf("@")
    const [name, version] = [key.slice(0, at), key.slice(at + 1)]
    const dir = `${info.npmCache}/registry.npmjs.org/${name}/${version}`
    const license = [...Deno.readDirSync(dir)].find((entry) => /^licen[sc]e/i.test(entry.name))
    if (!license) {
        throw new Error(`${name}@${version}: no license file in ${dir}`)
    }
    licenses.push(`${name}@${version}\n\n${(await Deno.readTextFile(`${dir}/${license.name}`)).trim()}\n`)
}

await Deno.remove(out, { recursive: true }).catch(() => {})
await Deno.mkdir(out, { recursive: true })
const header = `// license: ./LICENSE\n// Bundled by tools/vendor_ros.js from npm: ${
    Object.entries(PACKAGES).map(([name, version]) => `${name}@${version}`).join(", ")
}. Don't edit; re-run it.\n`
for (const entry of Deno.readDirSync(`${work}/out`)) {
    const text = await Deno.readTextFile(`${work}/out/${entry.name}`)
    await Deno.writeTextFile(new URL(entry.name, out), header + text)
    console.log(`source/vendor/ros/${entry.name}`)
}
await Deno.writeTextFile(new URL("LICENSE", out), licenses.join("\n---\n\n"))
await Deno.remove(work, { recursive: true })
