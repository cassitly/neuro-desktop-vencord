/*
 * Neuro Desktop Vencord integration
 * Copyright (c) 2026 Neuro Desktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { ChannelStore, React, SelectedChannelStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.NeuroDesktop as PluginNative<typeof import("./native")>;
const logger = new Logger("NeuroDesktop");

function report(error: unknown) {
    // The native layer returns only bounded, generic errors without token/body.
    logger.warn(error instanceof Error ? error.message : "Local Neuro Desktop request failed");
}

function selection() {
    const id = SelectedChannelStore.getChannelId();
    const channel = id ? ChannelStore.getChannel(id) : undefined;
    // DMs and group DMs never enter the adapter, even if name sharing is enabled.
    if (!channel?.guild_id) return;
    void Native.publishSelection({ isServer: true, name: channel.name ?? "" }).catch(report);
}

function SharingSession() {
    const [token, setToken] = React.useState("");
    const [message, setMessage] = React.useState("Disconnected. Enter this integration's scoped token for this session.");
    const [busy, setBusy] = React.useState(false);
    return React.createElement("section", { style: { display: "grid", gap: "8px" } },
        React.createElement("p", null, "Only use the integration token for vencord-discord. This field clears after connecting; the token stays in native memory until disconnect or Discord exits."),
        React.createElement("input", {
            type: "password", value: token, autoComplete: "off", spellCheck: false,
            "aria-label": "Neuro Desktop scoped integration token", placeholder: "Scoped integration token",
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => setToken(event.target.value)
        }),
        React.createElement(Button, {
            disabled: busy || !token,
            onClick: async () => {
                setBusy(true);
                const sessionToken = token;
                setToken("");
                try {
                    await Native.connect({
                        port: settings.store.port, token: sessionToken,
                        sharing: settings.store.shareSelectedChannel,
                        includeChannelNames: settings.store.includeChannelNames,
                        actor: settings.store.actor as "neuro" | "evil"
                    });
                    setMessage("Connected. Neuro Desktop must also allow this integration and viewer sharing.");
                    selection();
                } catch {
                    setMessage("Connection failed. Check the local server, scoped token and integration grants.");
                } finally { setBusy(false); }
            }
        }, "Connect this session"),
        React.createElement(Button, {
            variant: "secondary", disabled: busy,
            onClick: async () => {
                setToken("");
                setBusy(true);
                try { await Native.disconnect(); setMessage("Disconnected. Viewer history has been hidden where the server is reachable."); }
                catch { setMessage("Disconnected locally. The server will expire stale activity within 45 seconds."); }
                finally { setBusy(false); }
            }
        }, "Disconnect and hide"),
        React.createElement("p", { role: "status", "aria-live": "polite" }, message)
    );
}

const settings = definePluginSettings({
    port: {
        type: OptionType.NUMBER, default: 8300,
        description: "Local Neuro Desktop port at 127.0.0.1. Changing this disconnects the current session.",
        isValid: value => typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535,
        onChange: () => { void Native.disconnect().catch(report); }
    },
    shareSelectedChannel: {
        type: OptionType.BOOLEAN, default: false,
        description: "Opt in to publishing your selected server channel. DMs, message contents and Discord credentials are never read.",
        onChange: value => { void Native.setSharing(value).then(() => { if (value) selection(); }).catch(report); }
    },
    includeChannelNames: {
        type: OptionType.BOOLEAN, default: false,
        description: "Include a sanitized server-channel name. Changing this disconnects; reconnect to apply.",
        onChange: () => { void Native.disconnect().catch(report); }
    },
    actor: {
        type: OptionType.SELECT,
        description: "Overlay character label only. Desktop selection does not identify who acted. Changing this disconnects.",
        options: [
            { label: "Neuro", value: "neuro", default: true },
            { label: "Evil", value: "evil" }
        ],
        onChange: () => { void Native.disconnect().catch(report); }
    },
    session: { type: OptionType.COMPONENT, component: SharingSession }
});

export default definePlugin({
    name: "NeuroDesktop",
    description: "Share a curated view of your selected Discord server channel with your local Neuro Desktop overlay, when you opt in.",
    // No Discord identity is attributed to this project. Set your own author ID
    // when maintaining a private Vencord build.
    authors: [],
    tags: ["Privacy", "Activity"],
    settings,
    enabledByDefault: false,
    start() { /* Connecting always requires a scoped token entered this session. */ },
    stop() { void Native.disconnect().catch(report); },
    flux: {
        CHANNEL_SELECT() { selection(); },
        LOGOUT() { void Native.disconnect().catch(report); }
    }
});
