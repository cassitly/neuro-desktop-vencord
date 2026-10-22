/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (c) 2026 Neurcro contributors
 */
import http from "node:http";

const INTEGRATION_ID = "vencord-discord";
const MAX_RESPONSE = 256 * 1024;
const TIMEOUT_MS = 8_000;
const TOKEN = /^[A-Za-z0-9._~-]{16,256}$/;
const ACTORS = new Set(["neuro", "evil"]);

export function validatePort(port) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
        throw new TypeError("Neurcro port must be an integer between 1024 and 65535");
    return port;
}

export function sanitizeChannelName(name) {
    if (typeof name !== "string" || name.length > 256) throw new TypeError("Channel name must be text of at most 256 code units");
    // Remove markup, mentions, links, directional formatting and control chars.
    // A summary is plain text; no Discord IDs, messages or URLs are copied.
    return Array.from(name.normalize("NFKC")
        .replace(/<[@#][!&]?[0-9]+>/gu, "")
        .replace(/https?:\/\/\S+/giu, "")
        .replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim()).slice(0, 64).join("");
}

function validateOptions(options) {
    if (!options || typeof options !== "object" || Array.isArray(options))
        throw new TypeError("Connection settings must be an object");
    if (Object.keys(options).sort().join(",") !== "actor,includeChannelNames,port,sharing,token")
        throw new TypeError("Only the defined local connection settings are accepted");
    const { port, token, sharing, includeChannelNames, actor } = options;
    validatePort(port);
    if (typeof token !== "string" || !TOKEN.test(token))
        throw new TypeError("Use the scoped integration token from Neurcro");
    if (typeof sharing !== "boolean" || typeof includeChannelNames !== "boolean" || !ACTORS.has(actor))
        throw new TypeError("Invalid sharing settings");
    return { port, token, sharing, includeChannelNames, actor };
}

function request(port, token, endpoint, body) {
    // endpoint is chosen only by this module, never by the renderer or IPC.
    if (!["heartbeat", "activity", "hide"].includes(endpoint))
        throw new TypeError("Unsupported Neurcro endpoint");
    const data = Buffer.from(JSON.stringify(body), "utf8");
    if (data.length > 4096) throw new TypeError("Activity exceeds the local request limit");
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            error ? reject(error) : resolve(value);
        };
        const req = http.request({
            hostname: "127.0.0.1", port,
            path: `/api/integrations/${INTEGRATION_ID}/${endpoint}`,
            method: "POST", agent: false,
            headers: {
                "X-ND-Integration-Token": token,
                "Content-Type": "application/json", "Accept": "application/json",
                "Content-Length": data.length
            }
        }, response => {
            const chunks = [];
            let size = 0;
            response.on("data", chunk => {
                size += chunk.length;
                if (size > MAX_RESPONSE) {
                    finish(new Error("Neurcro response exceeded 256 KiB"));
                    response.destroy();
                    req.destroy();
                } else chunks.push(chunk);
            });
            response.on("error", () => finish(new Error("Neurcro response was interrupted")));
            response.on("end", () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    finish(new Error(`Neurcro denied the request (HTTP ${response.statusCode}); check grants and visibility`));
                    return;
                }
                try {
                    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
                    finish(null, result);
                } catch {
                    finish(new Error("Neurcro returned invalid JSON"));
                }
            });
        });
        req.on("error", () => finish(new Error("Cannot reach the local Neurcro server")));
        // Node's socket timeout alone can be prolonged by a trickling response.
        // Use one deadline for the complete request instead.
        timer = setTimeout(() => {
            finish(new Error("Local Neurcro request timed out"));
            req.destroy();
        }, TIMEOUT_MS);
        timer.unref?.();
        req.end(data);
    });
}

export function createBridge(options) {
    const config = validateOptions(options);
    let token = config.token;
    let sharing = config.sharing;
    let stopped = false;
    let started = false;
    let timer;
    let pendingHeartbeat;
    let lastError = "";
    let lastSummary = "";
    let lastPublish = 0;
    let stopping;

    async function heartbeat(state = "ready") {
        const result = await request(config.port, token, "heartbeat", { state, message: sharing ? "Vencord connected; local channel sharing enabled" : "Vencord connected; local channel sharing disabled" });
        lastError = "";
        return result;
    }

    function schedule() {
        if (stopped) return;
        timer = setTimeout(async () => {
            pendingHeartbeat = heartbeat();
            try { await pendingHeartbeat; }
            catch (error) { lastError = error.message; }
            finally { pendingHeartbeat = undefined; schedule(); }
        }, 15_000);
        timer.unref?.();
    }

    const bridge = {
        async start() {
            if (started || stopped) throw new Error("This connection cannot be started again");
            started = true;
            pendingHeartbeat = heartbeat();
            try { await pendingHeartbeat; }
            finally { pendingHeartbeat = undefined; }
            schedule();
            return bridge.status();
        },
        status() {
            return { connected: started && !stopped, sharing: !stopped && sharing, error: lastError };
        },
        async setSharing(enabled) {
            if (typeof enabled !== "boolean") throw new TypeError("Sharing choice must be a boolean");
            if (stopped) return { connected: false, sharing: false, error: "" };
            sharing = enabled;
            lastSummary = "";
            if (!enabled) await request(config.port, token, "hide", {});
            return bridge.status();
        },
        async publishSelection(selection) {
            if (stopped || !sharing) return { published: false, reason: "sharing_off" };
            if (!selection || typeof selection !== "object" || selection.isServer !== true)
                return { published: false, reason: "private_channel" };
            const name = config.includeChannelNames ? sanitizeChannelName(selection.name ?? "") : "";
            const summary = `Shared Discord desktop view: ${name ? `#${name}` : "a server channel"}. Selection source; actor unverified.`;
            if (summary === lastSummary) return { published: false, reason: "unchanged" };
            if (Date.now() - lastPublish < 2000) return { published: false, reason: "rate_limited" };
            lastPublish = Date.now();
            await request(config.port, token, "activity", { actor: config.actor, kind: "discord.channel", summary });
            lastSummary = summary;
            return { published: true };
        },
        async stop() {
            if (stopping) return stopping;
            stopped = true;
            sharing = false;
            clearTimeout(timer);
            stopping = (async () => {
                // Finish an earlier ready heartbeat before recording offline.
                try { await pendingHeartbeat; } catch { /* hide/offline still run */ }
                try { await request(config.port, token, "hide", {}); } catch { /* expiry is the fallback */ }
                try { await heartbeat("offline"); } catch { /* readiness expires after 45 seconds */ }
                finally { token = ""; config.token = ""; }
            })();
            return stopping;
        }
    };
    return bridge;
}
