import * as net from "net";
import type { DbType } from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("ssh2");

export interface TunnelHandle {
  localPort: number;
  close: () => void;
}

export interface SshConfig {
  host: string;
  port?: number;
  user: string;
  auth_type?: "password" | "key";
  password?: string;
  private_key?: string;
  passphrase?: string;
}

const tunnelCache = new Map<number, TunnelHandle>();

export function parseDbTarget(dbType: DbType, connectionString: string): { host: string; port: number } {
  if (dbType === "postgres" || dbType === "mysql" || dbType === "mariadb") {
    const url = new URL(connectionString);
    const defaultPort = dbType === "postgres" ? 5432 : 3306;
    return { host: url.hostname, port: url.port ? parseInt(url.port, 10) : defaultPort };
  }
  if (dbType === "mssql") {
    const m = connectionString.match(/Server=([^,;\s]+)(?:,(\d+))?/i);
    if (!m) throw new Error("Cannot parse MSSQL Server host from connection string");
    return { host: m[1], port: m[2] ? parseInt(m[2], 10) : 1433 };
  }
  throw new Error("SSH tunneling is not supported for SQLite");
}

export function rewriteForTunnel(dbType: string, connectionString: string, localPort: number): string {
  if (dbType === "postgres" || dbType === "mysql" || dbType === "mariadb") {
    const url = new URL(connectionString);
    url.hostname = "127.0.0.1";
    url.port = String(localPort);
    return url.toString();
  }
  if (dbType === "mssql") {
    return connectionString.replace(/Server=[^,;\s]+(?:,\d+)?/i, `Server=127.0.0.1,${localPort}`);
  }
  return connectionString;
}

export async function openTunnel(sshCfg: SshConfig, dbHost: string, dbPort: number): Promise<TunnelHandle> {
  return new Promise((resolve, reject) => {
    const sshClient = new Client();
    const activeSockets: net.Socket[] = [];

    const server = net.createServer((sock) => {
      activeSockets.push(sock);
      sock.on("close", () => {
        const i = activeSockets.indexOf(sock);
        if (i !== -1) activeSockets.splice(i, 1);
      });

      sshClient.forwardOut("127.0.0.1", sock.remotePort ?? 0, dbHost, dbPort, (err: Error | null, stream: NodeJS.ReadWriteStream) => {
        if (err) { sock.destroy(); return; }
        sock.pipe(stream).pipe(sock);
        stream.on("close", () => sock.destroy());
        sock.on("close", () => (stream as NodeJS.WritableStream).end?.());
      });
    });

    server.once("error", (err) => { sshClient.end(); reject(err); });

    server.listen(0, "127.0.0.1", () => {
      const { port: localPort } = server.address() as net.AddressInfo;

      const connectConfig: Record<string, unknown> = {
        host: sshCfg.host,
        port: sshCfg.port ?? 22,
        username: sshCfg.user,
        readyTimeout: 20000,
      };

      if (sshCfg.auth_type === "key" && sshCfg.private_key) {
        connectConfig.privateKey = sshCfg.private_key;
        if (sshCfg.passphrase) connectConfig.passphrase = sshCfg.passphrase;
      } else {
        connectConfig.password = sshCfg.password;
      }

      sshClient.once("error", (err: Error) => { server.close(); reject(err); });

      sshClient.once("ready", () => {
        resolve({
          localPort,
          close: () => {
            activeSockets.forEach((s) => s.destroy());
            server.close();
            sshClient.end();
          },
        });
      });

      sshClient.connect(connectConfig);
    });
  });
}

export async function ensureTunnel(connId: number, sshCfg: SshConfig, dbType: DbType, connectionString: string): Promise<TunnelHandle> {
  if (tunnelCache.has(connId)) return tunnelCache.get(connId)!;
  const { host, port } = parseDbTarget(dbType, connectionString);
  const handle = await openTunnel(sshCfg, host, port);
  tunnelCache.set(connId, handle);
  return handle;
}

export function closeTunnel(connId: number): void {
  const handle = tunnelCache.get(connId);
  if (handle) {
    try { handle.close(); } catch { /* ignore */ }
    tunnelCache.delete(connId);
  }
}
