// Static server for development: like `python -m http.server`, but sends `Cache-Control: no-store`,
// so the browser never keeps an old copy of a module after the files change.
// Usage: npm start            (port 8000, or PORT=9000 npm start)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8000;
// For testing the fallback path: SOMATA_JS_MIME=text/plain imitates python's http.server on Windows.
const jsMime = process.env.SOMATA_JS_MIME;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.plist': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};
http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      res
        .writeHead(200, {
          'Content-Type':
            path.extname(file) === '.js' && jsMime
              ? jsMime
              : types[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        })
        .end(data);
    });
  })
  .listen(port, () => console.log(`Somata: http://localhost:${port}/`));
