import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createBridge, sanitizeChannelName, validatePort } from "../plugin/transport.mjs";

const TOKEN = "fixture-scoped-integration-token-0123456789";

async function fixture(callback) {
    const seen = [];
    let code = 200;
    let reply = { ok: true };
    const server = http.createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        seen.push({ path: request.url, method: request.method, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
        response.writeHead(code, code === 302 ? { Location: "http://127.0.0.1:1/credential-sink" } : {});
        response.end(Buffer.isBuffer(reply) ? reply : JSON.stringify(reply));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const config = { port: server.address().port, token: TOKEN, sharing: false, includeChannelNames: false, actor: "neuro" };
    try {
        await callback({ seen, config, respond(nextCode, nextReply) { code = nextCode; reply = nextReply; } });
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

test("local port and renderer options cannot select arbitrary URLs or endpoints", () => {
    for (const value of [0, 1, 65536, "8300", 8300.5, NaN, "8300/api/admin", {}, null])
        assert.throws(() => validatePort(value));
    assert.equal(validatePort(8300), 8300);
    const config = { port: 8300, token: TOKEN, sharing: false, includeChannelNames: false, actor: "neuro" };
    for (const invalid of [
        { ...config, token: TOKEN + "\r\nX-ND-Token: admin" },
        { ...config, actor: "operator" }, { ...config, sharing: "yes" },
        { ...config, server: "https://example.org" }, { ...config, endpoint: "/api/admin" }
    ]) assert.throws(() => createBridge(invalid));
});

test("channel labels strip formatting, mentions, links and directional controls", () => {
    assert.equal(sanitizeChannelName("<@123> https://evil.example/\u202e #general\n"), "general");
    assert.equal(sanitizeChannelName("中文 test-1_ok"), "中文 test-1_ok");
    assert.equal(Array.from(sanitizeChannelName("a".repeat(100))).length, 64);
    assert.throws(() => sanitizeChannelName("a".repeat(257)));
});

test("sharing defaults off, DM selection is ignored, and shutdown hides before offline", async () => {
    await fixture(async ({ config, seen }) => {
        const bridge = createBridge(config);
        try {
            await bridge.start();
            assert.equal((await bridge.publishSelection({ isServer: true, name: "secret" })).reason, "sharing_off");
            assert.equal(seen.length, 1);
            await bridge.setSharing(true);
            assert.equal((await bridge.publishSelection({ isServer: false, name: "private DM" })).reason, "private_channel");
            assert.equal(seen.length, 1);
            assert.equal((await bridge.publishSelection({ isServer: true, name: "secret" })).published, true);
            const activity = seen.at(-1);
            assert.deepEqual(activity.body, { actor: "neuro", kind: "discord.channel", summary: "Shared Discord desktop view: a server channel. Selection source; actor unverified." });
            assert.equal((await bridge.publishSelection({ isServer: true, name: "other" })).reason, "unchanged");
            await bridge.setSharing(false);
            assert.equal(seen.at(-1).path, "/api/integrations/vencord-discord/hide");
        } finally { await bridge.stop(); }
        assert.equal(seen.at(-2).path, "/api/integrations/vencord-discord/hide");
        assert.equal(seen.at(-1).body.state, "offline");
        assert.deepEqual(bridge.status(), { connected: false, sharing: false, error: "" });
        for (const request of seen) {
            assert.equal(request.headers["x-nd-integration-token"], TOKEN);
            assert.equal(request.headers["x-nd-token"], undefined);
            assert.equal(request.headers.authorization, undefined);
            assert.ok(!request.path.includes(TOKEN));
            assert.ok(!JSON.stringify(request.body).includes(TOKEN));
        }
    });
});

test("explicit name sharing emits only a sanitized, bounded label", async () => {
    await fixture(async ({ config, seen }) => {
        const bridge = createBridge({ ...config, sharing: true, includeChannelNames: true, actor: "evil" });
        try {
            await bridge.start();
            await bridge.publishSelection({ isServer: true, name: "#general\n<@123>" });
            assert.match(seen.at(-1).body.summary, /#general/);
            assert.ok(!seen.at(-1).body.summary.includes("123"));
            assert.equal(seen.at(-1).body.actor, "evil");
            assert.ok(Array.from(seen.at(-1).body.summary).length <= 500);
        } finally { await bridge.stop(); }
    });
});

test("redirects and server errors cannot forward or echo a scoped token", async () => {
    await fixture(async ({ config, seen, respond }) => {
        const bridge = createBridge(config);
        respond(302, { error: TOKEN });
        await assert.rejects(bridge.start(), error => error.message.includes("302") && !error.message.includes(TOKEN));
        assert.equal(seen.length, 1);
        respond(403, { error: TOKEN });
        await assert.rejects(bridge.setSharing(false), error => !error.message.includes(TOKEN));
        respond(200, { ok: true });
        await bridge.stop();
    });
});

test("responses are bounded and malformed success bodies are rejected", async () => {
    await fixture(async ({ config, respond }) => {
        for (const response of [Buffer.from("not json"), [], Buffer.alloc(256 * 1024 + 1, 32)]) {
            const bridge = createBridge(config);
            respond(200, response);
            await assert.rejects(bridge.start());
            respond(200, { ok: true });
            await bridge.stop();
        }
    });
});
