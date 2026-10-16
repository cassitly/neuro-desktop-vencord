/* SPDX-License-Identifier: GPL-3.0-or-later */
export interface ConnectionOptions {
    port: number;
    token: string;
    sharing: boolean;
    includeChannelNames: boolean;
    actor: "neuro" | "evil";
}
export interface BridgeStatus {
    connected: boolean;
    sharing: boolean;
    error: string;
}
export interface Selection {
    isServer: boolean;
    name?: string;
}
export interface Bridge {
    start(): Promise<BridgeStatus>;
    status(): BridgeStatus;
    setSharing(enabled: boolean): Promise<BridgeStatus>;
    publishSelection(selection: Selection): Promise<{published: boolean; reason?: string}>;
    stop(): Promise<void>;
}
export function validatePort(port: unknown): number;
export function sanitizeChannelName(name: unknown): string;
export function createBridge(options: ConnectionOptions): Bridge;
