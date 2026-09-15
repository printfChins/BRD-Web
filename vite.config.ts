import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // [新增] GitHub Pages 專案網址為 /BRD-Web/，Build 後資源路徑必須帶入此 Base Path。
    base: '/BRD-Web/',

    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      // [保留] AI Studio 使用 DISABLE_HMR 控制 HMR。
      hmr: process.env.DISABLE_HMR !== 'true',

      // [保留] DISABLE_HMR=true 時關閉檔案監看。
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
