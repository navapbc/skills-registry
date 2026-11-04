import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

const contractsDetailDevRewrite = {
  name: 'contracts-detail-dev-rewrite',
  configureServer({ middlewares }) {
    middlewares.use((request, _response, next) => {
      const requestPath = request.url?.split('?')[0] ?? '';
      if (requestPath.startsWith('/contracts/') && !requestPath.includes('.')) {
        request.url = `/contracts${request.url.slice(requestPath.length)}`;
      }
      next();
    });
  },
};

export default defineConfig({
  vite: {
    plugins: [tailwindcss(), contractsDetailDevRewrite],
  },
  output: 'static',
  build: {
    assets: '_astro',
  },
  trailingSlash: 'never',
});
