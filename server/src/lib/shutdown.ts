export function createShutdown(server: { close(callback: () => void): unknown }, closeDb: () => void) {
  let shuttingDown = false;
  return () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    server.close(() => {
      clearTimeout(timeout);
      closeDb();
      process.exit(0);
    });
  };
}
