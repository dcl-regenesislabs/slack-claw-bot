import { createServer } from "node:http";

export function startHealthServer(port = 5000): void {
  const server = createServer((req, res) => {
    if (req.url === "/health/live") {
      res.writeHead(200);
      res.end("ok");
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => {
    console.log(`Health check listening on :${port}`);
  });
}
