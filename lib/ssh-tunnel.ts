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
const tunnelOpeningCache = new Map<number, Promise<TunnelHandle>>();

// Extract host and port from a URL-style connection string without using the URL
// API, so passwords containing @, #, ?, or / do not confuse the parser.
// Strategy: the hostname can never contain @, so the LAST @ in the authority
// section is always the userinfo separator.
function splitUrlHostPort(connStr: string, defaultPort: number): { host: string; port: number } {
  const schemeEnd = connStr.indexOf("://");
  const afterScheme = schemeEnd !== -1 ? connStr.slice(schemeEnd + 3) : connStr;
  const atIdx = afterScheme.lastIndexOf("@");
  const fromHost = atIdx !== -1 ? afterScheme.slice(atIdx + 1) : afterScheme;
  const stopAt = fromHost.search(/[/?#]/);
  const hostPort = stopAt !== -1 ? fromHost.slice(0, stopAt) : fromHost;
  const colonIdx = hostPort.lastIndexOf(":");
  const host = colonIdx !== -1 ? hostPort.slice(0, colonIdx) : hostPort;
  const portStr = colonIdx !== -1 ? hostPort.slice(colonIdx + 1) : "";
  return { host, port: portStr ? parseInt(portStr, 10) : defaultPort };
}

function rewriteUrlHostPort(connStr: string, newHost: string, newPort: number): string {
  const schemeEnd = connStr.indexOf("://");
  const afterScheme = schemeEnd !== -1 ? connStr.slice(schemeEnd + 3) : connStr;
  const prefix = schemeEnd !== -1 ? connStr.slice(0, schemeEnd + 3) : "";
  const atIdx = afterScheme.lastIndexOf("@");
  const userInfo = atIdx !== -1 ? afterScheme.slice(0, atIdx + 1) : "";
  const fromHost = atIdx !== -1 ? afterScheme.slice(atIdx + 1) : afterScheme;
  const stopAt = fromHost.search(/[/?#]/);
  const suffix = stopAt !== -1 ? fromHost.slice(stopAt) : "";
  return `${prefix}${userInfo}${newHost}:${newPort}${suffix}`;
}

export function parseDbTarget(dbType: DbType, connectionString: string): { host: string; port: number } {
  if (dbType === "postgres" || dbType === "mysql" || dbType === "mariadb") {
    const defaultPort = dbType === "postgres" ? 5432 : 3306;
    return splitUrlHostPort(connectionString, defaultPort);
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
    return rewriteUrlHostPort(connectionString, "127.0.0.1", localPort);
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
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      if (sshCfg.auth_type === "key" && sshCfg.private_key) {
        connectConfig.privateKey = sshCfg.private_key;
        if (sshCfg.passphrase) connectConfig.passphrase = sshCfg.passphrase;
      } else {
        connectConfig.password = sshCfg.password;
      }

      sshClient.once("error", (err: Error) => { server.close(); reject(err); });

      sshClient.once("ready", () => {
        const handle: TunnelHandle = {
          localPort,
          close: () => {
            activeSockets.forEach((s) => s.destroy());
            server.close();
            sshClient.end();
          },
        };

        // When the SSH connection closes unexpectedly, tear down the local server
        // and destroy any in-flight sockets so pool connections fail fast.
        sshClient.once("close", () => { handle.close(); });

        resolve(handle);
      });

      sshClient.connect(connectConfig);
    });
  });
}

export async function ensureTunnel(connId: number, sshCfg: SshConfig, dbType: DbType, connectionString: string, onDrop?: () => void): Promise<TunnelHandle> {
  if (tunnelCache.has(connId)) return tunnelCache.get(connId)!;
  // Deduplicate concurrent callers — only open one tunnel per connId at a time
  if (tunnelOpeningCache.has(connId)) return tunnelOpeningCache.get(connId)!;

  const { host, port } = parseDbTarget(dbType, connectionString);
  const promise = openTunnel(sshCfg, host, port).then((handle) => {
    tunnelCache.set(connId, handle);
    tunnelOpeningCache.delete(connId);
    // Wrap close so we evict the cache entry when the tunnel is torn down (planned or dropped)
    const origClose = handle.close;
    let closed = false;
    handle.close = () => {
      if (closed) return;
      closed = true;
      tunnelCache.delete(connId);
      onDrop?.();
      try { origClose(); } catch { /* ignore */ }
    };
    return handle;
  }).catch((err) => {
    tunnelOpeningCache.delete(connId);
    throw err;
  });

  tunnelOpeningCache.set(connId, promise);
  return promise;
}

export function closeTunnel(connId: number): void {
  const handle = tunnelCache.get(connId);
  if (handle) {
    try { handle.close(); } catch { /* ignore */ }
    tunnelCache.delete(connId);
  }
}
