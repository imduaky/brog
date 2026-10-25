import { defineConfig } from 'tsdown'

// Backend-only bundle. Runtime packages in "dependencies" stay external, so a
// backend deployment needs `pnpm install --prod` (no frontend packages).
export default defineConfig({
  entry: { main: 'src/server/main.ts' },
  outDir: 'dist/server',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  dts: false,
  sourcemap: true,
})
