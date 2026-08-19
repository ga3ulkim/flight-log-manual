import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Keep Vite's sensitive-file defaults when extending the deny list.
const PRIVATE_FILE_GLOBS = [
  '.env',
  '.env.*',
  '*.{crt,pem}',
  '**/.git/**',
  '**/flight-log-chart.html',
  '**/flight-log-chart.jsx',
  '**/*.csv',
  '**/*.xls',
  '**/*.xlsx',
  '**/flight-log-backup-*.json',
];

function isLocalOnlyPath(value: string): boolean {
  const normalized = value.split(/[?#]/, 1)[0].replace(/\\/g, '/').toLowerCase();
  const pathParts = normalized.split('/');
  const fileName = pathParts[pathParts.length - 1] ?? '';
  return (
    normalized === 'flight-log-chart.html' ||
    normalized.endsWith('/flight-log-chart.html') ||
    normalized === 'flight-log-chart.jsx' ||
    normalized.endsWith('/flight-log-chart.jsx') ||
    normalized.endsWith('.csv') ||
    normalized.endsWith('.xls') ||
    normalized.endsWith('.xlsx') ||
    /^flight-log-backup-\d{4}-\d{2}-\d{2}\.json$/.test(fileName)
  );
}

function denyPrivateFlightData(): Plugin {
  const requestGuard = (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): void => {
    let pathname = request.url ?? '/';
    try {
      pathname = decodeURIComponent(new URL(pathname, 'http://localhost').pathname);
    } catch {
      // Leave malformed URLs untouched and let Vite handle them normally.
    }

    if (!isLocalOnlyPath(pathname)) {
      next();
      return;
    }

    response.statusCode = 404;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Local-only reference and flight data files are not served by this application.');
  };

  return {
    name: 'deny-private-flight-data',
    enforce: 'pre',
    resolveId(source) {
      if (isLocalOnlyPath(source)) {
        throw new Error(`Importing local-only project data is disabled: ${source}`);
      }
      return null;
    },
    configureServer(server) {
      server.middlewares.use(requestGuard);
    },
    configurePreviewServer(server) {
      server.middlewares.use(requestGuard);
    },
  };
}

/** Resolve a project-site base only inside GitHub Actions production builds. */
export function githubPagesBase(command: string): string {
  if (command !== 'build' || process.env.GITHUB_ACTIONS !== 'true') return '/';

  const repositoryParts = (process.env.GITHUB_REPOSITORY ?? '').split('/');
  if (repositoryParts.length !== 2) return '/';

  const [owner, repository] = repositoryParts;
  if (!owner || !repository) return '/';

  return repository.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? '/'
    : `/${repository}/`;
}

export default defineConfig(({ command }) => ({
  base: githubPagesBase(command),
  // This application has no public assets; disabling publicDir prevents local
  // flight files from ever being copied to dist by Vite's passthrough step.
  publicDir: false,
  plugins: [denyPrivateFlightData(), react()],
  optimizeDeps: {
    // Do not let Vite discover the ignored local reference HTML as an app entry.
    entries: ['index.html'],
  },
  server: {
    host: '127.0.0.1',
    fs: {
      deny: PRIVATE_FILE_GLOBS,
    },
  },
  preview: {
    host: '127.0.0.1',
  },
}));
