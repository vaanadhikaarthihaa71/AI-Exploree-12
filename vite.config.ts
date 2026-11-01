import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, Plugin} from 'vite';

function adminRoutePlugin(): Plugin {
  return {
    name: 'admin-route-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ? req.url.split('?')[0] : '';
        if (url === '/admin' || url === '/admin/' || url === '/admin.html') {
          req.url = '/admin.html';
        }
        next();
      });
    },
    closeBundle() {
      // Ensure dist/admin/index.html exists for static hosts like Vercel and Netlify
      try {
        const distDir = path.resolve(__dirname, 'dist');
        const adminHtml = path.resolve(distDir, 'admin.html');
        const adminDir = path.resolve(distDir, 'admin');
        if (fs.existsSync(adminHtml)) {
          fs.mkdirSync(adminDir, { recursive: true });
          fs.copyFileSync(adminHtml, path.resolve(adminDir, 'index.html'));
        }
      } catch (err) {
        console.warn('Could not mirror admin.html to admin/index.html:', err);
      }
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), adminRoutePlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          admin: path.resolve(__dirname, 'admin.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
