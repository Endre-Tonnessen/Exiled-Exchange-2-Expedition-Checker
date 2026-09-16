import { defineConfig } from "vitest/config";

// `main` had no test runner before this; the renderer's vitest is a separate
// install with a separate config, and reaching across packages to borrow it
// would have dragged main's electron imports into the renderer's suite. See
// LOCAL_DIVERGENCE.md for the (additive) change this makes to main/package.json.
//
// No setup file on purpose. The OpenCV bootstrap the pixel tests need is slow
// and only some of them need it, so it is an explicit `await loadCv()` in those
// specs (see specs/support/cv.ts) rather than a cost every spec pays.
export default defineConfig({
  test: {
    include: ["specs/**/*.test.ts"],
    // Loading the OpenCV WASM build and walking a few hundred KB of fixture
    // pixels is well past vitest's 5s default, especially on a cold run.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The rune suite's whole output is an accuracy table it prints when it
    // finishes; the default reporter buffers console output away from a passing
    // run, which would hide the one number the suite exists to report.
    disableConsoleIntercept: true,
  },
});
