import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(async () => {
  const plugins = [tailwindcss()]
  try {
    const m = await import('./.vite-source-tags.js')
    plugins.push(m.sourceTags())
  } catch { /* 選用的開發外掛，不存在時忽略 */ }
  return {
    plugins,
    server: { host: true, allowedHosts: true },
    preview: { host: true, allowedHosts: true },
    build: { target: 'es2022' },
  }
})
