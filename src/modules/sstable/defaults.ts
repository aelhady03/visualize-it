/**
 * Default engine configuration (PLAN.md §5.1 `EngineState.config`).
 *
 * The canonical `defaultConfig` constant lives in ./state.ts: state.ts is a
 * PURE file under the ESLint boundary rules (AGENTS.md §6), and engine/**
 * plus lib/** may import only pure files — defaults.ts is not one of them.
 * This file re-exports the same object so the public shape matches the
 * PLAN.md §6 file layout (state.ts + defaults.ts).
 */

export { defaultConfig, defaultEngineConfig } from "./state";
