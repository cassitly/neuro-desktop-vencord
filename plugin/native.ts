/*
 * Neurcro Vencord integration
 * Copyright (c) 2026 Neurcro contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { type Bridge, type ConnectionOptions, createBridge, type Selection } from "./transport.mjs";

let current: Bridge | undefined;
let generation = 0;

export async function connect(_event: Electron.IpcMainInvokeEvent, options: ConnectionOptions) {
    const attempt = ++generation;
    const previous = current;
    current = undefined;
    await previous?.stop();
    if (attempt !== generation) throw new Error("Connection attempt was cancelled");
    const next = createBridge(options);
    current = next;
    try {
        const status = await next.start();
        if (attempt !== generation) throw new Error("Connection attempt was cancelled");
        return status;
    } catch (error) {
        if (current === next) current = undefined;
        await next.stop();
        throw error;
    }
}

export async function disconnect(_event: Electron.IpcMainInvokeEvent) {
    ++generation;
    const previous = current;
    current = undefined;
    await previous?.stop();
    return { connected: false, sharing: false, error: "" };
}

export function status(_event: Electron.IpcMainInvokeEvent) {
    return current?.status() ?? { connected: false, sharing: false, error: "" };
}

export async function setSharing(_event: Electron.IpcMainInvokeEvent, enabled: boolean) {
    if (typeof enabled !== "boolean") throw new TypeError("Sharing choice must be a boolean");
    return current?.setSharing(enabled) ?? { connected: false, sharing: false, error: "" };
}

export async function publishSelection(_event: Electron.IpcMainInvokeEvent, selection: Selection) {
    return current?.publishSelection(selection) ?? { published: false, reason: "disconnected" };
}
